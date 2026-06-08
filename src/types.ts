// Public types — these are the contract for `@adfinia/sdk-web`.
// Breaking changes here require a major version bump.

/** Free-form JSON-shaped properties bag. */
export type Properties = Record<string, unknown>

/** Traits passed to identify(). Same shape as Properties — distinct alias for docs. */
export type Traits = Record<string, unknown>

/**
 * Consent gate. The SDK invokes this on every public API call. Returning
 * `false` drops the call silently (no buffering, no network). Returning
 * `true` lets the SDK proceed as normal.
 *
 * Omit to assume consent (server-side / pre-consented contexts).
 */
export type ConsentFn = () => boolean

export interface AdfiniaConfig {
  /**
   * The tenant's write-only public key, issued from the Adfinia console at
   * `/settings/integrations/sdk-keys`. Prefixed `pk_live_` or `pk_test_`.
   * Safe to bundle in client-side code.
   */
  writeKey: string

  /**
   * Override the ingest host. Defaults to `https://events.adfinia.com`.
   * Self-hosted tenants point this at their own ingress.
   */
  host?: string

  /**
   * Log SDK internals to `console.debug`. Off by default.
   */
  debug?: boolean

  /**
   * Consent gate. See {@link ConsentFn}. If omitted, the SDK assumes
   * consent.
   */
  consent?: ConsentFn

  /**
   * Override the batch flush interval in ms. Default 5000.
   */
  flushIntervalMs?: number

  /**
   * Override the batch size that triggers an immediate flush. Default 50.
   */
  flushAt?: number

  /**
   * Override the max queue size. Default 1000 — events past this are
   * dropped (oldest first).
   */
  maxQueueSize?: number

  /**
   * Override the storage backend. Defaults to `localStorage` if available,
   * otherwise in-memory. Useful for testing.
   */
  storage?: Storage | null

  /**
   * Opt in to automatic browser-context collection on every event.
   *
   * When `true`, every `track / page / screen / identify / alias` call is
   * enriched with a context block containing `page_path`, `page_url`,
   * `referrer`, `user_agent`, `locale`, `timezone`, `viewport`,
   * `screen_resolution`, `library`, `library_version`. Per-event context
   * passed by the caller wins on key collisions.
   *
   * When enabled, the SDK ALSO captures the **first-touch acquisition**
   * context from the first session URL — `utm_source/medium/campaign/
   * term/content`, the click IDs `gclid/fbclid/ttclid/sc/msclkid`, and the
   * landing page. First-touch is persisted once: later events keep the
   * original acquisition values even after the user navigates away.
   *
   * Defaults to **false** — privacy-first. Adfinia never collects browser
   * context implicitly; the host app explicitly enables it.
   */
  autoContext?: boolean

  /**
   * Auto-fire `page()` on initial load and on SPA route changes
   * (`history.pushState` / `replaceState` / `popstate`). Default **true**
   * in a browser; set to `false` to wire page tracking by hand.
   *
   * The first auto page() fires on `init()`; subsequent ones fire when the
   * URL path or search changes. A hash-only change does not re-fire.
   */
  autoPage?: boolean
}

/**
 * Per-call options for `track / page / screen`. Carries an optional
 * `context` map that gets merged on top of the auto-collected context
 * (caller wins on collision), plus an optional per-call `externalId` —
 * a tenant-owned stable identity (e.g. a wallet hash) that resolves to a
 * customer ahead of the anonymous id on the server.
 */
export interface CallOptions {
  context?: Record<string, string>
  /**
   * Tenant-owned external identity for this call (e.g. a wallet address).
   * Persisted in the identity ledger and emitted on the wire as
   * `external_id`. The server resolves identity in the order
   * customer_id > external_id > anonymous_id.
   */
  externalId?: string
}

/** What identify() accepts: either a customer_id string, or a full object. */
export type IdentifyArg =
  | string
  | {
      customerId?: string
      /**
       * Tenant-owned external identity (e.g. a wallet hash). First-class
       * alongside customerId — persisted and emitted on the wire as
       * `external_id`. PredictStreet sends the wallet hash here.
       */
      externalId?: string
      anonymousId?: string
      traits?: Traits
      /** Optional per-call context map. Merged over auto-context; caller wins. */
      context?: Record<string, string>
    }

/** Internal event shape, written to the wire. */
export interface AdfiniaPayload {
  type: 'track' | 'identify' | 'page' | 'screen' | 'alias'
  event?: string
  customer_id?: string
  /**
   * Tenant-owned external identity (e.g. wallet hash). Emitted on the wire
   * as `external_id`. Server resolution order: customer_id > external_id >
   * anonymous_id.
   */
  external_id?: string
  anonymous_id: string
  previous_id?: string
  properties?: Properties
  traits?: Traits
  context: AdfiniaContext
  /**
   * Auto-context flat string map (populated when init({ autoContext: true })).
   * Layered into the wire `context` by the transport. Internal — not part of
   * the public API.
   */
  auto_context?: Record<string, string>
  /**
   * Per-call user-supplied context. Wins over both `auto_context` and the
   * default flattened context on key collision. Internal.
   */
  user_context?: Record<string, string>
  sent_at: string
  message_id: string
}

export interface AdfiniaContext {
  library: { name: string; version: string }
  user_agent?: string
  locale?: string
  timezone?: string
  page?: { url?: string; referrer?: string; title?: string; path?: string }
  screen?: { width?: number; height?: number }
}

/** Identity slice persisted across reloads. */
export interface AdfiniaIdentity {
  anonymousId: string
  customerId?: string
  /** Tenant-owned external identity (e.g. wallet hash). Persisted. */
  externalId?: string
  traits?: Traits
}
