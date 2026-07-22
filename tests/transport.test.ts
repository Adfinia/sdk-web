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
  it('POSTs a single track event to /api/v1/track/batch with bearer auth', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([makeEvent('track', 'Order Completed')])
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    // A single event now ships as a 1-element batch — the legacy single-event
    // endpoint is no longer used (it mis-tags test/live; see transport doc).
    expect(url).toBe('https://events.adfinia.com/api/v1/track/batch')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer pk_test_x')
    const body = JSON.parse(init.body)
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events).toHaveLength(1)
    const ev = body.events[0]
    expect(ev.event_name).toBe('Order Completed')
    expect(ev.anonymous_id).toBe('anon')
    expect(ev.occurred_at).toBeTruthy()
    expect(ev.context['library.name']).toBe('adfinia-sdk-web')
    expect(ev.context.message_id).toBe('msg')
  })

  it('emits external_id on the wire for track + identify', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const trackEv: AdfiniaPayload = { ...makeEvent('track', 'order_placed'), external_id: '0xWALLET' }
    await t.send([trackEv])
    const trackBody = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(trackBody.events[0].external_id).toBe('0xWALLET')

    fetcher.mockClear()
    const idEv: AdfiniaPayload = {
      type: 'identify',
      anonymous_id: 'anon',
      external_id: '0xWALLET',
      context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
      sent_at: new Date().toISOString(),
      message_id: 'msg',
    }
    await t.send([idEv])
    const idBody = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(idBody.events[0].external_id).toBe('0xWALLET')
  })

  it('postJSON POSTs an authenticated JSON body to a host-relative path', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.postJSON('/api/v1/push/subscriptions', { endpoint: 'https://push/x' })
    expect(res.ok).toBe(true)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://events.adfinia.com/api/v1/push/subscriptions')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer pk_test_x')
    expect(JSON.parse(init.body).endpoint).toBe('https://push/x')
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

  it('synthesises an event name for page / screen in batch mode', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    await t.send([
      { ...makeEvent('page'), event: undefined },
      { ...makeEvent('screen'), event: undefined },
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://events.adfinia.com/api/v1/track/batch')
    const body = JSON.parse(init.body)
    expect(body.events[0].event_name).toBe('$page_viewed')
    expect(body.events[1].event_name).toBe('$screen_viewed')
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
  // round-trips through the /api/v1/identify/batch path verbatim, with
  // snake_case keys preserved on the wire. Mirrors api `IdentifyTraits` v1.1
  // — keep in lockstep with api/internal/identity/models.go.
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
    expect(url).toBe('https://events.adfinia.com/api/v1/identify/batch')
    const body = JSON.parse(init.body)
    expect(body.events[0].customer_id).toBe('cust_42')
    expect(body.events[0].traits).toEqual(traits)
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
    const sentTraits = body.events[0].traits
    const keys = Object.keys(sentTraits).sort()
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
      expect(Object.prototype.hasOwnProperty.call(sentTraits, absent)).toBe(false)
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

  describe('sendBeacon (unload path)', () => {
    it('prefers navigator.sendBeacon and routes the write key + sdk version on the URL', () => {
      const beacon = vi.fn().mockReturnValue(true)
      const originalNavigator = globalThis.navigator
      // happy-dom gives us a navigator; just patch sendBeacon on it.
      ;(globalThis as unknown as { navigator: unknown }).navigator = {
        ...(originalNavigator ?? {}),
        sendBeacon: beacon,
      }
      const fetcher = vi.fn()
      const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
      t.sendBeacon([makeEvent('track', 'a'), makeEvent('track', 'b')])
      expect(beacon).toHaveBeenCalledTimes(1)
      const [url, body] = beacon.mock.calls[0]
      expect(String(url)).toContain('https://events.adfinia.com/api/v1/track/batch')
      expect(String(url)).toContain('auth=pk_test_x')
      expect(String(url)).toContain('sdk=')
      expect(body).toBeInstanceOf(Blob)
      // No fetch fallback when beacon returns true.
      expect(fetcher).not.toHaveBeenCalled()
      ;(globalThis as unknown as { navigator: unknown }).navigator = originalNavigator
    })

    it('falls back to fetch({ keepalive: true }) when sendBeacon returns false', () => {
      const beacon = vi.fn().mockReturnValue(false)
      const originalNavigator = globalThis.navigator
      ;(globalThis as unknown as { navigator: unknown }).navigator = {
        ...(originalNavigator ?? {}),
        sendBeacon: beacon,
      }
      const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
      const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
      t.sendBeacon([makeEvent('track', 'a')])
      expect(beacon).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledTimes(1)
      const [, init] = fetcher.mock.calls[0]
      expect(init.keepalive).toBe(true)
      ;(globalThis as unknown as { navigator: unknown }).navigator = originalNavigator
    })

    it('partitions identify vs track into separate beacon URLs', () => {
      const beacon = vi.fn().mockReturnValue(true)
      const originalNavigator = globalThis.navigator
      ;(globalThis as unknown as { navigator: unknown }).navigator = {
        ...(originalNavigator ?? {}),
        sendBeacon: beacon,
      }
      const identifyPayload: AdfiniaPayload = {
        type: 'identify',
        anonymous_id: 'anon',
        customer_id: 'cust_42',
        context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
        sent_at: new Date().toISOString(),
        message_id: 'msg',
      }
      const fetcher = vi.fn()
      const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
      t.sendBeacon([makeEvent('track', 'a'), identifyPayload])
      expect(beacon).toHaveBeenCalledTimes(2)
      const urls = beacon.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u.includes('/api/v1/track/batch'))).toBe(true)
      expect(urls.some((u) => u.includes('/api/v1/identify/batch'))).toBe(true)
      ;(globalThis as unknown as { navigator: unknown }).navigator = originalNavigator
    })

    it('no-ops on empty batch', () => {
      const beacon = vi.fn().mockReturnValue(true)
      const originalNavigator = globalThis.navigator
      ;(globalThis as unknown as { navigator: unknown }).navigator = {
        ...(originalNavigator ?? {}),
        sendBeacon: beacon,
      }
      const fetcher = vi.fn()
      const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
      t.sendBeacon([])
      expect(beacon).not.toHaveBeenCalled()
      expect(fetcher).not.toHaveBeenCalled()
      ;(globalThis as unknown as { navigator: unknown }).navigator = originalNavigator
    })
  })
})
