/**
 * The EDI 832 Price/Sales Catalog subset — a licensed distributor's price list,
 * read into ADR 0117 class-C sightings.
 *
 * WHERE A CLASS-C ROW GOES, AND WHY IT IS NOT THE INDEX REGISTER
 * -------------------------------------------------------------
 * A class-C price is the price THIS licence pays. It is not a public posting,
 * and the two must not share a table:
 *
 *   - `price_index_postings` has **no `restaurant_id` column at all**
 *     (`20260904200000_a_posted_price_names_its_state.sql`, whose own header
 *     says "NOT restaurant-scoped … a public register keyed by jurisdiction"),
 *     and its `source_class` CHECK admits exactly three values —
 *     `posted_wholesale_list`, `retail_reference`, `public_index`. The same
 *     migration says in words: "Class A (own paper) and C (licensed feed) never
 *     live here". Writing a licensee price there would publish one house's
 *     negotiated pricing to every other house in its state.
 *   - `vendor_price_observations` is restaurant-scoped and already admits this
 *     row. `vpo_source_type_check` lists `api_catalog`, documented in that
 *     migration's own header as "vendor's own structured feed", at trust tier
 *     **3**; `vpo_trust_tier_check` is `BETWEEN 1 AND 7`. So this needs **no
 *     migration** — measured by reading the CHECK, not assumed.
 *   - `comparisonClassOf` (`vendor-intel/price-below-average.ts`) already maps
 *     `api_catalog` into the `quoted` class and its docblock already names that
 *     class "ADR 0117 classes A and C". The ladder was built expecting this row
 *     to arrive here.
 *
 * And the tenancy is load-bearing, not stylistic. `belowTrailingAverage`
 * (`vendor-intel/vendor-comparison.service.ts`) reads
 * `.or("restaurant_id.is.null,restaurant_id.eq.<caller>")` — a NULL
 * `restaurant_id` is visible to EVERY house on the deployment. So a class-C row
 * with a null restaurant is a cross-tenant leak of a house's own buying terms,
 * which is why `no_restaurant` is the first refusal below and is refused for the
 * whole document rather than per row.
 *
 * WHAT THIS PARSER REFUSES TO GUESS
 * ---------------------------------
 * Three things, each because the standard genuinely does not say:
 *
 *  1. **Which CTP is the price.** `CTP02` is a Price Identifier Code from a list
 *     the X12 standard leaves to the trading partners. Two published
 *     implementation guides read on 2026-09-05 use four mutually incompatible
 *     codes between them — CDW's `C01` is literally "CDW Price"; MSSS uses `CON`
 *     and `CAT` out of a list its own guide says holds 164. There is no
 *     universal "the licensee price". So the mapping is an ARGUMENT, and a
 *     `CTP02` outside it is `unmapped_price_basis` — never "take the first one",
 *     never "take the lowest".
 *  2. **The size.** A missing `PO4` is `no_size` and never 750 ml.
 *     `normalizeUnitPrice` (`analytics/engine/vendor-price-consensus.ts`)
 *     silently skips volume scaling when `unitVolumeMl` is absent, so a 375 ml
 *     half-bottle admitted without its size enters the ladder at half its true
 *     per-750 price and becomes the best deal on the page. The published MSSS
 *     sample carries no `PO4` on any of its three lines, so this is the common
 *     case and not the corner case.
 *  3. **The currency.** There is no `USD` default here. `own-paper-sighting.ts`
 *     defaulting to `"USD"` is the measured defect that stamps every Turkish and
 *     British sighting as dollars (ADR 0117, the currency finding); a feed
 *     parser inheriting that default would spread it. `CUR02` or the caller's
 *     declared currency, or the document is refused whole.
 *
 * Every refusal is COUNTED and returned by reason. Nothing is dropped quietly.
 *
 * NOTHING HERE FETCHES ANYTHING. This module is a pure function over bytes
 * somebody else already has. No Illinois distributor was found to send an 832 —
 * see `distributor-feed.registry.ts` for what each portal actually publishes,
 * measured — so today this parser has no live producer, and the registry says so
 * in the sentence a house reads rather than leaving the absence to be guessed.
 */

import { createHash } from "node:crypto";
import { PriceCodeMeaning, attributionFor } from "./price-code-mappings";

/**
 * `api_catalog` / tier 3 — read from the CHECK constraint, not chosen.
 * `20260805154027_vendor_price_observations.sql:112-118` admits the value, and
 * that file's own trust-tier table reads "3 api_catalog — vendor's own
 * structured feed", which is precisely what a distributor's price catalogue is.
 */
export const FEED_SOURCE_TYPE = "api_catalog" as const;
export const FEED_TRUST_TIER = 3 as const;

/** X12 355 codes this parser will convert to millilitres. Deliberately three.
 *  The list has 794 codes (SPS Commerce's own count in the guide read
 *  2026-09-05); every other one — `EA`, `CA`, `OZ`, `BO` — is refused, because
 *  an ounce is ambiguous between fluid and weight and an "each" is not a volume
 *  at all. */
const VOLUME_UNITS: Readonly<Record<string, number>> = Object.freeze({
  ML: 1,
  CL: 10,
  LT: 1000,
});

/**
 * The `LIN` Product/Service ID Qualifiers this parser will take as the item's
 * identity, in preference order. Deliberately four, and each one was read in a
 * guide fetched 2026-09-05 rather than recalled: `VP` (Vendor's/Seller's Part
 * Number), `MG` (Manufacturer's Part Number) and `UP` (U.P.C. Consumer Package
 * Code) are the three CDW's V4010 guide documents, and `VN` is the one the MSSS
 * guide's own published sample uses. Every other X12 235 code — `CR` contract
 * number among them, which that same sample carries — is NOT an item identity
 * and is kept on `raw` rather than mistaken for one.
 */
const ITEM_ID_QUALIFIERS = ["VP", "VN", "MG", "UP"] as const;

/** `DTM01` qualifiers that state when this catalogue line takes effect.
 *  `036` (Expiration) and `001` (Cancel After) are read but never used as the
 *  effective date — an expiry is not an issue date. */
const EFFECTIVE_DATE_QUALIFIERS: ReadonlySet<string> = new Set(["007", "128"]);

/** One admitted class-C sighting, in the columns of `vendor_price_observations`. */
export interface FeedSighting {
  /** NEVER null. See the tenancy note in the header. */
  restaurantId: string;
  providerId: string | null;
  vendorNameRaw: string;
  productNameRaw: string;
  sourceType: typeof FEED_SOURCE_TYPE;
  trustTier: typeof FEED_TRUST_TIER;
  /** Stable per-item key: distributor + catalogue + the item's own id. */
  sourceRef: string;
  sourceUrl: string | null;
  /** OUR clock — when the file reached us. Never the issuer's date. */
  observedAt: string;
  /** The distributor's own `DTM*007` effective date, or null when it stated none. */
  effectiveDate: string | null;
  rawPrice: number;
  currency: string;
  packSize: number;
  unitVolumeMl: number;
  /** WHICH published number this is, in the house's own mapping's words. */
  priceBasis: string;
  /** The sender's own code, verbatim, that the mapping resolved. */
  priceCode: string;
  /**
   * The manager statement that admitted this row's trade level — the id of a
   * `distributor_price_code_mappings` row (ADR 0126 Q3, the founder:
   * "Manager maps it, recorded on every row").
   *
   * It is on the sighting, not only in `raw`, because it becomes
   * `vendor_price_observations.price_code_mapping_id`, a real column with a
   * RESTRICT foreign key — so every row a mapping admitted is one indexed query
   * away, and a withdrawal marks them all by join without rewriting one.
   */
  priceCodeMappingId: string | null;
  /** Who said what the code meant, as they were named when they said it. */
  priceCodeDeclaredByName: string | null;
  priceCodeDeclaredAt: string | null;
  contentHash: string;
  raw: Record<string, unknown>;
}

export interface FeedRefusal {
  reason: FeedRefusalReason;
  detail: string;
}

export type FeedRefusalReason =
  | "no_restaurant"
  | "not_a_832"
  | "no_catalog_header"
  | "no_currency"
  | "currency_disagreement"
  | "no_item_id"
  | "no_description"
  | "no_price"
  | "price_not_positive"
  | "unmapped_price_basis"
  | "no_size"
  | "size_unit_not_volume"
  | "bad_pack"
  | "no_effective_date"
  | "impossible_effective_date"
  | "duplicate_item_id";

export interface Edi832Run {
  distributorKey: string;
  /** The catalogue's own number and version, from `BCT`. Null when absent. */
  catalogNumber: string | null;
  catalogVersion: string | null;
  /** The newest `DTM*007` seen across the document, or null. */
  effectiveDate: string | null;
  currency: string | null;
  linesRead: number;
  sightings: FeedSighting[];
  refusals: FeedRefusal[];
  /** Set when the WHOLE document was refused, with the sentence saying why. */
  refusedWhole: string | null;
  /**
   * Every `CTP02` this house has NOT mapped, by name, deduped and sorted.
   *
   * The refusal detail already names them inside a sentence; this is the same
   * fact in a form a panel can act on, because the only thing that turns a
   * refused catalogue into an admitted one is a manager stating what these
   * particular codes mean. A report that said "0 rows admitted" without them
   * would be telling a house it had a bad file when what it has is an unstated
   * trade level (ADR 0126 Q3).
   */
  unmappedCodes: string[];
}

export interface Edi832Options {
  /** The house this catalogue was issued to. A feed with no house is refused. */
  restaurantId: string;
  distributorKey: string;
  distributorName: string;
  /**
   * `CTP02` code -> what a manager of THIS house said it means, with the id of
   * the statement. Supplied per house, because the code list is per trading
   * partner and the trade level is per licence.
   *
   * An empty map refuses every row, and that is the DEFAULT: nothing is seeded
   * and no distributor ships with a meaning. Build it from
   * `liveMappingsByCode` over `distributor_price_code_mappings`
   * (ADR 0126 Q3).
   */
  priceBasisByCode: Readonly<Record<string, PriceCodeMeaning>>;
  /** When the file reached us. Our clock; the caller passes it so tests can pin it. */
  receivedAt: string;
  /** Used only when the document carries no `CUR`. Absent = refuse. */
  declaredCurrency?: string | null;
  providerId?: string | null;
  sourceUrl?: string | null;
}

interface Segment {
  tag: string;
  el: string[];
}

/**
 * Split an interchange into segments.
 *
 * The delimiters are declared by the ISA when there is one — ISA16 is the
 * component separator and the character after the ISA's own trailer is the
 * segment terminator — but this reader takes the pragmatic route the industry
 * takes and accepts `~` / `*` while tolerating newlines, because a file handed
 * over by a person has usually been through a text editor. A document whose
 * delimiters differ is not silently misread: it produces zero `ST` segments and
 * is refused whole as `not_a_832`.
 */
function segments(raw: string): Segment[] {
  return raw
    .split("~")
    .map((s) => s.replace(/[\r\n]+/g, "").trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const el = s.split("*");
      return { tag: (el[0] ?? "").toUpperCase(), el };
    });
}

function element(seg: Segment, index: number): string {
  return (seg.el[index] ?? "").trim();
}

/** `CCYYMMDD` -> `YYYY-MM-DD`, or null when it is not a real day. */
export function readEdiDate(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6));
  const d = Number(raw.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (
    asDate.getUTCFullYear() !== y ||
    asDate.getUTCMonth() !== m - 1 ||
    asDate.getUTCDate() !== d
  ) {
    return null;
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** The identity the row dedups on: the price-bearing fields, nothing else. */
export function feedContentHash(s: {
  rawPrice: number;
  currency: string;
  packSize: number;
  unitVolumeMl: number;
  effectiveDate: string | null;
  priceBasis: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        s.rawPrice,
        s.currency,
        s.packSize,
        s.unitVolumeMl,
        s.effectiveDate,
        s.priceBasis,
      ]),
    )
    .digest("hex");
}

/**
 * Parse one 832 interchange into class-C sightings for one house.
 *
 * Returns rather than throws for every refusal a person could fix, so the
 * report can name what was dropped and why. It throws for nothing.
 */
export function parseEdi832(raw: string, opts: Edi832Options): Edi832Run {
  const run: Edi832Run = {
    distributorKey: opts.distributorKey,
    catalogNumber: null,
    catalogVersion: null,
    effectiveDate: null,
    currency: null,
    linesRead: 0,
    sightings: [],
    refusals: [],
    refusedWhole: null,
    unmappedCodes: [],
  };
  const unmapped = new Set<string>();

  if (!opts.restaurantId || !opts.restaurantId.trim()) {
    run.refusedWhole =
      "no house was named for this catalogue. A licensed distributor's price is the price ONE licence pays; written without a restaurant it would be readable by every other house on this deployment (belowTrailingAverage reads restaurant_id.is.null as everyone's).";
    run.refusals.push({
      reason: "no_restaurant",
      detail: "restaurantId was empty",
    });
    return run;
  }

  const segs = segments(raw ?? "");
  const hasTransaction = segs.some(
    (s) => s.tag === "ST" && element(s, 1) === "832",
  );
  if (!hasTransaction) {
    run.refusedWhole =
      "this is not an 832 price/sales catalog: no ST*832 segment was found. Nothing was parsed.";
    run.refusals.push({ reason: "not_a_832", detail: "no ST*832" });
    return run;
  }

  const bct = segs.find((s) => s.tag === "BCT");
  if (!bct) {
    run.refusedWhole =
      "the catalogue states no BCT header, so it names neither its purpose nor its number. Nothing was parsed.";
    run.refusals.push({ reason: "no_catalog_header", detail: "no BCT" });
    return run;
  }
  run.catalogNumber = element(bct, 2) || null;
  run.catalogVersion = element(bct, 3) || null;

  /*
   * A FILE THAT DISAGREES WITH ITSELF REFUSES THE WHOLE FILE TOO.
   *
   * Until this line the reader took `segs.find(s => s.tag === "CUR")` — the
   * FIRST `CUR` segment — and a second, disagreeing one was dropped with no
   * trace at all (audit of 19ab0258, finding 6: `CUR*SE*USD~` then
   * `CUR*SE*EUR~` read silently as USD). That is the same silent-money failure
   * the file-versus-declaration case below refuses, only with nobody at all to
   * notice it, so it takes the same answer and the same `refusedWhole` path.
   *
   * Normalisation happens BEFORE comparison, because `CUR*SE*usd~` and
   * `CUR*SE* USD ~` are the same currency written by two text editors, not a
   * disagreement: `element()` trims (line 253) and `toUpperCase()` folds case.
   * A `CUR` segment whose currency element is EMPTY (`CUR*SE*~`) states no
   * currency and is treated exactly as "no CUR" — it is dropped from the
   * comparison rather than counted as a third, blank opinion.
   */
  const curSegs = segs.filter((s) => s.tag === "CUR");
  const curCodes = curSegs.map((s) => element(s, 2).toUpperCase()).filter((c) => c !== "");
  const distinctCurCodes = [...new Set(curCodes)];
  if (distinctCurCodes.length > 1) {
    const named = distinctCurCodes.join(" and ");
    run.refusedWhole = `the file states ${distinctCurCodes.length} different currencies — ${named} — in its own CUR segments; nothing was read. A catalogue has one currency, and this parser will not pick one of them for you: reading the first would price the whole catalogue in a currency the rest of the file contradicts. Send the file again with a single CUR.`;
    run.refusals.push({
      reason: "currency_disagreement",
      detail: `the file's CUR segments stated ${named}`,
    });
    return run;
  }
  const curCode = distinctCurCodes[0] ?? "";
  const declared = (opts.declaredCurrency ?? "").trim().toUpperCase();
  const fileStates = /^[A-Z]{3}$/.test(curCode);
  const houseStated = /^[A-Z]{3}$/.test(declared);
  /*
   * A DISAGREEMENT REFUSES THE WHOLE FILE, NAMING BOTH (the founder,
   * 2026-09-06, batch 62 Q2: "Refuse the file, naming both").
   *
   * Until this line, the file's own `CUR` silently won and the manager's typed
   * declaration was discarded with no trace in the response. Either one of them
   * is wrong, and neither this parser nor the person can tell which from here:
   * a EUR file read as EUR when the house typed USD prices a catalogue in a
   * currency the manager did not expect, and the opposite writes a number that
   * is right by roughly the exchange rate. Both are silent, and both reach the
   * market box as real money.
   *
   * Refusing the whole document is the only answer that leaves the disagreement
   * visible. Agreement (the same code twice) and absence (no declaration at
   * all) are unchanged: the ordinary case is a file that states its own `CUR`
   * and a manager who leaves the box empty.
   */
  if (fileStates && houseStated && curCode !== declared) {
    run.refusedWhole = `the file states ${curCode} and the declaration says ${declared}; nothing was read. One of the two is wrong and this parser cannot tell which — reading either would price a whole catalogue in a currency somebody did not mean. Send the file again with the declaration corrected, or leave it empty and let the file state its own.`;
    run.refusals.push({
      reason: "currency_disagreement",
      detail: `CUR02 was '${curCode}' and declaredCurrency was '${declared}'`,
    });
    return run;
  }
  const currency = fileStates ? curCode : houseStated ? declared : null;
  if (!currency) {
    run.refusedWhole =
      "the catalogue states no CUR currency and none was declared for this connection. A price with no currency is not a price, and there is deliberately no USD default here.";
    run.refusals.push({
      reason: "no_currency",
      detail:
        curSegs.length > 0
          ? `CUR02 was '${element(curSegs[0], 2)}'`
          : "no CUR segment",
    });
    return run;
  }
  run.currency = currency;

  // The distributor's own name, when the document carries one (N1*SU).
  const n1su = segs.find((s) => s.tag === "N1" && element(s, 1) === "SU");
  const vendorNameRaw = (n1su && element(n1su, 2)) || opts.distributorName;

  // Split into LIN loops. A loop runs from one LIN to the next structural
  // segment (LIN or CTT/SE), so a CTP belongs to the LIN above it and never
  // leaks into the next item.
  const loops: Segment[][] = [];
  let current: Segment[] | null = null;
  for (const s of segs) {
    if (s.tag === "LIN") {
      if (current) loops.push(current);
      current = [s];
      continue;
    }
    if (s.tag === "CTT" || s.tag === "SE" || s.tag === "GE" || s.tag === "IEA") {
      if (current) loops.push(current);
      current = null;
      continue;
    }
    if (current) current.push(s);
  }
  if (current) loops.push(current);

  run.linesRead = loops.length;
  const seenItemIds = new Set<string>();

  for (const loop of loops) {
    const lin = loop[0];
    const label = element(lin, 1) || "(unnumbered)";

    // LIN02/03, LIN04/05, LIN06/07 are qualifier-and-id pairs. Every pair is
    // kept, so the row can carry a UPC alongside the vendor part number.
    const ids: Record<string, string> = {};
    for (let i = 2; i + 1 < lin.el.length; i += 2) {
      const q = element(lin, i).toUpperCase();
      const v = element(lin, i + 1);
      if (q && v) ids[q] = v;
    }
    const itemId = ITEM_ID_QUALIFIERS.map((q) => ids[q]).find(Boolean) ?? "";
    if (!itemId) {
      run.refusals.push({
        reason: "no_item_id",
        detail: `LIN ${label} carries none of ${ITEM_ID_QUALIFIERS.join(", ")} as an identifier`,
      });
      continue;
    }
    if (seenItemIds.has(itemId)) {
      run.refusals.push({
        reason: "duplicate_item_id",
        detail: `item ${itemId} appears more than once; the later line is refused rather than overwriting the earlier`,
      });
      continue;
    }
    // Claimed as soon as it is READ, not once it is admitted. If a catalogue
    // states the same item twice and the first copy is refused for a missing
    // size, the second copy is still the same item — admitting it would let a
    // defective line be repaired by a duplicate rather than reported.
    seenItemIds.add(itemId);

    const pid = loop.find((s) => s.tag === "PID");
    const description = pid ? element(pid, 5) : "";
    if (!description) {
      run.refusals.push({
        reason: "no_description",
        detail: `item ${itemId} has no PID05 description`,
      });
      continue;
    }

    let effectiveDate: string | null = null;
    let sawEffectiveQualifier = false;
    for (const s of loop) {
      if (s.tag !== "DTM") continue;
      if (!EFFECTIVE_DATE_QUALIFIERS.has(element(s, 1))) continue;
      sawEffectiveQualifier = true;
      const d = readEdiDate(element(s, 2));
      if (d && (!effectiveDate || d > effectiveDate)) effectiveDate = d;
    }
    if (!effectiveDate) {
      run.refusals.push({
        reason: sawEffectiveQualifier
          ? "impossible_effective_date"
          : "no_effective_date",
        detail: sawEffectiveQualifier
          ? `item ${itemId} states a DTM*007 that is not a real date`
          : `item ${itemId} states no DTM*007 or DTM*128 effective date`,
      });
      continue;
    }

    const po4 = loop.find((s) => s.tag === "PO4");
    if (!po4) {
      run.refusals.push({
        reason: "no_size",
        detail: `item ${itemId} carries no PO4, so neither its pack nor its size is stated. It is refused rather than assumed to be a 750 ml bottle.`,
      });
      continue;
    }
    const packRaw = Number(element(po4, 1));
    const sizeRaw = Number(element(po4, 2));
    const unitCode = element(po4, 3).toUpperCase();
    if (!Number.isFinite(packRaw) || packRaw < 1 || !Number.isInteger(packRaw)) {
      run.refusals.push({
        reason: "bad_pack",
        detail: `item ${itemId} states PO401 '${element(po4, 1)}', which is not a whole number of units`,
      });
      continue;
    }
    const multiplier = VOLUME_UNITS[unitCode];
    if (multiplier === undefined) {
      run.refusals.push({
        reason: "size_unit_not_volume",
        detail: `item ${itemId} states PO403 '${unitCode || "(empty)"}', which this parser will not convert to a volume. Only ML, CL and LT are mapped.`,
      });
      continue;
    }
    if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) {
      run.refusals.push({
        reason: "no_size",
        detail: `item ${itemId} states PO402 '${element(po4, 2)}', which is not a positive size`,
      });
      continue;
    }
    const unitVolumeMl = Math.round(sizeRaw * multiplier);

    const ctps = loop.filter((s) => s.tag === "CTP");
    if (ctps.length === 0) {
      run.refusals.push({
        reason: "no_price",
        detail: `item ${itemId} carries no CTP pricing segment`,
      });
      continue;
    }
    const mapped = ctps
      .map((s) => ({
        code: element(s, 2).toUpperCase(),
        price: Number(element(s, 3)),
      }))
      .filter((c) => opts.priceBasisByCode[c.code] !== undefined);
    if (mapped.length === 0) {
      // Named, not only counted. A manager cannot state what a code means
      // until they are told which code was refused.
      for (const s of ctps) {
        const code = element(s, 2).toUpperCase();
        if (code) unmapped.add(code);
      }
      run.refusals.push({
        reason: "unmapped_price_basis",
        detail: `item ${itemId} is priced under ${ctps
          .map((s) => `'${element(s, 2)}'`)
          .join(", ")}, and this connection has no mapping for any of them. CTP02 is a per-trading-partner code list; guessing which one is the licensee price would invent a trade level.`,
      });
      continue;
    }
    if (mapped.length > 1) {
      run.refusals.push({
        reason: "unmapped_price_basis",
        detail: `item ${itemId} carries ${mapped.length} mapped prices (${mapped
          .map((m) => m.code)
          .join(", ")}). Two mapped trade levels on one line is a mapping error, not a choice for this parser to make.`,
      });
      continue;
    }
    const chosen = mapped[0];
    if (!Number.isFinite(chosen.price) || chosen.price <= 0) {
      run.refusals.push({
        reason: "price_not_positive",
        detail: `item ${itemId} states CTP03 '${chosen.price}' under ${chosen.code}. A zero or absent price is not a price a house can be shown.`,
      });
      continue;
    }

    const meaning = opts.priceBasisByCode[chosen.code];
    const priceBasis = meaning.priceBasis;
    if (!run.effectiveDate || effectiveDate > run.effectiveDate) {
      run.effectiveDate = effectiveDate;
    }
    const sighting: FeedSighting = {
      restaurantId: opts.restaurantId,
      providerId: opts.providerId ?? null,
      vendorNameRaw,
      productNameRaw: description,
      sourceType: FEED_SOURCE_TYPE,
      trustTier: FEED_TRUST_TIER,
      sourceRef: `${opts.distributorKey}:${run.catalogNumber ?? "nocat"}:${itemId}`,
      sourceUrl: opts.sourceUrl ?? null,
      observedAt: opts.receivedAt,
      effectiveDate,
      rawPrice: chosen.price,
      currency,
      packSize: packRaw,
      unitVolumeMl,
      priceBasis,
      priceCode: chosen.code,
      // The whole point of ADR 0126 Q3: the row names the statement that let
      // it in. A wrong mapping is then one query, and reversing it is a
      // withdrawal rather than a hunt through JSONB.
      priceCodeMappingId: meaning.mappingId,
      priceCodeDeclaredByName: meaning.declaredByName,
      priceCodeDeclaredAt: meaning.declaredAt,
      contentHash: "",
      raw: {
        ediItemIds: ids,
        ctp02: chosen.code,
        priceCodeMapping: {
          mappingId: meaning.mappingId,
          priceBasis: meaning.priceBasis,
          declaredByName: meaning.declaredByName,
          declaredAt: meaning.declaredAt,
          attribution: attributionFor(meaning, chosen.code),
        },
        po4: { pack: packRaw, size: sizeRaw, unit: unitCode },
        catalogNumber: run.catalogNumber,
        catalogVersion: run.catalogVersion,
        distributorKey: opts.distributorKey,
      },
    };
    sighting.contentHash = feedContentHash(sighting);
    run.sightings.push(sighting);
  }

  run.unmappedCodes = [...unmapped].sort();
  return run;
}

/**
 * Is this text an 832 price/sales catalogue?
 *
 * Uses the SAME segment reader the parser uses, so detection and parsing agree:
 * a file whose delimiters this reader cannot split produces no `ST` segment and
 * is therefore not claimed as a catalogue, rather than being claimed and then
 * refused whole. `looksLikeX12` (`procurement/documents/x12/index.ts`) does not
 * recognise 832 — its `ST` alternation is `8[015][0-9]|997` — and an 832 inside
 * an ISA envelope reaches `parseX12`'s `default` branch, which reports it as an
 * unsupported set. That is why the document door asks THIS question first.
 */
export function looksLikeEdi832(raw: string): boolean {
  if (!raw) return false;
  return segments(raw).some((s) => s.tag === "ST" && element(s, 1) === "832");
}

/** What a catalogue says about itself, before any line is admitted. */
export interface Edi832Header {
  catalogNumber: string | null;
  catalogVersion: string | null;
  /** `CUR02` only. Never a default, and never the caller's declared currency. */
  currency: string | null;
  /** `N1*SU` — the sender's own name for itself, or null when it named none. */
  senderName: string | null;
  /** The newest `DTM*007`/`DTM*128` anywhere in the document. */
  effectiveDate: string | null;
  /** How many `LIN` loops the file carries. Read, not admitted. */
  lineCount: number;
}

/**
 * Read a catalogue's header without admitting a single price.
 *
 * The document door needs this and nothing more: it stores the file, names its
 * sender and its number, and stops. Admitting the lines needs the house's own
 * code mappings and is a different call with a different failure mode, so the
 * two are deliberately not one function — a header this can read is not a
 * catalogue whose prices this house may see.
 */
export function readEdi832Header(raw: string): Edi832Header {
  const segs = segments(raw ?? "");
  const bct = segs.find((s) => s.tag === "BCT");
  const cur = segs.find((s) => s.tag === "CUR");
  const curCode = cur ? element(cur, 2).toUpperCase() : "";
  const n1su = segs.find((s) => s.tag === "N1" && element(s, 1) === "SU");
  let effectiveDate: string | null = null;
  for (const s of segs) {
    if (s.tag !== "DTM") continue;
    if (!EFFECTIVE_DATE_QUALIFIERS.has(element(s, 1))) continue;
    const d = readEdiDate(element(s, 2));
    if (d && (!effectiveDate || d > effectiveDate)) effectiveDate = d;
  }
  return {
    catalogNumber: (bct && element(bct, 2)) || null,
    catalogVersion: (bct && element(bct, 3)) || null,
    currency: /^[A-Z]{3}$/.test(curCode) ? curCode : null,
    senderName: (n1su && element(n1su, 2)) || null,
    effectiveDate,
    lineCount: segs.filter((s) => s.tag === "LIN").length,
  };
}

/** Tally refusals by reason, so a short report can name every dropped line. */
export function tallyFeedRefusals(
  refusals: FeedRefusal[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of refusals) out[r.reason] = (out[r.reason] ?? 0) + 1;
  return out;
}
