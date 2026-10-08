import { Logger, ServiceUnavailableException } from "@nestjs/common";

/**
 * Read a window of rows WHOLE, page by page, or refuse (ADR 0292).
 *
 * WHY THIS EXISTS
 * ---------------
 * PostgREST stops every response at `max_rows` (1000, `supabase/config.toml:18`;
 * production answers the same, measured on 10 responses at exactly 1,000 in the
 * 2026-10-03 analytics walk). It does not say so: the response is a 200 with a
 * thousand rows in it. An unranged `select` over `pos_checks` or
 * `wine_consumption_log` was therefore a SAMPLE wearing the name of a total.
 * The 90-day till counted 1,000 of 3,313 checks ($187k against $626k), "Who
 * served it" ranked the floor on 29.6% of its takings, and menu engineering
 * saw 752 of about 8,445 units (F-131 / C15; A-004, A-005, A-006, A-031,
 * A-032, A-033). A smaller number is not a smaller truth here, it is a wrong
 * one, which is ADR 0020's fault in its plainest form.
 *
 * THE RULE
 * --------
 * The window comes back whole, in `id` order, or this throws `WholeReadError`.
 * It never returns a prefix.
 *
 *   * Keyset paging on the primary key: page 0 is `order(id).limit(n)`, every
 *     later page adds `.gt("id", <last id>)`. Offsets would skip or repeat rows
 *     when a check lands or is voided mid-read; a key cursor does not.
 *   * `build()` is a FACTORY. A supabase-js builder is a single-use thenable,
 *     so every page needs a fresh one carrying the reader's own filters. Its
 *     `select` must project `id` and ask for `{ count: "exact" }`, and it must
 *     not order, limit or range: this file owns all three, and a reader's own
 *     `.order()` would sort AHEAD of `id`, so the cursor would skip rows.
 *     ADR 0292's guard, `scripts/check_window_reads_are_whole.py`, checks all
 *     of it at every call site; it ships in its own PR, after this helper.
 *   * The exact count is what proves the read whole. Page 0's count is the
 *     window's size. A later page's count is what is left past the cursor, so
 *     it must equal the size minus the rows already read; when it does not, a
 *     row landed or left mid-read, the read starts once more from the top, and
 *     a second disagreement refuses (`unstable`). At the end the distinct ids
 *     must equal the size.
 *   * Page checks (the ADR 0269 idiom): no page longer than asked, no id twice
 *     (`cursor_stalled`), every row carries an id while the count is being
 *     proved and every page that continues carries one to page from.
 *   * A count past `ceiling` refuses (`row_ceiling`) before a second page is
 *     asked for: a total from part of a window is the fault this exists to
 *     stop, so past the ceiling the honest answer is "too large to read", not
 *     the first hundred thousand rows.
 *   * A Supabase error on ANY page refuses (`read_failed`), never answering
 *     from the pages already in hand.
 *   * When page 0 comes back shorter than asked while the count says more
 *     remain, the server's cap is lower than ours, and its page size is
 *     adopted for the rest of the read.
 *
 * WHAT IT CANNOT SEE
 * ------------------
 *   * With NO count reported (test doubles only: every reader asks for
 *     `count: "exact"`), a short page ends the read. A server cap lowered
 *     below the page size AND a count dropped from the response together would
 *     pass unseen.
 *   * The read is not one snapshot. A row changed behind the cursor after it
 *     was read is reported as it was when read; one inserted and one removed
 *     past the cursor between two pages cancel in the count.
 *
 * The rows come back in `id` order. No reader depends on order: every one
 * buckets or sums.
 */

/** PostgREST's `max_rows` (supabase/config.toml:18). A page never holds more. */
export const WHOLE_READ_PAGE = 1000;

/**
 * The most rows one window read will hold before it refuses. Measured volume
 * on the one real house (Tuzlu Rüzgar, 2026-10-03): about 58 checks and 131
 * consumption lines a day, so the 365-day ribbon reads about 21.5k checks and a
 * year of consumption about 48k lines. 100,000 is about 4.6 times the check
 * year and about twice the consumption year.
 */
export const WHOLE_READ_CEILING = 100_000;

export type WholeReadReason =
  /** The database answered a page with an error. */
  | "read_failed"
  /** The window holds more rows than the ceiling. */
  | "row_ceiling"
  /** The count moved while the window was read, twice in a row. */
  | "unstable"
  /** A row came back twice, or the count said rows remained and none came. */
  | "cursor_stalled"
  /** A page longer than asked, rows without an id, or no data and no error. */
  | "malformed_page";

const REASON_WORDS: Record<WholeReadReason, string> = {
  read_failed: "the database refused one of its pages",
  row_ceiling: "the window holds more rows than one read may hold",
  unstable: "rows landed or left while it was being read, twice running",
  cursor_stalled: "the pages stopped advancing through the window",
  malformed_page:
    "a page came back in a shape that cannot prove the read whole",
};

/**
 * A window that could not be read whole. A `ServiceUnavailableException`, so a
 * route that lets it through answers 503 with the sentence, never a figure
 * from part of the window.
 */
export class WholeReadError extends ServiceUnavailableException {
  constructor(
    readonly what: string,
    readonly reason: WholeReadReason,
    /** Rows in hand when the read refused. Never returned to the caller. */
    readonly rowsRead: number,
    /** The window's size as page 0 counted it; null when no count came. */
    readonly count: number | null,
    readonly detail: string,
  ) {
    super(
      `${what} could not be read whole: ${REASON_WORDS[reason]} (${detail}). ` +
        "Nothing is reported from part of it.",
    );
    this.name = "WholeReadError";
  }
}

/** One page's answer, as supabase-js resolves it. */
export interface WholeWindowPage {
  data: unknown[] | null;
  error: { message?: string; code?: string } | null;
  count?: number | null;
}

/** The three builder steps this file adds to the reader's own filters. */
export interface WholeWindowQuery extends PromiseLike<WholeWindowPage> {
  order(column: string, options: { ascending: boolean }): WholeWindowQuery;
  gt(column: string, value: string): WholeWindowQuery;
  limit(count: number): WholeWindowQuery;
}

export interface WholeWindowOptions {
  /** Rows asked for per page. Defaults to `WHOLE_READ_PAGE`. */
  pageSize?: number;
  /** Rows past which the read refuses. Defaults to `WHOLE_READ_CEILING`. */
  ceiling?: number;
}

const logger = new Logger("readWholeWindow");

type Attempt<T> =
  | { ok: true; rows: T[] }
  | { ok: false; error: WholeReadError };

export async function readWholeWindow<T = any>(
  what: string,
  build: () => WholeWindowQuery,
  options: WholeWindowOptions = {},
): Promise<T[]> {
  const first = await readOnce<T>(what, build, options);
  if (first.ok) return first.rows;
  if (first.error.reason !== "unstable") throw first.error;
  logger.warn(`${what}: ${first.error.detail}; reading the window again once`);
  const second = await readOnce<T>(what, build, options);
  if (second.ok) return second.rows;
  logger.error(second.error.message);
  throw second.error;
}

async function readOnce<T>(
  what: string,
  build: () => WholeWindowQuery,
  options: WholeWindowOptions,
): Promise<Attempt<T>> {
  let size = Math.max(1, Math.trunc(options.pageSize ?? WHOLE_READ_PAGE));
  const ceiling = options.ceiling ?? WHOLE_READ_CEILING;
  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let cursor: string | null = null;

  for (let page = 0; ; page++) {
    const refuse = (reason: WholeReadReason, detail: string): Attempt<T> => ({
      ok: false,
      error: new WholeReadError(what, reason, rows.length, total, detail),
    });

    let q = build().order("id", { ascending: true });
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error, count } = await q.limit(size);

    if (error) {
      return refuse(
        "read_failed",
        `page ${page + 1}: ${error.code ?? "?"} ${error.message ?? String(error)}`,
      );
    }
    if (!Array.isArray(data)) {
      return refuse(
        "malformed_page",
        `page ${page + 1} carried no rows and no error`,
      );
    }
    if (data.length > size) {
      return refuse(
        "malformed_page",
        `page ${page + 1} held ${data.length} rows against ${size} asked`,
      );
    }

    const counted = typeof count === "number" && Number.isFinite(count);
    if (page === 0) {
      if (counted) total = count as number;
      if (total !== null && total > ceiling) {
        return refuse(
          "row_ceiling",
          `the window holds ${total} rows against a ceiling of ${ceiling}`,
        );
      }
    } else if (total !== null) {
      // The count on a later page is what is left PAST the cursor, so a
      // window that held still says exactly "the size less what is read".
      if (!counted) {
        return refuse("unstable", `page ${page + 1} stopped reporting a count`);
      }
      const remaining = total - rows.length;
      if (count !== remaining) {
        return refuse(
          "unstable",
          `the window held ${total} rows when the read began and ` +
            `${rows.length + (count as number)} by page ${page + 1}`,
        );
      }
    }
    if (counted && data.length > (count as number)) {
      return refuse(
        "malformed_page",
        `page ${page + 1} held ${data.length} rows against a count of ${count}`,
      );
    }

    let missingId = false;
    for (const row of data) {
      const id = (row as { id?: unknown } | null)?.id;
      if (id === null || id === undefined || id === "") {
        missingId = true;
        continue;
      }
      const key = String(id);
      if (seen.has(key)) {
        return refuse("cursor_stalled", `row ${key} came back twice`);
      }
      seen.add(key);
    }
    rows.push(...(data as T[]));

    if (rows.length > ceiling) {
      return refuse(
        "row_ceiling",
        `more than ${ceiling} rows came back with no count to bound them`,
      );
    }

    let more: boolean;
    if (total !== null) {
      if (missingId) {
        return refuse(
          "malformed_page",
          `page ${page + 1} held rows with no id, so the count cannot be met`,
        );
      }
      if (data.length === 0 && rows.length < total) {
        return refuse(
          "cursor_stalled",
          `page ${page + 1} was empty with ${total - rows.length} rows still counted`,
        );
      }
      more = rows.length < total;
      // A short page while rows remain: the server's cap is below ours.
      if (more && data.length < size) size = data.length;
    } else {
      // No count (test doubles only): a short page is the last one.
      more = data.length > 0 && data.length === size;
    }

    if (!more) break;
    if (missingId) {
      return refuse(
        "malformed_page",
        `full page ${page + 1} held rows with no id to page from`,
      );
    }
    cursor = String((data[data.length - 1] as { id: unknown }).id);
  }

  if (total !== null && (seen.size !== total || rows.length !== total)) {
    return {
      ok: false,
      error: new WholeReadError(
        what,
        "unstable",
        rows.length,
        total,
        `${seen.size} distinct rows read against ${total} counted`,
      ),
    };
  }
  return { ok: true, rows };
}
