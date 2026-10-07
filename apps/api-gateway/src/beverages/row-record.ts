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
 *   pos      `pos_checks.items` +         what we actually SOLD, line by line.
 *            `pos_unresolved_lines`      Every line of every check not voided,
 *                                        wine or not, mapped or not, plus the
 *                                        queued lines no check holds, through
 *                                        house_till_lines (ADR 0301 §1).
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
 *
 * CHANGED a_till_name_with_a_serve_size_joins_its_row (ADR 0301, the
 * founder's ruling of 2026-10-05): the TILL book no longer uses this rule. It
 * reads the names the ledger itself counts on the row
 * (`house_till_names(p_restaurant_id, p_label)`), so the record lists exactly
 * the till lines the row's Sold cell sums: a till name joins the row whose key
 * it equals (`exact`), else the row with the most words among those whose
 * every word it holds (`contains`), and a name level between two rows joins
 * neither. The menu, invoice, order and quote books keep the rule above.
 *
 * CHANGED the same migration (ADR 0301, the founder's answers of 2026-10-06):
 * F1 "Also match without maker": a name that holds no row's every word joins
 * by the row's name without its maker, under the same rules; the ledger says
 * 'without_maker', and this record shows it as `contains` (loose), which it
 * is. F2 "List tied names on the row": the names that tied on the row come
 * back as 'tie'; the till book lists them in `tied` and never reads their
 * lines, so the record still lists exactly the lines the Sold cell sums.
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
  /**
   * The till book only, once it was read: the till names that hold this
   * row's words and another row's equally, so they count on neither (a tie;
   * ADR 0301, F2 of 2026-10-06, "List tied names on the row"). Listed so the
   * owner sees why the row's Sold is short; never in `ledger`, `rows` or a
   * series, and their lines are not read.
   */
  tied?: TiedTillName[];
  /**
   * ADDED (ADR 0301, the #650 BLOCK's Finding 2, 2026-10-07). The till book
   * only, when it counts no line and no name tied on it: whether the till
   * holds a name that contains this row's name by `matchLine` (case- and
   * spacing-insensitive). True: it does, and that name counts on another row
   * or on none. False: no till name does. Null: the till's names could not be
   * read. Absent on a book `readTillLines` did not build that way, which then
   * makes no claim either way.
   * [CHANGED 2026-10-07, the audit of aa5b5ce19: null also when the row's
   * label is shorter than `CONTAINS_FLOOR` and no till name equals it, since
   * `matchLine` then never looks inside a longer name ('Gin' beside 'Gin
   * Tonic'). False was said there, and could be untrue.]
   */
  holdsLabel?: boolean | null;
}

/** A till name that tied on a row: what the till calls it, and its lines. */
export interface TiedTillName {
  /** Trimmed to show. */
  name: string;
  /** How many lines the till holds under the name; null when not said. */
  lines: number | null;
}

/**
 * The tied names a ledger or `house_till_names` read returned, in its order:
 * each `{item_name, lines}` whose name is text. Anything else is dropped,
 * never shown as a blank name.
 */
export function tiedTillNames(v: unknown): TiedTillName[] {
  if (!Array.isArray(v)) return [];
  const out: TiedTillName[] = [];
  for (const e of v) {
    if (e === null || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const name = str(r.item_name);
    if (name === null) continue;
    out.push({ name, lines: num(r.lines) });
  }
  return out;
}

/** Each tied name with its lines, as the owner reads it: 'A' (2 lines). */
function tiedList(tied: TiedTillName[]): string {
  return tied
    .map((t) =>
      t.lines === null
        ? `'${t.name}'`
        : `'${t.name}' (${t.lines} ${t.lines === 1 ? "line" : "lines"})`,
    )
    .join(", ");
}

/** "One till name holds" / "3 till names hold", and what is counted. */
function tiedClause(tied: TiedTillName[]): string {
  const one = tied.length === 1;
  return `${one ? "One till name holds" : `${tied.length} till names hold`} this row's words and another row's equally, so ${
    one ? "its lines are" : "their lines are"
  } counted on neither: ${tiedList(tied)}.`;
}

/**
 * Why a till book whose only names tied has no line of its own: the names,
 * each with its lines, and that they count on neither row.
 */
export function tiedReason(tied: TiedTillName[]): string {
  return `No till line is counted on this row. ${tiedClause(tied)} A menu name that tells the two rows apart can let each name count on one row.`;
}

/**
 * ADDED (ADR 0301, the #650 BLOCK's Finding 2, 2026-10-07): why a till book
 * with no counted and no tied name is empty, by what the till holds. Each
 * says only what `readTillLines` checked: the names the register counts on
 * this row, and whether any till name contains this row's name
 * (`matchLine`). Never "the till has not rung this up": a till name the
 * register counts on another row may be this very product.
 */
export const TILL_HOLDS_THE_NAME_ELSEWHERE =
  "No till line is counted on this row. The till holds a name that contains this row's name (ignoring case and spacing), but the register counts that name on another row or on none, and this record lists only the lines this row's Sold counts.";

export const TILL_HOLDS_NO_SUCH_NAME =
  "No till line is counted on this row, and no till name contains this row's name (ignoring case and spacing). Every line of every check that was not voided (pos_checks.items) was read, with the queued lines no check holds.";

export function tillNamesUnreadReason(message: string): string {
  return `No till line is counted on this row. Whether the till holds a name that contains this row's name could not be read: ${message}`;
}

/**
 * The shortest folded row label `matchLine` looks for inside a longer line.
 * A shorter one matches only a line equal to it. Declared here, above the
 * reason that names it, since that string is built when the module loads.
 */
export const CONTAINS_FLOOR = 4;

/**
 * ADDED (ADR 0301, the audit of aa5b5ce19, 2026-10-07): a row label shorter
 * than `CONTAINS_FLOOR`, which `matchLine` matches only to a till name equal
 * to it. When none is equal, a longer name may still contain it ('Gin' in
 * 'Gin Tonic'), and this record did not look, so it says neither yes nor no.
 * TILL_HOLDS_NO_SUCH_NAME was said here, and was false for 'Gin' beside
 * 'Gin Tonic'.
 */
export const TILL_NAME_TOO_SHORT_TO_SEARCH = `No till line is counted on this row, and no till name is this row's name (ignoring case and spacing). Whether a longer till name contains it was not checked: this record looks for a name shorter than ${CONTAINS_FLOOR} characters only as a whole till name.`;

/**
 * The same names for a till book that does count lines, said under the match
 * rule (the record's last sentence), since the book's own reason is only
 * shown when it has no line.
 */
export function tiedNote(tied: TiedTillName[]): string {
  return `On this row's till book: ${tiedClause(tied)}`;
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
  "A menu, invoice, order or quote line belongs to this row when its label is the same words (exact), or contains this row's label inside a longer line (loose). This is a weaker rule than the register's own — that one folds producer and name into a sorted token multiset in SQL (beverage_house_key) — and it is used here because it answers on a database that has not run migration 20260903120000 yet. A till line belongs to this row by the register's own rule, the one its Sold cell counts by. Menu rows come first: an invoice, order or quote row takes only a till name that no menu row contains, by the menu row's every word or by its name without the maker. Among the rows that may take it, a name joins the row whose words it has exactly (exact), else the row with the most product words among those whose every word it holds; size words (a number with a volume unit, such as '70cl') decide only between rows level on product words (loose). A name that holds no menu row's every word tries the menu rows' names without their makers, under the same rule (loose); one that reaches no menu row and holds no other row's every word tries the order rows' names without their makers (loose). A name that holds two rows' words equally belongs to neither, and is named on each row's record without its lines. Every line below says which of the two found it.";

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
 * containment is refused below four characters (`CONTAINS_FLOOR`) — a rule
 * with a stated floor rather than a rule that quietly matches everything for
 * a short label.
 */
export function matchLine(
  rowLabel: string,
  lineLabel: string | null,
): "exact" | "contains" | null {
  const row = fold(rowLabel);
  const line = lineLabel === null ? "" : fold(lineLabel);
  if (row === "" || line === "") return null;
  if (row === line) return "exact";
  if (row.length >= CONTAINS_FLOOR && line.includes(row)) return "contains";
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
  // The till names that tied on this row (ADR 0301, F2 of 2026-10-06). A
  // till book with no line already names them in its reason; one that counts
  // lines names them here, so the record lists them either way.
  const till = books.find((b) => b.book === "pos");
  const tiedHere =
    till !== undefined &&
    till.readable &&
    (till.rows ?? 0) > 0 &&
    till.tied !== undefined &&
    till.tied.length > 0
      ? ` ${tiedNote(till.tied)}`
      : "";
  return {
    restaurantId,
    label,
    matchRule: ROW_RECORD_MATCH_RULE + tiedHere,
    books,
    named,
    // Only claimable when every book was actually readable. A row whose books
    // could not be read is not a row nothing names.
    // CHANGED (ADR 0301, the #650 BLOCK's Finding 2, 2026-10-07): nor while
    // the till book lists names that tied on this row, holds a name that
    // contains this row's name (`holdsLabel` true), or could not say whether
    // it does (null).
    nothingNamesIt:
      named.length === 0 &&
      books.every((b) => b.readable) &&
      (till === undefined ||
        ((till.tied === undefined || till.tied.length === 0) &&
          till.holdsLabel !== true &&
          till.holdsLabel !== null)),
  };
}
