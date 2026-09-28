/**
 * Jurisdictions the price register can be scoped to — and which source speaks
 * for which house.
 *
 * WHY THIS FILE EXISTS (ADR 0117, "Non-US markets", 2026-09-05)
 * -------------------------------------------------------------
 * The register was built for US states and `normalizeJurisdiction` knew only
 * them. Read off the production tenant rows on 2026-09-05 (a read, never a
 * write), three of fourteen houses sit outside that world and resolved to
 * NOTHING:
 *
 *   Chez Community     Fethiye   state_province 'Muğla'   country 'Türkiye'
 *   The Old House Pub  Antalya   state_province NULL      country 'Türkiye'
 *   ADMIN 1            London    state_province 'England' country 'United Kingdom'
 *
 * All three were told the same thing — "not a jurisdiction this register
 * recognises" — which is false about the place and true only about our table.
 * Muğla, England and Türkiye are all jurisdictions; they simply have no source.
 * Those are two different silences, and the founder's call of 2026-09-05
 * ("their own source class, researched per market") requires the register to
 * tell them apart. So the codes come first and the sources follow.
 *
 * WHICH CODES, AND WHY EACH ONE
 * -----------------------------
 *   ISO 3166-1 alpha-2   'TR', 'GB', 'US' — a house or a source known only to
 *                        its country. A national instrument (an excise
 *                        schedule, a duty table) is a fact about the country,
 *                        not about a province.
 *   ISO 3166-2:TR        'TR-01'..'TR-81' — all 81 provinces, from a listing
 *                        fetched 2026-09-05 rather than remembered (the fetch
 *                        is in the log named by price-sources.md). 'Muğla'
 *                        resolves to TR-48, 'Antalya' to TR-07.
 *   ISO 3166-2:GB        'GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR' — the four
 *                        first-level subdivisions. The UK house records
 *                        'England', so GB-ENG is the key it resolves to.
 *   ISO 3166-2:GB
 *   remark part 2        'GB-EAW' (England and Wales), 'GB-GBN' (Great
 *                        Britain), 'GB-UKM' (United Kingdom) — codes the
 *                        standard lists "for completeness". They matter here
 *                        because UK publications are issued at exactly those
 *                        extents: HMRC's duty table is UK-wide, and Defra's
 *                        wholesale produce series states its own extent as
 *                        "England and Wales".
 *
 * THE CONSTRAINT THAT DECIDED THE KEYS
 * ------------------------------------
 * price_index_postings.state carries
 *   CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$')
 * (20260904200000_a_posted_price_names_its_state.sql:57). A BARE COUNTRY CODE
 * HAS NO HYPHEN AND CANNOT BE WRITTEN: 'GB' and 'TR' fail that pattern, while
 * 'GB-ENG', 'GB-EAW', 'GB-UKM' and 'TR-48' pass it. (Measured against a local
 * Postgres built from these migrations earlier on 2026-09-05 — an INSERT with
 * state 'GB' was refused by name — and re-checked here against the pattern
 * itself, because that container did not survive the session.)
 *
 * That is why the UK sources are keyed GB-UKM / GB-EAW — codes the standard
 * already provides and the constraint already admits — and why a Türkiye-wide
 * source would need a migration before it could ever write a row. No Turkish
 * source can produce a row today, so no migration was added for one.
 *
 * COVERAGE IS CONTAINMENT, AND IT IS NOT SYMMETRIC
 * -----------------------------------------------
 * A source covers a house when the source's area CONTAINS the house's. GB-UKM
 * covers GB-ENG; GB-EAW covers GB-ENG and GB-WLS — but neither covers a house
 * known only as 'GB', because a house recorded only as "United Kingdom" may be
 * in Scotland, where an England-and-Wales wholesale price is not the market.
 * Guessing the other way is how a register starts answering questions it was
 * never asked.
 */

/** Fold diacritics and case so 'Muğla', 'MUGLA' and 'mugla' are one key. */
export function foldName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ISO 3166-1 alpha-2 for the countries the estate actually sits in, by the
 * spellings `restaurants.country` actually holds — measured 2026-09-05:
 * 'United States' x6, 'USA' x2, 'US' x1, 'united States' x1, 'Türkiye' x2,
 * 'United Kingdom' x1, NULL x1.
 *
 * Deliberately NOT a world list. A country this register has researched no
 * source for resolves to null and gets the honest "no source found" answer,
 * rather than a code that would imply somebody had looked.
 */
const COUNTRIES: Record<string, string> = {
  turkiye: "TR",
  turkey: "TR",
  tr: "TR",
  tur: "TR",
  "united kingdom": "GB",
  "united kingdom of great britain and northern ireland": "GB",
  "great britain": "GB",
  uk: "GB",
  gb: "GB",
  gbr: "GB",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  us: "US",
};

/**
 * ISO 3166-2:GB — the four first-level subdivisions, plus the remark-part-2
 * extent a UK publication is actually issued at.
 */
const GB_SUBDIVISIONS: Record<string, string> = {
  england: "GB-ENG",
  scotland: "GB-SCT",
  wales: "GB-WLS",
  cymru: "GB-WLS",
  "northern ireland": "GB-NIR",
  "england and wales": "GB-EAW",
};

/** ISO 3166-2:TR — all 81 provinces, from a listing fetched 2026-09-05. */
const TR_PROVINCES: Record<string, string> = {
  "adana": "TR-01",
  "adıyaman": "TR-02",
  "afyonkarahisar": "TR-03",
  "agrı": "TR-04",
  "amasya": "TR-05",
  "ankara": "TR-06",
  "antalya": "TR-07",
  "artvin": "TR-08",
  "aydın": "TR-09",
  "balıkesir": "TR-10",
  "bilecik": "TR-11",
  "bingol": "TR-12",
  "bitlis": "TR-13",
  "bolu": "TR-14",
  "burdur": "TR-15",
  "bursa": "TR-16",
  "canakkale": "TR-17",
  "cankırı": "TR-18",
  "corum": "TR-19",
  "denizli": "TR-20",
  "diyarbakır": "TR-21",
  "edirne": "TR-22",
  "elazıg": "TR-23",
  "erzincan": "TR-24",
  "erzurum": "TR-25",
  "eskisehir": "TR-26",
  "gaziantep": "TR-27",
  "giresun": "TR-28",
  "gumushane": "TR-29",
  "hakkari": "TR-30",
  "hatay": "TR-31",
  "isparta": "TR-32",
  "mersin": "TR-33",
  "istanbul": "TR-34",
  "izmir": "TR-35",
  "kars": "TR-36",
  "kastamonu": "TR-37",
  "kayseri": "TR-38",
  "kırklareli": "TR-39",
  "kırsehir": "TR-40",
  "kocaeli": "TR-41",
  "konya": "TR-42",
  "kutahya": "TR-43",
  "malatya": "TR-44",
  "manisa": "TR-45",
  "kahramanmaras": "TR-46",
  "mardin": "TR-47",
  "mugla": "TR-48",
  "mus": "TR-49",
  "nevsehir": "TR-50",
  "nigde": "TR-51",
  "ordu": "TR-52",
  "rize": "TR-53",
  "sakarya": "TR-54",
  "samsun": "TR-55",
  "siirt": "TR-56",
  "sinop": "TR-57",
  "sivas": "TR-58",
  "tekirdag": "TR-59",
  "tokat": "TR-60",
  "trabzon": "TR-61",
  "tunceli": "TR-62",
  "sanlıurfa": "TR-63",
  "usak": "TR-64",
  "van": "TR-65",
  "yozgat": "TR-66",
  "zonguldak": "TR-67",
  "aksaray": "TR-68",
  "bayburt": "TR-69",
  "karaman": "TR-70",
  "kırıkkale": "TR-71",
  "batman": "TR-72",
  "sırnak": "TR-73",
  "bartın": "TR-74",
  "ardahan": "TR-75",
  "igdır": "TR-76",
  "yalova": "TR-77",
  "karabuk": "TR-78",
  "kilis": "TR-79",
  "osmaniye": "TR-80",
  "duzce": "TR-81",
};

/** Every code this module can produce, so a caller may hand one straight back. */
const KNOWN_CODES = new Set<string>([
  ...Object.values(COUNTRIES),
  ...Object.values(GB_SUBDIVISIONS),
  ...Object.values(TR_PROVINCES),
  "GB-GBN",
  "GB-UKM",
]);

/**
 * Resolve a free-text place to an ISO key, or null.
 *
 * Null rather than a guess: an unrecognised place produces the endpoint's
 * "this register does not recognise it" sentence, which is a claim about the
 * register and is true.
 */
export function normalizeNonUsJurisdiction(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;

  const upper = v.toUpperCase();
  if (KNOWN_CODES.has(upper)) return upper;

  const key = foldName(v);
  return COUNTRIES[key] ?? GB_SUBDIVISIONS[key] ?? TR_PROVINCES[key] ?? null;
}

/** The country half of an ISO key ('GB-ENG' -> 'GB', 'TR-48' -> 'TR'). */
export function countryOf(jurisdiction: string): string {
  const dash = jurisdiction.indexOf("-");
  return dash === -1 ? jurisdiction : jurisdiction.slice(0, dash);
}

/**
 * The extents that contain other extents. Only the ones a real publication is
 * issued at are listed; anything absent contains only itself.
 */
const CONTAINS: Record<string, string[]> = {
  // A UK-wide instrument (HMRC's duty table) is a fact about all four.
  "GB-UKM": ["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR", "GB-EAW", "GB-GBN"],
  // Great Britain is the United Kingdom minus Northern Ireland.
  "GB-GBN": ["GB-ENG", "GB-SCT", "GB-WLS", "GB-EAW"],
  // Defra's wholesale produce series states its own extent: "England and Wales".
  "GB-EAW": ["GB-ENG", "GB-WLS"],
};

/**
 * Does a source published for `sourceJurisdiction` speak for a house in
 * `houseJurisdiction`?
 *
 *   the same key                                  -> yes
 *   a country code over its own subdivision
 *     ('TR' over 'TR-48')                         -> yes
 *   a listed containment ('GB-EAW' over 'GB-ENG') -> yes
 *   a subdivision over its own country ('GB-EAW'
 *     over a house known only as 'GB')            -> NO, it may be in Scotland
 */
export function jurisdictionCovers(
  sourceJurisdiction: string,
  houseJurisdiction: string,
): boolean {
  if (sourceJurisdiction === houseJurisdiction) return true;
  if (
    !sourceJurisdiction.includes("-") &&
    countryOf(houseJurisdiction) === sourceJurisdiction
  ) {
    return true;
  }
  return (CONTAINS[sourceJurisdiction] ?? []).includes(houseJurisdiction);
}

/**
 * Where a country's prices are published FROM — measured, not assumed, and the
 * reason a country-level answer has to differ by country.
 *
 *   US  subnational. Price posting is a state power; there is no federal
 *       posted list. A US house that records a country and no state HAS a
 *       source somewhere and we cannot say which — that is a missing address,
 *       not a missing market, and the two must not read alike.
 *   GB  national. There is no UK price-posting regime at all; what the state
 *       publishes (HMRC duty, ONS indices, Defra produce) is national or
 *       England-and-Wales wide.
 *   TR  national. The ÖTV schedule is a national instrument, and the regulator
 *       publishes no price data at any level.
 */
export type PriceScope = "national" | "subnational";

const COUNTRY_SCOPE: Record<string, PriceScope> = {
  US: "subnational",
  GB: "national",
  TR: "national",
};

export function priceScopeOf(jurisdiction: string): PriceScope | null {
  return COUNTRY_SCOPE[countryOf(jurisdiction)] ?? null;
}

/**
 * The sentence a house in this market is owed when the register holds nothing
 * for it — the market's own reason, in words. Never an em dash, and never a
 * silence that could be read as "nothing costs anything here".
 *
 * Every clause was measured on 2026-09-04 and re-measured 2026-09-05; the
 * fetches are in ADR 0117's "Non-US markets" section and the source registry.
 */
const MARKET_SILENCE: Record<string, string> = {
  TR:
    "No market price is published in Türkiye. There is no price-posting regime, the " +
    "regulator publishes no price data, and every producer site measured is age-gated " +
    "with no prices behind it. The ÖTV excise schedule is a tax, not a price, and is " +
    "not shown here as one. This house's own invoices are the price register available " +
    "to it.",
  // Reworded 2026-09-05 on the founder's Q24 call. The old sentence stopped at
  // "none found", which was true of DRINK and false of the market as a whole:
  // one UK source was found, it is real, and the founder chose to show it. A
  // sentence that says nothing was found, beside a box that is showing
  // something, teaches the reader to distrust both.
  GB:
    "No drinks price is published in the United Kingdom. There is no price-posting " +
    "regime — every drinks wholesaler measured prices per trade account — and the " +
    "national open-data catalogue holds no dataset of alcohol prices. HMRC's duty rates " +
    "are a tax, not a price, and are not shown here as one. What was found is Defra's " +
    "wholesale produce list for England and Wales, shown separately and labelled as " +
    "produce: a market this house also buys from, never a stand-in for a wine price. " +
    "For drink, this house's own invoices are the price register available to it.",
};

/**
 * The sentence for a jurisdiction whose only fetchable source is one whose rows
 * get their own labelled box — today the produce index (ADR 0117 Q24).
 *
 * It exists because the generic "has a fetchable posted list, but the scheduled
 * fetch is off" would be wrong twice over for a UK house: Defra publishes no
 * POSTED LIST (there is no posting regime in the UK at all), and the reader
 * would be told a drinks source is waiting to be switched on when none exists.
 * Arming is named exactly — an environment variable on the deployment — because
 * a reader who cannot find the switch will assume the product is broken.
 */
export function unarmedDisplaySilenceFor(
  jurisdiction: string,
  category: string,
  shortIssuer: string,
  extent: string,
  flag: string,
): string {
  const market = marketSilenceFor(jurisdiction);
  const own =
    `${category} (${shortIssuer}, ${extent}) is the one public list found for this house, ` +
    `and it has not been read yet: the scheduled fetch is off until ${flag} is set on the ` +
    `deployment. No line is drawn rather than showing a price nobody fetched.`;
  return market ? `${market} ${own}` : own;
}

export function marketSilenceFor(jurisdiction: string): string | null {
  return MARKET_SILENCE[countryOf(jurisdiction)] ?? null;
}
