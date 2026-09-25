/**
 * Request shape for Places Autocomplete (New).
 * Extracted so location bias can be tested without loading the Maps script.
 */
export function placesSuggestionRequest(
  input: string,
  opts?: {
    countryIso?: string | null
    locationBias?: { latitude: number; longitude: number } | null
  },
) {
  return {
    input,
    ...(opts?.countryIso ? { includedRegionCodes: [opts.countryIso] } : {}),
    ...(opts?.locationBias
      ? {
          locationBias: {
            center: {
              lat: opts.locationBias.latitude,
              lng: opts.locationBias.longitude,
            },
            radius: 25_000,
          },
        }
      : {}),
  }
}
