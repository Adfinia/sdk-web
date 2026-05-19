import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventQueue } from '../src/queue'
import { createStorage } from '../src/storage'
import type { AdfiniaPayload } from '../src/types'
import { clearStorage } from './helpers'

function makePayload(event: string): AdfiniaPayload {
  return {
    type: 'track',
    event,
    anonymous_id: 'anon',
    context: { library: { name: 'adfinia-sdk-web', version: 'test' } },
    sent_at: new Date().toISOString(),
    message_id: 'msg-' + event,
  }
}

describe('EventQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearStorage()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes when flushAt is hit', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, permanent: false })
    const q = new EventQueue({
      store: createStorage(),
      transport: { send },
      flushAt: 2,
      flushIntervalMs: 60_000,
      debug: () => {},
    })
    q.enqueue(makePayload('a'))
    q.enqueue(makePayload('b'))
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    expect(send.mock.calls[0][0]).toHaveLength(2)
  })

  it('flushes on the interval', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, permanent: false })
    const q = new EventQueue({
      store: createStorage(),
      transport: { send },
      flushAt: 100,
      flushIntervalMs: 5_000,
      debug: () => {},
    })
    q.enqueue(makePayload('a'))
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('drops events on permanent (4xx) failure', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, permanent: true, status: 400 })
    const q = new EventQueue({
      store: createStorage(),
      transport: { send },
      flushAt: 100, // don't auto-trigger; we want to control the flush.
      flushIntervalMs: 60_000,
      debug: () => {},
    })
    q.enqueue(makePayload('a'))
    await q.flush()
    expect(send).toHaveBeenCalledTimes(1)
    // Buffer should be empty now (events dropped, not retried).
    expect(q.drainAll()).toHaveLength(0)
  })

  it('retries on transient (5xx) failure with backoff', async () => {
    let calls = 0
    const send = vi.fn().mockImplementation(() => {
      calls++
      if (calls < 3) return Promise.resolve({ ok: false, permanent: false, status: 502 })
      return Promise.resolve({ ok: true, permanent: false, status: 200 })
    })
    const q = new EventQueue({
      store: createStorage(),
      transport: { send },
      flushAt: 1,
      flushIntervalMs: 60_000,
      debug: () => {},
    })
    q.enqueue(makePayload('a'))
    // First call (immediate via flushAt).
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    // Retry #1 should be scheduled ~1s out.
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    // Retry #2 should be scheduled ~2s out (exponential backoff).
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3))
    expect(q.drainAll()).toHaveLength(0)
  })

  it('persists buffered events across re-construction', async () => {
    const store = createStorage()
    const sendNever = vi.fn().mockResolvedValue({ ok: false, permanent: false })
    const q1 = new EventQueue({
      store,
      transport: { send: sendNever },
      flushAt: 100,
      flushIntervalMs: 60_000,
      debug: () => {},
    })
    q1.enqueue(makePayload('a'))
    q1.enqueue(makePayload('b'))
    q1.destroy()

    const sendOk = vi.fn().mockResolvedValue({ ok: true, permanent: false })
    const q2 = new EventQueue({
      store,
      transport: { send: sendOk },
      flushAt: 100,
      flushIntervalMs: 5_000,
      debug: () => {},
    })
    await q2.flush()
    expect(sendOk).toHaveBeenCalledTimes(1)
    expect(sendOk.mock.calls[0][0]).toHaveLength(2)
  })

  it('caps the queue at maxQueueSize and drops oldest', () => {
    const q = new EventQueue({
      store: createStorage(),
      transport: { send: () => Promise.resolve({ ok: false, permanent: false }) },
      flushAt: 1000,
      flushIntervalMs: 60_000,
      maxQueueSize: 3,
      debug: () => {},
    })
    for (let i = 0; i < 6; i++) q.enqueue(makePayload(`e${i}`))
    const drained = q.drainAll()
    expect(drained).toHaveLength(3)
    expect(drained[0].event).toBe('e3')
    expect(drained[2].event).toBe('e5')
  })
})
