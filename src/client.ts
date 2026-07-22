import { buildAutoContext, buildContext, firstTouchAcquisition } from './context'
import { IdentityStore } from './identity'
import { EventQueue } from './queue'
import { createStorage, type KVStore } from './storage'
import { HttpTransport, type Transport } from './transport'
import type {
  AdfiniaConfig,
  AdfiniaPayload,
  CallOptions,
  ConsentChannel,
  ConsentFn,
  ConsentStatus,
  IdentifyArg,
  Properties,
  Traits,
} from './types'
import { uuidv7 } from './uuid'
import { SDK_VERSION_HEADER } from './version'

const DEFAULT_HOST = 'https://api.adfinia.com'
const DEFAULT_FLUSH_AT = 50
const DEFAULT_FLUSH_INTERVAL = 5_000

/**
 * Hooks the SDK can use to swap dependencies in tests. Not part of the
 * public surface; exported for `tests/` only.
 */
export interface ClientHooks {
  transport?: Transport
  store?: KVStore
  now?: () => Date
}

/**
 * Adfinia client. One instance per page. The exported singleton in
 * `index.ts` wraps this class; advanced consumers (e.g. multi-tenant
 * server-side) can construct extra instances themselves.
 */
export class AdfiniaClient {
  private config!: Required<Omit<AdfiniaConfig, 'storage' | 'consent'>> &
    Pick<AdfiniaConfig, 'storage'> & { consent?: ConsentFn; autoContext: boolean; autoPage: boolean }
  private identityStore!: IdentityStore
  private queue!: EventQueue
  private transport!: Transport
  private storage!: KVStore
  private now: () => Date
  private initialised = false
  private unloadHandler: (() => void) | null = null
  /** Last path+search auto-page() fired for — guards against double-fire. */
  private lastAutoPageUrl: string | null = null
  /** Guards the one-time deprecation warning emitted by alias(). */
  private aliasDeprecationWarned = false
  /** Guards the one-time invalid-status warning emitted by setConsent(). */
  private consentStatusWarned = false
  /** Restores the patched history methods on teardown (tests). */
  private restoreHistory: (() => void) | null = null

  constructor(private hooks: ClientHooks = {}) {
    this.now = hooks.now ?? (() => new Date())
  }

  init(config: AdfiniaConfig): void {
    if (this.initialised) {
      this.debug('init() called twice — ignoring')
      return
    }
    if (!config.writeKey) {
      throw new Error('@adfinia/sdk-web: writeKey is required')
    }

    this.config = {
      writeKey: config.writeKey,
      host: stripTrailingSlash(config.host ?? DEFAULT_HOST),
      debug: !!config.debug,
      consent: config.consent,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL,
      flushAt: config.flushAt ?? DEFAULT_FLUSH_AT,
      maxQueueSize: config.maxQueueSize ?? 1000,
      autoContext: !!config.autoContext,
      // Default ON in a browser; opt-out via autoPage: false. Off when
      // there's no History API (Node / SSR).
      autoPage: config.autoPage ?? true,
      storage: config.storage,
    }

    this.storage = this.hooks.store ?? createStorage(this.config.storage)
    this.identityStore = new IdentityStore(this.storage)
    this.transport =
      this.hooks.transport ?? new HttpTransport(this.config.host, this.config.writeKey)
    this.queue = new EventQueue({
      store: this.storage,
      transport: this.transport,
      flushAt: this.config.flushAt,
      flushIntervalMs: this.config.flushIntervalMs,
      maxQueueSize: this.config.maxQueueSize,
      debug: (msg, extra) => this.debug(msg, extra),
    })

    this.attachUnloadFlush()
    this.initialised = true
    this.debug('initialised', { host: this.config.host })

    // Auto page-view tracking — fires once on load, then on SPA route
    // changes. Must run AFTER initialised = true so the first page() isn't
    // dropped by the guard. No-op when autoPage is off or there's no
    // History API.
    if (this.config.autoPage) {
      this.attachAutoPage()
    }

    // Best-effort: pull per-tenant runtime config from the server. The
    // server endpoint (GET /api/v1/sdk/config) returns batch_size /
    // flush_interval_ms / sampling_rate / breaker thresholds; we apply
    // the knobs we understand and ignore the rest (forward-compat: an
    // older SDK never breaks because the server adds a new knob).
    //
    // Fire-and-forget — a config-fetch failure must not block events.
    void this.fetchRemoteConfig()
  }

  /**
   * Hits GET /api/v1/sdk/config and updates the queue's flush thresholds
   * if the response disagrees with the local defaults. Soft-fails on any
   * network / parse error — the client keeps running on its embedded
   * defaults.
   */
  private async fetchRemoteConfig(): Promise<void> {
    if (typeof globalThis.fetch !== 'function') return
    try {
      const res = await globalThis.fetch(`${this.config.host}/api/v1/sdk/config`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.config.writeKey}`,
          'x-adfinia-sdk-version': SDK_VERSION_HEADER,
        },
      })
      if (!res.ok) {
        // 426 → SDK too old. Log a single warning, keep running with
        // local defaults — the server still accepts events from older
        // versions until the cutoff lands.
        if (res.status === 426) {
          this.debug('sdk version is below the server-side minimum — please upgrade @adfinia/sdk-web')
        }
        return
      }
      const cfg = (await res.json()) as Partial<{
        batch_size: number
        flush_interval_ms: number
        sampling_rate: number
        breaker_open_threshold: number
        breaker_cool_off_ms: number
        api_host_override: string
      }>
      this.queue.applyRemoteConfig({
        flushAt: cfg.batch_size,
        flushIntervalMs: cfg.flush_interval_ms,
      })
      this.debug('remote config applied', cfg)
    } catch (err) {
      this.debug('remote config fetch failed — sticking with defaults', err)
    }
  }

  identify(arg: IdentifyArg, maybeTraits?: Traits): void {
    if (!this.guard('identify')) return
    let customerId: string | undefined
    let externalId: string | undefined
    let anonymousId: string | undefined
    let traits: Traits | undefined
    let userContext: Record<string, string> | undefined

    if (typeof arg === 'string') {
      customerId = arg
      traits = maybeTraits
    } else if (arg && typeof arg === 'object') {
      customerId = arg.customerId
      externalId = arg.externalId
      anonymousId = arg.anonymousId
      traits = arg.traits ?? maybeTraits
      userContext = arg.context
    }

    this.identityStore.identify(customerId, traits, anonymousId, externalId)
    this.enqueue({
      type: 'identify',
      customer_id: this.identityStore.customerId(),
      external_id: this.identityStore.externalId(),
      anonymous_id: this.identityStore.anonymousId(),
      traits: this.identityStore.traits(),
    }, userContext)
  }

  track(event: string, properties?: Properties, options?: CallOptions): void {
    if (!this.guard('track')) return
    if (!event || typeof event !== 'string') {
      this.debug('track() called without an event name — dropped')
      return
    }
    this.identityStore.setExternalId(options?.externalId)
    this.enqueue({
      type: 'track',
      event,
      customer_id: this.identityStore.customerId(),
      external_id: this.identityStore.externalId(),
      anonymous_id: this.identityStore.anonymousId(),
      properties,
    }, options?.context)
  }

  page(name?: string, properties?: Properties, options?: CallOptions): void {
    if (!this.guard('page')) return
    this.identityStore.setExternalId(options?.externalId)
    this.enqueue({
      type: 'page',
      event: name,
      customer_id: this.identityStore.customerId(),
      external_id: this.identityStore.externalId(),
      anonymous_id: this.identityStore.anonymousId(),
      properties,
    }, options?.context)
  }

  screen(name?: string, properties?: Properties, options?: CallOptions): void {
    // Web SDK exposes screen() for API parity with the mobile/RN SDKs;
    // on the web it behaves identically to page().
    if (!this.guard('screen')) return
    this.identityStore.setExternalId(options?.externalId)
    this.enqueue({
      type: 'screen',
      event: name,
      customer_id: this.identityStore.customerId(),
      external_id: this.identityStore.externalId(),
      anonymous_id: this.identityStore.anonymousId(),
      properties,
    }, options?.context)
  }

  /**
   * Record a consent decision for one or more channels. Write-only: the SDK
   * key can set consent but never read it back (there is intentionally no
   * getConsent()).
   *
   * `channels` accepts a single channel string OR an array of channel
   * strings. Channels are OPEN strings, not an enum: the backend owns the
   * valid-channel registry (email/whatsapp/sms/push today, extensible to
   * rcs/voice/app_notification later), so whatever channel value is passed
   * is forwarded and future backend channels work with no SDK release. We
   * only trim + lowercase for consistency.
   *
   * Emits exactly ONE event:
   *   track('consent_updated', { channels: [<normalized>], status })
   * where `channels` is ALWAYS an array on the wire (even for one channel).
   *
   * Never throws. An invalid `status` logs a one-time debug warning and
   * sends nothing. An empty channel list is a soft no-op (debug note).
   */
  setConsent(channels: ConsentChannel | ConsentChannel[], status: ConsentStatus): void {
    if (status !== 'opted_in' && status !== 'opted_out') {
      if (!this.consentStatusWarned) {
        this.consentStatusWarned = true
        this.debug(
          `setConsent() called with invalid status "${String(status)}" — expected "opted_in" or "opted_out"; nothing sent`,
        )
      }
      return
    }
    const list = normalizeChannels(channels)
    if (list.length === 0) {
      this.debug('setConsent() called with no channels — nothing sent')
      return
    }
    // Reuse the standard track path: guard (init + consent gate), enqueue,
    // transport. The backend ConsentSink consumes `consent_updated`.
    this.track('consent_updated', { channels: list, status })
  }

  /** Shorthand for setConsent(channels, 'opted_in'). */
  optIn(channels: ConsentChannel | ConsentChannel[]): void {
    this.setConsent(channels, 'opted_in')
  }

  /** Shorthand for setConsent(channels, 'opted_out'). */
  optOut(channels: ConsentChannel | ConsentChannel[]): void {
    this.setConsent(channels, 'opted_out')
  }

  /**
   * @deprecated Deprecated: alias() is a no-op (no server-side handler). Anonymous sessions are promoted automatically by identify(). This method will be removed in the next major version.
   */
  alias(newId: string, previousId?: string): void {
    // No-op by design. There is no server-side alias handler; the backend only
    // processes track + identify. Anonymous->known promotion already happens
    // automatically via identify() (the identify event carries the live
    // anonymous_id). We intentionally do NOT enqueue or transmit any event.
    //
    // The signature is kept identical so existing callers still compile; the
    // arguments are deliberately unused.
    void newId
    void previousId
    if (!this.aliasDeprecationWarned) {
      this.aliasDeprecationWarned = true
      this.debug(
        'alias() is deprecated and is now a no-op (no server-side handler); anonymous sessions are promoted automatically by identify(). This method will be removed in the next major version.',
      )
    }
  }

  reset(): void {
    if (!this.initialised) return
    this.identityStore.reset()
    this.debug('identity reset — new anonymous_id minted')
  }

  /**
   * Drain the in-memory + persisted queue to the server.
   *
   * Returns a Promise that resolves once the in-flight batch settles (ok or
   * permanent drop). Use this before a critical navigation to maximise the
   * chance the last events land:
   *
   *     await Adfinia.flush()
   *     router.push('/checkout/confirmation')
   *
   * The Promise rejects only if the underlying transport throws — network
   * failures surface as a transient retry inside the queue, not a rejection.
   */
  async flush(): Promise<void> {
    if (!this.initialised) return
    await this.queue.flush()
  }

  /**
   * Internal accessor used by the web-push module. Surfaces the bits the
   * subscription flow needs without widening the public surface:
   * the authenticated transport, the current identity, the host (for an
   * optional /sdk/config VAPID fetch), the write key, a track() shim, and
   * the debug logger. Returns null before init().
   */
  _webPushBridge(): {
    transport: Transport
    host: string
    writeKey: string
    identity: () => { customer_id?: string; external_id?: string; anonymous_id: string }
    track: (event: string, properties?: Properties) => void
    debug: (msg: string, extra?: unknown) => void
  } | null {
    if (!this.initialised) return null
    return {
      transport: this.transport,
      host: this.config.host,
      writeKey: this.config.writeKey,
      identity: () => ({
        customer_id: this.identityStore.customerId(),
        external_id: this.identityStore.externalId(),
        anonymous_id: this.identityStore.anonymousId(),
      }),
      track: (event, properties) => this.track(event, properties),
      debug: (msg, extra) => this.debug(msg, extra),
    }
  }

  /** Internal — exposed for tests. */
  _identityStore(): IdentityStore {
    return this.identityStore
  }

  /** Internal — exposed for tests. */
  _queueLength(): number {
    return this.queue.drainAll().length
  }

  private enqueue(
    partial: Omit<
      AdfiniaPayload,
      'context' | 'sent_at' | 'message_id' | 'auto_context' | 'user_context'
    >,
    userContext?: Record<string, string>,
  ): void {
    const payload: AdfiniaPayload = {
      ...partial,
      context: buildContext(),
      auto_context: this.config.autoContext ? this.autoContextWithAcquisition() : undefined,
      user_context: userContext,
      sent_at: this.now().toISOString(),
      message_id: uuidv7(),
    }
    this.queue.enqueue(payload)
  }

  /**
   * Browser auto-context + first-touch acquisition, merged. Acquisition
   * (campaign.* + page.landing) layers UNDER the live browser fields so a
   * collision (there shouldn't be one — disjoint key spaces) resolves to the
   * live value. Both still sit under the user_context layer applied by the
   * transport, so a caller's `{ context }` always wins.
   */
  private autoContextWithAcquisition(): Record<string, string> {
    const base = buildAutoContext()
    const acq = firstTouchAcquisition(this.storage)
    if (!acq) return base
    return { ...acq, ...base }
  }

  private guard(label: string): boolean {
    if (!this.initialised) {
      // Allow logs but no events — init() not called yet.
      if (typeof console !== 'undefined') {
        console.warn(`@adfinia/sdk-web: ${label}() called before init()`)
      }
      return false
    }
    if (this.config.consent && !safeConsentCheck(this.config.consent)) {
      this.debug(`${label}() dropped — consent gate returned false`)
      return false
    }
    return true
  }

  private debug(message: string, extra?: unknown): void {
    if (!this.config?.debug) return
    if (typeof console === 'undefined') return
    if (extra !== undefined) {
      console.debug(`[adfinia] ${message}`, extra)
    } else {
      console.debug(`[adfinia] ${message}`)
    }
  }

  private attachUnloadFlush(): void {
    // Drain via `navigator.sendBeacon` on tab close / hide. This is the only
    // delivery path that reliably survives a closing tab — `fetch()` with
    // `keepalive: true` is the documented fallback when sendBeacon isn't
    // available (Node tests, very old browsers, or sendBeacon refusing the
    // payload).
    //
    // We listen for both `visibilitychange === 'hidden'` (modern Safari +
    // Chrome — fires when the user switches tabs / minimises / closes) and
    // `pagehide` (the back-compat path that fires on actual unload). Either
    // path is idempotent: a second beacon with an empty queue is a no-op.
    if (typeof document === 'undefined' || typeof window === 'undefined') return

    this.unloadHandler = () => {
      // Drain everything the queue is currently holding — both the in-memory
      // buffer and any persisted backlog. The queue clears its store on
      // drainAll(), so a follow-up visibilitychange won't re-fire stale
      // events.
      const pending = this.queue.drainAll()
      if (pending.length === 0) return
      try {
        this.transport.sendBeacon(pending)
      } catch (err) {
        this.debug('sendBeacon failed — events on the unload path may be lost', err)
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.unloadHandler?.()
      }
    })
    window.addEventListener('pagehide', () => this.unloadHandler?.())
  }

  /**
   * Auto page-view tracking for SPAs. Fires `page()` on:
   *
   *   - initial load (once, synchronously on init),
   *   - `history.pushState` / `history.replaceState` (monkey-patched),
   *   - `popstate` (back/forward).
   *
   * De-dupes by path+search: a navigation that lands on the same path+search
   * the SDK already fired for is ignored (covers replaceState no-ops and a
   * pushState immediately followed by a popstate to the same URL). Hash-only
   * changes are NOT counted as a new page.
   */
  private attachAutoPage(): void {
    if (
      typeof window === 'undefined' ||
      typeof history === 'undefined' ||
      typeof history.pushState !== 'function'
    ) {
      return
    }

    const fire = () => {
      const url = this.currentPathSearch()
      if (url === this.lastAutoPageUrl) return
      this.lastAutoPageUrl = url
      this.page()
    }

    // Initial load.
    fire()

    const origPush = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)

    history.pushState = (...args: Parameters<History['pushState']>) => {
      const ret = origPush(...args)
      fire()
      return ret
    }
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      const ret = origReplace(...args)
      fire()
      return ret
    }

    const onPop = () => fire()
    window.addEventListener('popstate', onPop)

    this.restoreHistory = () => {
      history.pushState = origPush
      history.replaceState = origReplace
      window.removeEventListener('popstate', onPop)
    }
  }

  private currentPathSearch(): string {
    if (typeof window === 'undefined' || !window.location) return ''
    return (window.location.pathname || '') + (window.location.search || '')
  }

  /** Internal — tear down history patches + listeners. Exposed for tests. */
  _teardownAutoPage(): void {
    this.restoreHistory?.()
    this.restoreHistory = null
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Normalize a single channel string or an array into a clean string array:
 * drop non-strings, trim, lowercase, drop empties. Does NOT reject unknown
 * channel values — the backend owns the valid-channel registry.
 */
function normalizeChannels(channels: string | string[]): string[] {
  const arr = Array.isArray(channels) ? channels : [channels]
  return arr
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0)
}

function safeConsentCheck(fn: ConsentFn): boolean {
  try {
    return !!fn()
  } catch {
    // If consent throws, treat it as no-consent (fail-closed).
    return false
  }
}
