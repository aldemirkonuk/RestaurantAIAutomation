import { WHOLE_READ_PAGE, WholeReadError } from "./read-whole-window";

/**
 * Read the rows that belong to a known list of ids, in batches, whole or
 * refused (the ADR 0292 rule, for a view `readWholeWindow` cannot page).
 *
 * WHY NOT `readWholeWindow`
 * -------------------------
 * Keyset paging needs one column that is unique per row. `inventory_lot_rollup`
 * has none: it groups lots by `(inventory_id, restaurant_id, master_wine_id)`,
 * `inventory_lots.inventory_id` is nullable, and nothing ties a lot's wine to
 * its inventory row's. Paged on `inventory_id`, one stray lot would refuse the
 * house's whole cellar ("row came back twice"), and a null key would refuse it
 * too. The callers only ever look a rollup row up by an inventory id they
 * already hold, so they ask for exactly those ids instead.
 *
 * THE RULE
 * --------
 *   * The ids are de-duplicated and asked for `chunk` at a time, with
 *     `.in(<column>, batch)` inside `build`. A hundred UUIDs keep each request
 *     URL near 4 KB.
 *   * Any batch's error refuses (`read_failed`). No figure is made from the
 *     batches already in hand.
 *   * A batch that comes back holding PostgREST's cap (`WHOLE_READ_PAGE`) may
 *     have been cut there, so it refuses (`row_ceiling`) rather than trusting
 *     it. A hundred ids would need ten rollup rows each to reach it.
 *   * No ids, no request: an empty cellar reads as an empty list.
 */

/** Ids per request. */
export const BY_IDS_CHUNK = 100;

/** Batches in flight at once. */
const IN_FLIGHT = 4;

export interface ByIdsPage {
  data: unknown[] | null;
  error: { message?: string; code?: string } | null;
}

export async function readByIds<T = any>(
  what: string,
  ids: readonly string[],
  build: (batch: string[]) => PromiseLike<ByIdsPage>,
  chunk = BY_IDS_CHUNK,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter((id) => !!id)));
  const size = Math.max(1, Math.trunc(chunk));
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += size)
    batches.push(unique.slice(i, i + size));

  const out: T[] = [];
  for (let i = 0; i < batches.length; i += IN_FLIGHT) {
    const wave = batches.slice(i, i + IN_FLIGHT);
    const answers = await Promise.all(wave.map((b) => build(b)));
    answers.forEach((a, k) => {
      const n = i + k + 1;
      if (a?.error) {
        throw new WholeReadError(
          what,
          "read_failed",
          out.length,
          null,
          `batch ${n} of ${batches.length}: ${a.error.code ?? "?"} ${a.error.message ?? String(a.error)}`,
        );
      }
      if (!Array.isArray(a?.data)) {
        throw new WholeReadError(
          what,
          "malformed_page",
          out.length,
          null,
          `batch ${n} of ${batches.length} carried no rows and no error`,
        );
      }
      if (a.data.length >= WHOLE_READ_PAGE) {
        throw new WholeReadError(
          what,
          "row_ceiling",
          out.length,
          null,
          `batch ${n} of ${batches.length} came back holding ${a.data.length} rows, the server's cap, so it may have been cut`,
        );
      }
      out.push(...(a.data as T[]));
    });
  }
  return out;
}
