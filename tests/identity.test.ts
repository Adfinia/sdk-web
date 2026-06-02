import { beforeEach, describe, expect, it } from 'vitest'
import { IdentityStore } from '../src/identity'
import { createStorage } from '../src/storage'
import type { IdentifyTraits } from '../src/types'
import { clearStorage } from './helpers'

describe('IdentityStore', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('mints an anonymous_id on first construction', () => {
    const store = new IdentityStore(createStorage())
    expect(store.anonymousId()).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.customerId()).toBeUndefined()
  })

  it('persists anonymous_id across constructions (shared backing store)', () => {
    // Use a single backing store to model the real-world case where both
    // SDK instances read the same `localStorage`. In Node's vitest sandbox
    // happy-dom's localStorage is an empty object, so we'd otherwise hit
    // the MemoryStore fallback — and each fallback is independent by design.
    const backing = createStorage()
    const s1 = new IdentityStore(backing)
    const id1 = s1.anonymousId()
    const s2 = new IdentityStore(backing)
    expect(s2.anonymousId()).toBe(id1)
  })

  it('records customer_id and merges traits', () => {
    const store = new IdentityStore(createStorage())
    store.identify('cust_42', { plan: 'growth' })
    expect(store.customerId()).toBe('cust_42')
    expect(store.traits()).toEqual({ plan: 'growth' })

    store.identify('cust_42', { country: 'AE' })
    expect(store.traits()).toEqual({ plan: 'growth', country: 'AE' })
  })

  it('reset() mints a new anonymous_id and clears customer_id', () => {
    const store = new IdentityStore(createStorage())
    const orig = store.anonymousId()
    store.identify('cust_42')
    store.reset()
    expect(store.customerId()).toBeUndefined()
    expect(store.anonymousId()).not.toBe(orig)
  })

  // v1.1.0 — IdentifyTraits expansion (mirrors api `IdentifyTraits` v1.1).
  // These tests pin the snake_case wire shape + omit-when-unset semantics.
  it('persists every v1.1.0 IdentifyTraits field with snake_case keys', () => {
    const store = new IdentityStore(createStorage())
    const traits: IdentifyTraits = {
      email: 'ahmed@example.ae',
      phone: '+971501234567',
      whatsapp: '+971501234567',
      first_name: 'Ahmed',
      last_name: 'Al Hosani',
      language: 'ar-AE',
      timezone: 'Asia/Dubai',
      country: 'AE',
      city: 'Dubai',
      gender: 'male',
      date_of_birth: '1990-04-12',
      source: 'sdk_web',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'ramadan_2026',
      utm_term: 'crm',
      utm_content: 'hero_cta',
    }
    store.identify('cust_42', traits)
    const stored = store.traits()
    // Every key arrives unchanged — snake_case preserved end-to-end.
    expect(stored).toEqual(traits)
  })

  it('omits unset IdentifyTraits fields from the persisted bag', () => {
    const store = new IdentityStore(createStorage())
    const traits: IdentifyTraits = { email: 'layla@example.ae', country: 'AE' }
    store.identify('cust_42', traits)
    const stored = store.traits()!
    // Only the two set keys land; the rest are absent (not `null`,
    // not `undefined` keys).
    expect(Object.keys(stored).sort()).toEqual(['country', 'email'])
    expect(Object.prototype.hasOwnProperty.call(stored, 'whatsapp')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(stored, 'gender')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(stored, 'date_of_birth')).toBe(false)
  })

  it('merges later traits with earlier ones (additive identify chain)', () => {
    const store = new IdentityStore(createStorage())
    store.identify('cust_42', { email: 'vikram@example.in', country: 'IN' })
    store.identify('cust_42', {
      language: 'hi-IN',
      utm_source: 'meta',
      gender: 'male',
    } satisfies IdentifyTraits)
    expect(store.traits()).toEqual({
      email: 'vikram@example.in',
      country: 'IN',
      language: 'hi-IN',
      utm_source: 'meta',
      gender: 'male',
    })
  })
})
