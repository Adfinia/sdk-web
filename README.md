# @adfinia/sdk-web

Adfinia Web SDK — event + identify ingest for browser apps. Under 11 KB minified for the IIFE bundle; tree-shakes to under 8 KB gzipped in modern bundlers.

- Tiny: ESM, CJS, and `<script>`-friendly IIFE builds.
- Reliable: events buffer to `localStorage` and survive page reloads, crashes, and offline windows.
- Consent-aware: opt-out by default until your consent callback says yes.
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
| `Adfinia.track(event, properties?)` | Event name + properties. |
| `Adfinia.page(name?, properties?)` | Page view. Auto-captures URL/title/referrer if no args. |
| `Adfinia.screen(name?, properties?)` | Parity hook for mobile SDKs; identical to `page()` on web. |
| `Adfinia.alias(newId, previousId?)` | Link the anonymous session to a known customer. |
| `Adfinia.reset()` | Logout — mints a new anonymous_id. |
| `Adfinia.flush()` | Promise — drains the in-memory queue. |

### `AdfiniaConfig`

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `writeKey` | `string` | — | **Required.** Tenant write-only public key (`pk_live_…` / `pk_test_…`). |
| `host` | `string` | `https://events.adfinia.com` | Override for self-hosted ingress. |
| `debug` | `boolean` | `false` | Log SDK internals to `console.debug`. |
| `consent` | `() => boolean` | undefined | Consent gate. Returning `false` drops events silently. |
| `flushAt` | `number` | `50` | Flush immediately once N events are buffered. |
| `flushIntervalMs` | `number` | `5000` | Otherwise, flush every N ms. |
| `maxQueueSize` | `number` | `1000` | Oldest events drop when this fills up. |

---

## Consent integration

The SDK ships with a consent gate. Pass a `consent` callback that returns the user's current opt-in state — it runs on **every** `track / identify / page / screen / alias` call. If it returns `false`, the SDK drops the call silently. The callback can flip from `false` to `true` mid-session without re-initialisation.

For UAE PDPL, India DPDP, EU GDPR: pair the gate with `Adfinia.reset()` when the user revokes — that clears any client-side identifier you'd otherwise still hold.

Full consent-architecture write-up: [docs.adfinia.com/user-guide/consent](https://docs.adfinia.com/user-guide/consent).

---

## Bundle output

| Format | File | Raw size | Use when |
|--------|------|----------|----------|
| ESM | `dist/index.js` | ~18 KB | Bundler-driven apps (Next.js, Vite, Webpack). Tree-shakes to under 8 KB gzipped. |
| CJS | `dist/index.cjs` | ~18 KB | Node.js + legacy bundlers. |
| IIFE | `dist/adfinia.iife.js` | ~11 KB | Direct `<script>` include, CDN drop-in, Google Tag Manager. |
| Types | `dist/index.d.ts` | ~6 KB | TypeScript autocomplete + type-checking. |

Sizes are pre-gzip. The IIFE bundle exposes `window.Adfinia` and self-bootstraps — no `import` needed.

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
