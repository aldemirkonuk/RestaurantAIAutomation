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
import {
  DEFRA_ISSUER,
  DEFRA_JURISDICTION,
  DEFRA_SOURCE_KEY,
  DefraRow,
  parseDefra,
} from "./parse-defra";
import { normalizeNonUsJurisdiction } from "./jurisdiction";

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
   * Present when the source cannot be fetched by a polite anonymous client from
   * this environment. Such an entry never carries a `parse`, so the scheduled
   * sweep skips it and no outbound request is ever made in the house's name.
   *
   * Amended 2026-09-05: this used to add "its parser is deliberately not
   * written — there is no honest sample to write it against". That is no longer
   * the definition. Michigan is withheld AND has a parser, because a real
   * edition of its book was measured and recorded as a fixture; what it lacks
   * is a fetch path, not a sample. `withheld` means unfetchable. Whether a
   * source can arrive some OTHER way is `intake`.
   */
  withheld?: {
    reason: string;
    measuredOn: string;
  };
  /**
   * Present when the source WAS read and still yields no row for this
   * register. Deliberately a different field from `withheld`, because they are
   * different facts and a reader must not have to guess which one a silence is:
   *
   *   `withheld`  we could not get the bytes (a 403, a login, a PDF).
   *   `silent`    we got the bytes, read them, and there is no price in them
   *               for this register — a tax rate, an index number with no
   *               currency, a discontinued series, an HTML page with no
   *               machine endpoint.
   *
   * Added 2026-09-05 with the Türkiye/UK research (ADR 0117, "Non-US markets").
   * A `silent` entry never carries a `parse`: there is nothing to parse into a
   * price, so the scheduled sweep skips it on its own `!source.parse` guard.
   */
  silent?: {
    kind:
      | "not_a_price" //          a tax or an index, not a price in a currency
      | "discontinued" //         published, then stopped, still returns 200
      | "no_machine_endpoint"; // readable by a person, not by a fetcher
    reason: string;
    measuredOn: string;
  };
  /**
   * How a reader is to be told WHAT this source is, when its rows are drawn.
   *
   * Added 2026-09-05 on the founder's Q24 call — *"show it, labelled as
   * produce, in its own box"*. A class-E row is not a drinks posting, and a
   * heading that only said "Public index" would let a reader take a cabbage
   * price for a wine one. The three strings are the publication's own words,
   * not ours: its category, the short name it is known by, and the extent it
   * states for itself. A source WITHOUT a `display` draws in the drinks box.
   */
  display?: {
    /** "Wholesale produce" — what the numbers are OF. */
    category: string;
    /** "Defra" — the issuer as a reader knows it, not the legal name. */
    shortIssuer: string;
    /** "England and Wales" — the extent the publication claims. */
    extent: string;
  };
  /** Turn a fetched payload into a ParseRun. Absent when withheld or silent. */
  parse?: (rows: unknown[], fetchedAt: string) => ParseRun;
  /**
   * How a row from this source can reach the register at all.
   *
   *   absent      the scheduled fetch, the ordinary case.
   *   "upload"    a person brings the file, because no machine may fetch it
   *               (`price-index-upload.service.ts`). Michigan is the only one
   *               today: the MLCC publishes the licensee price a house pays,
   *               and publishes it behind a WAF that refuses every automated
   *               reader while serving a browser normally.
   *   "foia"      the record exists, a public body holds it, and it is reached
   *               only by a written request under a freedom-of-information
   *               statute. Nothing automated can produce it; a PERSON files the
   *               request and a PERSON brings the answer back. Added 2026-09-05
   *               with the Michigan beer and wine schedules (ADR 0126).
   *
   * It is a separate field from `withheld` on purpose. "We cannot fetch this"
   * and "here is how it can still arrive" are different facts, and a panel that
   * only knows the first tells a Michigan house to give up on a book its own
   * manager could hand over in a minute.
   */
  intake?: "upload" | "foia";
  /**
   * Present only on an `intake: "foia"` source: the state of the standing
   * request, and the drafted text a person sends.
   *
   * `status` starts at `not_yet_filed` and STAYS there until somebody actually
   * files it. It is deliberately not `requested`: a register that reports a
   * drafted letter as a filed request is reporting an intention as an action,
   * which is this codebase's named cardinal fault wearing a different coat.
   * There is no writer for this field and no table behind it — moving it is a
   * commit, made by whoever filed the request, so the record of who filed it and
   * when is in git rather than in a column nobody maintains.
   */
  standingRequest?: {
    status: "not_yet_filed" | "filed" | "awaiting_response" | "answered";
    /** ISO day the request was filed, or null while it has not been. */
    filedOn: string | null;
    /** Repo-relative path to the text a person sends. */
    draft: string;
    /**
     * Why the answer will always be old, in days, when the statute embargoes
     * the record. Null when there is no embargo.
     */
    statutoryEmbargoDays: number | null;
  };
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
    // MEASURED 2026-09-05, not inferred: 14 archived editions of
    // `<date>-PRICE-BOOK-*` between 2022-01-30 and 2025-11-02 sit 91 days
    // apart (8 of 13 gaps exactly 91; the two 182s are missed captures), and
    // the 2026 editions are 2026-02-01 / 2026-05-03 / 2026-08-02. The issuer's
    // own page calls it "the previous quarterly price book". The four-weekly
    // series that used to make this look monthly is the NEW ITEM PRICE LIST,
    // a different artefact. The old values here — "monthly", 62 days — were
    // wrong in the dangerous direction: they refuse a current book from day 63
    // of its own 91-day cycle.
    cadence: "quarterly (the price book moves every 91 days)",
    maxAgeDays: 105, // 91-day cycle + a fortnight before the next edition lands
    // SHAPE ONLY, never a price (ADR 0117 Q21, founder 2026-09-05). These are
    // real MLCC rows, obtained from an Internet Archive capture because the
    // issuer's host refuses this fetcher — so they prove the PARSE and nothing
    // else. No row derived from them can reach the register: the file is JSON
    // rather than a workbook, and its 2025-08-03 edition is 398 days past this
    // source's 105-day bound and gets worse every day, so the staleness gate
    // refuses it at every clock. Proven in `michigan-fixture-not-a-price.spec.ts`.
    fixture: "michigan-lcc-price-book-2025-08-03.sample.json",
    // Still withheld from the FETCHER, and now for a narrower and more exact
    // reason than before. What changed on 2026-09-05 is that the second half of
    // the old reason ("no honest sample exists to parse") stopped being true:
    // the issuer publishes the book as .xlsx as well as .pdf, and a real
    // edition — 12,530 product rows, zero defects on every consistency test —
    // was measured and recorded as a fixture (`__fixtures__/
    // MICHIGAN-PROVENANCE.md`). `parse-michigan.ts` is written against it. What
    // remains true, and was re-measured today, is that no machine here may read
    // the book: michigan.gov answers 403 from an Akamai Kona Site Defender edge
    // (the CNAME ends `e4514.ksd.akamaiedge.net`) on the page, on a direct PDF
    // and on robots.txt itself, and data.michigan.gov — which DOES serve this
    // fetcher — publishes `Disallow: /`. So this entry keeps no `parse` (the
    // scheduled sweep must never try michigan.gov) and gains `intake: "upload"`.
    withheld: {
      reason:
        // Only WHY no machine can read it. How it can still arrive is `intake`,
        // and the service appends that sentence — saying it twice reads as two
        // different facts.
        "michigan.gov returns 403 to a polite anonymous fetcher (Akamai Kona Site Defender) on the price-book page, on a direct PDF and on robots.txt itself, and data.michigan.gov publishes 'Disallow: /'. The book is an Excel/PDF download with no machine endpoint and no mirror, so no scheduled fetch can reach it.",
      measuredOn: "2026-09-05",
    },
    intake: "upload",
  },

  // -------------------------------------------------------------------------
  // Michigan's OTHER posted list — the one that is filed rather than published,
  // and is embargoed by statute for a year (2026-09-05, ADR 0126).
  //
  // The founder's call this morning was "open a standing quarterly request,
  // filed as a source". The research that followed found the thing that call
  // could not have known, and it changes the shape rather than cancelling it:
  // MCL 436.1609a makes the filed net cash prices EXEMPT from disclosure under
  // MCL 15.243 "until 1 year after the net cash price or price change is
  // filed". ADR 0117 Q19 called them public records reachable by a quarterly
  // request; they are public records reachable by a request that can never
  // return anything less than a year old.
  //
  // So this entry exists, carries the cadence and the draft, and states the
  // embargo on its own face — because a Michigan house being shown a wine price
  // without being told it is a year old would be worse than being shown
  // nothing.
  // -------------------------------------------------------------------------
  "michigan-lcc-filed-beer-wine-schedules": {
    key: "michigan-lcc-filed-beer-wine-schedules",
    sourceClass: "posted_wholesale_list",
    issuer: "Michigan Liquor Control Commission",
    jurisdiction: "US-MI",
    // Wine's cadence is the rule's own: R 436.1726(1) requires a schedule filed
    // "before January 1, April 1, July 1, and October 1 of each year" and (2)
    // forbids changing it within the quarter without a written commission
    // order. Beer has NO recurring filing date — R 436.1625 requires a schedule
    // and requires a reduction to be filed before its effective date and held
    // "at least 180 days", and sets no calendar. Both rules read verbatim on
    // 2026-09-05 (law.cornell.edu, HTTP 200).
    cadence:
      "quarterly for wine (filed before 1 Jan, 1 Apr, 1 Jul, 1 Oct — R 436.1726); on change for beer, a reduction held 180 days (R 436.1625). Both are FILED with the commission, not published",
    // 365 (the statutory embargo) + 91 (a full quarter can elapse between the
    // filing and the embargo lifting on the one before it) + ~21 calendar days
    // for a 5-business-day answer plus its single 10-business-day extension.
    // THIS BOUND IS NOT A FRESHNESS ALLOWANCE. It is the arithmetic of an
    // embargo, and it is written here so that nobody later reads 480 as "this
    // register tolerates sixteen-month-old prices" and applies it elsewhere.
    maxAgeDays: 480,
    fixture: "",
    withheld: {
      reason:
        "The schedules are FILED with the commission rather than published: R 436.1726 and R 436.1625 both say 'file with the commission in Lansing' and neither requires publication. Nothing on any Michigan host serves them, and michigan.gov answers 403 to this fetcher on every path including robots.txt. They are reached only by a written FOIA request, and MCL 436.1609a exempts each filing from disclosure until one year after it was filed — so even a granted request returns a schedule at least twelve months old.",
      measuredOn: "2026-09-05",
    },
    intake: "foia",
    standingRequest: {
      // NOT 'requested'. Nothing has been sent. The draft is written for the
      // founder to send, and this session sent nothing.
      status: "not_yet_filed",
      filedOn: null,
      draft: ".planning/07-reference/MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md",
      statutoryEmbargoDays: 365,
    },
  },

  // -------------------------------------------------------------------------
  // The non-US markets, researched per market on 2026-09-05 (ADR 0117,
  // "Non-US markets: Türkiye and the United Kingdom"). The founder's call that
  // day: each market gets its own named class of public price source, or an
  // honest "none found" with the sentence that proves it. Three of fourteen
  // houses sit here — two in Türkiye, one in London.
  //
  // NEITHER MARKET HAS A CLASS B, AND NEITHER CAN. Class B exists in the
  // United States because three-tier licensing COMPELS a wholesaler to publish
  // what it charges a retailer. Türkiye has no such compulsion; the United
  // Kingdom has no posting regime at all. So what follows is what each state
  // does publish — and exactly one of these five entries yields a price.
  // -------------------------------------------------------------------------

  [DEFRA_SOURCE_KEY]: {
    key: DEFRA_SOURCE_KEY,
    sourceClass: "public_index",
    issuer: DEFRA_ISSUER,
    jurisdiction: DEFRA_JURISDICTION, // GB-EAW, the publication's own extent
    cadence: "fortnightly (a new edition roughly every second Monday)",
    // A fortnightly series that has not moved in three weeks has stopped.
    // Measured 2026-09-05: newest row 31/08/2026, five days old.
    maxAgeDays: 21,
    fixture: "defra-wholesale-fruit-veg-2026-09-01.sample.csv",
    // SHOWN, on the founder's call of 2026-09-05 (ADR 0117 Q24): *"show it,
    // labelled as produce, in its own box"* — an honest index of a market the
    // house also buys from, never beside a wine quote, with the label saying
    // what it is. `display` is what the panel titles that box with.
    //
    // Nothing here decides whether the fetch RUNS. Arming this source is one
    // thing and one thing only: setting the environment variable
    // `PRICE_INDEX_FETCH_ENABLED` to "true" or "1" on the deployment — a switch
    // the founder flips, not a code change and not a toggle in the product.
    // Until then the box shows the register's own sentence saying so, which is
    // the truth about why it is empty.
    display: {
      category: "Wholesale produce",
      shortIssuer: "Defra",
      extent: "England and Wales",
    },
    parse: (rows, fetchedAt) => parseDefra(rows as DefraRow[], fetchedAt),
  },

  "hmrc-alcohol-duty-rates": {
    key: "hmrc-alcohol-duty-rates",
    sourceClass: "public_index",
    issuer: "HM Revenue & Customs",
    jurisdiction: "GB-UKM",
    cadence: "on change (last changed 1 February 2026)",
    maxAgeDays: 400,
    fixture: "",
    silent: {
      kind: "not_a_price",
      // Fetched 2026-09-05: the guidance page HTTP 200 (90,801 bytes) and the
      // GOV.UK Content API HTTP 200 carrying `public_updated_at`
      // 2026-02-01T00:15:01Z and organisation "HM Revenue & Customs" — so
      // issuer and date are both machine-readable, and there is STILL no
      // price. The table publishes a RATE per litre of pure alcohol (wine and
      // spirits 3.5-8.4% GBP 26.61, 8.5-22% GBP 30.62, over 22% GBP 33.99;
      // beer 3.5-8.4% GBP 22.58). It becomes a per-bottle figure only by
      // multiplying it with the house's own ABV and volume, and that product
      // is a number no issuer ever published.
      reason:
        "HMRC publishes a duty RATE per litre of pure alcohol, not a price for a product. Turning it into a per-bottle figure needs the house's own ABV and volume, so the result is arithmetic no issuer published. Open Government Licence v3.0; issuer and effective date are both machine-readable (GOV.UK Content API, public_updated_at 2026-02-01).",
      measuredOn: "2026-09-05",
    },
  },

  "ons-rpi-average-price-alcohol": {
    key: "ons-rpi-average-price-alcohol",
    sourceClass: "retail_reference",
    issuer: "Office for National Statistics",
    jurisdiction: "GB-UKM",
    cadence: "was monthly; no observation since January 2025",
    maxAgeDays: 62,
    fixture: "",
    silent: {
      kind: "discontinued",
      // THE SOURCE THAT WOULD HAVE BEEN THE ANSWER, AND THE TRAP IT SETS.
      // ONS publishes four RPI average-price series for drink — KEF4 wine per
      // 175ml glass, CZMS draught lager per pint, CZMT draught bitter per
      // pint, CZMR whisky per nip — each a money figure in pence with a stated
      // measure and a monthly date, keyless, OGL v3.0. Everything ADR 0117
      // asks of a sighting.
      //
      // Fetched 2026-09-05, all four HTTP 200. Every one's LAST OBSERVATION IS
      // 2025 JAN (517p / 483p / 380p / 390p) — nineteen months ago — while the
      // same payload's `releaseDate` says 2026-08-18 and its `nextRelease`
      // says 16 September 2026. A food series sampled the same way (CZNJ
      // tomatoes) stops in the same month, so the whole family has stopped and
      // not only drink.
      //
      // This is the bh_fv020.txt fault in a better disguise: a 200, a
      // fresh-looking release date, and a value nineteen months stale.
      // `refuseStale` catches it because it reads the OBSERVATION's own date
      // and not the status code or the publisher's release field — which is
      // exactly the reason that gate exists.
      reason:
        "The four ONS RPI average-price series for drink (KEF4 wine per 175ml glass, CZMS lager, CZMT bitter, CZMR whisky) still return HTTP 200 with a releaseDate of 2026-08-18 and a nextRelease of 16 September 2026, but every one's last observation is January 2025. A fetcher reading the status code or the release field as freshness would file a nineteen-month-old price as this month's.",
      measuredOn: "2026-09-05",
    },
  },

  "gib-otv-alcohol-schedule": {
    key: "gib-otv-alcohol-schedule",
    sourceClass: "public_index",
    issuer: "Gelir Idaresi Baskanligi (GIB)",
    jurisdiction: "TR",
    cadence: "six-monthly (January and July, Law 4760 art. 12/3)",
    maxAgeDays: 400,
    fixture: "",
    silent: {
      kind: "not_a_price",
      // Türkiye's answer to HMRC's duty table, and the same objection twice
      // over. The (III)(A) schedule publishes an asgari maktu vergi tutari per
      // G.T.I.P. class (beer 12,4849 / still wine 61,3914 / raki 1.705,9025 /
      // spirits 1.919,1384 TL, read in full 2026-09-04) — a tax, and one whose
      // UNIT is not stated on the face of the table, so even the tax could not
      // be filed with the unit ADR 0117 requires. Re-measured 2026-09-05:
      // gib.gov.tr/robots.txt HTTP 200 `User-agent: * / Allow: /`, the OTV
      // landing page HTTP 200 (39,777 bytes) — but a Next.js shell carrying no
      // PDF link and no cdn.gib reference in its served HTML, so the schedule
      // itself was NOT re-read today and yesterday's reading is cited as
      // yesterday's.
      reason:
        "The OTV (III)(A) schedule is an excise tax per customs class, not a price, and the unit the figure is per is not stated on the face of the table. gib.gov.tr allows crawling and answered HTTP 200 on 2026-09-05, but the schedule is a PDF reached only through a JavaScript shell.",
      measuredOn: "2026-09-05",
    },
  },

  "hks-hal-daily-bulletin": {
    key: "hks-hal-daily-bulletin",
    sourceClass: "public_index",
    issuer: "Ticaret Bakanligi - Hal Kayit Sistemi",
    jurisdiction: "TR",
    cadence: "daily (a bulletin per day, on the previous day's trades)",
    maxAgeDays: 7,
    fixture: "",
    silent: {
      kind: "no_machine_endpoint",
      // The closest Türkiye comes to Defra: national daily wholesale produce
      // prices, public, no login. Fetched 2026-09-05, HTTP 200 (64,583 bytes),
      // headed "Bulten Tarihi : 5.09.2026 (4.09.2026 Tarihli Veriler
      // Kullanilmistir.)", with a real row read verbatim:
      //     ACUR | ACUR | Geleneksel(Konvansiyonel) | 23,78 | 69216 | Kg
      // and no currency stated on the row. But it is a SharePoint WebForms
      // grid: the served HTML references no .ashx, /api/ or .json endpoint at
      // all, the export ("Aktarma Secenekleri") is a postback control rather
      // than a URL, and pages after the first need __VIEWSTATE. Both machine
      // alternatives failed the same day — data.ibb.gov.tr HTTP 403 and the
      // Istanbul hal-price Swagger an empty reply. So no parser is written:
      // parsing page one and calling it the bulletin would report a fraction
      // of a market as the market.
      reason:
        "Public, live and dated (bulletin of 5.09.2026 on 4.09.2026 trades) but readable only as a paged SharePoint HTML grid: no JSON or .ashx endpoint in the served markup, the export is a postback control rather than a URL, and later pages need __VIEWSTATE. The Istanbul REST alternative returned HTTP 403 and an empty Swagger the same day.",
      measuredOn: "2026-09-05",
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
  // Outside the United States: ISO 3166-1 countries and ISO 3166-2 regions.
  // Before 2026-09-05 'Muğla', 'England' and 'Türkiye' all fell through to null
  // and three real houses were told their jurisdiction did not exist. See
  // `jurisdiction.ts` for which codes are known and why.
  return normalizeNonUsJurisdiction(v);
}
