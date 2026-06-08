import type { AdfiniaIdentity, Traits } from './types'
import type { KVStore } from './storage'
import { uuidv7 } from './uuid'

const IDENTITY_KEY = 'adfinia:identity'

/**
 * Identity ledger. Owns the anonymous_id + customer_id + traits triple and
 * is the single place that persists them. All other modules read identity
 * through this surface; they never touch storage keys directly.
 */
export class IdentityStore {
  private state: AdfiniaIdentity

  constructor(private store: KVStore) {
    this.state = this.load()
  }

  private load(): AdfiniaIdentity {
    const raw = this.store.get(IDENTITY_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AdfiniaIdentity
        if (parsed.anonymousId) return parsed
      } catch {
        // Corrupt — fall through to a fresh identity.
      }
    }
    const fresh: AdfiniaIdentity = { anonymousId: uuidv7() }
    this.persist(fresh)
    return fresh
  }

  private persist(state: AdfiniaIdentity): void {
    this.store.set(IDENTITY_KEY, JSON.stringify(state))
  }

  anonymousId(): string {
    return this.state.anonymousId
  }

  customerId(): string | undefined {
    return this.state.customerId
  }

  externalId(): string | undefined {
    return this.state.externalId
  }

  traits(): Traits | undefined {
    return this.state.traits
  }

  identify(
    customerId?: string,
    traits?: Traits,
    anonymousId?: string,
    externalId?: string,
  ): void {
    this.state = {
      anonymousId: anonymousId ?? this.state.anonymousId,
      customerId: customerId ?? this.state.customerId,
      externalId: externalId ?? this.state.externalId,
      traits: mergeTraits(this.state.traits, traits),
    }
    this.persist(this.state)
  }

  /**
   * Record an external identity from a per-call option (track/page) without
   * the full identify() ceremony. Persists it so later calls keep emitting
   * it. No-op when externalId is falsy or already current.
   */
  setExternalId(externalId?: string): void {
    if (!externalId || externalId === this.state.externalId) return
    this.state = { ...this.state, externalId }
    this.persist(this.state)
  }

  /**
   * Clear customer_id + traits and mint a new anonymous_id. Used on logout.
   */
  reset(): void {
    this.state = { anonymousId: uuidv7() }
    this.persist(this.state)
  }
}

function mergeTraits(prev: Traits | undefined, next: Traits | undefined): Traits | undefined {
  if (!next) return prev
  if (!prev) return next
  return { ...prev, ...next }
}
