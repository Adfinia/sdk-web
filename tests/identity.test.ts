import { beforeEach, describe, expect, it } from 'vitest'
import { IdentityStore } from '../src/identity'
import { createStorage } from '../src/storage'
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
})
