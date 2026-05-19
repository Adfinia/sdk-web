# @adfinia/sdk-web

Official Adfinia SDK for the browser. Send events and identify customers
from your website or web app — Adfinia handles batching, retries, offline
persistence, and identity stitching for you.

- Tiny: under 8 KB minified + gzipped.
- Reliable: events buffer to `localStorage` and survive page reloads,
  crashes, and offline windows.
- Standards-friendly: ESM, CommonJS, and `<script>`-friendly IIFE builds.
- Consent-aware: opt-out by default until your cookie banner says yes.
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
<script src="https://cdn.adfinia.com/sdk-web/0.1.0/adfinia.iife.js"></script>
<script>
  Adfinia.init({ writeKey: 'pk_live_...' })
  Adfinia.track('Page Viewed')
</script>
```

---

## Quick start

```ts
import Adfinia from '@adfinia/sdk-web'

Adfinia.init({
  writeKey: 'pk_live_your_public_key_here',
  // host: 'https://events.your-company.com', // self-hosted ingress
  debug: false,
})

// Identify the current user
Adfinia.identify('cust_42', { plan: 'growth', country: 'AE' })

// Track behaviour
Adfinia.track('Order Completed', { order_id: 'o_123', total: 49.99 })

// Page view
Adfinia.page('Pricing')

// Alias an anonymous user to a known customer id after signup
Adfinia.alias('cust_42')

// Clear identity on logout
Adfinia.reset()

// Force-flush before navigating away (rarely needed; SDK flushes on
// `visibilitychange` automatically)
await Adfinia.flush()
```

---

## Public API

### `Adfinia.init(config)`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `writeKey` | `string` | — | **Required.** The tenant write-only public key. Issue from `/settings/integrations/sdk-keys`. |
| `host` | `string` | `https://events.adfinia.com` | Ingest host. Self-hosted? Point at your ingress. |
| `debug` | `boolean` | `false` | Log SDK internals to `console.debug`. |
| `consent` | `() => boolean` | undefined | Consent gate. Returning `false` drops events silently. See [Consent](#consent--gdpr--pdpl--dpdp) below. |
| `flushAt` | `number` | `50` | Flush immediately once N events are buffered. |
| `flushIntervalMs` | `number` | `5000` | Otherwise, flush every N ms. |
| `maxQueueSize` | `number` | `1000` | Oldest events drop when this fills up. |

### `Adfinia.identify(customerId, traits?)`

```ts
Adfinia.identify('cust_42')
Adfinia.identify('cust_42', { plan: 'growth' })
// or the object form:
Adfinia.identify({ customerId: 'cust_42', traits: { plan: 'growth' } })
```

Traits merge with the existing trait bag — call `identify` again with new
traits and Adfinia will combine them server-side.

### `Adfinia.track(eventName, properties?)`

```ts
Adfinia.track('Order Completed', {
  order_id: 'o_123',
  total: 49.99,
  currency: 'AED',
  items: [{ sku: 'shirt-blue', qty: 1 }],
})
```

`eventName` should be in **Title Case Verb-Object** (`Order Completed`,
`Newsletter Subscribed`) — this is convention, not enforcement; Adfinia
accepts any non-empty string.

Properties must be JSON-serialisable. Don't put DOM nodes or class
instances in there — they'll be stringified to `{}`.

### `Adfinia.page(name?, properties?)`

```ts
Adfinia.page() // auto-captures url, path, title, referrer from window
Adfinia.page('Pricing', { plan_focused: 'growth' })
```

### `Adfinia.screen(name?, properties?)`

API-parity hook for the mobile/React Native SDKs. On the web it behaves
identically to `page()`. Use whichever reads better in your code; pick
one and stay consistent.

### `Adfinia.alias(newId, previousId?)`

```ts
// On signup, link the pre-signup anonymous activity to the new customer id
Adfinia.alias('cust_42')
```

If `previousId` is omitted, Adfinia uses the active `customer_id` (or the
anonymous id if there isn't one yet).

### `Adfinia.reset()`

Clears the customer id and traits, mints a new anonymous id. Call this on
logout so the next user's activity doesn't get stitched to the previous
one.

### `Adfinia.flush()`

Promise that resolves once the in-memory buffer has been POSTed. Rarely
needed — the SDK flushes on the interval, on size, on
`visibilitychange`, and on `pagehide`.

---

## Consent / GDPR / PDPL / DPDP

The SDK ships with a consent gate. By default consent is **assumed** —
this matches the legacy / server-side use case. If you have a cookie
banner, pass a `consent` callback:

```ts
import Adfinia from '@adfinia/sdk-web'

Adfinia.init({
  writeKey: 'pk_live_...',
  consent: () => window.__cookieBanner?.allowsAnalytics === true,
})
```

The callback runs on **every** `track / identify / page / screen / alias`
call. If it returns `false`, the SDK drops the call silently — no
buffering, no network. This means:

- You can initialise the SDK before the user makes a consent decision —
  early calls just drop on the floor until they accept.
- If the user revokes consent later in the session, the gate flips back
  to false automatically without re-initialisation.
- A `consent` function that throws is treated as no-consent
  (fail-closed).

For UAE PDPL, India DPDP, EU GDPR: pair the gate with `Adfinia.reset()`
when the user revokes — that clears any client-side identifier you'd
otherwise still hold.

---

## Content Security Policy (CSP)

The SDK makes outbound requests to your ingest host. Add it to your CSP
`connect-src`:

```
Content-Security-Policy: connect-src 'self' https://events.adfinia.com
```

The SDK itself does **not**:

- Inject `<script>` tags.
- Read or write cookies (we use `localStorage`).
- Touch global namespaces other than `window.Adfinia` (IIFE build only).

So the CSP impact is just `connect-src`.

---

## Identity model

| Concept | Stored as | Lifetime |
|---------|-----------|----------|
| `anonymous_id` | UUIDv7, `localStorage` key `adfinia:identity` | Until `reset()` or `identify(customerId)` |
| `customer_id` | string, `localStorage` key `adfinia:identity` | Until `reset()` |
| `traits` | object, `localStorage` key `adfinia:identity` | Until `reset()`; merged across `identify()` calls |
| Event queue | array, `localStorage` key `adfinia:queue` | Until flushed; survives reloads |

Storage keys:

- `adfinia:identity` — JSON `{anonymousId, customerId?, traits?}`
- `adfinia:queue` — JSON `AdfiniaPayload[]`

Both are scoped to the document origin. If you serve `app.example.com`
and `marketing.example.com`, they're treated as separate identities by
default — the API can stitch them server-side via shared customer ids.

---

## Browser support

| Browser | Version |
|---------|---------|
| Chrome / Edge | last 2 majors |
| Firefox | last 2 majors |
| Safari | iOS 14+, macOS 14+ |
| Node.js | 18+ (for server-side use) |

The SDK uses `fetch`, `crypto.getRandomValues`, and `localStorage`. All
are polyfill-free targets on the supported browser set.

In SSR contexts (Next.js, Remix, Nuxt), the SDK gracefully degrades —
`localStorage` falls back to in-memory and DOM-aware context fields are
omitted. Most consumers initialise the SDK only on the client.

---

## Production checklist

- [ ] `writeKey` is your **public** key, not your secret API key.
- [ ] `host` is set explicitly if you serve from a self-hosted ingress.
- [ ] Cookie banner integration via `consent` callback.
- [ ] `reset()` wired into your logout flow.
- [ ] CSP `connect-src` updated.
- [ ] The SDK is loaded **async** or **deferred** — never block first
      paint on event tracking.

---

## Examples

### Next.js (App Router)

```tsx
// app/providers.tsx
'use client'
import { useEffect } from 'react'
import Adfinia from '@adfinia/sdk-web'

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    Adfinia.init({
      writeKey: process.env.NEXT_PUBLIC_ADFINIA_KEY!,
      consent: () => document.cookie.includes('analytics_consent=1'),
    })
    Adfinia.page()
  }, [])
  return <>{children}</>
}
```

### Vanilla SPA route change

```ts
import Adfinia from '@adfinia/sdk-web'
import { router } from './router'

router.afterEach((to) => {
  Adfinia.page(to.name, { path: to.path })
})
```

### E-commerce conversion

```ts
async function onCheckoutSuccess(order) {
  Adfinia.identify(order.customer_id, { email: order.email })
  Adfinia.track('Order Completed', {
    order_id: order.id,
    total: order.total,
    currency: order.currency,
    items: order.items.map((i) => ({ sku: i.sku, qty: i.qty, price: i.price })),
  })
  await Adfinia.flush() // ensure delivery before redirecting
  window.location = '/thanks'
}
```

---

## Versioning

Semver. The signatures of `init / identify / track / page / screen / alias
/ reset / flush` are the stable API contract. Anything under `src/`'s
non-exported modules (`AdfiniaClient` aside) can change in a patch.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Issues / questions

- Bugs: [github.com/infinia-net/adfinia-web-sdk/issues](https://github.com/infinia-net/adfinia-web-sdk/issues)
- Docs: [docs.adfinia.com/sdks/web](https://docs.adfinia.com/sdks/web)
- Email: engineering@adfinia.com
