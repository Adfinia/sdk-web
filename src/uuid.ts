// UUIDv7 — time-ordered, 128-bit. Spec: RFC 9562 §5.7.
// We generate them client-side so the API can sort events without a clock skew step.
//
// Monotonicity within the same millisecond is preserved by using a 12-bit
// per-ms counter in the rand_a section (bits 48..59 of the UUID, ignoring
// the version nibble). This matches the "Method 1: Monotonic Random" pattern
// from RFC 9562 §6.2.

let lastMs = 0
let counter = 0 // 12-bit counter within the current millisecond.

/**
 * Generate a UUIDv7 string. Format: `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`
 * where the first 48 bits encode milliseconds-since-epoch.
 */
export function uuidv7(): string {
  let ms = Date.now()
  if (ms === lastMs) {
    counter += 1
    if (counter > 0xfff) {
      // Counter overflow within a single ms — bump the clock so the next
      // batch lands in the next millisecond. Very rare in practice.
      ms = lastMs + 1
      lastMs = ms
      counter = 0
    }
  } else {
    lastMs = ms
    counter = 0
  }

  // 16 random bytes; we'll overwrite the first 6 with the timestamp,
  // bytes 6..7 with the counter, and set the version + variant nibbles.
  const bytes = new Uint8Array(16)
  const cryptoSource = getCrypto()
  cryptoSource.getRandomValues(bytes)

  // First 48 bits = unix_ts_ms big-endian.
  const msBig = BigInt(ms)
  bytes[0] = Number((msBig >> 40n) & 0xffn)
  bytes[1] = Number((msBig >> 32n) & 0xffn)
  bytes[2] = Number((msBig >> 24n) & 0xffn)
  bytes[3] = Number((msBig >> 16n) & 0xffn)
  bytes[4] = Number((msBig >> 8n) & 0xffn)
  bytes[5] = Number(msBig & 0xffn)

  // Bits 48..59 = 12-bit monotonic counter (rand_a section per RFC 9562 §5.7).
  bytes[6] = (counter >> 8) & 0x0f
  bytes[7] = counter & 0xff

  // Version = 7 (high nibble of byte 6).
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  // Variant = 10 (high two bits of byte 8).
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  return formatUuid(bytes)
}

function formatUuid(b: Uint8Array): string {
  const hex: string[] = []
  for (let i = 0; i < b.length; i++) {
    hex.push(b[i].toString(16).padStart(2, '0'))
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}

function getCrypto(): Crypto {
  const g = typeof globalThis !== 'undefined' ? globalThis : undefined
  const c = g?.crypto
  if (c && typeof c.getRandomValues === 'function') {
    return c
  }
  // Last resort — should never hit this in a modern browser or Node 16+.
  throw new Error('@adfinia/sdk-web: no crypto.getRandomValues available')
}
