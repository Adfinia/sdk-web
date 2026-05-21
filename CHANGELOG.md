# @adfinia/sdk-web changelog

All notable changes to the official Adfinia web SDK land here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the SDK
follows [semver](https://semver.org/) starting at 1.0.0.

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
