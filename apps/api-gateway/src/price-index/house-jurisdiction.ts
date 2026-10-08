import { normalizeJurisdiction } from "./price-index.registry";
import { countryOf, normalizeNonUsJurisdiction } from "./jurisdiction";

/**
 * Which market a house is in: its state, read inside its own country
 * (ADR 0305).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every market reader of a house (the price index, the price-book review and
 * its pool of admitters, the commodity panel, the distributor catalogue) used
 * to read `restaurants.state_province` on its own, through
 * `normalizeJurisdiction`, and fall back to `restaurants.country` only when
 * the state did not resolve. A bare two-letter code therefore meant a US state
 * whatever country the house was in: an Italian house that writes "MI" for
 * Milano, as Poste Italiane's address standard asks it to ("20133 MILANO MI"),
 * was read as Michigan, and a house in Georgia the country was read as the US
 * state GA. No address standard reads a code that way. ISO 3166-2, CLDR,
 * Google's address data and Shopify's validator all look the code up inside
 * the address's own country: IT-MI is Milano, US-MI is Michigan. (Research:
 * `p4-scratch/sim-run/fixes/audits/research-r3-subdivisions-2026-10-07.md`,
 * outside the repository.)
 *
 * THE RULE
 * --------
 *   1. The country is read first. A blank country is COUNTRY NOT RECORDED: no
 *      state is read and nothing is guessed, and the panels ask for the
 *      country (the founder, 2026-10-07T19:48:13Z, "Ask for the country
 *      (Recommended)").
 *   2. A recorded country this register has no subdivision list for (Italy,
 *      Georgia, anything outside the United States, the United Kingdom and
 *      Türkiye) is UNRECOGNISED: no state is read, so "MI" on an Italian house
 *      is never Michigan.
 *   3. For the three it has lists for, the state is read ONLY against that
 *      country's own list. A state that does not read inside the country is
 *      not used; the house falls back to its country, as it did before.
 *
 * The country step reads `jurisdiction.ts`'s country spellings, which cover
 * every name and alias the web's one country table (`apps/web/src/lib/
 * countries.ts`, ADR 0117 Q33) gives the United States, the United Kingdom and
 * Türkiye; `house-jurisdiction.spec.ts` reads that file as text and fails on
 * any it would miss. A constituent country written as the country ("England")
 * is read as that subdivision, as `normalizeJurisdiction` read it before.
 *
 * WHY IT LIVES HERE AND NOT IN THE REGISTRY OR `jurisdiction.ts`
 * --------------------------------------------------------------
 * It imports both. `organizations/house-state-country.ts` (PR #613, ADR 0289,
 * merged after this file was written) imports both too and holds
 * `HOUSE_COUNTRIES`; a resolver inside either file could not read it without
 * an import cycle. In its own file it can (a follow-up, ADR 0305).
 */

export type HouseJurisdiction =
  /** No country is recorded. Nothing is read, the state included. */
  | { kind: "country_not_recorded"; requested: string | null }
  /** A country is recorded and this register has no list for it. */
  | { kind: "country_unrecognised"; requested: string }
  /** The ISO key the house is in, and the text it was read from. */
  | { kind: "resolved"; jurisdiction: string; requested: string };

/** The state read inside one country's own list, or null. */
function stateWithin(country: string, state: string): string | null {
  // The United States list is the registry's (code, name and US-XX). Every
  // other country is read without it, so no US code can answer for it.
  const key =
    country === "US"
      ? normalizeJurisdiction(state)
      : normalizeNonUsJurisdiction(state);
  return key && countryOf(key) === country ? key : null;
}

export function resolveHouseJurisdiction(
  stateProvince: string | null | undefined,
  country: string | null | undefined,
): HouseJurisdiction {
  const stateText = (stateProvince ?? "").trim();
  const countryText = (country ?? "").trim();
  if (!countryText) {
    return { kind: "country_not_recorded", requested: stateText || null };
  }
  const countryKey = normalizeNonUsJurisdiction(countryText);
  if (!countryKey) {
    return { kind: "country_unrecognised", requested: countryText };
  }
  if (stateText) {
    const stateKey = stateWithin(countryOf(countryKey), stateText);
    if (stateKey) {
      return { kind: "resolved", jurisdiction: stateKey, requested: stateText };
    }
  }
  return { kind: "resolved", jurisdiction: countryKey, requested: countryText };
}

/** The ISO key alone, for the readers that need nothing else; null otherwise. */
export function houseJurisdictionKey(
  stateProvince: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const house = resolveHouseJurisdiction(stateProvince, country);
  return house.kind === "resolved" ? house.jurisdiction : null;
}

/**
 * The gateway's sentence for a house with no country. The web draws its own
 * words beside a link to Settings (the no-time-zone shape), and every other
 * caller gets this.
 */
export const COUNTRY_NOT_RECORDED_SENTENCE =
  "This house's country isn't recorded, so its state is not read and no state-based price is shown. " +
  "A state code means different places in different countries (MI is Michigan in the United States and Milano in Italy), so nothing is guessed. " +
  "Set the country in Settings, under Locations.";
