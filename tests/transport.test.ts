import { describe, expect, it, vi } from 'vitest'
import { HttpTransport } from '../src/transport'
import type { AdfiniaPayload } from '../src/types'

function makeEvent(type: AdfiniaPayload['type'], event = 'e'): AdfiniaPayload {
  return {
    type,
    event,
    anonymous_id: 'anon',
    context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
    sent_at: new Date().toISOString(),
    message_id: 'msg',
  }
}

describe('HttpTransport', () => {
  it('POSTs a single track event to /api/v1/track with bearer auth', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([makeEvent('track', 'Order Completed')])
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    // Single-event shortcut keeps using the legacy endpoint.
    expect(url).toBe('https://events.adfinia.com/api/v1/track')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer pk_test_x')
    const body = JSON.parse(init.body)
    expect(body.event_name).toBe('Order Completed')
    expect(body.anonymous_id).toBe('anon')
    expect(body.occurred_at).toBeTruthy()
    expect(body.context['library.name']).toBe('adfinia-sdk-web')
    expect(body.context.message_id).toBe('msg')
  })

  it('POSTs a multi-event track batch to /api/v1/track/batch as one request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([
      makeEvent('track', 'a'),
      makeEvent('track', 'b'),
      makeEvent('track', 'c'),
    ])
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://events.adfinia.com/api/v1/track/batch')
    const body = JSON.parse(init.body)
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events).toHaveLength(3)
    expect(body.events.map((e: { event_name: string }) => e.event_name)).toEqual(['a', 'b', 'c'])
  })

  it('partitions a mixed batch into one identify-batch + one track-batch call', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const identifyPayload: AdfiniaPayload = {
      type: 'identify',
      anonymous_id: 'anon',
      customer_id: 'cust_42',
      traits: { plan: 'growth' },
      context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
      sent_at: new Date().toISOString(),
      message_id: 'msg',
    }
    await t.send([makeEvent('track'), makeEvent('track', 'b'), identifyPayload])
    expect(fetcher).toHaveBeenCalledTimes(2)
    const urls = fetcher.mock.calls.map((c) => c[0])
    expect(urls).toContain('https://events.adfinia.com/api/v1/track/batch')
    expect(urls).toContain('https://events.adfinia.com/api/v1/identify/batch')
    const identifyCall = fetcher.mock.calls.find(
      (c) => c[0] === 'https://events.adfinia.com/api/v1/identify/batch',
    )
    const identifyBody = JSON.parse(identifyCall![1].body)
    expect(identifyBody.events).toHaveLength(1)
    expect(identifyBody.events[0].customer_id).toBe('cust_42')
    expect(identifyBody.events[0].traits).toEqual({ plan: 'growth' })
  })

  it('synthesises an event name for page / screen / alias in batch mode', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    await t.send([
      { ...makeEvent('page'), event: undefined },
      { ...makeEvent('screen'), event: undefined },
      { ...makeEvent('alias'), event: undefined, previous_id: 'cust_old' },
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://events.adfinia.com/api/v1/track/batch')
    const body = JSON.parse(init.body)
    expect(body.events[0].event_name).toBe('$page_viewed')
    expect(body.events[1].event_name).toBe('$screen_viewed')
    expect(body.events[2].event_name).toBe('$alias')
    expect(body.events[2].properties.previous_id).toBe('cust_old')
  })

  it('returns permanent=true on 4xx', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 400 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([makeEvent('track')])
    expect(res.ok).toBe(false)
    expect(res.permanent).toBe(true)
    expect(res.status).toBe(400)
  })

  it('returns permanent=false on 5xx', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([makeEvent('track')])
    expect(res.ok).toBe(false)
    expect(res.permanent).toBe(false)
  })

  it('treats network errors as retryable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'))
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([makeEvent('track')])
    expect(res.ok).toBe(false)
    expect(res.permanent).toBe(false)
  })

  it('no-ops on empty batch', async () => {
    const fetcher = vi.fn()
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([])
    expect(res.ok).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  // v1.1.0 — IdentifyTraits expansion. Asserts every new trait field
  // round-trips through the single-event /api/v1/identify path verbatim,
  // with snake_case keys preserved on the wire. Mirrors api
  // `IdentifyTraits` v1.1 — keep in lockstep with
  // api/internal/identity/models.go.
  it('round-trips every v1.1.0 IdentifyTraits field on the wire (snake_case preserved)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const traits = {
      email: 'ahmed@example.ae',
      phone: '+971501234567',
      whatsapp: '+971501234567',
      first_name: 'Ahmed',
      last_name: 'Al Hosani',
      language: 'ar-AE',
      timezone: 'Asia/Dubai',
      country: 'AE',
      city: 'Dubai',
      gender: 'male',
      date_of_birth: '1990-04-12',
      source: 'sdk_web',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'ramadan_2026',
      utm_term: 'crm',
      utm_content: 'hero_cta',
    }
    const payload: AdfiniaPayload = {
      type: 'identify',
      anonymous_id: 'anon',
      customer_id: 'cust_42',
      traits,
      context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
      sent_at: new Date().toISOString(),
      message_id: 'msg',
    }
    const res = await t.send([payload])
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://events.adfinia.com/api/v1/identify')
    const body = JSON.parse(init.body)
    expect(body.customer_id).toBe('cust_42')
    expect(body.traits).toEqual(traits)
  })

  it('omits unset IdentifyTraits fields from the JSON body (no null / no empty string)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    // Only two of the v1.1 fields are set — the rest must NOT appear in
    // the JSON body, so the server's "empty means untouched" semantics
    // work cleanly.
    const traits = {
      email: 'layla@example.ae',
      country: 'AE',
    }
    const payload: AdfiniaPayload = {
      type: 'identify',
      anonymous_id: 'anon',
      customer_id: 'cust_99',
      traits,
      context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
      sent_at: new Date().toISOString(),
      message_id: 'msg',
    }
    await t.send([payload])
    const [, init] = fetcher.mock.calls[0]
    const body = JSON.parse(init.body)
    const keys = Object.keys(body.traits).sort()
    expect(keys).toEqual(['country', 'email'])
    // Sanity-check absence of every unset v1.1 field.
    for (const absent of [
      'whatsapp',
      'gender',
      'date_of_birth',
      'language',
      'timezone',
      'city',
      'source',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body.traits, absent)).toBe(false)
    }
  })

  it('round-trips IdentifyTraits in batch mode (snake_case preserved across all events)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const traitsA = { email: 'a@example.ae', utm_source: 'google', gender: 'female' as const }
    const traitsB = {
      email: 'b@example.ae',
      date_of_birth: '1992-08-04',
      source: 'sdk_web' as const,
    }
    const mkIdentify = (cust: string, traits: Record<string, unknown>): AdfiniaPayload => ({
      type: 'identify',
      anonymous_id: 'anon',
      customer_id: cust,
      traits,
      context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
      sent_at: new Date().toISOString(),
      message_id: `msg-${cust}`,
    })
    await t.send([mkIdentify('cust_a', traitsA), mkIdentify('cust_b', traitsB)])
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://events.adfinia.com/api/v1/identify/batch')
    const body = JSON.parse(init.body)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].traits).toEqual(traitsA)
    expect(body.events[1].traits).toEqual(traitsB)
  })
})
