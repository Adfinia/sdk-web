import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { firstTouchAcquisition, readAcquisitionFromUrl } from '../src/context'
import { createStorage } from '../src/storage'

const ORIGIN = 'http://localhost:3000'

function setUrl(path: string): void {
  // happy-dom updates window.location on a direct href assignment (it does
  // NOT honour relative history.replaceState for location). Use an absolute
  // URL so search/pathname populate.
  window.location.href = path.startsWith('http') ? path : ORIGIN + path
}

describe('acquisition auto-context', () => {
  beforeEach(() => {
    setUrl('/')
  })
  afterEach(() => {
    setUrl('/')
  })

  it('reads UTM tags, click IDs, and the landing page from the URL', () => {
    setUrl(
      '/land?utm_source=google&utm_medium=cpc&utm_campaign=fifwc&utm_term=odds&utm_content=banner&gclid=G123&fbclid=F456&ttclid=T789&sc=SC1&msclkid=MS2',
    )
    const acq = readAcquisitionFromUrl()
    expect(acq['campaign.utm_source']).toBe('google')
    expect(acq['campaign.utm_medium']).toBe('cpc')
    expect(acq['campaign.utm_campaign']).toBe('fifwc')
    expect(acq['campaign.utm_term']).toBe('odds')
    expect(acq['campaign.utm_content']).toBe('banner')
    expect(acq['campaign.gclid']).toBe('G123')
    expect(acq['campaign.fbclid']).toBe('F456')
    expect(acq['campaign.ttclid']).toBe('T789')
    expect(acq['campaign.sc']).toBe('SC1')
    expect(acq['campaign.msclkid']).toBe('MS2')
    expect(acq['page.landing']).toContain('/land')
  })

  it('omits keys that are not present in the URL', () => {
    setUrl('/plain?utm_source=newsletter')
    const acq = readAcquisitionFromUrl()
    expect(acq['campaign.utm_source']).toBe('newsletter')
    expect(acq['campaign.gclid']).toBeUndefined()
    expect(acq['campaign.utm_medium']).toBeUndefined()
  })

  it('persists first-touch — later calls keep the original acquisition', () => {
    const store = createStorage(null) // in-memory, isolated
    setUrl('/?utm_source=google&gclid=G1')
    const first = firstTouchAcquisition(store)
    expect(first?.['campaign.utm_source']).toBe('google')
    expect(first?.['campaign.gclid']).toBe('G1')

    // User navigates to a clean URL (no params) — first-touch must be sticky.
    setUrl('/dashboard')
    const second = firstTouchAcquisition(store)
    expect(second?.['campaign.utm_source']).toBe('google')
    expect(second?.['campaign.gclid']).toBe('G1')

    // And a later landing with DIFFERENT params does not overwrite first-touch.
    setUrl('/?utm_source=facebook')
    const third = firstTouchAcquisition(store)
    expect(third?.['campaign.utm_source']).toBe('google')
  })

  it('captures the landing page even with no campaign params', () => {
    const store = createStorage(null)
    setUrl('/no-params')
    const acq = firstTouchAcquisition(store)
    expect(acq?.['page.landing']).toContain('/no-params')
    expect(acq?.['campaign.utm_source']).toBeUndefined()
  })
})
