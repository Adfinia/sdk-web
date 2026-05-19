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
}

/** What identify() accepts: either a customer_id string, or a full object. */
export type IdentifyArg =
  | string
  | {
      customerId?: string
      anonymousId?: string
      traits?: Traits
    }

/** Internal event shape, written to the wire. */
export interface AdfiniaPayload {
  type: 'track' | 'identify' | 'page' | 'screen' | 'alias'
  event?: string
  customer_id?: string
  anonymous_id: string
  previous_id?: string
  properties?: Properties
  traits?: Traits
  context: AdfiniaContext
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
  traits?: Traits
}
