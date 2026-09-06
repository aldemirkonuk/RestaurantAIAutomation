/**
 * The house's own record on a bottle, and how a register is assembled from it.
 *
 * Kept free of Nest and of the database client for the same reason
 * `cellar/cellar-registers.ts` is: every rule here is a claim about what the
 * house's books mean, and a claim about meaning should be testable without a
 * network.
 *
 * THE SHAPE OF THE ANSWER, AND WHY IT IS THIS WAY ROUND
 * ----------------------------------------------------
 * The first build of these registers made `public.beverages` the spine and
 * asked what the house had. That was the wrong way round, and it produced the
 * sentence the register still carried this morning: *"public.beverages carries
 * no restaurant_id — nothing here is stock."* True, and useless: a whisky bar
 * opening `/whiskey` got 211 strangers' bottles and nothing of its own.
 *
 * DESIGN-FOUNDATION.md §6 names the opposite as the exponential idea for this
 * page — "the house's own record on every bottle … CellarTracker has 7.5M
 * strangers' notes; we have one house's memory". So the spine is now THE
 * HOUSE'S BOOKS (`house_beverage_ledger`, migration 20260903120000), and the
 * shared catalogue is the lookup laid over it:
 *
 *   a row with a house record and a catalogue match — the full record.
 *   a row with a house record and no match         — still the house's, in full.
 *                                                    A bottle nobody catalogued
 *                                                    is not a bottle nobody bought.
 *   a row with a catalogue entry and no house record — browsable, and labelled
 *                                                    as somebody else's row.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * There is no `onHand` anywhere in this file. Every quantity path in the schema
 * (`restaurant_inventory`, `inventory_lots`, `inventory_transactions`,
 * `pour_events`) is keyed on `master_wine_id`, so a keg has no stock row to
 * read. That is OD-113, the non-wine inventory identity axis, and the register
 * states it in one sentence rather than rendering a column of zeroes.
 */

import {
  REGISTER_IDS,
  registersForBeverageType,
  registersForLabel,
  type RegisterId,
} from "../cellar/cellar-registers";

/**
 * Which books named this product. The vocabulary is closed and the words are
 * the operator's, not the schema's — "invoice", not
 * "procurement_document_lines".
 */
export type HouseBook = "menu" | "invoice" | "order" | "quote" | "pos";

export interface OnMenu {
  lines: number;
  bottlePrice: number | null;
  glassPrice: number | null;
  sections: string[];
}

export interface Bought {
  lines: number;
  /** First invoice line naming it. The founder's "first bought". */
  first: string | null;
  last: string | null;
  bottles: number | null;
  /** What the house has actually been charged, summed over invoice lines. */
  paidTotal: number | null;
  lastUnitPrice: number | null;
  /** The vendor on the most recent invoice. Null when the doc names none. */
  lastFrom: string | null;
}

export interface Ordered {
  lines: number;
  lastAt: string | null;
  lastPrice: number | null;
  lastFrom: string | null;
}

export interface Quoted {
  count: number;
  lastAt: string | null;
  lastPrice: number | null;
  /** `vendor_price_observations.source_type` — invoice, catalogue, quote, … */
  lastSource: string | null;
  lastFrom: string | null;
}

export interface Poured {
  lines: number;
  qty: number | null;
  revenue: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

export interface HouseRecord {
  books: HouseBook[];
  firstSeen: string | null;
  /** Null means this book does not name it — never a zeroed block. */
  onMenu: OnMenu | null;
  bought: Bought | null;
  ordered: Ordered | null;
  quoted: Quoted | null;
  poured: Poured | null;
}

export interface CatalogueFacts {
  id: string;
  beverageType: string | null;
  country: string | null;
  region: string | null;
  abvPct: number | null;
  volumeMl: number | null;
  packageFormat: string | null;
  priceReference: number | null;
  /**
   * How this catalogue row was reached from the house's line. Null on a
   * catalogue-only row, which was never reached from anything.
   *
   * `exact`    — the same token multiset.
   * `contains` — every catalogue token appears in the house's line. Weaker, and
   *              every surface that renders a `contains` row says so.
   */
  matchedBy: "exact" | "contains" | null;
}

export interface RegisterRow {
  /**
   * Stable across a re-read: the catalogue id when there is one, otherwise the
   * house key. Never an array index — the register sorts and filters, and a
   * positional key would reattach a row's record to its neighbour.
   */
  key: string;
  name: string;
  producer: string | null;
  catalogue: CatalogueFacts | null;
  house: HouseRecord | null;
}

/** The shape `cellar-registers.service.ts` already uses, reused verbatim. */
export interface SourceStatus {
  readable: boolean;
  reason: string | null;
  rows: number | null;
}

export interface RegisterResult {
  restaurantId: string;
  register: RegisterId;
  rows: RegisterRow[];
  counts: {
    total: number;
    /** Rows this house's own books name. The register's real subject. */
    houseRows: number;
    /** …of those, how many reach a catalogue entry. */
    matched: number;
    /** …and by the weaker rule, reported apart so it can be shown apart. */
    matchedLoosely: number;
    /** Catalogue rows nobody in this house has touched. */
    catalogueOnly: number;
  };
  catalogue: SourceStatus & {
    truncated: boolean;
    limit: number;
    matchedTypes: string[];
    servedByThisTable: boolean;
  };
  house: SourceStatus & { truncated: boolean; limit: number };
  /**
   * Stocking, stated once and identically for every register. `available` is a
   * literal `false` rather than a boolean so a future build cannot flip it
   * without deleting the sentence beside it.
   */
  stocking: {
    available: false;
    decision: "OD-113";
    reason: string;
  };
  scopeNote: string;
}

export const STOCKING_WITHHELD =
  "Nothing in this register can be counted into the cellar yet. restaurant_inventory is keyed on master_wine_id → master_wine_library, so a keg, a bottle of rye and a case of cola have no stock row to write to. The identity axis that would give them one is OD-113 and is not decided, so adding to inventory is withheld rather than faked.";

/** One row of `house_beverage_ledger`, exactly as the RPC returns it. */
export interface LedgerRow {
  house_key: string;
  label: string | null;
  books: string[] | null;
  first_seen: string | null;
  menu_lines: number | null;
  menu_bottle_price: number | null;
  menu_glass_price: number | null;
  menu_sections: string[] | null;
  invoice_lines: number | null;
  first_bought: string | null;
  last_bought: string | null;
  bottles_bought: number | null;
  paid_total: number | null;
  last_unit_price: number | null;
  last_bought_from: string | null;
  order_lines: number | null;
  last_ordered_at: string | null;
  last_order_price: number | null;
  last_ordered_from: string | null;
  quote_count: number | null;
  last_quote_at: string | null;
  last_quote_price: number | null;
  last_quote_source: string | null;
  last_quote_from: string | null;
  pos_lines: number | null;
  poured_qty: number | null;
  poured_revenue: number | null;
  first_poured: string | null;
  last_poured: string | null;
  beverage_id: string | null;
  match_method: string | null;
}

/** One row of `public.beverages`, as the catalogue read selects it. */
export interface CatalogueRow {
  id: string;
  beverage_type: string | null;
  name: string;
  display_name: string | null;
  producer: string | null;
  country: string | null;
  region: string | null;
  abv_pct: number | null;
  volume_ml: number | null;
  package_format: string | null;
  price_reference: number | null;
}

/** A finite number, or null. Postgres numerics arrive over PostgREST as strings. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * A count from the ledger. `0` from SQL is a real zero (the book was read and
 * names it nowhere); `null` is the book being absent from the join. Both flow
 * through, and the *block* is dropped when the count is zero — so a bottle that
 * was never quoted has `quoted: null`, not `quoted: { count: 0 }`, and the
 * surface renders an em dash instead of a confident nought.
 */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

export function toHouseRecord(r: LedgerRow): HouseRecord {
  const books = (r.books ?? []).filter((b): b is HouseBook =>
    ["menu", "invoice", "order", "quote", "pos"].includes(b),
  );
  const menuLines = positive(r.menu_lines);
  const invoiceLines = positive(r.invoice_lines);
  const orderLines = positive(r.order_lines);
  const quotes = positive(r.quote_count);
  const posLines = positive(r.pos_lines);

  return {
    books,
    firstSeen: str(r.first_seen),
    onMenu:
      menuLines === null
        ? null
        : {
            lines: menuLines,
            bottlePrice: num(r.menu_bottle_price),
            glassPrice: num(r.menu_glass_price),
            sections: (r.menu_sections ?? []).filter(
              (s): s is string => typeof s === "string" && s.trim() !== "",
            ),
          },
    bought:
      invoiceLines === null
        ? null
        : {
            lines: invoiceLines,
            first: str(r.first_bought),
            last: str(r.last_bought),
            bottles: num(r.bottles_bought),
            // A paid total of 0 is not "free": it is an invoice whose line
            // total and unit price were both blank. Reported as unknown.
            paidTotal: positive(r.paid_total),
            lastUnitPrice: positive(r.last_unit_price),
            lastFrom: str(r.last_bought_from),
          },
    ordered:
      orderLines === null
        ? null
        : {
            lines: orderLines,
            lastAt: str(r.last_ordered_at),
            lastPrice: positive(r.last_order_price),
            lastFrom: str(r.last_ordered_from),
          },
    quoted:
      quotes === null
        ? null
        : {
            count: quotes,
            lastAt: str(r.last_quote_at),
            lastPrice: positive(r.last_quote_price),
            lastSource: str(r.last_quote_source),
            lastFrom: str(r.last_quote_from),
          },
    poured:
      posLines === null
        ? null
        : {
            lines: posLines,
            qty: positive(r.poured_qty),
            revenue: positive(r.poured_revenue),
            firstAt: str(r.first_poured),
            lastAt: str(r.last_poured),
          },
  };
}

/**
 * Which registers one house line belongs to.
 *
 * Two independent signals, unioned, and neither invented here:
 *
 *  - the words in the label and in its menu sections, through
 *    `registersForLabel` — the same word lists the register INFERENCE uses, so
 *    a house whose books say "Islay" gets whiskey in both places or in
 *    neither. There is no second vocabulary in this file.
 *  - the `beverage_type` of the catalogue row it matched, through
 *    `registersForBeverageType` — the stronger signal where it exists, because
 *    it is the catalogue's own classification rather than a word in a till
 *    label.
 *
 * A line that lands in NO register is not dropped: it is returned by
 * `unregistered()` so the surface can say how many of this house's own lines
 * this build cannot file, instead of silently shrinking the register.
 */
export function registersForHouseRow(
  label: string | null,
  sections: string[],
  catalogueType: string | null,
): RegisterId[] {
  const hit = new Set<RegisterId>();
  for (const id of registersForLabel(label)) hit.add(id);
  for (const s of sections) for (const id of registersForLabel(s)) hit.add(id);
  for (const id of registersForBeverageType(catalogueType)) hit.add(id);
  return REGISTER_IDS.filter((id) => hit.has(id));
}

export interface ComposeInput {
  restaurantId: string;
  register: RegisterId;
  ledger: LedgerRow[] | null;
  ledgerStatus: SourceStatus;
  ledgerTruncated: boolean;
  ledgerLimit: number;
  catalogue: CatalogueRow[] | null;
  catalogueStatus: SourceStatus;
  catalogueTruncated: boolean;
  catalogueLimit: number;
  matchedTypes: string[];
  servedByThisTable: boolean;
}

/**
 * Assemble one register: the house's own rows first, then the catalogue rows
 * nobody here has touched.
 *
 * The ORDER is the argument. An operator opening `/whiskey` is looking for the
 * bottles this house pours; the other 200 are reference. Sorting the two
 * together by name would bury the house's twelve rows among strangers' rows and
 * undo the whole point of the ledger.
 */
export function composeRegister(input: ComposeInput): RegisterResult {
  const byId = new Map<string, CatalogueRow>();
  for (const c of input.catalogue ?? []) byId.set(c.id, c);

  const rows: RegisterRow[] = [];
  const claimed = new Set<string>();
  let matched = 0;
  let matchedLoosely = 0;

  for (const r of input.ledger ?? []) {
    const cat = r.beverage_id ? (byId.get(r.beverage_id) ?? null) : null;
    // The catalogue read is filtered to THIS register, so a ledger row whose
    // match is not in it belongs to another register — that is the filter
    // working, not a missing row.
    const sections = (r.menu_sections ?? []).filter(
      (s): s is string => typeof s === "string",
    );
    const mine = registersForHouseRow(
      r.label,
      sections,
      cat?.beverage_type ?? null,
    );
    // A ledger row is in this register when its own words say so, OR when it
    // matched a catalogue row — `byId` holds only rows the catalogue read
    // already filtered to THIS register's `beverage_type` list, so a match is
    // itself the membership test. That second clause is why a till line
    // reading "MACALLAN 12" reaches `spirits` even though no word in it is a
    // spirits word, and it is the stronger of the two: the catalogue's own
    // classification beats a keyword in a label.
    if (!mine.includes(input.register) && cat === null) continue;

    const method =
      r.match_method === "exact" || r.match_method === "contains"
        ? r.match_method
        : null;
    if (cat) {
      claimed.add(cat.id);
      if (method === "exact") matched += 1;
      else if (method === "contains") matchedLoosely += 1;
    }

    rows.push({
      key: cat?.id ?? r.house_key,
      name: str(r.label) ?? cat?.display_name ?? cat?.name ?? "Untitled",
      producer: cat?.producer ?? null,
      catalogue: cat ? toCatalogueFacts(cat, method) : null,
      house: toHouseRecord(r),
    });
  }

  for (const c of input.catalogue ?? []) {
    if (claimed.has(c.id)) continue;
    rows.push({
      key: c.id,
      name: str(c.display_name) ?? c.name,
      producer: str(c.producer),
      catalogue: toCatalogueFacts(c, null),
      house: null,
    });
  }

  const houseRows = rows.filter((r) => r.house !== null).length;

  return {
    restaurantId: input.restaurantId,
    register: input.register,
    rows,
    counts: {
      total: rows.length,
      houseRows,
      matched,
      matchedLoosely,
      catalogueOnly: rows.length - houseRows,
    },
    catalogue: {
      ...input.catalogueStatus,
      truncated: input.catalogueTruncated,
      limit: input.catalogueLimit,
      matchedTypes: input.matchedTypes,
      servedByThisTable: input.servedByThisTable,
    },
    house: {
      ...input.ledgerStatus,
      truncated: input.ledgerTruncated,
      limit: input.ledgerLimit,
    },
    stocking: {
      available: false,
      decision: "OD-113",
      reason: STOCKING_WITHHELD,
    },
    scopeNote:
      "Rows with a record are this house's own, read from its menu, invoices, orders, quotes and till. Rows without one are the shared reference catalogue (public.beverages has no restaurant_id) and belong to nobody.",
  };
}

function toCatalogueFacts(
  c: CatalogueRow,
  matchedBy: "exact" | "contains" | null,
): CatalogueFacts {
  return {
    id: c.id,
    beverageType: str(c.beverage_type),
    country: str(c.country),
    region: str(c.region),
    abvPct: num(c.abv_pct),
    volumeMl: num(c.volume_ml),
    packageFormat: str(c.package_format),
    // The gateway's wine mapper turns a missing reference price into 0
    // (wines.service.ts `price_reference ?? 0`); this one does not repeat that
    // — 0 here means the catalogue recorded no price, and says so as null.
    priceReference: positive(c.price_reference),
    matchedBy,
  };
}

/**
 * The house's own lines that no register in the seven can hold.
 *
 * Reported rather than dropped, for the same reason `unmappedKinds` is: a house
 * with 40 lines this build cannot file is a fact the founder should see, and a
 * register that quietly returns fewer rows than the books contain is the
 * absence-reported-as-health fault wearing a filter.
 */
export function unregistered(
  ledger: LedgerRow[],
  catalogueTypeById: Map<string, string | null>,
): { label: string; books: string[] }[] {
  const out: { label: string; books: string[] }[] = [];
  for (const r of ledger) {
    const sections = (r.menu_sections ?? []).filter(
      (s): s is string => typeof s === "string",
    );
    const type = r.beverage_id
      ? (catalogueTypeById.get(r.beverage_id) ?? null)
      : null;
    if (registersForHouseRow(r.label, sections, type).length === 0) {
      out.push({ label: r.label ?? r.house_key, books: r.books ?? [] });
    }
  }
  return out;
}
