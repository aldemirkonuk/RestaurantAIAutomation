/**
 * Read a per-good VIEW whole, page by page, or throw.
 *
 * `readWholeWindow` (ADR 0292) pages on `id`, and the three views /inventory
 * joins onto its list (`inventory_lot_rollup`, `inventory_location_breakdown`,
 * `inventory_analytics`) have no `id`: they are keyed by `inventory_id`, and
 * the location breakdown by `inventory_id` and `location_id`. Each one was
 * read with one unranged `select`, so PostgREST's `max_rows` (1,000,
 * `supabase/config.toml:18`) cut it short without a word. A house holding its
 * goods in three places reached that cap at about 333 goods, and zone names
 * were the first thing to vanish (QA round 2, H-1).
 *
 * This pages by offset over a TOTAL order the caller names (every column of
 * the view's key), asks for an exact count on every page, and throws when:
 *   - any page answers with an error,
 *   - the count moves between pages (a row landed or left mid-read, so an
 *     offset may have skipped or repeated one),
 *   - a page holds more rows than asked, or the rows in hand at the end do not
 *     equal the count.
 * It never returns a prefix. The callers keep their own catch, so a view that
 * cannot be read whole is handled exactly as one that cannot be read at all.
 */

/** PostgREST's `max_rows` (supabase/config.toml:18). A page never holds more. */
export const VIEW_PAGE = 1000;

export interface ViewPage {
  data: unknown[] | null;
  error: { message?: string; code?: string } | null;
  count?: number | null;
}

export interface ViewQuery extends PromiseLike<ViewPage> {
  order(column: string, options: { ascending: boolean }): ViewQuery;
  range(from: number, to: number): ViewQuery;
}

export class ViewReadError extends Error {
  constructor(what: string, detail: string) {
    super(`${what} could not be read whole: ${detail}`);
    this.name = "ViewReadError";
  }
}

export async function readViewWhole<T = any>(
  what: string,
  build: () => ViewQuery,
  orderBy: string[],
  pageSize: number = VIEW_PAGE,
): Promise<T[]> {
  if (orderBy.length === 0) {
    throw new ViewReadError(what, "no order was named to page by");
  }
  const rows: T[] = [];
  let total: number | null = null;
  let size = Math.max(1, Math.trunc(pageSize));
  for (let page = 0; ; page++) {
    let q = build();
    for (const column of orderBy) q = q.order(column, { ascending: true });
    // The offset is the rows already in hand, so a server that answers fewer
    // rows than asked (its cap below ours) is followed, never skipped past.
    const from = rows.length;
    const { data, error, count } = await q.range(from, from + size - 1);
    if (error) {
      throw new ViewReadError(
        what,
        `page ${page + 1}: ${error.code ?? "?"} ${error.message ?? String(error)}`,
      );
    }
    if (!Array.isArray(data)) {
      throw new ViewReadError(
        what,
        `page ${page + 1} carried no rows and no error`,
      );
    }
    if (typeof count !== "number" || !Number.isFinite(count)) {
      throw new ViewReadError(what, `page ${page + 1} reported no count`);
    }
    if (data.length > size) {
      throw new ViewReadError(
        what,
        `page ${page + 1} held ${data.length} rows against ${size} asked`,
      );
    }
    if (total === null) total = count;
    else if (count !== total) {
      throw new ViewReadError(
        what,
        `it held ${total} rows when the read began and ${count} by page ${page + 1}`,
      );
    }
    rows.push(...(data as T[]));
    if (rows.length >= total) break;
    if (data.length === 0) {
      throw new ViewReadError(
        what,
        `page ${page + 1} was empty with ${total - rows.length} rows still counted`,
      );
    }
    if (data.length < size) size = data.length;
  }
  if (rows.length !== total) {
    throw new ViewReadError(
      what,
      `${rows.length} rows read against ${total} counted`,
    );
  }
  return rows;
}
