import type { AdfiniaContext } from './types'
import { LIBRARY_NAME, LIBRARY_VERSION } from './version'

/**
 * Build the per-event context block. Stays browser-safe — every DOM/Navigator
 * access is guarded so the SDK runs in Node, in workers, and on SSR.
 */
export function buildContext(): AdfiniaContext {
  const ctx: AdfiniaContext = {
    library: { name: LIBRARY_NAME, version: LIBRARY_VERSION },
  }

  if (typeof navigator !== 'undefined') {
    ctx.user_agent = navigator.userAgent
    ctx.locale = navigator.language
  }

  try {
    if (typeof Intl !== 'undefined') {
      ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  } catch {
    /* timezone unavailable */
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    ctx.page = {
      url: window.location?.href,
      path: window.location?.pathname,
      referrer: document.referrer || undefined,
      title: document.title || undefined,
    }
    if (window.screen) {
      ctx.screen = { width: window.screen.width, height: window.screen.height }
    }
  }

  return ctx
}
