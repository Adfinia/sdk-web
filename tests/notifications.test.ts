import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationsClient,
  type EventSourceLike,
  type InboxBridge,
  type InboxNotification,
} from '../src/notifications'

// --- Test doubles ---------------------------------------------------------

function makeNotification(over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: over.id ?? 'ntf_1',
    contact_id: over.contact_id ?? 'cust_42',
    title: over.title ?? 'Deposit cleared',
    body: over.body ?? 'Your deposit of AED 500 is now available.',
    severity: over.severity ?? 'success',
    dismissable: over.dismissable ?? true,
    deep_link: over.deep_link,
    data: over.data,
    read: over.read ?? false,
    created_at: over.created_at ?? '2026-07-24T10:00:00Z',
    read_at: over.read_at,
    expires_at: over.expires_at,
  }
}

/** A controllable fake EventSource. */
class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onopen: ((ev: unknown) => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeEventSource.last = this
  }
  close(): void {
    this.closed = true
  }
  emit(n: InboxNotification | string): void {
    this.onmessage?.({ data: typeof n === 'string' ? n : JSON.stringify(n) })
  }
}

interface Harness {
  bridge: InboxBridge
  client: NotificationsClient
  fetchMock: ReturnType<typeof vi.fn>
  posted: { path: string; body: unknown }[]
  tracked: { event: string; properties?: Record<string, unknown> }[]
  esFactory: ReturnType<typeof vi.fn>
}

function harness(
  opts: {
    identity?: { customer_id?: string; external_id?: string; anonymous_id: string }
    withEventSource?: boolean
    nullBridge?: boolean
  } = {},
): Harness {
  const posted: { path: string; body: unknown }[] = []
  const tracked: { event: string; properties?: Record<string, unknown> }[] = []
  const fetchMock = vi.fn()
  const esFactory = vi.fn()
  esFactory.mockImplementation((url: string) => new FakeEventSource(url))

  const bridge: InboxBridge = {
    host: 'https://api.adfinia.com',
    writeKey: 'pk_test_x',
    sdkVersion: 'adfinia-sdk-web@test',
    transport: {
      async postJSON(path, body) {
        posted.push({ path, body })
        return { ok: true, permanent: false, status: 200 }
      },
    },
    fetcher: fetchMock as unknown as typeof fetch,
    identity: () => opts.identity ?? { customer_id: 'cust_42', anonymous_id: 'anon-1' },
    track: (event, properties) => tracked.push({ event, properties }),
    debug: () => {},
    eventSourceFactory: opts.withEventSource ? (esFactory as unknown as (u: string) => EventSourceLike) : null,
  }

  const client = new NotificationsClient(() => (opts.nullBridge ? null : bridge))
  return { bridge, client, fetchMock, posted, tracked, esFactory }
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

beforeEach(() => {
  FakeEventSource.last = null
})
afterEach(() => {
  vi.restoreAllMocks()
})

// --- list() ---------------------------------------------------------------

describe('NotificationsClient.list', () => {
  it('GETs /api/v1/notifications with contact_id + filters and maps the wire shape', async () => {
    const h = harness()
    const n = makeNotification()
    h.fetchMock.mockResolvedValue(okJson({ data: [n], next_cursor: 'c2', has_more: true }))

    const page = await h.client.list({ status: 'unread', cursor: 'c1', limit: 20 })

    expect(page.data).toEqual([n])
    expect(page.nextCursor).toBe('c2')
    expect(page.hasMore).toBe(true)

    const [url, init] = h.fetchMock.mock.calls[0]
    expect(url).toContain('https://api.adfinia.com/api/v1/notifications?')
    expect(url).toContain('contact_id=cust_42')
    expect(url).toContain('status=unread')
    expect(url).toContain('cursor=c1')
    expect(url).toContain('limit=20')
    expect(init.method).toBe('GET')
    expect(init.headers.authorization).toBe('Bearer pk_test_x')
    expect(init.headers['x-adfinia-sdk-version']).toBe('adfinia-sdk-web@test')
  })

  it('resolves contact_id as customer_id > external_id > anonymous_id', async () => {
    const h = harness({ identity: { external_id: '0xWALLET', anonymous_id: 'anon-1' } })
    h.fetchMock.mockResolvedValue(okJson({ data: [], next_cursor: null, has_more: false }))
    await h.client.list()
    expect(h.fetchMock.mock.calls[0][0]).toContain('contact_id=0xWALLET')
  })

  it('honours an explicit contactId override', async () => {
    const h = harness()
    h.fetchMock.mockResolvedValue(okJson({ data: [], next_cursor: null, has_more: false }))
    await h.client.list({ contactId: 'cust_override' })
    expect(h.fetchMock.mock.calls[0][0]).toContain('contact_id=cust_override')
  })

  it('soft-fails to an empty page on a non-ok response', async () => {
    const h = harness()
    h.fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const page = await h.client.list()
    expect(page).toEqual({ data: [], nextCursor: null, hasMore: false })
  })

  it('soft-fails to an empty page when fetch throws', async () => {
    const h = harness()
    h.fetchMock.mockRejectedValue(new Error('network'))
    const page = await h.client.list()
    expect(page.data).toEqual([])
  })

  it('returns an empty page before init() (null bridge) and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = harness({ nullBridge: true })
    const page = await h.client.list()
    expect(page.data).toEqual([])
    expect(warn).toHaveBeenCalled()
  })
})

// --- markRead / markAllRead -----------------------------------------------

describe('NotificationsClient.markRead / markAllRead', () => {
  it('POSTs /api/v1/notifications/{id}/read with contact_id and returns true', async () => {
    const h = harness()
    const ok = await h.client.markRead('ntf_9')
    expect(ok).toBe(true)
    expect(h.posted[0].path).toBe('/api/v1/notifications/ntf_9/read')
    expect(h.posted[0].body).toEqual({ contact_id: 'cust_42' })
  })

  it('markRead returns false and posts nothing without an id', async () => {
    const h = harness()
    const ok = await h.client.markRead('')
    expect(ok).toBe(false)
    expect(h.posted).toHaveLength(0)
  })

  it('POSTs /api/v1/notifications/read-all with contact_id', async () => {
    const h = harness()
    const ok = await h.client.markAllRead()
    expect(ok).toBe(true)
    expect(h.posted[0].path).toBe('/api/v1/notifications/read-all')
    expect(h.posted[0].body).toEqual({ contact_id: 'cust_42' })
  })

  it('markRead reflects a failed POST as false', async () => {
    const h = harness()
    h.bridge.transport.postJSON = async () => ({ ok: false, permanent: true, status: 404 })
    expect(await h.client.markRead('ntf_1')).toBe(false)
  })
})

// --- subscribe() ----------------------------------------------------------

describe('NotificationsClient.subscribe', () => {
  it('replays unread on connect then streams new notifications, de-duped by id', async () => {
    const h = harness({ withEventSource: true })
    const unread = makeNotification({ id: 'ntf_replay', read: false })
    // One replay page (has_more false).
    h.fetchMock.mockResolvedValue(okJson({ data: [unread], next_cursor: null, has_more: false }))

    const received: InboxNotification[] = []
    const sub = h.client.subscribe((n) => received.push(n))

    // Let the fire-and-forget replay resolve.
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(received[0].id).toBe('ntf_replay')

    // Stream opened against the SSE endpoint with auth + contact_id.
    const es = FakeEventSource.last!
    expect(es.url).toContain('/api/v1/notifications/stream?')
    expect(es.url).toContain('contact_id=cust_42')
    expect(es.url).toContain('auth=pk_test_x')

    // A live notification is delivered.
    es.emit(makeNotification({ id: 'ntf_live' }))
    expect(received.map((n) => n.id)).toEqual(['ntf_replay', 'ntf_live'])

    // Re-emitting the SAME id (also present in replay) does not double-fire.
    es.emit(makeNotification({ id: 'ntf_replay' }))
    es.emit(makeNotification({ id: 'ntf_live' }))
    expect(received).toHaveLength(2)

    sub.unsubscribe()
    expect(es.closed).toBe(true)
  })

  it('after unsubscribe, no further stream messages are delivered', async () => {
    const h = harness({ withEventSource: true })
    h.fetchMock.mockResolvedValue(okJson({ data: [], next_cursor: null, has_more: false }))
    const received: InboxNotification[] = []
    const sub = h.client.subscribe((n) => received.push(n))
    const es = FakeEventSource.last!
    sub.unsubscribe()
    es.emit(makeNotification({ id: 'after_close' }))
    expect(received).toHaveLength(0)
  })

  it('skips replay when replayUnread is false', async () => {
    const h = harness({ withEventSource: true })
    h.fetchMock.mockResolvedValue(okJson({ data: [makeNotification()], next_cursor: null, has_more: false }))
    const received: InboxNotification[] = []
    h.client.subscribe((n) => received.push(n), { replayUnread: false })
    // Give any accidental replay a tick — must stay empty.
    await new Promise((r) => setTimeout(r, 5))
    expect(received).toHaveLength(0)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  it('ignores unparseable stream payloads', async () => {
    const h = harness({ withEventSource: true })
    h.fetchMock.mockResolvedValue(okJson({ data: [], next_cursor: null, has_more: false }))
    const received: InboxNotification[] = []
    h.client.subscribe((n) => received.push(n))
    FakeEventSource.last!.emit('not-json{')
    expect(received).toHaveLength(0)
  })

  it('runs replay but no live stream when EventSource is unavailable', async () => {
    const h = harness({ withEventSource: false })
    h.fetchMock.mockResolvedValue(okJson({ data: [makeNotification()], next_cursor: null, has_more: false }))
    const received: InboxNotification[] = []
    h.client.subscribe((n) => received.push(n))
    await vi.waitFor(() => expect(received).toHaveLength(1))
    expect(FakeEventSource.last).toBeNull()
  })

  it('returns a no-op subscription with no contact identity', () => {
    const h = harness({ identity: { anonymous_id: '' }, withEventSource: true })
    const received: InboxNotification[] = []
    const sub = h.client.subscribe((n) => received.push(n))
    expect(() => sub.unsubscribe()).not.toThrow()
    expect(h.esFactory).not.toHaveBeenCalled()
  })
})

// --- trackOpened / trackClicked -------------------------------------------

describe('NotificationsClient open/click events', () => {
  it('trackOpened emits notification_opened with id + severity + deep_link', () => {
    const h = harness()
    h.client.trackOpened(makeNotification({ id: 'ntf_7', severity: 'warning', deep_link: '/wallet' }))
    expect(h.tracked[0]).toEqual({
      event: 'notification_opened',
      properties: { notification_id: 'ntf_7', severity: 'warning', deep_link: '/wallet' },
    })
  })

  it('trackClicked accepts a bare id string + extra props', () => {
    const h = harness()
    h.client.trackClicked('ntf_9', { placement: 'toast' })
    expect(h.tracked[0]).toEqual({
      event: 'notification_clicked',
      properties: { notification_id: 'ntf_9', placement: 'toast' },
    })
  })
})
