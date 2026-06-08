import type { KVStore } from './storage'
import type { AdfiniaContext } from './types'
import { LIBRARY_NAME, LIBRARY_VERSION } from './version'

/** Storage key for the first-touch acquisition map (set once per browser). */
const ACQUISITION_KEY = 'adfinia:acquisition'

/** UTM query params we lift into the acquisition map (server key `campaign.<utm>`). */
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

/** Ad-platform click identifiers (server key `campaign.<clickid>`). */
const CLICK_ID_PARAMS = ['gclid', 'fbclid', 'ttclid', 'sc', 'msclkid'] as const

/**
 * Build the per-event context block. Stays browser-safe — every DOM/Navigator
 * access is guarded so the SDK runs in Node, in workers, and on SSR.
 *
 * This is the "minimal, privacy-preserving" context used regardless of the
 * `autoContext` flag — it just carries library identifiers + the few fields
 * the existing wire schema documents. For richer auto-collection, see
 * {@link buildAutoContext}.
 */
export function buildContext(): AdfiniaContext {
  const ctx: AdfiniaContext = {
    library: { name: LIBRARY_NAME, version: LIBRARY_VERSION },
  }

  if (typeof navigator !== 'undefined') {
    ctx.user_agent = navigator.userAgent
    ctx.locale = navigator.language
  }

  try {
    if (typeof Intl !== 'undefined') {
      ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  } catch {
    /* timezone unavailable */
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    ctx.page = {
      url: window.location?.href,
      path: window.location?.pathname,
      referrer: document.referrer || undefined,
      title: document.title || undefined,
    }
    if (window.screen) {
      ctx.screen = { width: window.screen.width, height: window.screen.height }
    }
  }

  return ctx
}

/**
 * Build the opt-in browser-context map. Returns a flat `Record<string,string>`
 * shaped to the server's `context map[string]string` contract (see
 * api/internal/identity/models.go IdentifyRequest/TrackRequest).
 *
 * Populated keys (omitted when the underlying source isn't available):
 *
 *   page_path, page_url, referrer, user_agent, locale, timezone,
 *   viewport, screen_resolution, library, library_version
 *
 * Only fired when `init({ autoContext: true })` is set. Default OFF —
 * Adfinia treats browser context as opt-in for privacy.
 *
 * Caller-supplied context wins on key collision (see `client.enqueue`).
 */
export function buildAutoContext(): Record<string, string> {
  const out: Record<string, string> = {
    library: LIBRARY_NAME,
    library_version: LIBRARY_VERSION,
  }

  if (typeof navigator !== 'undefined') {
    if (navigator.userAgent) out.user_agent = navigator.userAgent
    if (navigator.language) out.locale = navigator.language
  }

  try {
    if (typeof Intl !== 'undefined') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) out.timezone = tz
    }
  } catch {
    /* timezone unavailable */
  }

  if (typeof window !== 'undefined') {
    if (window.location) {
      if (window.location.href) out.page_url = window.location.href
      if (window.location.pathname) out.page_path = window.location.pathname
    }
    // Viewport — pixels, narrow tolerance for SSR / headless.
    if (typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number') {
      out.viewport = `${window.innerWidth}x${window.innerHeight}`
    }
    if (window.screen) {
      out.screen_resolution = `${window.screen.width}x${window.screen.height}`
    }
  }

  if (typeof document !== 'undefined' && document.referrer) {
    out.referrer = document.referrer
  }

  return out
}

/**
 * Read the acquisition signals (UTM tags, ad-platform click IDs, landing
 * page) from the CURRENT URL. Returns a flat map shaped to the server's
 * `context map[string]string` contract:
 *
 *   campaign.utm_source, campaign.utm_medium, campaign.utm_campaign,
 *   campaign.utm_term, campaign.utm_content,
 *   campaign.gclid, campaign.fbclid, campaign.ttclid, campaign.sc,
 *   campaign.msclkid,
 *   page.landing  (the landing URL, sans hash)
 *
 * Empty values are omitted. SSR / non-browser → empty map.
 */
export function readAcquisitionFromUrl(): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof window === 'undefined' || !window.location) return out

  let params: URLSearchParams | undefined
  try {
    params = new URLSearchParams(window.location.search || '')
  } catch {
    params = undefined
  }

  if (params) {
    for (const k of UTM_PARAMS) {
      const v = params.get(k)
      if (v) out[`campaign.${k}`] = v
    }
    for (const k of CLICK_ID_PARAMS) {
      const v = params.get(k)
      if (v) out[`campaign.${k}`] = v
    }
  }

  // Landing page — origin + path + search, sans hash. Best-effort.
  const loc = window.location
  const landing =
    (loc.origin || '') + (loc.pathname || '') + (loc.search || '')
  if (landing) out['page.landing'] = landing

  return out
}

/**
 * Resolve the FIRST-TOUCH acquisition map. The first time this runs in a
 * browser it captures {@link readAcquisitionFromUrl} and persists it; every
 * later call returns the persisted value unchanged — so a user who lands via
 * `?utm_source=google` keeps that attribution on every subsequent event,
 * even after the query string is gone.
 *
 * Persistence is keyed in the same {@link KVStore} the rest of the SDK uses,
 * so it rides the localStorage / in-memory fallback automatically.
 *
 * Returns `undefined` when there's nothing to attribute (no URL signals AND
 * nothing persisted) so the transport doesn't pad the wire with empties.
 */
export function firstTouchAcquisition(store: KVStore): Record<string, string> | undefined {
  // Already captured — return the persisted first-touch verbatim.
  const raw = store.get(ACQUISITION_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* corrupt — fall through and recapture */
    }
  }

  const captured = readAcquisitionFromUrl()
  if (Object.keys(captured).length === 0) return undefined

  store.set(ACQUISITION_KEY, JSON.stringify(captured))
  return captured
}
