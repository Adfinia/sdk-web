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
  it('POSTs track events to /api/v1/track with bearer auth', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    const res = await t.send([makeEvent('track', 'Order Completed')])
    expect(res.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
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

  it('routes identify events to /api/v1/identify', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 })
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
    await t.send([makeEvent('track'), identifyPayload])
    expect(fetcher).toHaveBeenCalledTimes(2)
    const urls = fetcher.mock.calls.map((c) => c[0])
    expect(urls).toContain('https://events.adfinia.com/api/v1/track')
    expect(urls).toContain('https://events.adfinia.com/api/v1/identify')
    const identifyCall = fetcher.mock.calls.find(
      (c) => c[0] === 'https://events.adfinia.com/api/v1/identify',
    )
    const identifyBody = JSON.parse(identifyCall![1].body)
    expect(identifyBody.customer_id).toBe('cust_42')
    expect(identifyBody.traits).toEqual({ plan: 'growth' })
  })

  it('synthesises an event name for page / screen / alias', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    const t = new HttpTransport('https://events.adfinia.com', 'pk_test_x', fetcher)
    await t.send([
      { ...makeEvent('page'), event: undefined },
      { ...makeEvent('screen'), event: undefined },
      { ...makeEvent('alias'), event: undefined, previous_id: 'cust_old' },
    ])
    const bodies = fetcher.mock.calls.map((c) => JSON.parse(c[1].body))
    expect(bodies[0].event_name).toBe('$page_viewed')
    expect(bodies[1].event_name).toBe('$screen_viewed')
    expect(bodies[2].event_name).toBe('$alias')
    // Alias carries previous_id in properties so the server's identity graph picks it up.
    expect(bodies[2].properties.previous_id).toBe('cust_old')
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
})
