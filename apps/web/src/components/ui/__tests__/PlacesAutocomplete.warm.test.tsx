import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The restaurant step's place search warms the Maps library ahead of the
 * first keystroke (r105 onboarding g3). `MAPS_API_KEY` is read at module
 * load, so each case stubs the env and imports a fresh module.
 */

const loader = vi.hoisted(() => ({ importLibrary: vi.fn(), setOptions: vi.fn() }))
vi.mock('@googlemaps/js-api-loader', () => loader)

async function freshModule(key: string) {
  vi.resetModules()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', key)
  return import('../PlacesAutocomplete')
}

describe('warmPlaces', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    loader.importLibrary.mockReset()
    loader.importLibrary.mockResolvedValue({})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('loads the library once, however many times the steps mount', async () => {
    const { warmPlaces } = await freshModule('test-key')
    warmPlaces()
    warmPlaces()
    expect(loader.importLibrary).not.toHaveBeenCalled() // idle, not on the mount frame
    await vi.advanceTimersByTimeAsync(3000)
    expect(loader.importLibrary).toHaveBeenCalledTimes(1)
    expect(loader.importLibrary).toHaveBeenCalledWith('places')
    warmPlaces()
    await vi.advanceTimersByTimeAsync(3000)
    expect(loader.importLibrary).toHaveBeenCalledTimes(1)
  })

  it('does nothing when Maps is not configured', async () => {
    const { warmPlaces } = await freshModule('')
    warmPlaces()
    await vi.advanceTimersByTimeAsync(3000)
    expect(loader.importLibrary).not.toHaveBeenCalled()
  })

  it('swallows a failed load', async () => {
    loader.importLibrary.mockRejectedValue(new Error('blocked'))
    const { warmPlaces } = await freshModule('test-key')
    warmPlaces()
    await vi.advanceTimersByTimeAsync(3000)
    expect(loader.importLibrary).toHaveBeenCalledTimes(1)
  })
})

describe('GetStarted wiring', () => {
  it('warms Places on the restaurant step only', () => {
    const src = readFileSync(resolve(__dirname, '../../../pages/GetStarted.tsx'), 'utf8')
    expect(src).toMatch(/if \(step === 'restaurant'\) warmPlaces\(\)/)
    expect(src).toMatch(/import \{ PlacesAutocomplete, warmPlaces,/)
  })
})
