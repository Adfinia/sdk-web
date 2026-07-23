// In-app notification inbox client — US-PS-INBOX-001 (web, client side).
//
// Consumes the backend inbox shipped alongside the web-push channel:
//
//   GET  /api/v1/notifications?contact_id=&status={all|unread|read}&cursor=&limit=
//        -> { data: InboxNotification[], next_cursor, has_more }
//   POST /api/v1/notifications/{id}/read
//   POST /api/v1/notifications/read-all
//   GET  /api/v1/notifications/stream?contact_id=            (live SSE)
//
// This is the DATA client only — it is deliberately framework-agnostic and
// ships NO UI. The host app renders the bell / list / toast; the SDK gives it
// typed notifications, a live subscription, and the two open/click track
// events (`notification_opened` / `notification_clicked`) that keep the inbox
// consistent with the existing push event contract
// (`notification_permission_*`, `push_received`, `push_clicked`).
//
// Identity: the inbox is keyed on the current contact. We resolve the
// `contact_id` query param from the SDK identity in the SAME priority the
// server uses — customer_id > external_id > anonymous_id — and let the caller
// override it explicitly via `{ contactId }`.
//
// This module talks to the API through a small bridge the client hands it
// (see AdfiniaClient._notificationsBridge), mirroring the web-push bridge:
//   - GET (list)         -> bridge.fetcher (same pattern as fetchRemoteConfig)
//   - POST (mark read)   -> bridge.transport.postJSON (authenticated)
//   - SSE (subscribe)    -> bridge.eventSourceFactory (EventSource in a browser)
//
// The SSE stream runs in the PAGE via EventSource (a foreground channel). It
// is complementary to the web-push service worker, which handles BACKGROUND
// system notifications when the tab is closed — see README "In-app inbox".

import type { Transport } from './transport'
import type { Properties } from './types'

const BASE_PATH = '/api/v1/notifications'

/** Severity of an inbox notification. Mirrors the backend enum. */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

/** A single in-app notification. Wire shape mirrors the backend `InboxNotification`. */
export interface InboxNotification {
  id: string
  contact_id: string
  title: string
  body: string
  severity: NotificationSeverity
  dismissable: boolean
  deep_link?: string
  data?: Record<string, unknown>
  read: boolean
  created_at: string
  read_at?: string
  expires_at?: string
}

/** Read-status filter for `list()`. */
export type NotificationStatus = 'all' | 'unread' | 'read'

export interface ListNotificationsOptions {
  /** Read-status filter. Defaults to `all` (server default). */
  status?: NotificationStatus
  /** Opaque pagination cursor from a previous page's `nextCursor`. */
  cursor?: string
  /** Page size. Server clamps to its own max. */
  limit?: number
  /**
   * Override the auto-resolved contact identity. By default the client uses
   * customer_id > external_id > anonymous_id from the current SDK identity.
   */
  contactId?: string
}

/** One page of notifications. Cursor fields are camelCased from the wire. */
export interface NotificationsPage {
  data: InboxNotification[]
  nextCursor: string | null
  hasMore: boolean
}

/** Handler invoked for each live + replayed notification on a subscription. */
export type NotificationHandler = (notification: InboxNotification) => void

export interface SubscribeOptions {
  /** Override the auto-resolved contact identity (see ListNotificationsOptions). */
  contactId?: string
  /**
   * Replay currently-unread notifications through the handler when the stream
   * connects, so a freshly-mounted inbox is populated immediately. Default true.
   */
  replayUnread?: boolean
  /** Safety cap on unread pages replayed on connect. Default 5. */
  maxReplayPages?: number
  /** Called when the underlying stream errors (EventSource auto-reconnects). */
  onError?: (err: unknown) => void
  /** Called once the stream opens. */
  onOpen?: () => void
}

/** Handle returned by `subscribe()`. Call `unsubscribe()` to close the stream. */
export interface NotificationsSubscription {
  unsubscribe(): void
}

/**
 * Minimal EventSource surface the subscription needs. The real browser
 * `EventSource` satisfies it; tests inject a fake.
 */
export interface EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onopen: ((ev: unknown) => void) | null
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

/**
 * Bridge the client hands to the inbox module. Mirrors `_webPushBridge` — it
 * surfaces exactly what the inbox needs without widening the public surface.
 */
export interface InboxBridge {
  host: string
  writeKey: string
  sdkVersion: string
  /** For the authenticated mark-read POSTs. */
  transport: Pick<Transport, 'postJSON'>
  /** For the list GET. May be undefined in environments without fetch. */
  fetcher: typeof fetch | undefined
  identity: () => { customer_id?: string; external_id?: string; anonymous_id: string }
  track: (event: string, properties?: Properties) => void
  debug: (msg: string, extra?: unknown) => void
  /** EventSource constructor wrapper, or null where SSE is unavailable. */
  eventSourceFactory: EventSourceFactory | null
}

const EMPTY_PAGE: NotificationsPage = { data: [], nextCursor: null, hasMore: false }

/**
 * In-app inbox client. Reached via `Adfinia.notifications`; bound to the
 * singleton through a bridge provider so it works before/after init() without
 * holding a stale reference. Never throws — network failures soft-fail to an
 * empty page / a no-op subscription and a debug log, matching the rest of the
 * SDK.
 */
export class NotificationsClient {
  constructor(private bridgeProvider: () => InboxBridge | null) {}

  /**
   * Fetch a page of notifications for the current (or overridden) contact.
   * Soft-fails to an empty page on any network / parse error.
   */
  async list(options: ListNotificationsOptions = {}): Promise<NotificationsPage> {
    const bridge = this.bridgeProvider()
    if (!bridge) {
      warnNotInit()
      return { ...EMPTY_PAGE }
    }
    if (typeof bridge.fetcher !== 'function') {
      bridge.debug('notifications.list(): fetch unavailable in this environment')
      return { ...EMPTY_PAGE }
    }
    const contactId = options.contactId ?? resolveContactId(bridge)
    if (!contactId) {
      bridge.debug('notifications.list(): no contact identity yet — nothing to fetch')
      return { ...EMPTY_PAGE }
    }

    const qs = new URLSearchParams()
    qs.set('contact_id', contactId)
    if (options.status) qs.set('status', options.status)
    if (options.cursor) qs.set('cursor', options.cursor)
    if (options.limit != null) qs.set('limit', String(options.limit))
    const url = `${bridge.host}${BASE_PATH}?${qs.toString()}`

    try {
      const res = await bridge.fetcher(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${bridge.writeKey}`,
          'x-adfinia-sdk-version': bridge.sdkVersion,
        },
      })
      if (!res.ok) {
        bridge.debug('notifications.list(): non-ok response', res.status)
        return { ...EMPTY_PAGE }
      }
      const body = (await res.json()) as {
        data?: InboxNotification[]
        next_cursor?: string | null
        has_more?: boolean
      }
      return {
        data: Array.isArray(body.data) ? body.data : [],
        nextCursor: body.next_cursor ?? null,
        hasMore: !!body.has_more,
      }
    } catch (err) {
      bridge.debug('notifications.list(): request failed', err)
      return { ...EMPTY_PAGE }
    }
  }

  /**
   * Mark a single notification read. Returns true when the server accepted it.
   */
  async markRead(id: string): Promise<boolean> {
    const bridge = this.bridgeProvider()
    if (!bridge) {
      warnNotInit()
      return false
    }
    if (!id || typeof id !== 'string') {
      bridge.debug('notifications.markRead(): missing id')
      return false
    }
    const contactId = resolveContactId(bridge)
    const res = await bridge.transport.postJSON(
      `${BASE_PATH}/${encodeURIComponent(id)}/read`,
      contactId ? { contact_id: contactId } : {},
    )
    if (!res.ok) bridge.debug('notifications.markRead(): POST failed', res.status)
    return res.ok
  }

  /**
   * Mark every notification for the current contact read. Returns true when the
   * server accepted it.
   */
  async markAllRead(): Promise<boolean> {
    const bridge = this.bridgeProvider()
    if (!bridge) {
      warnNotInit()
      return false
    }
    const contactId = resolveContactId(bridge)
    if (!contactId) {
      bridge.debug('notifications.markAllRead(): no contact identity yet')
      return false
    }
    const res = await bridge.transport.postJSON(`${BASE_PATH}/read-all`, {
      contact_id: contactId,
    })
    if (!res.ok) bridge.debug('notifications.markAllRead(): POST failed', res.status)
    return res.ok
  }

  /**
   * Open a live subscription. On connect the client (a) replays currently-unread
   * notifications through `handler` (unless `replayUnread: false`), then (b)
   * streams new ones over SSE. Delivery is de-duped by id, so a notification
   * that appears in both the replay and the stream fires the handler once.
   *
   * Returns a handle whose `unsubscribe()` closes the stream and guarantees the
   * handler is never called again (including from an in-flight replay).
   */
  subscribe(handler: NotificationHandler, options: SubscribeOptions = {}): NotificationsSubscription {
    const bridge = this.bridgeProvider()
    const delivered = new Set<string>()
    let closed = false
    let es: EventSourceLike | null = null

    const noop: NotificationsSubscription = {
      unsubscribe() {
        closed = true
        try {
          es?.close()
        } catch {
          /* ignore */
        }
      },
    }

    const deliver = (n: InboxNotification | null): void => {
      if (closed || !n || typeof n.id !== 'string') return
      if (delivered.has(n.id)) return
      delivered.add(n.id)
      try {
        handler(n)
      } catch (err) {
        bridge?.debug('notifications.subscribe(): handler threw', err)
      }
    }

    if (!bridge) {
      warnNotInit()
      return noop
    }
    const contactId = options.contactId ?? resolveContactId(bridge)
    if (!contactId) {
      bridge.debug('notifications.subscribe(): no contact identity yet — not subscribing')
      return noop
    }

    // (a) Replay unread — fire-and-forget; respects `closed`.
    if (options.replayUnread ?? true) {
      void this.replayUnread(
        contactId,
        options.maxReplayPages ?? 5,
        deliver,
        () => closed,
      )
    }

    // (b) Live SSE stream.
    const factory = bridge.eventSourceFactory
    if (!factory) {
      bridge.debug('notifications.subscribe(): EventSource unavailable — live updates disabled (replay still runs)')
      return noop
    }
    const streamQs = new URLSearchParams()
    streamQs.set('contact_id', contactId)
    // EventSource can't set Authorization; the gateway accepts the write key +
    // SDK version as query params (same as the sendBeacon path).
    streamQs.set('auth', bridge.writeKey)
    streamQs.set('sdk', bridge.sdkVersion)
    const streamUrl = `${bridge.host}${BASE_PATH}/stream?${streamQs.toString()}`

    try {
      es = factory(streamUrl)
    } catch (err) {
      bridge.debug('notifications.subscribe(): failed to open stream', err)
      options.onError?.(err)
      return noop
    }

    es.onopen = () => {
      if (!closed) options.onOpen?.()
    }
    es.onmessage = (ev: { data: string }) => {
      if (closed) return
      deliver(parseNotification(ev.data))
    }
    es.onerror = (err: unknown) => {
      if (closed) return
      bridge.debug('notifications.subscribe(): stream error (EventSource will retry)', err)
      options.onError?.(err)
    }

    return noop
  }

  /** Emit the `notification_opened` track event. */
  trackOpened(notification: InboxNotification | string, extra?: Properties): void {
    this.emit('notification_opened', notification, extra)
  }

  /** Emit the `notification_clicked` track event. */
  trackClicked(notification: InboxNotification | string, extra?: Properties): void {
    this.emit('notification_clicked', notification, extra)
  }

  private emit(event: string, notification: InboxNotification | string, extra?: Properties): void {
    const bridge = this.bridgeProvider()
    if (!bridge) {
      warnNotInit()
      return
    }
    bridge.track(event, { ...notificationProps(notification), ...(extra ?? {}) })
  }

  private async replayUnread(
    contactId: string,
    maxPages: number,
    deliver: (n: InboxNotification | null) => void,
    isClosed: () => boolean,
  ): Promise<void> {
    let cursor: string | undefined
    for (let page = 0; page < maxPages; page++) {
      if (isClosed()) return
      const res = await this.list({ status: 'unread', contactId, cursor })
      for (const n of res.data) {
        if (isClosed()) return
        deliver(n)
      }
      if (!res.hasMore || !res.nextCursor) return
      cursor = res.nextCursor
    }
  }
}

/** customer_id > external_id > anonymous_id — matches server resolution order. */
function resolveContactId(bridge: InboxBridge): string | undefined {
  const id = bridge.identity()
  return id.customer_id || id.external_id || id.anonymous_id || undefined
}

function notificationProps(notification: InboxNotification | string): Properties {
  if (typeof notification === 'string') return { notification_id: notification }
  const props: Properties = { notification_id: notification.id }
  if (notification.severity) props.severity = notification.severity
  if (notification.deep_link) props.deep_link = notification.deep_link
  return props
}

function parseNotification(data: string): InboxNotification | null {
  try {
    const obj = JSON.parse(data) as InboxNotification
    if (obj && typeof obj.id === 'string') return obj
    return null
  } catch {
    return null
  }
}

function warnNotInit(): void {
  if (typeof console !== 'undefined') {
    console.warn('@adfinia/sdk-web: notifications used before init()')
  }
}
