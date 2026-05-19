import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdfiniaClient } from '../src/client'
import type { AdfiniaPayload } from '../src/types'
import { clearStorage } from './helpers'

class CapturingTransport {
  sent: AdfiniaPayload[] = []
  result = { ok: true, permanent: false }
  async send(batch: AdfiniaPayload[]) {
    this.sent.push(...batch)
    return this.result
  }
}

describe('AdfiniaClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearStorage()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws if init() is called without a writeKey', () => {
    const c = new AdfiniaClient()
    expect(() => c.init({ writeKey: '' })).toThrow(/writeKey/)
  })

  it('warns when public methods are called before init()', () => {
    const c = new AdfiniaClient()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    c.track('Order Completed')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('track() enqueues an event with the right shape', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
    c.track('Order Completed', { total: 49.99 })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const ev = transport.sent[0]
    expect(ev.type).toBe('track')
    expect(ev.event).toBe('Order Completed')
    expect(ev.properties).toEqual({ total: 49.99 })
    expect(ev.anonymous_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(ev.message_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(ev.context.library.name).toBe('adfinia-sdk-web')
  })

  it('identify(string) sets customer_id and emits an identify event', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
    c.identify('cust_42', { plan: 'growth' })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].type).toBe('identify')
    expect(transport.sent[0].customer_id).toBe('cust_42')
    expect(transport.sent[0].traits).toEqual({ plan: 'growth' })
  })

  it('identify({customerId, traits}) accepts the object form', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
    c.identify({ customerId: 'cust_99', traits: { tier: 'enterprise' } })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].customer_id).toBe('cust_99')
    expect(transport.sent[0].traits).toEqual({ tier: 'enterprise' })
  })

  it('subsequent track() carries the customer_id from identify()', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 2, flushIntervalMs: 60_000 })
    c.identify('cust_42')
    c.track('Order Completed')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
    expect(transport.sent[1].customer_id).toBe('cust_42')
  })

  it('alias() emits an alias event and updates the active identity', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
    c.alias('cust_new', 'cust_old')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].type).toBe('alias')
    expect(transport.sent[0].customer_id).toBe('cust_new')
    expect(transport.sent[0].previous_id).toBe('cust_old')
  })

  it('reset() mints a new anonymous_id', () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x' })
    const before = c._identityStore().anonymousId()
    c.identify('cust_42')
    c.reset()
    expect(c._identityStore().customerId()).toBeUndefined()
    expect(c._identityStore().anonymousId()).not.toBe(before)
  })

  it('consent gate drops events when consent() returns false', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    let consented = false
    c.init({ writeKey: 'pk_test_x', consent: () => consented, flushAt: 1, flushIntervalMs: 60_000 })
    c.track('Order Completed')
    // Buffer should be empty — event was dropped.
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.sent).toHaveLength(0)
    consented = true
    c.track('Order Completed')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
  })

  it('consent gate that throws is treated as no-consent (fail-closed)', () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({
      writeKey: 'pk_test_x',
      consent: () => {
        throw new Error('cookie banner crashed')
      },
      flushAt: 1,
      flushIntervalMs: 60_000,
    })
    c.track('Order Completed')
    expect(transport.sent).toHaveLength(0)
  })

  it('track() without an event name is a no-op', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
    // @ts-expect-error testing runtime guard
    c.track(undefined)
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.sent).toHaveLength(0)
  })

  it('init() called twice is a no-op (does not reset state)', () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x' })
    const id = c._identityStore().anonymousId()
    c.init({ writeKey: 'pk_test_y' })
    expect(c._identityStore().anonymousId()).toBe(id)
  })

  it('flush() triggers transport on demand', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', flushAt: 100, flushIntervalMs: 60_000 })
    c.track('a')
    c.track('b')
    expect(transport.sent).toHaveLength(0)
    await c.flush()
    expect(transport.sent).toHaveLength(2)
  })
})
