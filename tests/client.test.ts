import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdfiniaClient } from '../src/client'
import type { AdfiniaPayload } from '../src/types'
import { clearStorage } from './helpers'

class CapturingTransport {
  sent: AdfiniaPayload[] = []
  beaconed: AdfiniaPayload[] = []
  posted: { path: string; body: unknown }[] = []
  result = { ok: true, permanent: false }
  async send(batch: AdfiniaPayload[]) {
    this.sent.push(...batch)
    return this.result
  }
  async postJSON(path: string, body: unknown) {
    this.posted.push({ path, body })
    return { ok: true, permanent: false }
  }
  sendBeacon(batch: AdfiniaPayload[]) {
    this.beaconed.push(...batch)
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
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
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
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.identify('cust_42', { plan: 'growth' })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].type).toBe('identify')
    expect(transport.sent[0].customer_id).toBe('cust_42')
    expect(transport.sent[0].traits).toEqual({ plan: 'growth' })
  })

  it('identify({customerId, traits}) accepts the object form', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.identify({ customerId: 'cust_99', traits: { tier: 'enterprise' } })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].customer_id).toBe('cust_99')
    expect(transport.sent[0].traits).toEqual({ tier: 'enterprise' })
  })

  it('subsequent track() carries the customer_id from identify()', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 2, flushIntervalMs: 60_000 })
    c.identify('cust_42')
    c.track('Order Completed')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
    expect(transport.sent[1].customer_id).toBe('cust_42')
  })

  describe('consent (setConsent / optIn / optOut)', () => {
    it('optOut(single) emits one consent_updated event with channels as an array', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      c.optOut('email')
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
      const ev = transport.sent[0]
      expect(ev.type).toBe('track')
      expect(ev.event).toBe('consent_updated')
      expect(ev.properties).toEqual({ channels: ['email'], status: 'opted_out' })
    })

    it('optIn(array) normalizes (trim + lowercase) and keeps channels an array', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      c.optIn(['  Email ', 'WhatsApp', 'SMS'])
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
      expect(transport.sent[0].event).toBe('consent_updated')
      expect(transport.sent[0].properties).toEqual({
        channels: ['email', 'whatsapp', 'sms'],
        status: 'opted_in',
      })
    })

    it('setConsent accepts open (unknown) channel strings without rejecting them', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      // rcs / voice / app_notification are not shipped today but must pass through.
      c.setConsent(['rcs', 'voice', 'app_notification'], 'opted_in')
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
      expect(transport.sent[0].properties).toEqual({
        channels: ['rcs', 'voice', 'app_notification'],
        status: 'opted_in',
      })
    })

    it('invalid status sends nothing, warns once (debug), and does not throw', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      c.init({ writeKey: 'pk_test_x', debug: true, autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      // @ts-expect-error testing runtime guard on an invalid status
      expect(() => c.setConsent('email', 'maybe')).not.toThrow()
      // @ts-expect-error second invalid call must not double-warn
      c.setConsent('sms', 'nope')
      await vi.advanceTimersByTimeAsync(100)
      expect(transport.sent).toHaveLength(0)
      const statusWarnings = debugSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('invalid status'),
      )
      expect(statusWarnings).toHaveLength(1)
      debugSpy.mockRestore()
    })

    it('empty channel list is a soft no-op (no event, no throw)', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      expect(() => c.optOut('   ')).not.toThrow()
      expect(() => c.optIn([])).not.toThrow()
      await vi.advanceTimersByTimeAsync(100)
      expect(transport.sent).toHaveLength(0)
    })

    it('optOut() before init() does not throw (warns, drops — like track)', () => {
      const c = new AdfiniaClient()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => c.optOut(['email', 'sms'])).not.toThrow()
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('consent event carries the current identity', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 2, flushIntervalMs: 60_000 })
      c.identify('cust_42')
      c.optOut('whatsapp')
      await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
      expect(transport.sent[1].event).toBe('consent_updated')
      expect(transport.sent[1].customer_id).toBe('cust_42')
    })
  })

  it('alias() is a deprecated no-op: emits no event and warns exactly once', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    c.init({
      writeKey: 'pk_test_x',
      debug: true,
      autoPage: false,
      flushAt: 1,
      flushIntervalMs: 60_000,
    })
    c.alias('cust_new', 'cust_old')
    c.alias('cust_new_again')
    // Give the queue a tick; nothing should ever be enqueued or transmitted.
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.sent).toHaveLength(0)
    expect(c._queueLength()).toBe(0)
    // The active identity is untouched; alias() no longer promotes anyone.
    expect(c._identityStore().customerId()).toBeUndefined()
    // One-time deprecation warning fired on the FIRST call only.
    const aliasWarnings = debugSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('alias() is deprecated'),
    )
    expect(aliasWarnings).toHaveLength(1)
    debugSpy.mockRestore()
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
    c.init({ writeKey: 'pk_test_x', autoPage: false, consent: () => consented, flushAt: 1, flushIntervalMs: 60_000 })
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
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
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
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 100, flushIntervalMs: 60_000 })
    c.track('a')
    c.track('b')
    expect(transport.sent).toHaveLength(0)
    await c.flush()
    expect(transport.sent).toHaveLength(2)
  })

  it('autoContext: false (default) does not attach auto_context', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.track('a')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].auto_context).toBeUndefined()
  })

  it('autoContext: true attaches a flat auto_context map', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', autoContext: true, autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.track('a')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const ac = transport.sent[0].auto_context
    expect(ac).toBeDefined()
    expect(ac?.library).toBe('adfinia-sdk-web')
    // library_version is a plain string, no semver-shape assertion
    expect(typeof ac?.library_version).toBe('string')
  })

  it('autoContext true folds first-touch acquisition into auto_context', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    window.location.href = 'http://localhost:3000/?utm_source=google&gclid=G42'
    c.init({ writeKey: 'pk_test_x', autoContext: true, autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.track('a')
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const ac = transport.sent[0].auto_context
    expect(ac?.['campaign.utm_source']).toBe('google')
    expect(ac?.['campaign.gclid']).toBe('G42')
    window.location.href = 'http://localhost:3000/'
  })

  it('track() options.context wins over auto-context on collision', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', autoContext: true, autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.track('a', undefined, { context: { library: 'override' } })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].user_context).toEqual({ library: 'override' })
  })

  it('identify({ context }) is forwarded as user_context', async () => {
    const transport = new CapturingTransport()
    const c = new AdfiniaClient({ transport })
    c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
    c.identify({ customerId: 'cust_42', context: { tenant: 'acme' } })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0].user_context).toEqual({ tenant: 'acme' })
  })

  describe('external_id / wallet identity', () => {
    it('identify({ externalId }) persists + emits external_id on the wire', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      c.identify({ externalId: '0xWALLETHASH' })
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
      expect(transport.sent[0].type).toBe('identify')
      expect(transport.sent[0].external_id).toBe('0xWALLETHASH')
      expect(c._identityStore().externalId()).toBe('0xWALLETHASH')
    })

    it('external_id from identify carries onto subsequent track events', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 2, flushIntervalMs: 60_000 })
      c.identify({ customerId: 'cust_1', externalId: '0xABC' })
      c.track('order_placed')
      await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
      expect(transport.sent[1].external_id).toBe('0xABC')
      expect(transport.sent[1].customer_id).toBe('cust_1')
    })

    it('track() accepts a per-call externalId, persists it, and emits it', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 2, flushIntervalMs: 60_000 })
      c.track('wallet_connected', undefined, { externalId: '0xDEF' })
      c.track('order_placed')
      await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
      expect(transport.sent[0].external_id).toBe('0xDEF')
      // Persisted — second track keeps it without re-passing.
      expect(transport.sent[1].external_id).toBe('0xDEF')
    })

    it('reset() clears the external_id', () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false })
      c.identify({ externalId: '0xWALLET' })
      expect(c._identityStore().externalId()).toBe('0xWALLET')
      c.reset()
      expect(c._identityStore().externalId()).toBeUndefined()
    })
  })

  describe('autoPage (SPA route tracking)', () => {
    // happy-dom does NOT update window.location on history.pushState, so the
    // tests set window.location.href to simulate the navigation, then invoke
    // pushState — mirroring the real-browser order (location changes, then
    // the patched pushState's fire() reads the new location).
    afterEach(() => {
      window.location.href = 'http://localhost:3000/'
    })

    it('fires an initial page() on init when autoPage is on (default)', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      window.location.href = 'http://localhost:3000/start'
      c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
      expect(transport.sent[0].type).toBe('page')
      c._teardownAutoPage()
    })

    it('does NOT fire on init when autoPage: false', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
      await vi.advanceTimersByTimeAsync(100)
      expect(transport.sent).toHaveLength(0)
    })

    it('fires page() on pushState navigation', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      window.location.href = 'http://localhost:3000/home'
      c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1)) // initial
      window.location.href = 'http://localhost:3000/match/42'
      window.history.pushState({}, '', '/match/42')
      await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
      expect(transport.sent[1].type).toBe('page')
      c._teardownAutoPage()
    })

    it('does not double-fire when navigating to the same path+search', async () => {
      const transport = new CapturingTransport()
      const c = new AdfiniaClient({ transport })
      window.location.href = 'http://localhost:3000/same'
      c.init({ writeKey: 'pk_test_x', flushAt: 1, flushIntervalMs: 60_000 })
      await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
      // pushState to the identical URL — should be ignored (location unchanged).
      window.history.pushState({}, '', '/same')
      await vi.advanceTimersByTimeAsync(100)
      expect(transport.sent).toHaveLength(1)
      c._teardownAutoPage()
    })
  })
})
