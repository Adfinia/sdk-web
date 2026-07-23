/**
 * @adfinia/sdk-web — official Adfinia SDK for the browser.
 *
 * Usage (named import — recommended, matches the docs at
 * https://docs.adfinia.com/user-guide/sdk-integration):
 *
 *   import { Adfinia } from '@adfinia/sdk-web'
 *
 *   Adfinia.init({ writeKey: 'pk_live_...' })
 *   Adfinia.identify('cust_42', { plan: 'growth' })
 *   Adfinia.track('Order Completed', { total: 49.99 })
 *
 * Default-import form (kept for backwards-compat with 1.0.0 consumers):
 *
 *   import Adfinia from '@adfinia/sdk-web'
 *
 * Every public method on `Adfinia` is a thin pass-through to the
 * underlying `AdfiniaClient`. The singleton means consumers don't have
 * to manage instances; for multi-tenant server-side use, instantiate
 * `AdfiniaClient` directly (also exported).
 */
import { AdfiniaClient } from './client'
import { NotificationsClient } from './notifications'
import { WebPush, type WebPushConfig, type WebPushSubscribeResult } from './webpush'
import type {
  AdfiniaConfig,
  CallOptions,
  ConsentChannel,
  ConsentStatus,
  IdentifyArg,
  Properties,
  Traits,
} from './types'

export type {
  AdfiniaConfig,
  AdfiniaContext,
  AdfiniaIdentity,
  AdfiniaPayload,
  CallOptions,
  ConsentChannel,
  ConsentFn,
  ConsentStatus,
  IdentifyArg,
  Properties,
  Traits,
} from './types'

export type { WebPushConfig, WebPushSubscribeResult } from './webpush'

export type {
  EventSourceFactory,
  EventSourceLike,
  InboxBridge,
  InboxNotification,
  ListNotificationsOptions,
  NotificationHandler,
  NotificationSeverity,
  NotificationStatus,
  NotificationsPage,
  NotificationsSubscription,
  SubscribeOptions,
} from './notifications'

export { AdfiniaClient } from './client'
export { NotificationsClient } from './notifications'

const singleton = new AdfiniaClient()

/**
 * In-app notification inbox, bound to the singleton. Framework-agnostic data
 * client — the host app renders the UI. See {@link NotificationsClient}.
 *
 *   Adfinia.notifications.list({ status: 'unread' })
 *   const sub = Adfinia.notifications.subscribe((n) => renderToast(n))
 *   Adfinia.notifications.markRead(n.id)
 *   sub.unsubscribe()
 */
const notifications = new NotificationsClient(() => singleton._notificationsBridge())

/**
 * `Adfinia` is the singleton wrapper around `AdfiniaClient`. It is the
 * primary public entry point and is documented at
 * https://docs.adfinia.com/user-guide/sdk-integration.
 *
 * Exported as both a named export (`import { Adfinia } from '@adfinia/sdk-web'`)
 * and the default export (`import Adfinia from '@adfinia/sdk-web'`). Both
 * forms resolve to the same object — `Adfinia === (default export)` is `true`.
 */
export const Adfinia = {
  init(config: AdfiniaConfig): void {
    singleton.init(config)
  },
  identify(arg: IdentifyArg, traits?: Traits): void {
    singleton.identify(arg, traits)
  },
  track(event: string, properties?: Properties, options?: CallOptions): void {
    singleton.track(event, properties, options)
  },
  page(name?: string, properties?: Properties, options?: CallOptions): void {
    singleton.page(name, properties, options)
  },
  screen(name?: string, properties?: Properties, options?: CallOptions): void {
    singleton.screen(name, properties, options)
  },
  /**
   * Record a write-only consent decision for one or more channels. `channels`
   * is a single channel string or an array of them; `status` is `'opted_in'`
   * or `'opted_out'`. Channels are open strings (not an enum) — the backend
   * owns the valid-channel registry. Emits one `consent_updated` event with
   * `channels` always an array. Never throws; safe to call from a GTM tag
   * (works via `window.Adfinia.optOut([...])`, and before init() it warns and
   * drops just like identify/track).
   */
  setConsent(channels: ConsentChannel | ConsentChannel[], status: ConsentStatus): void {
    singleton.setConsent(channels, status)
  },
  /** Shorthand for setConsent(channels, 'opted_in'). */
  optIn(channels: ConsentChannel | ConsentChannel[]): void {
    singleton.optIn(channels)
  },
  /** Shorthand for setConsent(channels, 'opted_out'). */
  optOut(channels: ConsentChannel | ConsentChannel[]): void {
    singleton.optOut(channels)
  },
  /**
   * @deprecated Deprecated: alias() is a no-op (no server-side handler). Anonymous sessions are promoted automatically by identify(). This method will be removed in the next major version.
   */
  alias(newId: string, previousId?: string): void {
    singleton.alias(newId, previousId)
  },
  reset(): void {
    singleton.reset()
  },
  async flush(): Promise<void> {
    await singleton.flush()
  },
  /**
   * Register a browser web-push subscription for the current identity and
   * POST it to the Adfinia ingest. Requires a service worker + a tenant
   * VAPID public key. See {@link WebPushConfig}. Resolves with the
   * subscription result, or a reason when the browser/permission blocks it.
   */
  async registerWebPush(config: WebPushConfig): Promise<WebPushSubscribeResult> {
    return WebPush.subscribe(singleton, config)
  },
  /**
   * In-app notification inbox. `list()` / `markRead()` / `markAllRead()` /
   * `subscribe()` plus the `trackOpened` / `trackClicked` event helpers. The
   * SDK ships no UI — the host app renders. See {@link NotificationsClient}.
   */
  notifications,
  /**
   * Escape hatch for advanced use cases that need a private instance
   * (multi-tenant SSR, isolated test contexts, etc.).
   */
  createClient(): AdfiniaClient {
    return new AdfiniaClient()
  },
}

export default Adfinia
