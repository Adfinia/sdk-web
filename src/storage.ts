// Thin Storage wrapper that gracefully degrades to in-memory when
// localStorage is unavailable (SSR, private-browsing iOS Safari, etc.).

export interface KVStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

class MemoryStore implements KVStore {
  private map = new Map<string, string>()
  get(key: string): string | null {
    return this.map.get(key) ?? null
  }
  set(key: string, value: string): void {
    this.map.set(key, value)
  }
  remove(key: string): void {
    this.map.delete(key)
  }
}

class LocalStorageStore implements KVStore {
  constructor(private backend: Storage) {}
  get(key: string): string | null {
    try {
      return this.backend.getItem(key)
    } catch {
      return null
    }
  }
  set(key: string, value: string): void {
    try {
      this.backend.setItem(key, value)
    } catch {
      // Quota exceeded or storage disabled — silently drop. Better to
      // lose persistence than to crash the host app.
    }
  }
  remove(key: string): void {
    try {
      this.backend.removeItem(key)
    } catch {
      /* noop */
    }
  }
}

export function createStorage(override?: Storage | null): KVStore {
  if (override === null) return new MemoryStore()
  if (override) return new LocalStorageStore(override)
  if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
    try {
      // Probe — Safari throws on access in private mode.
      const probe = '__adfinia_probe__'
      globalThis.localStorage.setItem(probe, '1')
      globalThis.localStorage.removeItem(probe)
      return new LocalStorageStore(globalThis.localStorage)
    } catch {
      return new MemoryStore()
    }
  }
  return new MemoryStore()
}
