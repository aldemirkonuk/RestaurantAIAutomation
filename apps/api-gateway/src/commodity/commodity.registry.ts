/**
 * The index-series register: which series exist, what each one's terms are, and
 * why one of them may not be fetched.
 *
 * Modelled on `price-index/price-index.registry.ts` — same idea, same
 * `withheld` / `silent` distinction (unreadable versus read-but-unusable), same
 * rule that a source's cadence bound lives beside the source rather than as a
 * global constant. It is a separate file because the tables are separate and a
 * class-E series carries five fields a posting has no column for.
 *
 * EVERY FACT BELOW WAS MEASURED ON 2026-09-05 AND THE FETCH IS LOGGED.
 * `p4-scratch/p4bb-fetch-log.md` carries the URL, the status, the byte count
 * and the `robots.txt` read BEFORE each host's data. A claim here that is not
 * in that log is a claim this file may not make.
 *
 * Both robots readings were also re-read independently by the plan's author at
 * 2026-09-05T14:12-14:15Z after an audit found that log incomplete
 * (`p4as-fetch-log.md:150-151`, rows 75 and 76), and the two sets of
 * measurements agree in every particular: FAO 200 / 1,056 bytes / seven
 * `Disallow` lines / no crawl-delay / nothing matching `media/docs`, and ONS
 * 404 / 101,929 bytes. Two independent reads, one answer.
 *
 * WHAT IS NOT HERE, AND WHY THAT IS THE POINT
 * -------------------------------------------
 * BLS. `api.bls.gov/robots.txt` returns 200 with `User-agent: * / Disallow: /`
 * on the host of a documented, key-issuing, rate-limited public API. Whether
 * that bars a fetcher is genuinely open and is the plan's Q1 — the founder's,
 * not this file's. Nothing here depends on the answer, and no BLS series is
 * registered, because registering one would be answering it.
 */

import type { Admission, CommodityValueKind, PeriodGrain, Redistribution } from "./commodity.types";
import type { DutyDenominator } from "./duty";

/** Everything true of a whole series, exactly as the table stores it. */
export interface SeriesEntry {
  seriesKey: string;
  issuer: string;
  /** ISO 3166 where one applies, and the literal `WORLD` where none does. */
  issuerJurisdiction: string;
  /** The issuer's own title, verbatim. Never our paraphrase. */
  seriesTitle: string;
  sourceUrl: string;
  valueKind: CommodityValueKind;
  /** The issuer's own unit string, verbatim. */
  unit: string;
  /** The base an index is stated against, verbatim; null for a price or rate. */
  basePeriod: string | null;
  currency: string | null;
  priceBasis: string | null;
  cadence: string;
  periodGrain: PeriodGrain;
  /** The staleness bound, in days, against the NEWEST OBSERVATION'S PERIOD. */
  maxAgeDays: number;
  licence: string;
  attribution: string | null;
  redistribution: Redistribution;
  admission: Admission;
  /**
   * How this series would be shown, in the words a reader knows, before they
   * reach a number. Mirrors the price-index registry's `display`, which is what
   * earns a source its own titled box on `/notifications`.
   */
  display: { category: string; shortIssuer: string; extent: string };
  /** Unreadable: the reason nothing can be fetched. */
  withheld: { reason: string; measuredOn: string } | null;
  /** Read but unusable: read fine, and what came back cannot be admitted. */
  silent: { kind: string; reason: string; measuredOn: string } | null;
  /**
   * A series whose only route in is a person's own download, and whose file has
   * not arrived yet. The founder's Q1 answer, 2026-09-05: a one-off human read,
   * logged. TRUE means the parser exists, is tested against the recorded format
   * and its fixture contract, and has never seen real bytes -- so nothing
   * anywhere may report this series as working.
   */
  awaitingHumanDownload?: boolean;
  /**
   * For `value_kind: 'rate'` only. WHAT THE PUBLISHED FIGURE IS PER.
   *
   * Declared rather than inferred, because the three rates registered here have
   * three different denominators and one of them is not published at all. See
   * `duty.ts`: a single rate x volume helper across them would be wrong twice.
   */
  dutyDenominator?: DutyDenominator;
  /** The instrument, in the issuer's own citation. A rate without one is a rumour. */
  statute?: string;
  /** The date the issuer says these figures are in force from. */
  effectiveFrom?: string;
}

/**
 * FAO Food Price Index.
 *
 * Phase 0's first source, and it earns that on politeness rather than on
 * usefulness: `robots.txt` reads 200 and permits the path, no `Crawl-delay` is
 * declared, the CSV is keyless, and the series serves EVERY house rather than
 * one jurisdiction.
 *
 * `maxAgeDays: 70`, and the number is derived rather than picked. The index is
 * monthly and is released in the first week of the following month (the page
 * states 2026-08's release as 2026-09-04 and the next as 2026-10-02). Ageing
 * the newest observation's PERIOD START, an on-time August release is 35 days
 * old on 5 September and 66 days old on the eve of the October release. 70
 * clears that by four days and refuses anything a whole cycle behind. A bound
 * shorter than a full cycle would refuse a current file for the days before the
 * next release — the mistake the Michigan cadence correction already caught
 * once, in the other direction (62 days on a 91-day cycle).
 *
 * THE LICENCE IS UNSTATED AND IS RECORDED AS UNSTATED. The page carries
 * "© FAO 2026" and a general terms link and declares no licence for the CSV.
 * Under the registry's standing rule that is never upgraded to permissive.
 * Whether `unstated` also blocks DISPLAY has never been decided here and is the
 * plan's Q4 — so this entry is admitted to the register and the panel's
 * treatment of it is the founder's call, not this file's.
 */
const FAO_FOOD_PRICE_INDEX: SeriesEntry = {
  seriesKey: "fao.food_price_index.all",
  issuer: "Food and Agriculture Organization of the United Nations",
  issuerJurisdiction: "WORLD",
  seriesTitle: "FAO Food Price Index",
  sourceUrl:
    "https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv",
  valueKind: "index_number",
  unit: "Index, base year = 100",
  basePeriod: "2014-2016=100",
  currency: null,
  priceBasis: null,
  cadence: "monthly (released in the first week of the following month)",
  periodGrain: "month",
  maxAgeDays: 70,
  licence: "unstated",
  attribution: null,
  redistribution: "unstated",
  admission: "fetch",
  display: {
    category: "World food commodity index",
    shortIssuer: "FAO",
    extent: "all food commodities, worldwide",
  },
  withheld: null,
  silent: null,
};

/**
 * ONS `d7bu` — CPI INDEX 01: FOOD AND NON-ALCOHOLIC BEVERAGES, 2015=100.
 *
 * Phase 0's second source. Open Government Licence v3.0, keyless, and it states
 * an `updateDate` on EVERY observation — the only series here that does. It
 * sits beside the Defra wholesale produce line another builder shipped the same
 * day, and speaks for the one UK house on this estate.
 *
 * `robots.txt` is a 404, which under RFC 9309 means unrestricted. Recorded as
 * unrestricted-because-absent, never as permissive-because-stated: the two are
 * different facts and only one of them is a publisher's decision.
 *
 * `maxAgeDays: 70` for the same monthly arithmetic as FAO. Measured against the
 * fetched file: `releaseDate` 2026-08-18 for a July observation, `nextRelease`
 * 16 September — so a current file is at most 62 days past its period start on
 * the eve of the next release.
 *
 * AND THE TRAP THIS SOURCE'S OWN HOST ALREADY SPRANG ONCE. Four ONS RPI
 * average-price series return HTTP 200 with a fresh `releaseDate` and a fresh
 * `nextRelease` while every last observation is 2025 JAN (recorded 2026-09-05
 * in `price-sources.md` as `silent: discontinued`). A gate that trusted
 * `releaseDate` would admit them forever. That is why the bound below is
 * measured against the newest OBSERVATION'S period and never against the
 * issuer's release date, on this source above all.
 */
const ONS_D7BU: SeriesEntry = {
  seriesKey: "ons.d7bu.cpi_food_and_non_alcoholic_beverages",
  issuer: "Office for National Statistics",
  issuerJurisdiction: "GB",
  seriesTitle: "CPI INDEX 01 : FOOD AND NON-ALCOHOLIC BEVERAGES 2015=100",
  sourceUrl:
    "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bu/mm23/data",
  valueKind: "index_number",
  unit: "Index, base year = 100",
  basePeriod: "2015=100",
  currency: null,
  priceBasis: null,
  cadence: "monthly (released mid-month for the previous month)",
  periodGrain: "month",
  maxAgeDays: 70,
  licence: "Open Government Licence v3.0",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0.",
  redistribution: "attribution_required",
  admission: "fetch",
  display: {
    category: "Consumer price index, food and non-alcoholic drink",
    shortIssuer: "ONS",
    extent: "United Kingdom",
  },
  withheld: null,
  silent: null,
};

/**
 * USDA AMS Daily National Shell Egg Index — REGISTERED, NEVER FETCHED.
 *
 * This is the source the founder's own example is about, it is the best series
 * in the whole plan, and it is the one entry here that carries no fetcher and
 * no parser. `https://www.ams.usda.gov/robots.txt` returned HTTP 403 on
 * 2026-09-04 and again on 2026-09-05, and this repository's own rule — recorded
 * in `price-sources.md` for K&L Wine Merchants, Majestic and Tesco — is that a
 * host whose crawl rules cannot be READ may not be fetched. So:
 *
 *   `admission: "upload_only"`   nothing may be pointed at that host
 *   `withheld`                    the 403, named, with the date it was measured
 *   `armed` (in the table)        false, and it cannot be set true: the CHECK
 *                                 refuses an armed series with no threshold,
 *                                 and its threshold cannot be derived, because
 *                                 the only route to its DAILY history is the
 *                                 MARS API, which is unverified
 *
 * The last point is worth stating plainly because it would otherwise look like
 * an oversight: every threshold measurement behind this design was made on
 * MONTHLY series, and a daily series' move distribution is not a monthly one's.
 * Arming this series on a monthly-derived number would be a threshold that
 * means something other than what it says.
 *
 * A person may still bring the file. That is the Michigan path
 * (`POST /price-index/upload`), and wiring this series into it is phase 1's
 * work, not phase 0's.
 */
const USDA_SHELL_EGG: SeriesEntry = {
  seriesKey: "usda_ams.shell_egg_index.national",
  issuer: "USDA Agricultural Marketing Service",
  issuerJurisdiction: "US",
  seriesTitle: "Daily National Shell Egg Index Report (5-day rolling average)",
  sourceUrl: "https://www.ams.usda.gov/mnreports/ams_2843.pdf",
  valueKind: "price",
  unit: "cents per dozen",
  basePeriod: null,
  currency: "USD",
  priceBasis: "FOB, graded loose, white, Large, 30-dozen cases",
  cadence: "daily",
  periodGrain: "day",
  maxAgeDays: 5,
  licence: "US Government work",
  attribution: null,
  // The host's own terms were not read: its robots.txt refuses to serve. An
  // unread term is `unstated`, never `permitted`.
  redistribution: "unstated",
  admission: "upload_only",
  display: {
    category: "Wholesale shell eggs",
    shortIssuer: "USDA AMS",
    extent: "national, United States",
  },
  withheld: {
    reason:
      "www.ams.usda.gov/robots.txt returns HTTP 403, so this host's crawl rules cannot be read and nothing may be fetched from it. A person may bring the report; nothing here goes and gets it.",
    measuredOn: "2026-09-05",
  },
  silent: null,
  // The founder's answer to Q1, 2026-09-05: a one-off human read, logged. The
  // parser is written (`parse-usda-shell-egg.ts`) against the format the plan
  // recorded and against `__fixtures__/USDA-SHELL-EGG-CONTRACT.md`, and it has
  // never seen real bytes. This flag is what stops any surface reporting this
  // series as working before the file lands.
  awaitingHumanDownload: true,
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RATES. A rate IS a series (the founder, 2026-09-05, batch 51).
 * ─────────────────────────────────────────────────────────────────────────────
 * `value_kind: 'rate'` was in this table from the first migration and had no
 * occupant. The founder's answer to the plan's Q6 fills it, and the case for it
 * is that these three carry BETTER provenance than most of the prices in the
 * drink register: each states its issuer, its statute, its effective date and
 * its figures exactly, and two of the three are openly licensed.
 *
 * **NOTHING WAS FETCHED FOR THESE THREE.** All three were measured on
 * 2026-09-05 by the market-research builder, with `robots.txt` read first in
 * each case, and are recorded in `.planning/07-reference/price-sources.md` at
 * lines 269 (GİB), 295 and 471 (HMRC) and 565 (Illinois). They are CITED here,
 * not re-crawled: the founder's instruction was to fetch nothing whose robots
 * had not been logged, and re-reading a host that another builder already read
 * politely today adds a request and no fact.
 *
 * A rate is never rendered as a price and never compared with one. What it can
 * do is carry a DERIVED per-bottle duty line — and `duty.ts` is where the three
 * different denominators are handled, including the one that is not published.
 */

/**
 * HMRC alcohol duty. The best-provenanced source in either register: Open
 * Government Licence v3.0, a machine-readable issuer and date on the GOV.UK
 * Content API (`public_updated_at` 2026-02-01T00:15:01Z, organisation "HM
 * Revenue & Customs"), and rates stated per litre of pure alcohol.
 *
 * `admission: 'upload_only'` and NOT because of robots — `www.gov.uk` is
 * readable. The measured reason is that **the rates are HTML prose**: there is
 * no CSV and no API for the figures themselves on that page, so a scheduled
 * fetcher would be a scraper of a prose table, and a scraper that silently
 * mis-reads one band writes a tax figure. A person brings the numbers.
 */
const HMRC_ALCOHOL_DUTY: SeriesEntry = {
  seriesKey: "hmrc.alcohol_duty.spirits_and_wine_8_5_to_22",
  issuer: "HM Revenue & Customs",
  issuerJurisdiction: "GB",
  seriesTitle: "Alcohol Duty rates, wine and spirits 8.5% to 22% ABV",
  sourceUrl: "https://www.gov.uk/guidance/alcohol-duty-rates",
  valueKind: "rate",
  unit: "GBP per litre of pure alcohol",
  basePeriod: null,
  currency: "GBP",
  priceBasis: null,
  cadence: "on change (last changed 1 February 2026)",
  periodGrain: "day",
  // A duty rate does not go stale on a clock: it is in force until it is
  // changed. 400 days is a bound against a register quietly holding a schedule
  // through a Budget, not a cadence.
  maxAgeDays: 400,
  licence: "Open Government Licence v3.0",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0.",
  redistribution: "attribution_required",
  admission: "upload_only",
  dutyDenominator: "litre_of_pure_alcohol",
  statute: "Finance (No. 2) Act 2023, Part 2; rates as amended in force 1 February 2026",
  effectiveFrom: "2026-02-01",
  display: {
    category: "Alcohol duty",
    shortIssuer: "HMRC",
    extent: "United Kingdom",
  },
  withheld: {
    reason:
      "The rates are HTML prose on the guidance page: no CSV and no API publishes the figures themselves (measured 2026-09-05, price-sources.md:471). A scheduled scraper of a prose tax table that mis-reads one band writes a wrong tax, so a person brings the numbers.",
    measuredOn: "2026-09-05",
  },
  silent: null,
  awaitingHumanDownload: true,
};

/**
 * The Illinois liquor gallonage tax. A state excise rate, robots-clean, with
 * its own effective period stated on the page.
 *
 * The only one of the three whose per-bottle line needs nothing but a size —
 * it is per gallon of LIQUID, not of pure alcohol — which makes it the honest
 * first test of `duty.ts` the day a bottle size somebody actually stated exists.
 */
const ILLINOIS_GALLONAGE: SeriesEntry = {
  seriesKey: "il_dor.liquor_gallonage_tax.above_20_abv",
  issuer: "Illinois Department of Revenue",
  issuerJurisdiction: "US-IL",
  seriesTitle: "Liquor Gallonage Tax, alcoholic liquor above 20% ABV",
  sourceUrl: "https://tax.illinois.gov/research/taxrates/excise.html",
  valueKind: "rate",
  unit: "USD per gallon",
  basePeriod: null,
  currency: "USD",
  priceBasis: null,
  cadence: "on change (this schedule applies to reporting periods July 2026 or after)",
  periodGrain: "day",
  maxAgeDays: 400,
  // A US state work. The page states no licence of its own, and an unstated
  // licence is recorded as unstated rather than assumed from the publisher.
  licence: "unstated",
  attribution: null,
  redistribution: "unstated",
  admission: "upload_only",
  dutyDenominator: "gallon_of_liquid",
  statute: "235 ILCS 5/8-1 (Liquor Control Act of 1934, Article VIII)",
  effectiveFrom: "2026-07-01",
  display: {
    category: "State excise rate",
    shortIssuer: "Illinois DOR",
    extent: "Illinois",
  },
  withheld: {
    reason:
      "The rates are an HTML table on the excise page and no machine endpoint publishes them (measured 2026-09-05, price-sources.md:565). robots.txt is 200 and disallows only draft forms, so the block is the FORMAT rather than the host: a person brings the numbers.",
    measuredOn: "2026-09-05",
  },
  silent: null,
  awaitingHumanDownload: true,
};

/**
 * The GİB ÖTV (III) sayılı liste, (A) cetveli — and the one that must be
 * registered SILENT.
 *
 * Everything about its provenance is good: `gib.gov.tr/robots.txt` is 200 with
 * `Allow: /` and no crawl-delay, the schedule states its own instrument
 * (*"[10799 sayılı Cumhurbaşkanı Kararı ile değişen liste] (Yürürlük:
 * 31/12/2025)"*) and its own effective date, and the figures are exact.
 *
 * **And the issuer does not state what the figure is PER.** Measured and
 * recorded verbatim in `price-sources.md:269`: *"The unit is not stated on the
 * face of the table and is NOT asserted here"* — press reporting of the same
 * decision divides by 100, which IMPLIES per litre of pure alcohol, and that
 * inference was never confirmed against Law 4760.
 *
 * So this series is registered, dated, cited — and `silent`, with
 * `dutyDenominator: 'unstated'`. It may be shown as published and no per-bottle
 * line may ever be derived from it until somebody reads the law. Registering it
 * with a guessed denominator would put a tax figure on a Turkish house's screen
 * that is either right or wrong by a factor of a hundred, which is exactly the
 * ambiguity ADR 0117's unit rule exists to refuse.
 */
const GIB_OTV: SeriesEntry = {
  seriesKey: "gib.otv_iii_a.asgari_maktu",
  issuer: "Gelir İdaresi Başkanlığı",
  issuerJurisdiction: "TR",
  seriesTitle:
    "ÖTV (III) sayılı liste, (A) cetveli — asgari maktu vergi tutarı",
  sourceUrl:
    "https://www.gib.gov.tr/yardim-ve-kaynaklar/yararli-bilgiler/otv-oranlari",
  valueKind: "rate",
  // The issuer's own column heading, verbatim. What it is TL per is the part
  // that is missing, and `dutyDenominator: 'unstated'` is where that is said.
  unit: "TL, asgari maktu vergi tutarı",
  basePeriod: null,
  currency: "TRY",
  priceBasis: null,
  cadence: "six-monthly, January and July (Law 4760 md. 12/3, Yİ-ÜFE)",
  periodGrain: "day",
  maxAgeDays: 400,
  licence: "unstated",
  attribution: null,
  redistribution: "unstated",
  admission: "upload_only",
  dutyDenominator: "unstated",
  statute:
    "4760 sayılı Özel Tüketim Vergisi Kanunu; 10799 sayılı Cumhurbaşkanı Kararı (Yürürlük 31/12/2025)",
  effectiveFrom: "2025-12-31",
  display: {
    category: "Excise rate",
    shortIssuer: "GİB",
    extent: "Türkiye",
  },
  withheld: null,
  silent: {
    kind: "unit_denominator_not_stated",
    reason:
      "The schedule states an exact TL figure, its instrument and its effective date, and it does NOT state what the figure is per. Press reporting of the same decision divides by 100, which implies per litre of pure alcohol; that was never confirmed against Law 4760 and is not asserted. The rate is held and shown as published; no per-bottle duty is derived from it.",
    measuredOn: "2026-09-05",
  },
  awaitingHumanDownload: true,
};

/** The register, keyed by our stable series key. */
export const SERIES: Record<string, SeriesEntry> = {
  [FAO_FOOD_PRICE_INDEX.seriesKey]: FAO_FOOD_PRICE_INDEX,
  [ONS_D7BU.seriesKey]: ONS_D7BU,
  [USDA_SHELL_EGG.seriesKey]: USDA_SHELL_EGG,
  [HMRC_ALCOHOL_DUTY.seriesKey]: HMRC_ALCOHOL_DUTY,
  [ILLINOIS_GALLONAGE.seriesKey]: ILLINOIS_GALLONAGE,
  [GIB_OTV.seriesKey]: GIB_OTV,
};

/** The series a scheduled reader may be pointed at. Never the whole register. */
export function fetchableSeries(): SeriesEntry[] {
  return Object.values(SERIES).filter(
    (s) => s.admission === "fetch" && s.withheld === null,
  );
}

/**
 * Which series speak for a house in this jurisdiction.
 *
 * `WORLD` speaks for everyone. Otherwise containment, not equality, reusing the
 * price-index registry's own reading: a national instrument speaks for a house
 * in one of its provinces (`GB` covers `GB-ENG`), and a house known only as
 * `GB` is NOT covered by an England-and-Wales series, because it may be in
 * Scotland. A house whose jurisdiction is unknown gets the WORLD series and
 * nothing else — which is a real answer rather than an empty list.
 */
export function seriesForJurisdiction(iso: string | null): SeriesEntry[] {
  return Object.values(SERIES).filter((s) => {
    if (s.issuerJurisdiction === "WORLD") return true;
    if (!iso) return false;
    return iso === s.issuerJurisdiction || iso.startsWith(`${s.issuerJurisdiction}-`);
  });
}
