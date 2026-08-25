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

/**
 * US state codes, keyed by both the code and the full name.
 *
 * Needed because a custom provider stores one flat address string while the
 * catalogue stores a separate `state`. Without this a custom provider is
 * invisible to the state filter — it would sit in the list under "Michigan"
 * while being from Texas, which is worse than not offering the filter.
 *
 * Deliberately US-only and best-effort. It reads a code or a state name out of
 * a comma-separated address and returns null when it finds neither. Null means
 * "unknown", and an unknown-state provider is hidden by an active state filter
 * rather than assumed to match — claiming a state we did not read would be a
 * quieter, worse failure than omitting the row.
 */
const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}
const STATE_CODES = new Set(Object.values(US_STATES))

export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null
  for (const raw of address.split(',')) {
    const part = raw.trim()
    if (!part) continue
    // "MI 48823" — a code followed by a ZIP is the shape Places produces.
    const token = part.split(/\s+/)[0]?.toUpperCase()
    if (token && STATE_CODES.has(token)) return token
    const named = US_STATES[part.toLowerCase()]
    if (named) return named
  }
  return null
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
    // City stays null: a flat address string cannot be split into a city with
    // any confidence, and inventing one would put a wrong place name on the
    // card. State is different — it appears in a recognisable, checkable form
    // (a known code or name), so it can be read out rather than guessed, and
    // reading it is what lets the state filter apply to custom providers too.
    city: null,
    state: stateFromAddress(p.physicalAddress),
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
    // The flat address string the user entered — shown on the card as a
    // fallback when city/state are absent, which they always are for custom
    // providers because a single string cannot be reliably split.
    full_address: p.physicalAddress || null,
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
