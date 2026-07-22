import { describe, expect, it } from 'vitest'
import AdfiniaDefault, { Adfinia, AdfiniaClient } from '../src/index'

describe('public exports', () => {
  it('exposes Adfinia as a named export with an init method', () => {
    expect(Adfinia).toBeDefined()
    expect(typeof Adfinia.init).toBe('function')
  })

  it('exposes AdfiniaClient as a named class export', () => {
    expect(typeof AdfiniaClient).toBe('function')
    const c = new AdfiniaClient()
    expect(typeof c.init).toBe('function')
  })

  it('default export and named Adfinia export are the same singleton', () => {
    // Critical: customers using `import Adfinia from '@adfinia/sdk-web'`
    // (1.0.0 shape) and `import { Adfinia } from '@adfinia/sdk-web'`
    // (1.0.1+ docs shape) must drive the SAME client instance.
    expect(AdfiniaDefault).toBe(Adfinia)
  })

  it('Adfinia exposes the full documented surface', () => {
    for (const method of [
      'init',
      'identify',
      'track',
      'page',
      'screen',
      'setConsent',
      'optIn',
      'optOut',
      'alias',
      'reset',
      'flush',
      'registerWebPush',
      'createClient',
    ] as const) {
      expect(typeof (Adfinia as Record<string, unknown>)[method]).toBe('function')
    }
  })
})
