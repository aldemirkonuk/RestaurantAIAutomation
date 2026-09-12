/**
 * THE RECORD BEHIND ONE ROW — the series a cellar column can open.
 *
 * The fourth pass asked for this in the founder's words: *"Let us see insights
 * and details when double clicked/right clicked on columns to see their data
 * graphs or research … order ledgers maybe when clicked on paid."*
 *
 * WHY THIS IS NOT THE REGISTER READ AGAIN
 * ---------------------------------------
 * `readRegister` returns one AGGREGATE per product — first bought, paid total,
 * poured qty, last quote. An aggregate cannot be graphed and cannot be audited:
 * "we have paid ₺4,120 for this" is a number you either believe or do not.
 * This read returns the LINES those aggregates were made of, in time order, so
 * the same figure can be drawn as a series and read as a ledger. Bloomberg has
 * kept exactly this pair since the terminal shipped — `GP <GO>` graphs a
 * security's history and `HP <GO>` tables the same series
 * (https://libguides.cbs.dk/gp_function_bloomberg,
 * https://businesslibrary.uflib.ufl.edu/c.php?g=114612&p=746558) — and the
 * cellar panel draws both from this one response rather than choosing for the
 * operator.
 *
 * THE FIVE BOOKS, AND WHAT EACH ONE CAN AND CANNOT SAY
 * ---------------------------------------------------
 *   menu     `menu_items`                 what we list, and charge. A state, not
 *                                         a series — rendered as a ledger only.
 *   invoice  `procurement_document_lines` what we were CHARGED, and when. The
 *                                         only book that supports "paid".
 *   order    `procurement_order_items`    what we ASKED for. Not the same claim.
 *   quote    `vendor_price_observations`  who quoted it, off which source.
 *   pos      `pos_unresolved_lines`       what we actually SOLD, line by line.
 *
 * MEASURED, 2026-09-03, against the live database this gateway is pointed at
 * (`exzueerziesmczwlhomd`): `procurement_document_lines` holds 0 rows in the
 * WHOLE database and `vendor_price_observations` holds 0, while
 * `pos_unresolved_lines` holds 39 rows for the demo tenant alone. So the two
 * books the founder named by name — paid, and the price history — are empty
 * TODAY, and the one book nobody named is the one with a real series in it.
 * That is reported per book (`readable` / `rows` / `reason`), never as an empty
 * chart: an empty chart says "the price never moved", which is a claim about
 * the vendor. "No invoice line names this bottle" is a claim about our books,
 * and it is the true one.
 *
 * HOW A LINE IS MATCHED TO A ROW, AND WHY IT IS THE WEAKER RULE
 * ------------------------------------------------------------
 * `house_beverage_ledger` groups the five books by
 * `public.beverage_house_key` — a sorted token multiset, deliberately a
 * REPORTING key (migration `20260903120000_the_house_s_own_record.sql:40-60`).
 * That function is SQL and is NOT on every database this gateway meets: it is
 * absent from the one measured above, which is why the register's house half
 * currently renders `readable: false`.
 *
 * This read therefore does NOT reimplement the tokenizer in TypeScript — a
 * second implementation of an identity rule is a second identity rule, and the
 * migration's own comment forbids substituting for `identity_key`. It uses a
 * plainer, weaker, stated rule instead:
 *
 *   `exact`    — the line's label equals the row's label, case- and
 *                whitespace-insensitively.
 *   `contains` — the row's label appears inside the line's label.
 *
 * and every response carries `matchRule` in words so the surface can say which
 * one found the line. Weaker than the ledger's rule, honest about being so, and
 * — unlike the ledger — it answers on a database that has not run the
 * migration yet.
 */

/** The five books, in the order a house reads them. */
export const ROW_RECORD_BOOKS = [
  "menu",
  "invoice",
  "order",
  "quote",
  "pos",
] as const;
export type RowRecordBook = (typeof ROW_RECORD_BOOKS)[number];

/**
 * Which column of the register opens which book. The register's own column
 * vocabulary lives in the browser (`cellar/next/cellar-columns.ts`); this map
 * is the gateway's half of the same contract, so a column can never open a
 * book the gateway does not serve.
 */
export const COLUMN_BOOK: Record<string, RowRecordBook> = {
  listed: "menu",
  first: "invoice",
  paid: "invoice",
  ordered: "order",
  quote: "quote",
  sold: "pos",
  charged: "pos",
};

export interface SeriesPoint {
  /** ISO instant or date. Never invented: a line with no date is not a point. */
  at: string;
  value: number;
  /** `money` or `count` — what the axis is, decided here rather than guessed. */
  unit: "money" | "count";
}

export interface LedgerEntry {
  at: string | null;
  /** The line's own label, as the book recorded it. */
  label: string;
  /** Who, where the book names anyone. */
  who: string | null;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  /** A book-specific word: the invoice's vendor, the quote's source type… */
  note: string | null;
  /** How this line was reached from the row. */
  matchedBy: "exact" | "contains";
}

export interface BookRecord {
  book: RowRecordBook;
  readable: boolean;
  /** Null when readable and non-empty. Words, never an empty array's silence. */
  reason: string | null;
  rows: number | null;
  /** The money series, where the book carries a price. */
  price: SeriesPoint[];
  /** The quantity series, where the book carries one. */
  quantity: SeriesPoint[];
  ledger: LedgerEntry[];
  /** Which table this came from, named so the claim is checkable. */
  source: string;
}

export interface RowRecord {
  restaurantId: string;
  label: string;
  matchRule: string;
  books: BookRecord[];
  /** Books that named the row at all. The five-mark strip, per-line this time. */
  named: RowRecordBook[];
  /** The whole read's own sentence when nothing anywhere names the row. */
  nothingNamesIt: boolean;
}

export const ROW_RECORD_MATCH_RULE =
  "A line belongs to this row when its label is the same words (exact), or contains this row's label inside a longer till or invoice line (loose). This is a weaker rule than the register's own — that one folds producer and name into a sorted token multiset in SQL (beverage_house_key) — and it is used here because it answers on a database that has not run migration 20260903120000 yet. Every line below says which of the two rules found it.";

/** A finite number, or null. Postgres numerics arrive over PostgREST as strings. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Case- and whitespace-insensitive, and nothing more clever than that. */
export function fold(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Does this line belong to this row? Returns HOW, or null.
 *
 * A one-character row label would "contain" its way into most of the till, so
 * containment is refused below four characters — a rule with a stated floor
 * rather than a rule that quietly matches everything for a short label.
 */
export function matchLine(
  rowLabel: string,
  lineLabel: string | null,
): "exact" | "contains" | null {
  const row = fold(rowLabel);
  const line = lineLabel === null ? "" : fold(lineLabel);
  if (row === "" || line === "") return null;
  if (row === line) return "exact";
  if (row.length >= 4 && line.includes(row)) return "contains";
  return null;
}

/** A book nobody could read. The reason is the caller's, never invented here. */
export function unreadableBook(
  book: RowRecordBook,
  source: string,
  reason: string,
): BookRecord {
  return {
    book,
    readable: false,
    reason,
    rows: null,
    price: [],
    quantity: [],
    ledger: [],
    source,
  };
}

/**
 * A book that was read and named the row nowhere. Distinct from unreadable,
 * and the sentence says which — the whole point of ADR 0020.
 */
export function emptyBook(
  book: RowRecordBook,
  source: string,
  reason: string,
): BookRecord {
  return {
    book,
    readable: true,
    reason,
    rows: 0,
    price: [],
    quantity: [],
    ledger: [],
    source,
  };
}

function byTime(a: SeriesPoint, z: SeriesPoint): number {
  return Date.parse(a.at) - Date.parse(z.at);
}

/**
 * Turn matched lines into a book's record. Points are only made from a line
 * that carries BOTH a date and a value — a dateless line stays in the ledger
 * and never becomes a point at an invented instant.
 */
export function composeBook(input: {
  book: RowRecordBook;
  source: string;
  ledger: LedgerEntry[];
  emptyReason: string;
}): BookRecord {
  const { book, source, ledger, emptyReason } = input;
  if (ledger.length === 0) return emptyBook(book, source, emptyReason);

  const price: SeriesPoint[] = [];
  const quantity: SeriesPoint[] = [];
  for (const e of ledger) {
    if (e.at === null || Number.isNaN(Date.parse(e.at))) continue;
    if (e.unitPrice !== null) {
      price.push({ at: e.at, value: e.unitPrice, unit: "money" });
    }
    if (e.qty !== null) {
      quantity.push({ at: e.at, value: e.qty, unit: "count" });
    }
  }
  price.sort(byTime);
  quantity.sort(byTime);

  return {
    book,
    readable: true,
    reason: null,
    rows: ledger.length,
    price,
    quantity,
    ledger: [...ledger].sort((a, z) => {
      if (a.at === null && z.at === null) return 0;
      if (a.at === null) return 1;
      if (z.at === null) return -1;
      return Date.parse(z.at) - Date.parse(a.at); // newest first, as a ledger reads
    }),
    source,
  };
}

export function composeRowRecord(input: {
  restaurantId: string;
  label: string;
  books: BookRecord[];
}): RowRecord {
  const { restaurantId, label, books } = input;
  const named = books
    .filter((b) => b.readable && (b.rows ?? 0) > 0)
    .map((b) => b.book);
  return {
    restaurantId,
    label,
    matchRule: ROW_RECORD_MATCH_RULE,
    books,
    named,
    // Only claimable when every book was actually readable. A row whose books
    // could not be read is not a row nothing names.
    nothingNamesIt: named.length === 0 && books.every((b) => b.readable),
  };
}
