/**
 * @adfinia/sdk-web — official Adfinia SDK for the browser.
 *
 * Usage (named import — recommended, matches the docs at
 * https://docs.adfinia.com/user-guide/sdk-integration):
 *
 *   import { Adfinia } from '@adfinia/sdk-web'
 *
 *   Adfinia.init({ writeKey: 'pk_live_...' })
 *   Adfinia.identify('cust_42', { plan: 'growth' })
 *   Adfinia.track('Order Completed', { total: 49.99 })
 *
 * Default-import form (kept for backwards-compat with 1.0.0 consumers):
 *
 *   import Adfinia from '@adfinia/sdk-web'
 *
 * Every public method on `Adfinia` is a thin pass-through to the
 * underlying `AdfiniaClient`. The singleton means consumers don't have
 * to manage instances; for multi-tenant server-side use, instantiate
 * `AdfiniaClient` directly (also exported).
 */
import { AdfiniaClient } from './client'
import type {
  AdfiniaConfig,
  IdentifyArg,
  Properties,
  Traits,
} from './types'

export type {
  AdfiniaConfig,
  AdfiniaContext,
  AdfiniaIdentity,
  AdfiniaPayload,
  ConsentFn,
  IdentifyArg,
  Properties,
  Traits,
} from './types'

export { AdfiniaClient } from './client'

const singleton = new AdfiniaClient()

/**
 * `Adfinia` is the singleton wrapper around `AdfiniaClient`. It is the
 * primary public entry point and is documented at
 * https://docs.adfinia.com/user-guide/sdk-integration.
 *
 * Exported as both a named export (`import { Adfinia } from '@adfinia/sdk-web'`)
 * and the default export (`import Adfinia from '@adfinia/sdk-web'`). Both
 * forms resolve to the same object — `Adfinia === (default export)` is `true`.
 */
export const Adfinia = {
  init(config: AdfiniaConfig): void {
    singleton.init(config)
  },
  identify(arg: IdentifyArg, traits?: Traits): void {
    singleton.identify(arg, traits)
  },
  track(event: string, properties?: Properties): void {
    singleton.track(event, properties)
  },
  page(name?: string, properties?: Properties): void {
    singleton.page(name, properties)
  },
  screen(name?: string, properties?: Properties): void {
    singleton.screen(name, properties)
  },
  alias(newId: string, previousId?: string): void {
    singleton.alias(newId, previousId)
  },
  reset(): void {
    singleton.reset()
  },
  async flush(): Promise<void> {
    await singleton.flush()
  },
  /**
   * Escape hatch for advanced use cases that need a private instance
   * (multi-tenant SSR, isolated test contexts, etc.).
   */
  createClient(): AdfiniaClient {
    return new AdfiniaClient()
  },
}

export default Adfinia
