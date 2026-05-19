// Test helpers — happy-dom's localStorage doesn't expose `clear()` reliably,
// so we remove the known SDK keys directly between tests.

const KEYS = ['adfinia:identity', 'adfinia:queue']

export function clearStorage(): void {
  if (typeof localStorage === 'undefined') return
  for (const key of KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore — storage disabled */
    }
  }
}
