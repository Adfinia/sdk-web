import { describe, expect, it } from 'vitest'
import { uuidv7 } from '../src/uuid'

describe('uuidv7', () => {
  it('emits the canonical 36-character format', () => {
    const id = uuidv7()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('encodes the current timestamp in the first 48 bits', () => {
    const before = Date.now()
    const id = uuidv7()
    const after = Date.now()
    const tsHex = id.replace(/-/g, '').slice(0, 12)
    const ts = parseInt(tsHex, 16)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('emits monotonically-ordered ids across calls', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })
})
