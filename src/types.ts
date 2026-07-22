// Public types — these are the contract for `@adfinia/sdk-web`.
// Breaking changes here require a major version bump.

/** Free-form JSON-shaped properties bag. */
export type Properties = Record<string, unknown>

/**
 * Closed set of acquisition-source enum values the platform accepts on
 * `identify()`. Mirrors api/internal/identity/models.go `ValidSources`
 * — keep in lockstep with the Go struct's `validate:"oneof=..."` tag.
 *
 * Empty / omitted is also valid and means "leave the existing
 * contacts.source untouched" on the server side.
 */
export type IdentifySource =
  | 'google_ads'
  | 'meta_ads'
  | 'tiktok_ads'
  | 'snapchat_ads'
  | 'organic'
  | 'csv'
  | 'api'
  | 'crm'
  | 'sdk_web'
  | 'sdk_ios'
  | 'sdk_android'
  | 'sdk_react_native'
  | 'sdk_flutter'

/**
 * Gender enum accepted by `identify()`. The brief lists the four canonical
 * values; the server column is free-text TEXT so additional values are
 * allowed in the wire protocol, but the typed surface stays narrow so
 * consumers get autocomplete + lint coverage.
 */
export type IdentifyGender =
  | 'male'
  | 'female'
  | 'non_binary'
  | 'prefer_not_to_say'

/**
 * Strongly-typed shape for `identify()` traits.
 *
 * Mirrors `api/internal/identity/models.go` `IdentifyTraits` exactly —
 * every key here matches the Go struct's `json:"..."` tag, so the SDK can
 * pass the traits bag straight to the wire without renaming. The api is
 * the wire-protocol authority; if anything drifts, the api wins.
 *
 * All fields are optional. Unset fields are omitted from the JSON body —
 * never serialised as `null` or empty string — so the server's
 * "empty means untouched" semantics work cleanly.
 *
 * Tenants with custom contact fields can still pass arbitrary keys via
 * the `extra` bag (Record<string, string>); first-class fields stay
 * typed.
 */
export interface IdentifyTraits {
  // Identifier fields — drive alias attachment on the server.
  /** Email address. Resolves to an `email` alias on the identity graph. */
  email?: string
  /** Phone in E.164 (e.g. `+971501234567`). Resolves to a `phone` alias. */
  phone?: string
  /** Device-scoped identifier. Resolves to a `device_id` alias. */
  device_id?: string
  /** Tenant-side CRM / external system ID. Resolves to an `external_id` alias. */
  external_id?: string

  // Descriptive fields — update typed columns on contacts.
  first_name?: string
  last_name?: string

  /**
   * Acquisition-source enum. The web SDK defaults this to `sdk_web` at the
   * call site if the caller omits it; pass an explicit value to override
   * (e.g. when re-identifying a contact already attributed to `google_ads`).
   * Empty string is treated by the server as "leave existing value alone".
   */
  source?: IdentifySource

  // UTM bundle — first-touch lands on contacts.first_touch JSONB on
  // contact creation; last-touch on every Identify call that carries any
  // UTM key.
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string

  /** BCP 47 language tag, e.g. `en-AE`, `ar-AE`, `hi-IN`. Drives template selection. */
  language?: string
  /** IANA timezone, e.g. `Asia/Dubai`. Drives AI send-time scheduling. */
  timezone?: string
  /** ISO 3166-1 alpha-2 country code, e.g. `AE`. */
  country?: string
  /** City — free text. Segment filter + AI personalisation only. */
  city?: string

  /**
   * WhatsApp number in E.164. Separate channel from `phone` — many tenants
   * ship the same value to both, but enterprise tenants route SMS to
   * `phone` and WhatsApp to `whatsapp` independently.
   */
  whatsapp?: string

  /** Gender. See {@link IdentifyGender}. */
  gender?: IdentifyGender
  /** Date of birth in ISO 8601 date format `YYYY-MM-DD`. */
  date_of_birth?: string

  /** Open-ended bag for tenant-specific custom-field values. */
  extra?: Record<string, string>
}

/**
 * Traits passed to identify(). Accepts the strongly-typed `IdentifyTraits`
 * shape OR an open record for tenants with custom field schemas. Both
 * pass through to the server unchanged.
 *
 * Union (not intersection) so callers can hand us either form without
 * TypeScript requiring an index signature on `IdentifyTraits` — that's
 * what would otherwise force every typed field to also satisfy
 * `Record<string, unknown>`, which closed interfaces don't.
 */
export type Traits = IdentifyTraits | Record<string, unknown>

/**
 * Consent gate. The SDK invokes this on every public API call. Returning
 * `false` drops the call silently (no buffering, no network). Returning
 * `true` lets the SDK proceed as normal.
 *
 * Omit to assume consent (server-side / pre-consented contexts).
 */
export type ConsentFn = () => boolean

/**
 * Consent status for setConsent() / optIn() / optOut(). The only two values
 * the wire accepts. Emitted as the `status` property on the
 * `consent_updated` event.
 */
export type ConsentStatus = 'opted_in' | 'opted_out'

/**
 * A consent channel. Deliberately an OPEN string, NOT an enum: the backend
 * owns the valid-channel registry (email/whatsapp/sms/push today, extensible
 * to rcs/voice/app_notification later). The SDK passes whatever channel
 * string it is given so new backend channels work with no SDK release.
 */
export type ConsentChannel = string

export interface AdfiniaConfig {
  /**
   * The tenant's write-only public key, issued from the Adfinia console at
   * `/settings/integrations/sdk-keys`. Prefixed `pk_live_` or `pk_test_`.
   * Safe to bundle in client-side code.
   */
  writeKey: string

  /**
   * Override the ingest host. Defaults to `https://api.adfinia.com`.
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
  // Note: `alias` was removed as a payload type in 1.4.0. alias() is now a
  // deprecated no-op (no server-side handler), so no alias event is ever
  // produced. See CHANGELOG.md [1.4.0].
  type: 'track' | 'identify' | 'page' | 'screen'
  event?: string
  customer_id?: string
  /**
   * Tenant-owned external identity (e.g. wallet hash). Emitted on the wire
   * as `external_id`. Server resolution order: customer_id > external_id >
   * anonymous_id.
   */
  external_id?: string
  anonymous_id: string
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
