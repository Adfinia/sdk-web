import { buildContext } from './context'
import { IdentityStore } from './identity'
import { EventQueue } from './queue'
import { createStorage, type KVStore } from './storage'
import { HttpTransport, type Transport } from './transport'
import type {
  AdfiniaConfig,
  AdfiniaPayload,
  ConsentFn,
  IdentifyArg,
  Properties,
  Traits,
} from './types'
import { uuidv7 } from './uuid'

const DEFAULT_HOST = 'https://events.adfinia.com'
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
    Pick<AdfiniaConfig, 'storage'> & { consent?: ConsentFn }
  private identityStore!: IdentityStore
  private queue!: EventQueue
  private transport!: Transport
  private storage!: KVStore
  private now: () => Date
  private initialised = false
  private unloadHandler: (() => void) | null = null

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
  }

  identify(arg: IdentifyArg, maybeTraits?: Traits): void {
    if (!this.guard('identify')) return
    let customerId: string | undefined
    let anonymousId: string | undefined
    let traits: Traits | undefined

    if (typeof arg === 'string') {
      customerId = arg
      traits = maybeTraits
    } else if (arg && typeof arg === 'object') {
      customerId = arg.customerId
      anonymousId = arg.anonymousId
      traits = arg.traits ?? maybeTraits
    }

    this.identityStore.identify(customerId, traits, anonymousId)
    this.enqueue({
      type: 'identify',
      customer_id: this.identityStore.customerId(),
      anonymous_id: this.identityStore.anonymousId(),
      traits: this.identityStore.traits(),
    })
  }

  track(event: string, properties?: Properties): void {
    if (!this.guard('track')) return
    if (!event || typeof event !== 'string') {
      this.debug('track() called without an event name — dropped')
      return
    }
    this.enqueue({
      type: 'track',
      event,
      customer_id: this.identityStore.customerId(),
      anonymous_id: this.identityStore.anonymousId(),
      properties,
    })
  }

  page(name?: string, properties?: Properties): void {
    if (!this.guard('page')) return
    this.enqueue({
      type: 'page',
      event: name,
      customer_id: this.identityStore.customerId(),
      anonymous_id: this.identityStore.anonymousId(),
      properties,
    })
  }

  screen(name?: string, properties?: Properties): void {
    // Web SDK exposes screen() for API parity with the mobile/RN SDKs;
    // on the web it behaves identically to page().
    if (!this.guard('screen')) return
    this.enqueue({
      type: 'screen',
      event: name,
      customer_id: this.identityStore.customerId(),
      anonymous_id: this.identityStore.anonymousId(),
      properties,
    })
  }

  alias(newId: string, previousId?: string): void {
    if (!this.guard('alias')) return
    if (!newId) {
      this.debug('alias() called without a newId — dropped')
      return
    }
    const prev = previousId ?? this.identityStore.customerId() ?? this.identityStore.anonymousId()
    this.enqueue({
      type: 'alias',
      customer_id: newId,
      anonymous_id: this.identityStore.anonymousId(),
      previous_id: prev,
    })
    // After alias, the customer_id is now the new id.
    this.identityStore.identify(newId)
  }

  reset(): void {
    if (!this.initialised) return
    this.identityStore.reset()
    this.debug('identity reset — new anonymous_id minted')
  }

  async flush(): Promise<void> {
    if (!this.initialised) return
    await this.queue.flush()
  }

  /** Internal — exposed for tests. */
  _identityStore(): IdentityStore {
    return this.identityStore
  }

  /** Internal — exposed for tests. */
  _queueLength(): number {
    return this.queue.drainAll().length
  }

  private enqueue(partial: Omit<AdfiniaPayload, 'context' | 'sent_at' | 'message_id'>): void {
    const payload: AdfiniaPayload = {
      ...partial,
      context: buildContext(),
      sent_at: this.now().toISOString(),
      message_id: uuidv7(),
    }
    this.queue.enqueue(payload)
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
    // Best-effort flush on page hide. We use `visibilitychange` (the modern
    // recommendation) and fall back to `pagehide` for Safari.
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    this.unloadHandler = () => {
      void this.queue.flush()
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.unloadHandler?.()
      }
    })
    window.addEventListener('pagehide', () => this.unloadHandler?.())
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function safeConsentCheck(fn: ConsentFn): boolean {
  try {
    return !!fn()
  } catch {
    // If consent throws, treat it as no-consent (fail-closed).
    return false
  }
}
