import type { AdfiniaPayload } from './types'

export interface TransportResult {
  ok: boolean
  /** True if the failure is permanent (4xx) and the events should be dropped. */
  permanent: boolean
  status?: number
}

export interface Transport {
  send(batch: AdfiniaPayload[]): Promise<TransportResult>
}

/**
 * Default HTTP transport. The platform's `/api/v1/identify` + `/api/v1/track`
 * endpoints are single-event today (see `api/api/openapi.yaml` §
 * AGENT-CDP-IDENTITY 2026-05-19) so we fan a buffered batch out into one
 * request per event with `Promise.all`. When the batch endpoints land we'll
 * switch to a single `{batch: [...]}` POST and drop the fan-out.
 *
 * - identify events → POST /api/v1/identify
 * - track / page / screen / alias → POST /api/v1/track
 *
 * Field-name translation happens here so the rest of the SDK can keep using
 * the SDK-native shape (`event` not `event_name`, `sent_at` not `occurred_at`,
 * etc.) without leaking the wire's quirks into the queue.
 */
export class HttpTransport implements Transport {
  constructor(
    private host: string,
    private writeKey: string,
    private fetcher: typeof fetch = globalThis.fetch?.bind(globalThis),
  ) {
    if (!this.fetcher) {
      throw new Error('@adfinia/sdk-web: fetch is unavailable in this environment')
    }
  }

  async send(batch: AdfiniaPayload[]): Promise<TransportResult> {
    if (batch.length === 0) return { ok: true, permanent: false }

    const results = await Promise.all(batch.map((p) => this.sendOne(p)))

    // Worst result wins — if any send failed retryably, retry the whole batch.
    let ok = true
    let permanent = false
    let status: number | undefined
    for (const r of results) {
      if (!r.ok) {
        ok = false
        if (r.permanent) permanent = true
        status = r.status
      }
    }
    return { ok, permanent, status }
  }

  private async sendOne(payload: AdfiniaPayload): Promise<TransportResult> {
    const path = payload.type === 'identify' ? '/api/v1/identify' : '/api/v1/track'
    const body = payload.type === 'identify' ? toIdentifyWire(payload) : toTrackWire(payload)
    const url = `${this.host}${path}`
    try {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.writeKey}`,
        },
        body: JSON.stringify(body),
        // keepalive lets us flush during unload events on modern browsers.
        keepalive: true,
      })
      if (res.ok) return { ok: true, permanent: false, status: res.status }
      // 4xx → permanent; 5xx + network → retry.
      const permanent = res.status >= 400 && res.status < 500
      return { ok: false, permanent, status: res.status }
    } catch {
      // Network failure — retryable.
      return { ok: false, permanent: false }
    }
  }
}

interface IdentifyWire {
  customer_id?: string
  anonymous_id?: string
  traits?: Record<string, unknown>
  context?: Record<string, string>
}

interface TrackWire {
  customer_id?: string
  anonymous_id?: string
  event_name: string
  properties?: Record<string, unknown>
  context?: Record<string, string>
  occurred_at?: string
}

function toIdentifyWire(p: AdfiniaPayload): IdentifyWire {
  return {
    customer_id: p.customer_id,
    anonymous_id: p.anonymous_id,
    traits: p.traits,
    context: stringifyContext(p),
  }
}

function toTrackWire(p: AdfiniaPayload): TrackWire {
  return {
    customer_id: p.customer_id,
    anonymous_id: p.anonymous_id,
    // For page/screen/alias the event name may be empty — fall back to a
    // synthetic name so the server's `event_name` required field is satisfied.
    event_name: p.event || synthesiseName(p),
    properties: mergeProperties(p),
    context: stringifyContext(p),
    occurred_at: p.sent_at,
  }
}

function synthesiseName(p: AdfiniaPayload): string {
  switch (p.type) {
    case 'page':
      return '$page_viewed'
    case 'screen':
      return '$screen_viewed'
    case 'alias':
      return '$alias'
    default:
      return '$unknown'
  }
}

function mergeProperties(p: AdfiniaPayload): Record<string, unknown> | undefined {
  // For alias events, carry the previous_id in properties so the server can
  // pick it up under the SDK-side identity-graph contract.
  if (p.type === 'alias' && p.previous_id) {
    return { ...(p.properties ?? {}), previous_id: p.previous_id }
  }
  return p.properties
}

/**
 * The track/identify endpoints accept `context: object<string, string>`. Our
 * internal context is richer (nested page / screen objects); we flatten the
 * fields the server understands and stringify everything else.
 */
function stringifyContext(p: AdfiniaPayload): Record<string, string> | undefined {
  const ctx = p.context
  if (!ctx) return undefined
  const out: Record<string, string> = {
    'library.name': ctx.library.name,
    'library.version': ctx.library.version,
    message_id: p.message_id,
    sdk_event_type: p.type,
  }
  if (ctx.user_agent) out.user_agent = ctx.user_agent
  if (ctx.locale) out.locale = ctx.locale
  if (ctx.timezone) out.timezone = ctx.timezone
  if (ctx.page?.url) out['page.url'] = ctx.page.url
  if (ctx.page?.path) out['page.path'] = ctx.page.path
  if (ctx.page?.title) out['page.title'] = ctx.page.title
  if (ctx.page?.referrer) out['page.referrer'] = ctx.page.referrer
  return out
}
