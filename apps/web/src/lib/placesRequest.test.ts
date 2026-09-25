import { describe, expect, it } from 'vitest'
import { placesSuggestionRequest } from './placesRequest'

describe('placesSuggestionRequest', () => {
  it('omits locationBias until a point is given', () => {
    expect(placesSuggestionRequest('meyhane', { countryIso: 'TR' })).toEqual({
      input: 'meyhane',
      includedRegionCodes: ['TR'],
    })
  })

  it('centres the search on Use-my-location coordinates', () => {
    expect(
      placesSuggestionRequest('meyhane', {
        countryIso: 'TR',
        locationBias: { latitude: 41.01, longitude: 28.97 },
      }),
    ).toEqual({
      input: 'meyhane',
      includedRegionCodes: ['TR'],
      locationBias: {
        center: { lat: 41.01, lng: 28.97 },
        radius: 25_000,
      },
    })
  })
})
