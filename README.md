# @adfinia/sdk-web

Adfinia Web SDK — event + identify ingest for browser apps. Around 19.5 KB minified for the IIFE bundle (~6 KB gzipped); tree-shakes further in modern bundlers.

- Tiny: ESM, CJS, and `<script>`-friendly IIFE builds.
- Reliable: events buffer to `localStorage` and survive page reloads, crashes, and offline windows. Last-mile delivery uses `navigator.sendBeacon` on tab close so the final batch lands even when the page is unloading.
- Consent-aware: opt-out by default until your consent callback says yes.
- Privacy-first context: browser context (page, viewport, locale, referrer, user-agent) is **opt-in** via `autoContext: true`. Default OFF.
- Typed: full TypeScript types exported.

---

## Install

```bash
npm install @adfinia/sdk-web
# or
pnpm add @adfinia/sdk-web
# or
yarn add @adfinia/sdk-web
```

Or drop the IIFE bundle in via `<script>`:

```html
<script src="https://cdn.adfinia.com/sdk-web/1.1.0/adfinia.iife.js"></script>
<script>
  Adfinia.init({ writeKey: 'pk_live_...' })
  Adfinia.track('Page Viewed')
</script>
```

---

## Quickstart

```ts
import { Adfinia } from '@adfinia/sdk-web'

Adfinia.init({
  writeKey: 'pk_live_your_public_key_here',
  consent: () => window.__cookieBanner?.allowsAnalytics === true,
})

Adfinia.identify('cust_42', {
  email: 'ahmed@example.ae',
  first_name: 'Ahmed',
  language: 'en-AE',
  country: 'AE',
  city: 'Dubai',
  source: 'sdk_web',
  utm_source: 'google',
  utm_campaign: 'ramadan_2026',
})
Adfinia.track('Order Completed', { order_id: 'o_123', total: 49.99 })
Adfinia.page('Pricing')
```

### `identify()` traits

The full `IdentifyTraits` interface (added in `1.1.0`, mirrors the api
`IdentifyTraits` contract) accepts the following optional fields:

| Field | Type | Notes |
|-------|------|-------|
| `email` | `string` | Resolves to an `email` alias on the identity graph. |
| `phone` | `string` | E.164. Resolves to a `phone` alias. |
| `device_id` | `string` | Resolves to a `device_id` alias. |
| `external_id` | `string` | Tenant-side CRM / external system ID. |
| `first_name` / `last_name` | `string` | |
| `language` | `string` | BCP 47 — e.g. `en-AE`, `ar-AE`, `hi-IN`. |
| `timezone` | `string` | IANA — e.g. `Asia/Dubai`. |
| `country` | `string` | ISO 3166-1 alpha-2 — e.g. `AE`. |
| `city` | `string` | Free text. |
| `whatsapp` | `string` | E.164. Separate channel from `phone`. |
| `gender` | `'male' \| 'female' \| 'non_binary' \| 'prefer_not_to_say'` | |
| `date_of_birth` | `string` | ISO 8601 date — `YYYY-MM-DD`. |
| `source` | `IdentifySource` | Closed enum — see `src/types.ts`. Web defaults to `sdk_web` when callers omit it server-side. |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_term` / `utm_content` | `string` | First-touch lands on contact creation; last-touch on every Identify carrying any UTM key. |
| `extra` | `Record<string, string>` | Open-ended bag for tenant-specific custom fields. |

Unset fields are omitted from the JSON body (never `null` / empty
string); the server treats them as "leave existing value alone".

> **Note on imports.** The named-import form above is the recommended shape and matches the [SDK integration guide](https://docs.adfinia.com/user-guide/sdk-integration#web). The default-import form `import Adfinia from '@adfinia/sdk-web'` is the legacy alias kept for backwards-compat with consumers who started against `1.0.0` (which only shipped the default export). Both forms resolve to the same singleton.
>
> For advanced cases that need their own client instance (multi-tenant SSR, isolated test contexts), import the underlying class: `import { AdfiniaClient } from '@adfinia/sdk-web'`.

---

## API reference

| Method | Notes |
|--------|-------|
| `Adfinia.init(config)` | One-shot. Subsequent calls are ignored. |
| `Adfinia.identify(customerId, traits?)` | Customer-id form. |
| `Adfinia.identify({ customerId, externalId?, anonymousId?, traits?, context? })` | Object form. `externalId` is a tenant-owned stable id (e.g. wallet hash). `context` is merged on top of auto-context. |
| `Adfinia.track(event, properties?, { context?, externalId? }?)` | Event name + properties + per-call context / external id. |
| `Adfinia.page(name?, properties?, { context?, externalId? }?)` | Page view. Auto-captures URL/title/referrer if no args. |
| `Adfinia.screen(name?, properties?, { context?, externalId? }?)` | Parity hook for mobile SDKs; identical to `page()` on web. |
| `Adfinia.alias(newId, previousId?)` | **Deprecated (no-op).** There is no server-side alias handler; this method does nothing and will be removed in the next major version. Anonymous sessions are promoted to a known customer automatically by `identify()` (the identify event carries the live anonymous_id). |
| `Adfinia.reset()` | Logout — mints a new anonymous_id and clears external_id. |
| `Adfinia.flush()` | Promise — drains the queue and resolves when the in-flight batch settles. Use before a critical navigation. |
| `Adfinia.registerWebPush({ vapidPublicKey, ... })` | Promise — registers a web-push subscription (service worker + permission + PushManager). See [Web push](#web-push). |

### `AdfiniaConfig`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `writeKey` | `string` | — | **Required.** Tenant write-only public key (`pk_live_…` / `pk_test_…`). |
| `host` | `string` | `https://api.adfinia.com` | Override for self-hosted ingress. |
| `debug` | `boolean` | `false` | Log SDK internals to `console.debug`. |
| `consent` | `() => boolean` | undefined | Consent gate. Returning `false` drops events silently. |
| `autoContext` | `boolean` | `false` | Opt in to automatic browser-context enrichment (page_path, page_url, referrer, user_agent, locale, timezone, viewport, screen_resolution) **plus first-touch acquisition** (UTM tags, ad click IDs, landing page). Off by default — privacy-first. |
| `autoPage` | `boolean` | `true` | Auto-fire `page()` on load + SPA route change (pushState/replaceState/popstate). Set `false` to wire page views by hand. |
| `flushAt` | `number` | `50` | Flush immediately once N events are buffered. |
| `flushIntervalMs` | `number` | `5000` | Otherwise, flush every N ms. |
| `maxQueueSize` | `number` | `1000` | Oldest events drop when this fills up. |

### Browser context: `autoContext`

By default the SDK ships only library identifiers + the message envelope. To enrich every event with browser context, opt in:

```ts
Adfinia.init({
  writeKey: 'pk_live_…',
  autoContext: true, // collect page_path, page_url, referrer, user_agent, locale, timezone, viewport, screen_resolution
})
```

Per-call context wins on key collision:

```ts
Adfinia.track('Order Completed', { total: 49.99 }, {
  context: { experiment_variant: 'checkout_v3' },
})
```

The auto-context keys map 1:1 to the server's `context map[string]string` contract. Caller-supplied context is layered on last, so anything you pass in `{ context }` always overrides what the SDK auto-collects.

### External identity (`external_id`)

Pass a tenant-owned stable identifier — a wallet hash, a CRM key, anything you control — as `externalId`. It's persisted client-side and emitted on the wire as `external_id`. The server resolves identity in the order `customer_id > external_id > anonymous_id`.

```ts
// At wallet connect / login:
Adfinia.identify({ externalId: walletAddress, traits: { country: 'AE' } })

// Or per call, before you have a full identify:
Adfinia.track('wallet_connected', { is_new_wallet: true }, { externalId: walletAddress })
```

Once set (via `identify` or a per-call option), `external_id` rides every subsequent event automatically until `reset()`.

### Acquisition (first-touch attribution)

When `autoContext: true`, the SDK reads acquisition signals from the **first** session URL and persists them — later events keep the original attribution even after the query string is gone:

- UTM tags: `utm_source / utm_medium / utm_campaign / utm_term / utm_content` → `campaign.utm_*`
- Ad click IDs: `gclid / fbclid / ttclid / sc / msclkid` → `campaign.*`
- Landing page → `page.landing`

No code beyond `autoContext: true` — land the user with `?utm_source=google&gclid=…` and the attribution sticks for the whole session.

### Auto page tracking (SPAs)

By default (`autoPage: true`) the SDK fires `page()` on the initial load and on every SPA route change — it hooks `history.pushState`, `history.replaceState`, and `popstate`, de-duped by path+search so you never get a double-fire. Hash-only changes don't count as a new page.

```ts
Adfinia.init({ writeKey: 'pk_live_…' }) // page views are automatic

// Wiring them by hand instead? Turn it off:
Adfinia.init({ writeKey: 'pk_live_…', autoPage: false })
router.afterEach(() => Adfinia.page())
```

### Web push

`Adfinia.registerWebPush(config)` runs the full browser opt-in: register a service worker, request Notification permission, `PushManager.subscribe` with your tenant VAPID public key, and POST the subscription to Adfinia. It also emits `notification_permission_prompted/granted/denied` track events.

```ts
const result = await Adfinia.registerWebPush({
  vapidPublicKey: 'BEl62iUY…',     // tenant VAPID public key (base64url P-256)
  serviceWorkerUrl: '/adfinia-sw.js', // default; host this at your web root
})
if (result.ok) {
  console.log('subscribed', result.endpoint)
} else {
  console.log('not subscribed —', result.reason) // 'permission_denied' | 'unsupported' | …
}
```

**Service worker hosting.** The service worker **must** be served from your web root (a SW only controls pages at or below its own URL). Copy it from the package after install:

```bash
cp node_modules/@adfinia/sdk-web/dist/adfinia-sw.js ./public/adfinia-sw.js
```

The worker shows the notification and emits `push_received` / `push_clicked` back to Adfinia. If you serve it from a sub-path, set the `Service-Worker-Allowed` response header and pass `scope` to `registerWebPush`.

> **VAPID key.** Get your tenant VAPID public key from the Adfinia console (Settings → Channels → Push). You can pass it as `vapidPublicKey`, or set `fetchVapidFromConfig: true` to have the SDK pull it from `/sdk/config` (requires server support for that field).
>
> **iOS.** Web push works on Android + desktop Chrome/Firefox/Edge today. iOS Safari 16.4+ supports web push only for home-screen-added PWAs — lead with email/SMS there.

### Last-mile delivery on unload

On tab close / hide, the SDK drains the queue via `navigator.sendBeacon` (with a `fetch({ keepalive: true })` fallback). This survives the unloading page so the final batch reliably reaches the server. The auth + SDK-version travel as query params on the beacon URL because `sendBeacon` can't set custom headers — the gateway accepts both forms.

For navigations you control, prefer the explicit `await Adfinia.flush()`:

```ts
Adfinia.track('CTA Clicked', { cta: 'upgrade' })
await Adfinia.flush()
router.push('/upgrade')
```

---

## Consent integration

The SDK ships with a consent gate. Pass a `consent` callback that returns the user's current opt-in state — it runs on **every** `track / identify / page / screen / alias` call. If it returns `false`, the SDK drops the call silently. The callback can flip from `false` to `true` mid-session without re-initialisation.

For UAE PDPL, India DPDP, EU GDPR: pair the gate with `Adfinia.reset()` when the user revokes — that clears any client-side identifier you'd otherwise still hold.

Full consent-architecture write-up: [docs.adfinia.com/user-guide/consent](https://docs.adfinia.com/user-guide/consent).

---

## Bundle output

| Format | File | Raw size | Use when |
|--------|------|----------|----------|
| ESM | `dist/index.js` | ~36 KB | Bundler-driven apps (Next.js, Vite, Webpack). Tree-shakes to ~10 KB gzipped. |
| CJS | `dist/index.cjs` | ~36 KB | Node.js + legacy bundlers. |
| IIFE | `dist/adfinia.iife.js` | ~19.5 KB | Direct `<script>` include, CDN drop-in, Google Tag Manager. |
| SW | `dist/adfinia-sw.js` | ~3.5 KB | Web-push service worker. Host at your web root (not bundled). |
| Types | `dist/index.d.ts` | ~16 KB | TypeScript autocomplete + type-checking. |

Sizes are pre-gzip; the IIFE bundle gzips to roughly 6 KB on the wire. The IIFE bundle exposes `window.Adfinia` and self-bootstraps — no `import` needed.

---

## Looking for the full integration guide?

[docs.adfinia.com/user-guide/sdk-integration#web](https://docs.adfinia.com/user-guide/sdk-integration#web) — covers CSP, Next.js App Router patterns, SPA routing, consent banners, e-commerce conversion tracking, and self-hosted ingest configuration.

---

## Browser support

| Browser | Version |
|---------|---------|
| Chrome / Edge | last 2 majors |
| Firefox | last 2 majors |
| Safari | iOS 14+, macOS 14+ |
| Node.js | 18+ (for server-side use) |

The SDK uses `fetch`, `crypto.getRandomValues`, and `localStorage`. All are polyfill-free on the supported set. In SSR contexts it gracefully degrades — `localStorage` falls back to in-memory.

---

## Issues + contributing

- Bugs and feature requests: [github.com/Adfinia/sdk-web/issues](https://github.com/Adfinia/sdk-web/issues)
- Contributing guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Email: engineering@adfinia.com

---

## License

MIT — see [LICENSE](./LICENSE).
