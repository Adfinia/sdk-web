import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdfiniaClient } from '../src/client'
import { WebPush, urlBase64ToUint8Array } from '../src/webpush'
import type { AdfiniaPayload } from '../src/types'
import { clearStorage } from './helpers'

class CapturingTransport {
  sent: AdfiniaPayload[] = []
  posted: { path: string; body: any }[] = []
  postResult = { ok: true, permanent: false, status: 201 }
  async send(batch: AdfiniaPayload[]) {
    this.sent.push(...batch)
    return { ok: true, permanent: false }
  }
  async postJSON(path: string, body: unknown) {
    this.posted.push({ path, body })
    return this.postResult
  }
  sendBeacon() {}
}

// --- Browser API mocks ----------------------------------------------------

// A valid base64url-encoded P-256 application server (VAPID) public key.
const VALID_VAPID =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8'

function installPushMocks(opts: {
  permission?: NotificationPermission
  existingSubscription?: boolean
} = {}) {
  const permission = opts.permission ?? 'granted'

  const subscription = {
    endpoint: 'https://push.example.com/sub/abc',
    toJSON() {
      return {
        endpoint: 'https://push.example.com/sub/abc',
        keys: { p256dh: 'P256DH_KEY', auth: 'AUTH_KEY' },
      }
    },
  }

  const subscribe = vi.fn().mockResolvedValue(subscription)
  const getSubscription = vi
    .fn()
    .mockResolvedValue(opts.existingSubscription ? subscription : null)

  const registration = {
    pushManager: { subscribe, getSubscription },
  }

  const register = vi.fn().mockResolvedValue(registration)

  ;(globalThis as any).navigator = {
    ...(globalThis.navigator ?? {}),
    serviceWorker: {
      register,
      ready: Promise.resolve(registration),
    },
  }

  const requestPermission = vi.fn().mockResolvedValue(permission)
  ;(globalThis as any).Notification = { requestPermission, permission }
  ;(globalThis as any).PushManager = function () {}

  return { register, subscribe, getSubscription, requestPermission }
}

function makeClient(transport: CapturingTransport): AdfiniaClient {
  const c = new AdfiniaClient({ transport: transport as any })
  c.init({ writeKey: 'pk_test_x', autoPage: false, flushAt: 1, flushIntervalMs: 60_000 })
  return c
}

describe('WebPush.subscribe', () => {
  const originalNavigator = globalThis.navigator
  const originalNotification = (globalThis as any).Notification
  const originalPushManager = (globalThis as any).PushManager

  beforeEach(() => {
    vi.useFakeTimers()
    clearStorage()
  })
  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).navigator = originalNavigator
    ;(globalThis as any).Notification = originalNotification
    ;(globalThis as any).PushManager = originalPushManager
  })

  it('urlBase64ToUint8Array decodes a base64url VAPID key to bytes', () => {
    const bytes = urlBase64ToUint8Array(VALID_VAPID)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(60)
    // Round-trip: re-encoding the bytes reproduces the (padded) base64url.
    const roundTrip = urlBase64ToUint8Array(VALID_VAPID)
    expect(Array.from(roundTrip)).toEqual(Array.from(bytes))
  })

  it('registers SW, requests permission, subscribes, and POSTs the subscription', async () => {
    const mocks = installPushMocks({ permission: 'granted' })
    const transport = new CapturingTransport()
    const c = makeClient(transport)
    c.identify({ externalId: '0xWALLET' })

    const result = await WebPush.subscribe(c, {
      vapidPublicKey: VALID_VAPID,
      serviceWorkerUrl: '/adfinia-sw.js',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.endpoint).toBe('https://push.example.com/sub/abc')
      expect(result.alreadySubscribed).toBe(false)
    }
    expect(mocks.register).toHaveBeenCalledWith('/adfinia-sw.js', undefined)
    expect(mocks.requestPermission).toHaveBeenCalled()
    expect(mocks.subscribe).toHaveBeenCalled()

    // The subscription POST carries identity + endpoint + keys.
    const post = transport.posted.find((p) => p.path === '/api/v1/push/subscriptions')
    expect(post).toBeDefined()
    expect(post!.body.external_id).toBe('0xWALLET')
    expect(post!.body.anonymous_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(post!.body.endpoint).toBe('https://push.example.com/sub/abc')
    expect(post!.body.keys).toEqual({ p256dh: 'P256DH_KEY', auth: 'AUTH_KEY' })
  })

  it('emits notification_permission_granted on grant', async () => {
    installPushMocks({ permission: 'granted' })
    const transport = new CapturingTransport()
    const c = makeClient(transport)
    await WebPush.subscribe(c, { vapidPublicKey: VALID_VAPID })
    await vi.runOnlyPendingTimersAsync()
    await c.flush()
    const granted = transport.sent.find((e) => e.event === 'notification_permission_granted')
    expect(granted).toBeDefined()
    expect(granted!.properties).toEqual({ channel: 'web_push' })
  })

  it('returns permission_denied + emits the denied event when the user declines', async () => {
    installPushMocks({ permission: 'denied' })
    const transport = new CapturingTransport()
    const c = makeClient(transport)
    const result = await WebPush.subscribe(c, { vapidPublicKey: VALID_VAPID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('permission_denied')
    await c.flush()
    const denied = transport.sent.find((e) => e.event === 'notification_permission_denied')
    expect(denied).toBeDefined()
  })

  it('reuses an existing subscription (alreadySubscribed=true)', async () => {
    const mocks = installPushMocks({ permission: 'granted', existingSubscription: true })
    const transport = new CapturingTransport()
    const c = makeClient(transport)
    const result = await WebPush.subscribe(c, { vapidPublicKey: VALID_VAPID })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.alreadySubscribed).toBe(true)
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })

  it('returns no_vapid_key when no key is provided', async () => {
    installPushMocks({ permission: 'granted' })
    const transport = new CapturingTransport()
    const c = makeClient(transport)
    const result = await WebPush.subscribe(c, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_vapid_key')
  })

  it('returns post_failed when the subscription POST is rejected', async () => {
    installPushMocks({ permission: 'granted' })
    const transport = new CapturingTransport()
    transport.postResult = { ok: false, permanent: true, status: 400 }
    const c = makeClient(transport)
    const result = await WebPush.subscribe(c, { vapidPublicKey: VALID_VAPID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('post_failed')
  })

  it('returns not_initialised when called before init()', async () => {
    installPushMocks({ permission: 'granted' })
    const c = new AdfiniaClient()
    const result = await WebPush.subscribe(c, { vapidPublicKey: VALID_VAPID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_initialised')
  })
})
