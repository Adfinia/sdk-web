// Web-push client — US-PS-WEBPUSH-001 (client side).
//
// Registers a service worker, requests Notification permission, calls
// PushManager.subscribe with the tenant VAPID public key, and POSTs the
// resulting subscription to the Adfinia ingest at
// POST /api/v1/push/subscriptions via the SDK's authenticated transport.
//
// The subscribe body carries the current identity (customer_id /
// external_id / anonymous_id) plus the browser's {endpoint, keys:{p256dh,
// auth}} triple. The server resolves identity in the order
// customer_id > external_id > anonymous_id.
//
// Permission-prompt outcomes are mirrored as track events
// (`notification_permission_granted` / `_denied`), matching the
// PredictStreet event contract. The service worker (public/adfinia-sw.js)
// emits `push_received` / `push_clicked` itself.

import type { AdfiniaClient } from './client'

const SUBSCRIPTION_PATH = '/api/v1/push/subscriptions'
const DEFAULT_SW_URL = '/adfinia-sw.js'

export interface WebPushConfig {
  /**
   * Tenant VAPID public key, base64url-encoded P-256. Provide it directly,
   * OR omit it and set `fetchVapidFromConfig: true` to pull it from
   * `GET /api/v1/sdk/config` (`vapid_public_key`) — note the server must
   * expose that field for the fetch to succeed.
   */
  vapidPublicKey?: string

  /**
   * When true and `vapidPublicKey` is not given, fetch the key from
   * `GET /api/v1/sdk/config`. Default false.
   */
  fetchVapidFromConfig?: boolean

  /**
   * URL of the Adfinia service worker to register. Defaults to
   * `/adfinia-sw.js` (host it at your web root). Ship the file from
   * `node_modules/@adfinia/sdk-web/dist/adfinia-sw.js` or copy
   * `src/service-worker/adfinia-sw.js`.
   */
  serviceWorkerUrl?: string

  /**
   * Scope for the service-worker registration. Defaults to the SW URL's
   * directory (browser default).
   */
  scope?: string

  /**
   * Emit `notification_permission_*` track events for the prompt outcome.
   * Default true.
   */
  trackPermissionEvents?: boolean
}

export type WebPushSubscribeResult =
  | { ok: true; endpoint: string; alreadySubscribed: boolean }
  | { ok: false; reason: WebPushFailureReason; detail?: string }

export type WebPushFailureReason =
  | 'unsupported' // no SW / PushManager / Notification in this browser
  | 'not_initialised' // client.init() not called
  | 'no_vapid_key' // key neither provided nor fetchable
  | 'permission_denied' // user said no (or was already denied)
  | 'subscribe_failed' // PushManager.subscribe threw
  | 'post_failed' // server rejected the subscription POST

/**
 * Web-push subscription entry point. Static so it can be called as
 * `WebPush.subscribe(client, config)`; the public `Adfinia.registerWebPush`
 * wraps this against the singleton.
 */
export const WebPush = {
  async subscribe(
    client: AdfiniaClient,
    config: WebPushConfig,
  ): Promise<WebPushSubscribeResult> {
    const bridge = client._webPushBridge()
    if (!bridge) {
      return { ok: false, reason: 'not_initialised' }
    }
    const trackEvents = config.trackPermissionEvents ?? true

    if (!webPushSupported()) {
      bridge.debug('web-push unsupported in this browser')
      return { ok: false, reason: 'unsupported' }
    }

    // 1. Resolve the VAPID public key.
    let vapid = config.vapidPublicKey
    if (!vapid && config.fetchVapidFromConfig) {
      vapid = await fetchVapidFromConfig(bridge.host, bridge.writeKey)
    }
    if (!vapid) {
      bridge.debug('web-push: no VAPID public key available')
      return { ok: false, reason: 'no_vapid_key' }
    }

    // 2. Register the service worker.
    let registration: ServiceWorkerRegistration
    try {
      const swUrl = config.serviceWorkerUrl ?? DEFAULT_SW_URL
      registration = await navigator.serviceWorker.register(
        swUrl,
        config.scope ? { scope: config.scope } : undefined,
      )
      await navigator.serviceWorker.ready
    } catch (err) {
      bridge.debug('web-push: service worker registration failed', err)
      return { ok: false, reason: 'subscribe_failed', detail: String(err) }
    }

    // 3. Request notification permission.
    if (trackEvents) bridge.track('notification_permission_prompted', { channel: 'web_push' })
    let permission: NotificationPermission
    try {
      permission = await Notification.requestPermission()
    } catch (err) {
      bridge.debug('web-push: requestPermission threw', err)
      permission = 'denied'
    }
    if (permission !== 'granted') {
      if (trackEvents) bridge.track('notification_permission_denied', { channel: 'web_push' })
      return { ok: false, reason: 'permission_denied' }
    }
    if (trackEvents) bridge.track('notification_permission_granted', { channel: 'web_push' })

    // 4. Subscribe with PushManager (re-uses an existing subscription if any).
    let subscription: PushSubscription
    let alreadySubscribed = false
    try {
      const existing = await registration.pushManager.getSubscription()
      if (existing) {
        subscription = existing
        alreadySubscribed = true
      } else {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
        })
      }
    } catch (err) {
      bridge.debug('web-push: PushManager.subscribe failed', err)
      return { ok: false, reason: 'subscribe_failed', detail: String(err) }
    }

    // 5. POST the subscription to the ingest.
    const sub = subscription.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    const endpoint = sub.endpoint ?? subscription.endpoint
    const keys = sub.keys ?? {}
    if (!endpoint || !keys.p256dh || !keys.auth) {
      bridge.debug('web-push: subscription missing endpoint/keys')
      return { ok: false, reason: 'subscribe_failed', detail: 'incomplete subscription' }
    }

    const id = bridge.identity()
    const body = {
      customer_id: id.customer_id,
      external_id: id.external_id,
      anonymous_id: id.anonymous_id,
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    }

    const res = await bridge.transport.postJSON(SUBSCRIPTION_PATH, body)
    if (!res.ok) {
      bridge.debug('web-push: subscription POST failed', res.status)
      return { ok: false, reason: 'post_failed', detail: res.status ? String(res.status) : undefined }
    }

    bridge.debug('web-push: subscribed', { endpoint, alreadySubscribed })
    return { ok: true, endpoint, alreadySubscribed }
  },
}

function webPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof Notification !== 'undefined' &&
    typeof PushManager !== 'undefined'
  )
}

async function fetchVapidFromConfig(host: string, writeKey: string): Promise<string | undefined> {
  if (typeof globalThis.fetch !== 'function') return undefined
  try {
    const res = await globalThis.fetch(`${host}/api/v1/sdk/config`, {
      method: 'GET',
      headers: { authorization: `Bearer ${writeKey}` },
    })
    if (!res.ok) return undefined
    const cfg = (await res.json()) as { vapid_public_key?: string }
    return cfg.vapid_public_key || undefined
  } catch {
    return undefined
  }
}

/**
 * Convert a base64url-encoded VAPID public key to the Uint8Array
 * `applicationServerKey` PushManager.subscribe expects.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = typeof atob === 'function' ? atob(base64) : bufferDecode(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

// Node fallback when atob isn't available (tests / SSR probing).
function bufferDecode(base64: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer
  if (B) return B.from(base64, 'base64').toString('binary')
  return ''
}
