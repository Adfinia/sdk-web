# @adfinia/sdk-web changelog

All notable changes to the official Adfinia web SDK land here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the SDK
follows [semver](https://semver.org/) starting at 1.0.0.

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
