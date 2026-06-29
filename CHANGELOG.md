# @adfinia/sdk-web changelog

All notable changes to the official Adfinia web SDK land here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the SDK
follows [semver](https://semver.org/) starting at 1.0.0.

## [1.3.1] — 2026-06-29

Patch release. No public-surface change — every existing call site compiles
and behaves identically.

### Fixed — always batch (correct test/live tagging)
- The transport no longer falls back to the legacy single-event endpoints
  (`POST /api/v1/track`, `POST /api/v1/identify`) when a flush carries exactly
  one event. Every flush now goes to the batch endpoints
  (`/api/v1/track/batch`, `/api/v1/identify/batch`) as a 1-element
  `{events:[…]}`.
- Why: the server's single-event `/track` path does NOT stamp the event's
  environment from the authenticating API key — it defaults to `live` unless
  the caller supplies `context.environment`. So singleton drains from a
  `adf_test_*` key were mis-tagged `environment=live` and leaked into live
  analytics. The batch endpoints stamp environment from the API key
  (`middleware.GetAPIKeyEnvironment`), so routing everything through them makes
  test/live tagging correct and consistent. The single-event endpoints are
  also deprecated server-side (`Deprecation: prefer-batch` response header).
- `sdk-react-native@1.0.1` ships the identical fix; the two transports are
  kept in lockstep.

## [1.3.0] — 2026-06-08

Feature release. Reunites the v1.1.0 `identify()` trait expansion (which had
already shipped to npm) with the enterprise-polish + PredictStreet web-funnel
work. **Supersedes 1.2.0**, which was published from a branch cut before 1.1.0
and therefore inadvertently omitted the v1.1.0 identify-trait fields. 1.3.0 is
the full union; no public-surface breaks vs 1.1.0 or 1.0.1.

### Added — identify() traits (restored from 1.1.0)
- `identify()` accepts `language`, `country`, `city`, `whatsapp`, `gender`,
  `date_of_birth`, `source`, and the five `utm_*` fields (mirrors api
  `IdentifyTraits` v1.1). Optional; empty / omitted means "leave as-is".
- Typed surface in `src/types.ts`: `IdentifyTraits` + `IdentifySource` +
  `IdentifyGender`; `Traits` intersects the typed shape with
  `Record<string, unknown>` for custom fields.

### Added — PredictStreet web funnel + enterprise polish
- The full 1.2.0 feature set (see below): `external_id` / wallet identity,
  acquisition first-touch auto-context, auto-`page()`, web-push client,
  `autoContext`, per-call `context`, and `sendBeacon` on unload.

### Changed
- `LIBRARY_VERSION` → `1.3.0`; `X-Adfinia-SDK-Version` reports
  `adfinia-sdk-web@1.3.0`.

## [Unreleased]

Nothing in flight.

## [1.2.0] — 2026-06-08

> **Superseded by 1.3.0.** Published from a branch cut before 1.1.0 landed on
> npm, so this build inadvertently dropped the v1.1.0 `identify()` trait
> fields. Upgrade to 1.3.0, which folds them back in. Kept here as history.

Additive minor release. Folds the `feat/enterprise-polish` browser-context
work AND the four PredictStreet web-funnel capabilities. No public-surface
breaks vs `1.0.1` — every existing call site compiles and behaves
identically. (We jumped `1.1.0` → `1.2.0`: the polish never shipped to npm
on its own, so the four new features ship together under one minor.)

### Added — PredictStreet web funnel
- **`external_id` / wallet identity (first-class).** `identify(...)` object
  form takes `externalId`; `track / page / screen` take it as a per-call
  option (`{ externalId }`). It's persisted in the identity ledger (so once
  set it rides every later event) and emitted on the wire as `external_id`.
  The server resolves identity in the order
  `customer_id > external_id > anonymous_id`. `reset()` clears it.
  PredictStreet sends the wallet hash as `external_id`.
- **Acquisition auto-context with first-touch persistence**
  (`US-PS-SDK-AUTOCTX-001`). Under the existing `autoContext` opt-in, the SDK
  now captures from the **first** session URL: `utm_source/medium/campaign/
  term/content`, the click IDs `gclid/fbclid/ttclid/sc/msclkid`, and the
  landing page. These are persisted once (`adfinia:acquisition`) — later
  events keep the original acquisition values even after the query string is
  gone. Mapped to the server `context map[string]string` as
  `campaign.<key>` and `page.landing`.
- **Auto-`page()` on SPA route changes.** New `autoPage` config (default
  **on** in a browser). Fires `page()` on initial load and on
  `history.pushState` / `replaceState` / `popstate`, de-duped by path+search
  (no double-fire; hash-only changes don't re-fire). Set `autoPage: false`
  to wire page tracking by hand.
- **Web-push client** (`US-PS-WEBPUSH-001`, client side).
  `Adfinia.registerWebPush({ vapidPublicKey, serviceWorkerUrl?, ... })`
  registers a service worker, requests Notification permission,
  `PushManager.subscribe`s with the tenant VAPID public key, and POSTs
  `{customer_id?, external_id?, anonymous_id, endpoint, keys:{p256dh, auth}}`
  to `POST /api/v1/push/subscriptions` via the SDK transport. Emits
  `notification_permission_prompted/granted/denied` track events. The
  permission key can be passed directly or fetched from `/sdk/config`
  (`fetchVapidFromConfig: true`, pending server support). Ships the service
  worker at `dist/adfinia-sw.js` — host it at your web root; it emits
  `push_received` / `push_clicked`.

### Added — enterprise polish (was the unshipped 1.1.0 WIP)
- **`init({ autoContext: true })`** — opt-in browser-context enrichment:
  `page_path`, `page_url`, `referrer`, `user_agent`, `locale`, `timezone`,
  `viewport`, `screen_resolution`, `library`, `library_version`. Defaults to
  **off** — Adfinia treats browser context as opt-in for PDPL / DPDP / GDPR.
- **Per-call `context` overrides** — `track / page / screen` accept a third
  options arg `{ context?: Record<string,string> }`; `identify` accepts
  `context` on the object form. Caller-supplied context wins over the
  auto-collected map on key collision.
- **`navigator.sendBeacon` on tab unload** (`visibilitychange === 'hidden'`
  + `pagehide`), with a `fetch({ keepalive: true })` fallback. Auth +
  SDK-version travel as query params (sendBeacon can't set headers).
- **`Adfinia.flush()` doc clarification** — resolves once the in-flight
  batch settles.
- **`Transport.sendBeacon(batch)` + `Transport.postJSON(path, body)`** —
  internal transport methods (the latter powers the web-push subscription
  POST).

### Changed
- **`LIBRARY_VERSION` 1.0.0 → 1.2.0** — the `X-Adfinia-SDK-Version` header
  now reports `adfinia-sdk-web@1.2.0`.
- **IIFE bundle: ~14 KB → ~19.5 KB raw (~6.1 KB gzip).** Driven by the
  web-push client + acquisition + auto-page. CI size budget raised
  15000 → 24000 bytes. README "Bundle output" updated.
- **README** updated with external_id, acquisition auto-context, auto-page,
  and web-push usage.

### Notes
- **No breaking changes** vs `1.0.1`. `autoPage` defaults on, but it only
  emits a standard `page()` event (already a supported call); opt out with
  `autoPage: false` if you wire page views yourself.
- The wire `context` map stays `Record<string, string>`. Layering order:
  default flat context → auto-context + first-touch acquisition (when
  `autoContext` on) → caller's `{ context }` (always wins).

## [1.1.0] — 2026-06-02

### Added
- `identify()` now accepts: `language`, `country`, `city`, `whatsapp`,
  `gender`, `date_of_birth`, `source`, `utm_source`, `utm_medium`,
  `utm_campaign`, `utm_term`, `utm_content` (mirrors api
  `IdentifyTraits` v1.1). All fields are optional; the server treats
  empty / omitted as "leave existing value alone".
- New typed surface in `src/types.ts`: `IdentifyTraits` interface +
  `IdentifySource` enum + `IdentifyGender` enum. The `Traits` type now
  intersects the typed shape with `Record<string, unknown>`, so tenants
  with custom contact fields keep their open-bag escape hatch.
- `X-Adfinia-SDK-Version` header now reads `adfinia-sdk-web@1.1.0`.

### Internal
- No breaking changes — additive only. v1.0.x calls remain wire-compatible:
  every existing field name + JSON shape is unchanged, the new keys are
  pure additions, and unset fields are still omitted from the JSON body
  (not serialised as `null`).
- Field keys on the wire stay snake_case throughout, matching the api's
  `IdentifyTraits` JSON tags exactly. Pass-through in `transport.ts` is
  unchanged — the typed surface guides callers, the wire payload is
  identical to whatever the caller supplied.

## [1.0.1] — 2026-05-22

Patch release fixing two launch-day bugs reported against `1.0.0`.

### Fixed
- **`Adfinia` is now exported as a named export.** Every customer doc and
  README example uses `import { Adfinia } from '@adfinia/sdk-web'`, but
  `1.0.0` only shipped a default export — so `import { Adfinia }` was
  `undefined` at runtime. `1.0.1` exports `Adfinia` both as the default
  export and as a named export; both resolve to the exact same singleton.
- **`package.json` repository metadata points at the live repo.** `1.0.0`
  carried the legacy `infinia-net/adfinia-web-sdk` URLs in `repository`,
  `homepage`, and `bugs`. The npm "Repository" link on
  https://www.npmjs.com/package/@adfinia/sdk-web now resolves to
  `https://github.com/Adfinia/sdk-web`.

### Notes
- No code-path / wire-format changes vs `1.0.0`. Drop-in upgrade.
- `import Adfinia from '@adfinia/sdk-web'` (the form `1.0.0` shipped)
  keeps working unchanged.

## [1.0.0] — 2026-05-22

First stable release. Same content as the dev-internal-only
`1.0.0-rc.1` build (never published to npm); the founder direction on
2026-05-22 was to drop the `-rc.1` suffix and ship straight as `1.0.0`.

### Added
- **Server-driven runtime config.** On `init()`, the SDK fetches
  `GET /api/v1/sdk/config` and applies `batch_size` + `flush_interval_ms`
  to the in-memory queue. The fetch is fire-and-forget; a network error
  leaves the local defaults (`flushAt: 50`, `flushIntervalMs: 5_000`) in
  place. Unknown response fields are ignored — older SDKs keep working
  when the server adds knobs.
- **`X-Adfinia-SDK-Version` header.** Every request to the API (events
  and config) carries `adfinia-sdk-web@<version>` so the server's
  version middleware can return `426 Upgrade Required` once this
  release falls below the supported floor.
- **`EventQueue.applyRemoteConfig({ flushAt?, flushIntervalMs? })`** —
  internal API the client uses to apply remote knobs without restart.

### Changed
- Library version bumped `0.1.0 → 1.0.0`. `LIBRARY_VERSION` in
  `version.ts` now exports a `SDK_VERSION_HEADER` constant the transport
  reads.

## ~~[1.0.0-rc.1] — 2026-05-22~~

~~Dev-internal release candidate. Never published to npm; superseded by
`1.0.0` on the same day per founder direction. Same code, no `-rc.1`
suffix on the public artifact.~~

### Notes
- No breaking changes to the public `init / identify / track / page /
  screen / alias / reset / flush` surface vs 0.1.0.
- Endpoints in use:
  - `POST /api/v1/track/batch`
  - `POST /api/v1/identify/batch`
  - `POST /api/v1/track` and `/api/v1/identify` (single-event fallback)
  - `GET /api/v1/sdk/config` (init)

## [0.1.0] — 2026-05-20

Initial pre-release alongside the iOS / Android / React Native /
Flutter SDK skeletons. Wire compatibility tested against the
`/api/v1/track/batch` and `/api/v1/identify/batch` endpoints introduced
by AGENT-SDK-INGEST-KAFKA on 2026-05-21.
