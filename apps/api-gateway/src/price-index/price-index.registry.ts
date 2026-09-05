/**
 * The source registry — one entry per price-index source, and the mapping from
 * the free-text `restaurants.state_province` mess to an ISO-3166-2 key the
 * endpoint can scope on.
 *
 * Every source here is class B/D/E (ADR 0117). Class A (own paper) and C
 * (licensed feed) are not index sources and live elsewhere. Each entry names
 * its cadence bound (`maxAgeDays`) — the staleness gate — and whether it can be
 * fetched at all. Michigan is present and WITHHELD, not omitted: a source we
 * cannot fetch is recorded as unverified with the reason, never invented
 * (ADR 0117, `.planning/07-reference/price-sources.md`).
 */

import { ParseRun, PriceIndexClass } from "./price-index.types";
import {
  CALIFORNIA_SOURCE_KEY,
  CaliforniaPosting,
  parseCalifornia,
} from "./parse-california";
import { IOWA_SOURCE_KEY, IowaRow, parseIowa } from "./parse-iowa";
import { OREGON_SOURCE_KEY, OregonRow, parseOregon } from "./parse-oregon";

export interface SourceEntry {
  key: string;
  sourceClass: PriceIndexClass;
  issuer: string;
  /** ISO-3166-2 jurisdiction this source prices. */
  jurisdiction: string;
  /** Human cadence, for the status line. */
  cadence: string;
  /**
   * The staleness bound in days. For a monthly file (Iowa/Oregon) this is the
   * primary freshness signal. For a continuous feed (California) the primary
   * signal is the posting's own Active status, and this is a frozen-feed
   * backstop set generously.
   */
  maxAgeDays: number;
  /** The recorded fixture, for the jest tests and the offline path. */
  fixture: string;
  /**
   * Present and true when the source cannot be fetched by a polite anonymous
   * client from this environment. Its parser is deliberately not written —
   * there is no honest sample to write it against.
   */
  withheld?: {
    reason: string;
    measuredOn: string;
  };
  /** Turn a fetched payload into a ParseRun. Absent when withheld. */
  parse?: (rows: unknown[], fetchedAt: string) => ParseRun;
}

export const SOURCES: Record<string, SourceEntry> = {
  [CALIFORNIA_SOURCE_KEY]: {
    key: CALIFORNIA_SOURCE_KEY,
    sourceClass: "posted_wholesale_list",
    issuer: "California Department of Alcoholic Beverage Control",
    jurisdiction: "US-CA",
    cadence: "continuous (a posting is effective on filing until amended)",
    // Continuous feed: Active status is the freshness signal; this is a
    // frozen-feed backstop (a feed whose newest Active posting is ~18 months
    // old has stopped being maintained).
    maxAgeDays: 550,
    fixture: "california-abc-beer-2026-09-04.sample.json",
    parse: (rows, fetchedAt) =>
      parseCalifornia(rows as CaliforniaPosting[], fetchedAt),
  },
  [IOWA_SOURCE_KEY]: {
    key: IOWA_SOURCE_KEY,
    sourceClass: "retail_reference",
    issuer: "Iowa Alcoholic Beverages Division",
    jurisdiction: "US-IA",
    cadence: "monthly (report_as_of moves once a month)",
    maxAgeDays: 62,
    fixture: "iowa-liquor-products-2026-09-01.sample.ndjson",
    parse: (rows, fetchedAt) => parseIowa(rows as IowaRow[], fetchedAt),
  },
  [OREGON_SOURCE_KEY]: {
    key: OREGON_SOURCE_KEY,
    sourceClass: "retail_reference",
    issuer: "Oregon Liquor & Cannabis Commission",
    jurisdiction: "US-OR",
    cadence: "monthly (asofdate moves once a month)",
    maxAgeDays: 62,
    fixture: "oregon-olcc-pricing-2026-09-01.sample.json",
    parse: (rows, fetchedAt) => parseOregon(rows as OregonRow[], fetchedAt),
  },
  "michigan-lcc-spirits-price-book": {
    key: "michigan-lcc-spirits-price-book",
    sourceClass: "posted_wholesale_list",
    issuer: "Michigan Liquor Control Commission",
    jurisdiction: "US-MI",
    cadence: "monthly (spirits price book)",
    maxAgeDays: 62,
    fixture: "",
    withheld: {
      // The best jurisdictional match in the estate (3 of 14 houses) — and
      // unreadable. michigan.gov is Akamai-fronted and returns HTTP 403
      // "Access Denied" to a non-browser client on both the price-book info
      // page and a direct PDF; its robots.txt is itself 403. The book is
      // published as Excel + PDF, not a machine endpoint, so there is no
      // honest sample to write a parser against. A human download is the path.
      reason:
        "michigan.gov returns 403 to a polite anonymous fetcher (Akamai edge block); robots.txt is also 403; the price book is Excel/PDF, not a machine endpoint. No honest sample exists to parse.",
      measuredOn: "2026-09-04",
    },
  },
};

/** All source keys that can actually be parsed today. */
export const ACTIVE_SOURCE_KEYS = Object.values(SOURCES)
  .filter((s) => !s.withheld && s.parse)
  .map((s) => s.key);

/**
 * Free-text state → ISO-3166-2. Covers every US state (the register may fill
 * any of them) plus the estate's non-US jurisdictions, returning null for
 * anything unrecognised so the endpoint says "no index for this jurisdiction"
 * rather than guessing. `restaurants.state_province` holds both 'MI' and
 * 'Michigan' and 'CA'/'California', so both the code and the name resolve.
 */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};
const US_ABBR = new Set(Object.values(US_STATES));

export function normalizeJurisdiction(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  // Already an ISO-3166-2 code?
  const iso = v.toUpperCase();
  if (/^US-[A-Z]{2}$/.test(iso) && US_ABBR.has(iso.slice(3))) return iso;
  // A bare two-letter US state code.
  if (/^[A-Za-z]{2}$/.test(v) && US_ABBR.has(v.toUpperCase())) {
    return `US-${v.toUpperCase()}`;
  }
  // A full state name.
  const named = US_STATES[v.toLowerCase()];
  if (named) return `US-${named}`;
  return null;
}
