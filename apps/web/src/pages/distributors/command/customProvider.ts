import type {
  Distributor,
  DistributorDetail,
  DistributorType,
} from '../../../services/api/distributors'
import type { Provider } from '../../../services/api/providers'

/**
 * Adapting a restaurant's own provider into the distributor map's shape.
 *
 * Why this exists as one typed function instead of two inline object literals
 * -------------------------------------------------------------------------
 * The map, the card list and the drawer all render `Distributor`. A custom
 * provider is a different domain object, so something has to bridge them. That
 * bridging was previously done by hand-writing a 20-field object literal in two
 * places, which failed in three ways at once:
 *
 *   - It drifted. Adding a field to `Distributor` left both literals stale and
 *     the compiler said nothing, because an object literal assigned to a
 *     `Distributor[]` position only had to be structurally close enough.
 *   - It lied about field names. It read `p.business_type` and
 *     `p.address.city`, neither of which exists on `Provider` — the real
 *     fields are `primaryBusinessType` and a flat `physicalAddress` string.
 *   - It invented values. `data_confidence: 100` gave a hand-typed record more
 *     certainty than any genuinely verified catalogue row.
 *
 * With one function whose return type is `Distributor`, the compiler now
 * enforces completeness at a single site: add a field to `Distributor` and this
 * stops compiling until someone decides what a custom provider should report.
 *
 * The remaining wart, named so it is not mistaken for design
 * ---------------------------------------------------------
 * `id` is prefixed with `custom-` because selection state (hoveredId,
 * selectedId) is a single string shared between catalogue rows and custom ones.
 * Encoding a type into an id is a hack: the prefixed value is not a UUID, and
 * passing it to any endpoint that does `.eq('id', …)` yields a Postgres
 * "invalid input syntax for type uuid" error. `unwrapCustomId` below is the
 * only sanctioned way back to the real id — do not hand-roll `.replace()`.
 *
 * The durable fix is a discriminated union at the selection boundary
 * (`{ kind: 'catalogue' | 'own', id: string }`) so the prefix disappears
 * entirely. That is a larger change across three components; this module makes
 * the current behaviour correct and confines the hack to one place.
 */

const CUSTOM_ID_PREFIX = 'custom-'

export function toCustomDistributorId(providerId: string): string {
  return `${CUSTOM_ID_PREFIX}${providerId}`
}

export function isCustomDistributorId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_ID_PREFIX)
}

/** Real provider id from a prefixed one; returns the input unchanged if unprefixed. */
export function unwrapCustomId(id: string): string {
  return id.startsWith(CUSTOM_ID_PREFIX) ? id.slice(CUSTOM_ID_PREFIX.length) : id
}

/** `Provider.primaryBusinessType` → the catalogue's `DistributorType`. */
function toDistributorType(p: Provider): DistributorType {
  switch (p.primaryBusinessType) {
    case 'Wholesaler':
      return 'wholesaler'
    case 'Importer':
      return 'importer'
    default:
      return 'distributor'
  }
}

/**
 * A provider is mappable only when it has been geocoded.
 *
 * Checked against `typeof === 'number'`, not truthiness: longitude 0 is the
 * Prime Meridian and latitude 0 is the Equator. A falsy check would silently
 * drop every vendor in Greenwich or Accra.
 */
export function hasCoordinates(
  p: Provider,
): p is Provider & { latitude: number; longitude: number } {
  return typeof p.latitude === 'number' && typeof p.longitude === 'number'
}

export function providerToDistributor(
  p: Provider & { latitude: number; longitude: number },
): Distributor {
  return {
    id: toCustomDistributorId(p.id),
    name: p.name,
    type: toDistributorType(p),
    // Provider stores one flat address string, so city and state are not
    // separable here. Null is the honest answer; splitting on commas would
    // invent structure the record does not have.
    city: null,
    state: null,
    country: null,
    website: p.website || null,
    wine_specialties: p.specialties?.length ? p.specialties.join(', ') : null,
    latitude: p.latitude,
    longitude: p.longitude,
    // Distance is computed server-side against the search origin; a
    // client-assembled row has none, and 0 would rank it as nearest.
    distance_m: null,
    distance_is_hq: false,
    nearest_location_kind: null,
    // The restaurant added this vendor themselves, so it serves them by
    // definition — this is the one field a custom provider knows better than
    // the catalogue ever could.
    may_serve: true,
    serves_via: null,
    listing_tier: 'custom',
    // Deliberately null, not 100. Confidence describes how well WE verified a
    // catalogue row; a hand-entered provider has not been verified at all, and
    // claiming perfect confidence would outrank genuinely vetted entries.
    data_confidence: null,
    verified_at: null,
  }
}

/** Every geocodable custom provider, adapted. Ungeocoded ones are dropped. */
export function customProvidersAsDistributors(providers: Provider[]): Distributor[] {
  return providers.filter(hasCoordinates).map(providerToDistributor)
}

/**
 * The drawer renders `DistributorDetail['vendor']`, which is a richer shape
 * than `Distributor` — it carries address, notes and geocode_provider that the
 * search result does not.
 *
 * Two adapters rather than one because these really are two shapes. Forcing a
 * `Distributor` into the drawer produced a union whose members disagreed on
 * every optional field, which is what the seventeen "property does not exist"
 * errors were: TypeScript refusing to let the drawer read `notes` off a value
 * that might not have it.
 */
export function providerToVendorDetail(p: Provider): DistributorDetail['vendor'] {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone || null,
    email: p.email || null,
    website: p.website || null,
    address: p.physicalAddress || null,
    wine_specialties: p.specialties?.length ? p.specialties.join(', ') : null,
    notes: p.notes || null,
    // Null, not a number. Confidence measures how well we verified a catalogue
    // row; nobody verified this one, and a value here would rank a hand-typed
    // record above genuinely vetted entries.
    data_confidence: null,
    // Not geocoded by a provider service — the coordinates, when present, came
    // from the address the user picked in Places autocomplete.
    geocode_provider: null,
    listing_tier: 'custom',
    type: toDistributorType(p),
  }
}
