import { normalizeJurisdiction } from "../price-index/price-index.registry";
import { countryOf } from "../price-index/jurisdiction";

/**
 * A house's country and state, checked before the location editor writes them
 * (ADR 0289).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The market index tells a United States house with no state to "Set the state
 * in Settings to scope an index line" (`price-index/price-index.service.ts`,
 * `silenceFor`), and until ADR 0289 nothing an owner could reach wrote
 * `restaurants.state_province` or `restaurants.country` on a house that
 * already existed. The founder, 2026-10-04 ~00:30Z: *"Add it to the editor
 * (Recommended)"* — state and country in the location editor, changed by
 * owners only and recorded in the log.
 *
 * WHY THE STATE IS CHECKED AGAINST THE COUNTRY, AND NOT ONLY ON ITS OWN
 * ---------------------------------------------------------------------
 * Every reader of the pair is REGION FIRST: `PriceIndexService.forHouse`,
 * `PriceIndexReviewService.jurisdictionOfHouse` and `admittersFor`, the
 * commodity and distributor panels all resolve `state_province` through
 * `normalizeJurisdiction` and fall back to the country only when the state
 * does not resolve. So a state that resolves to ANOTHER country moves the
 * house there: "GA" (Goa) on an Indian house reads as US-GA, "WA" (Western
 * Australia) as US-WA, "England" on a Turkish house as GB-ENG. Those are
 * refused here, with the way out named (write the name in full, or leave it
 * blank), because accepting them would scope the house to a market it is not
 * in and pool its owners with that market's admitters.
 *
 * THE RULES (ADR 0289 R3)
 * -----------------------
 *   country     required whenever the pair is sent; must be a row of the one
 *               country table (ADR 0117 Q33, mirrored below); written as the
 *               table's display name, the spelling `CountryCombobox` and
 *               get-started write. It is never cleared.
 *   US          the state is required (the US index publishes state by state,
 *               and CCPA retention reads US-CA from it) and must resolve to a
 *               US state. It is written as the bare two-letter code ("CA"),
 *               never "US-CA": `retention-rules.ts` `resolveJurisdiction`
 *               matches "CA" or "CALIFORNIA" and would read "US-CA" as plain
 *               US.
 *   GB, TR      the state is optional (blank means the whole country). Given,
 *               it must resolve to one of that country's subdivisions in
 *               `price-index/jurisdiction.ts` — the four nations, the 81
 *               provinces — and is written trimmed, as sent. GB-EAW, GB-GBN
 *               and GB-UKM are refused: ISO lists them "for completeness" as
 *               extents a publication is issued at, not places a house is in.
 *   elsewhere   the state is optional free text, trimmed, at most 100
 *               characters (the column is varchar(100)). No list of its
 *               subdivisions exists in this repository, so none is guessed.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a second country table. `HOUSE_COUNTRIES` is a COPY of
 * `apps/web/src/lib/countries.ts` (code, name and aliases; the currency column
 * is the web's alone), and `house-state-country.spec.ts` reads that file as
 * text and fails on any difference, the same mirror `common/iso-4217.spec.ts`
 * keeps for currencies. The gateway cannot import the web's file: the two
 * apps are separate builds.
 */

/** One row of the country table: the ISO 3166-1 alpha-2 code is the key. */
export interface HouseCountry {
  readonly code: string;
  readonly name: string;
  readonly aliases?: readonly string[];
}

/**
 * The one country table (ADR 0117 Q33), mirrored from
 * `apps/web/src/lib/countries.ts` row for row. Edit the web's file first, then
 * this one; the spec fails until they agree.
 */
export const HOUSE_COUNTRIES: readonly HouseCountry[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia", aliases: ["Plurinational State of Bolivia"] },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde", aliases: ["Cape Verde"] },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CR", name: "Costa Rica" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic", aliases: ["Czechia"] },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini", aliases: ["Swaziland"] },
  { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran", aliases: ["Islamic Republic of Iran"] },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos", aliases: ["Lao People's Democratic Republic"] },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova", aliases: ["Republic of Moldova"] },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar", aliases: ["Burma"] },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands", aliases: ["Holland", "The Netherlands"] },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  {
    code: "KP",
    name: "North Korea",
    aliases: ["Democratic People's Republic of Korea", "Korea, North"],
  },
  { code: "MK", name: "North Macedonia", aliases: ["Macedonia"] },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestine" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia", aliases: ["Russian Federation"] },
  { code: "RW", name: "Rwanda" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "Sao Tome and Principe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  {
    code: "KR",
    name: "South Korea",
    aliases: ["Republic of Korea", "Korea, South"],
  },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria", aliases: ["Syrian Arab Republic"] },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania", aliases: ["United Republic of Tanzania"] },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste", aliases: ["East Timor"] },
  { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  {
    code: "TR",
    name: "Turkey",
    aliases: ["Türkiye", "Turkiye", "Republic of Türkiye"],
  },
  { code: "TM", name: "Turkmenistan" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates", aliases: ["UAE"] },
  {
    code: "GB",
    name: "United Kingdom",
    aliases: [
      "UK",
      "Great Britain",
      "England",
      "Scotland",
      "Wales",
      "Northern Ireland",
      "GB",
    ],
  },
  {
    code: "US",
    name: "United States",
    aliases: ["USA", "US", "U.S.", "United States of America"],
  },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City", aliases: ["Holy See"] },
  {
    code: "VE",
    name: "Venezuela",
    aliases: ["Bolivarian Republic of Venezuela"],
  },
  { code: "VN", name: "Vietnam", aliases: ["Viet Nam"] },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
];

/** The web's `fold`: trim, lower-case, strip diacritics. One country, one key. */
function fold(raw: string): string {
  return raw.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

const BY_CODE = new Map<string, HouseCountry>(
  HOUSE_COUNTRIES.map((c) => [c.code, c]),
);

const BY_TEXT = new Map<string, HouseCountry>();
for (const country of HOUSE_COUNTRIES) {
  BY_TEXT.set(fold(country.name), country);
  BY_TEXT.set(fold(country.code), country);
  for (const alias of country.aliases ?? []) BY_TEXT.set(fold(alias), country);
}

/**
 * The row for a name, a code or a recorded alias — the web's `countryByName`,
 * resolved the same way. Null for text the table does not know; never a guess.
 */
export function resolveHouseCountry(
  text: string | null | undefined,
): HouseCountry | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  return BY_TEXT.get(fold(text)) ?? null;
}

/** `restaurants.state_province` and `restaurants.country` are varchar(100). */
export const HOUSE_PLACE_MAX_LENGTH = 100;

/**
 * Extents ISO 3166-2:GB lists "for completeness" (remark part 2). A UK
 * publication is issued at them; a house is not in one.
 */
const GB_EXTENTS = new Set(["GB-EAW", "GB-GBN", "GB-UKM"]);

/** The answer for one state: what to write, or the sentence that refuses it. */
export type StateCheck = { write: string | null } | { refused: string };

/** The whole pair: what to write, or the sentence that refuses it. */
export type PairCheck =
  | { country: HouseCountry; state: string | null }
  | { refused: string };

const NOTHING = "Nothing was changed.";

function nameOfCode(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

/**
 * Check a state against the house's country (an ISO 3166-1 alpha-2 code from
 * `HOUSE_COUNTRIES`). See the header for the rules.
 */
export function checkStateFor(
  countryCode: string,
  state: string | null | undefined,
): StateCheck {
  const country = nameOfCode(countryCode);
  if (state !== null && state !== undefined && typeof state !== "string") {
    return { refused: `A state is text. ${NOTHING}` };
  }
  const v = (state ?? "").trim();
  if (v.length > HOUSE_PLACE_MAX_LENGTH) {
    return {
      refused: `A state is at most ${HOUSE_PLACE_MAX_LENGTH} characters; this one is ${v.length}. ${NOTHING}`,
    };
  }

  if (countryCode === "US") {
    if (!v) {
      return {
        refused: `A United States house needs its state: the market index publishes United States prices state by state, and mail retention reads California's rule from it. Write the state, for example CA or California. ${NOTHING}`,
      };
    }
    const j = normalizeJurisdiction(v);
    if (!j || !j.startsWith("US-")) {
      return {
        refused: `"${v}" is not a United States state. Write its two-letter code or its name, for example CA or California. ${NOTHING}`,
      };
    }
    return { write: j.slice(3) };
  }

  if (!v) return { write: null };

  const j = normalizeJurisdiction(v);
  if (j && countryOf(j) !== countryCode) {
    const elsewhere = countryOf(j);
    const reads =
      elsewhere === "US"
        ? `reads as the United States state ${j}`
        : `reads as a place in ${nameOfCode(elsewhere)} (${j})`;
    return {
      refused: `"${v}" ${reads}, and this house is in ${country}. Every reader takes the state before the country, so it would place the house there. Write the name out in full, or leave the state blank. ${NOTHING}`,
    };
  }

  if (countryCode === "GB" || countryCode === "TR") {
    const which =
      countryCode === "GB"
        ? "one of England, Scotland, Wales or Northern Ireland"
        : "one of Turkey's 81 provinces, for example Muğla or Antalya";
    if (!j) {
      return {
        refused: `"${v}" is not ${which}. Write ${countryCode === "GB" ? "the nation" : "the province"}, or leave the state blank for the whole country. ${NOTHING}`,
      };
    }
    if (!j.includes("-")) {
      return {
        refused: `"${v}" names the country, not a place in it. Leave the state blank for the whole country, or write ${which}. ${NOTHING}`,
      };
    }
    if (GB_EXTENTS.has(j)) {
      return {
        refused: `"${v}" is an extent a publication is issued at, not a place a house is in. Write ${which}, or leave the state blank. ${NOTHING}`,
      };
    }
    return { write: v };
  }

  return { write: v };
}

/**
 * Check the pair as the location editor sends it. Both keys are required:
 * the state means nothing without the country it is read against (R2).
 */
export function checkHouseStateCountry(
  country: unknown,
  state: unknown,
): PairCheck {
  if (country === undefined) {
    return {
      refused: `Send the country with the state: a state is read against its country. ${NOTHING}`,
    };
  }
  if (state === undefined) {
    return {
      refused: `Send the state with the country (null for none): the two are checked together. ${NOTHING}`,
    };
  }
  if (country === null || (typeof country === "string" && !country.trim())) {
    return {
      refused: `A house's country cannot be cleared: the currency, the clock, mail retention and the market index all read it. Pick the country this house is in. ${NOTHING}`,
    };
  }
  if (typeof country !== "string") {
    return { refused: `A country is text. ${NOTHING}` };
  }
  if (country.trim().length > HOUSE_PLACE_MAX_LENGTH) {
    return {
      refused: `A country is at most ${HOUSE_PLACE_MAX_LENGTH} characters. ${NOTHING}`,
    };
  }
  const row = resolveHouseCountry(country);
  if (!row) {
    return {
      refused: `"${country.trim()}" is not a country this list knows. Pick one from the list, for example United States, Turkey or United Kingdom. ${NOTHING}`,
    };
  }
  const checked = checkStateFor(row.code, state as string | null);
  if ("refused" in checked) return { refused: checked.refused };
  return { country: row, state: checked.write };
}
