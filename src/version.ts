// Single source of truth for the library identifier emitted in every
// event's `context.library` block AND the `X-Adfinia-SDK-Version` header
// every HTTP request sets. Kept in sync with package.json by the release
// script (TODO — for now bump manually on release).
//
// Header shape (server contract, see api/internal/identity/sdk_config_handler.go):
//
//     X-Adfinia-SDK-Version: adfinia-sdk-web@1.0.0
//
// The server's SDKVersionMiddleware parses this header to enforce the
// minimum supported version per SDK. Below the floor → 426 Upgrade Required.

export const LIBRARY_NAME = 'adfinia-sdk-web'
export const LIBRARY_VERSION = '1.3.1'

/** Value to send as the `X-Adfinia-SDK-Version` header on every request. */
export const SDK_VERSION_HEADER = `${LIBRARY_NAME}@${LIBRARY_VERSION}`
