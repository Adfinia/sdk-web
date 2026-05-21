import type { AdfiniaPayload } from './types'
import { SDK_VERSION_HEADER } from './version'

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
 * Default HTTP transport.
 *
 * AGENT-SDK-INGEST-KAFKA (2026-05-21) — switched to the batch endpoints
 * `/api/v1/track/batch` + `/api/v1/identify/batch`. The queue already
 * batches up to 50 events; we now send them as a single batch request
 * instead of fanning out into 50 parallel HTTP calls.
 *
 * Three send modes:
 *
 *   - All identify    → POST /api/v1/identify/batch
 *   - All track/page/screen/alias → POST /api/v1/track/batch
 *   - Mixed batch     → one batch per kind, in parallel
 *
 * Single-event fallback path: when the batch size is 1, we still hit
 * the legacy single-event endpoint. That keeps offline-drain flushes
 * (where the queue might trickle 1-3 events) from paying the batch
 * overhead. The server side accepts both shapes.
 *
 * 2xx → ok; 4xx → permanent (drop); 5xx + network → retryable.
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

    // Single-event shortcut: skip the batch wrapper.
    if (batch.length === 1) {
      return this.sendSingle(batch[0])
    }

    // Partition into identify vs track-like.
    const identifies: AdfiniaPayload[] = []
    const tracks: AdfiniaPayload[] = []
    for (const p of batch) {
      if (p.type === 'identify') identifies.push(p)
      else tracks.push(p)
    }

    const calls: Promise<TransportResult>[] = []
    if (identifies.length > 0) calls.push(this.sendBatch('/api/v1/identify/batch', identifies.map(toIdentifyWire)))
    if (tracks.length > 0) calls.push(this.sendBatch('/api/v1/track/batch', tracks.map(toTrackWire)))
    const results = await Promise.all(calls)

    // Worst result wins.
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

  private async sendBatch(path: string, events: unknown[]): Promise<TransportResult> {
    const url = `${this.host}${path}`
    try {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.writeKey}`,
          'x-adfinia-sdk-version': SDK_VERSION_HEADER,
        },
        body: JSON.stringify({ events }),
        keepalive: true,
      })
      if (res.ok) return { ok: true, permanent: false, status: res.status }
      const permanent = res.status >= 400 && res.status < 500
      return { ok: false, permanent, status: res.status }
    } catch {
      return { ok: false, permanent: false }
    }
  }

  private async sendSingle(payload: AdfiniaPayload): Promise<TransportResult> {
    const path = payload.type === 'identify' ? '/api/v1/identify' : '/api/v1/track'
    const body = payload.type === 'identify' ? toIdentifyWire(payload) : toTrackWire(payload)
    const url = `${this.host}${path}`
    try {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.writeKey}`,
          'x-adfinia-sdk-version': SDK_VERSION_HEADER,
        },
        body: JSON.stringify(body),
        keepalive: true,
      })
      if (res.ok) return { ok: true, permanent: false, status: res.status }
      const permanent = res.status >= 400 && res.status < 500
      return { ok: false, permanent, status: res.status }
    } catch {
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
