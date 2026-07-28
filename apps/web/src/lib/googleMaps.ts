/**
 * Shared Google Maps JS API loader.
 *
 * Mirrors the module-singleton approach already used by
 * components/ui/PlacesAutocomplete.tsx: one shared in-flight promise so that
 * several components mounting at once cannot trigger duplicate script loads.
 *
 * Callers must handle `isMapsConfigured() === false` by rendering a non-map
 * fallback rather than throwing — the key is absent in plenty of dev setups,
 * and the distributor list is perfectly usable without a map.
 */
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

export const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export function isMapsConfigured(): boolean {
  return typeof MAPS_API_KEY === 'string' && MAPS_API_KEY.length > 0
}

type MapsLib = typeof google.maps
type MarkerLib = typeof google.maps.marker

let mapsLib: MapsLib | null = null
let markerLib: MarkerLib | null = null
let loadPromise: Promise<void> | null = null

export async function ensureMaps(): Promise<{ maps: MapsLib; marker: MarkerLib }> {
  if (!isMapsConfigured()) throw new Error('VITE_GOOGLE_MAPS_API_KEY not set')
  if (mapsLib && markerLib) return { maps: mapsLib, marker: markerLib }

  if (!loadPromise) {
    setOptions({ key: MAPS_API_KEY as string, language: 'en' })
    loadPromise = Promise.all([
      importLibrary('maps') as Promise<MapsLib>,
      importLibrary('marker') as Promise<MarkerLib>,
    ]).then(([m, mk]) => {
      mapsLib = m
      markerLib = mk
    })
  }

  await loadPromise
  return { maps: mapsLib as MapsLib, marker: markerLib as MarkerLib }
}

/**
 * Turn the raw SDK failure into something a user can act on.
 * Same classification approach as PlacesAutocomplete, which found that the raw
 * messages are opaque about the three problems that actually occur.
 */
export function describeMapsError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/not set/i.test(msg)) return 'Map unavailable — VITE_GOOGLE_MAPS_API_KEY is not configured.'
  if (/BillingNotEnabled/i.test(msg)) return 'Map unavailable — billing is not enabled for this Google Cloud project.'
  if (/ApiNotActivated/i.test(msg)) return 'Map unavailable — the Maps JavaScript API is not enabled for this key.'
  if (/RefererNotAllowed/i.test(msg)) return 'Map unavailable — this domain is not in the API key referrer allowlist.'
  if (/InvalidKey|ApiTargetBlocked/i.test(msg)) return 'Map unavailable — the API key is invalid or restricted.'
  return 'Map unavailable — could not load Google Maps.'
}
