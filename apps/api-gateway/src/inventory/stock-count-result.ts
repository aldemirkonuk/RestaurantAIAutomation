/**
 * The shape of a recorded physical count (ADR 0078 — a count is a record).
 *
 * Shared by the two paths that commit a count (`InventoryService.recordSpotCount`
 * and `InventoryLedgerService.reconcileInventory`) so they cannot describe the
 * same `record_stock_count` RPC differently.
 *
 * `transactionId: null` means the count AGREED and nothing had to move. That is
 * a result, not missing data — and it is precisely the outcome the ledger was
 * structurally unable to represent: `set_stock_absolute` returns NULL on a zero
 * delta and `inventory_transactions` CHECKs `quantity_change <> 0`, so before
 * this every recorded count had disagreed and any variance rate over them was
 * 1.0 by construction.
 */
/**
 * F-1514, ADR 0335 §2: the `stock_counts.source` an opening count is kept
 * under. The opening count is the first count variance is measured from, so
 * the month close leaves it out of the month's count variance. 'import' is an
 * existing `inventory_transaction_source` value (the movement carries it too),
 * and no other path writes a count with it.
 */
export const OPENING_COUNT_SOURCE = "import";

export interface StockCountRecord {
  countId: string | null;
  /** What the lots said, read under the same lock the delta was computed from. */
  expectedQty: number | null;
  countedQty: number | null;
  /** counted - expected. 0 is the recorded, meaningful case. */
  varianceQty: number | null;
  /** The movement this count caused, or null when there was nothing to correct. */
  transactionId: string | null;
  countedAt: string | null;
  /** True when this request replayed an already-recorded count (same key). */
  replayed: boolean;
  /**
   * F-1524: present only when an opening count named a cost per bottle. True
   * when the wine had no live costed lot and took it; false when it already
   * had a cost, which is kept.
   */
  costApplied?: boolean;
  /**
   * F-1544 lane 2: present only when the count named open ml or a stock-take,
   * so a spot count's answer keeps exactly the keys it had. Open figures are
   * integer ml (ADR 0070), null when the open bottles were not counted.
   */
  expectedOpenMl?: number | null;
  countedOpenMl?: number | null;
  varianceOpenMl?: number | null;
  sessionId?: string | null;
  /**
   * True when this line was a second count of the same item on the same
   * shelf in the same stock-take: it was kept for the manager and moved
   * nothing (founder 2026-10-12, F2 a). `countId` is then null.
   */
  held?: boolean;
  heldLineId?: string | null;
}

/**
 * ADR 0297's stand-in: a bottle whose size the item does not state is read as
 * 750 ml, the size record_glass_pour already assumes for it.
 */
export const STAND_IN_BOTTLE_ML = 750;

/**
 * F-1660: a count act (a line, a park, a shelf done) taken after a manager
 * stopped or signed off the count is refused. One taken before it still lands
 * whenever it arrives -- an offline act is never dropped for arriving late
 * (ADR 0241). `at` is when the act was taken (its countedAgoMs, or now).
 * Returns the refusal's words, or null when the act may land. An ended count
 * with no end time on record cannot show the act came first, so it refuses.
 */
export function countEndedBefore(
  session: {
    status?: string | null;
    signed_off_at?: string | null;
    abandoned_at?: string | null;
  },
  at: Date,
): string | null {
  if (!session.status || session.status === "open") return null;
  const stopped = session.status === "abandoned";
  const endIso = stopped ? session.abandoned_at : session.signed_off_at;
  const end = endIso ? Date.parse(endIso) : NaN;
  if (Number.isFinite(end) && at.getTime() <= end) return null;
  return stopped
    ? "This count was stopped before this was counted, so nothing was saved."
    : "This count was signed off before this was counted, so nothing was saved.";
}

/**
 * F-1544 lane 2 (F3 a): staff say what is left in the open bottles in tenths
 * of a bottle -- 7 is seven tenths of one bottle, 13 is one and three tenths
 * across the open bottles of that item on that shelf -- and the one count
 * writer stores integer ml. Null when the input is not a whole number of
 * tenths at or above nothing.
 */
export function openTenthsToMl(
  tenths: unknown,
  bottleSizeMl: number | null | undefined,
): number | null {
  const t = Number(tenths);
  if (tenths === null || tenths === "" || !Number.isInteger(t) || t < 0) {
    return null;
  }
  const size =
    Number.isFinite(Number(bottleSizeMl)) && Number(bottleSizeMl) > 0
      ? Number(bottleSizeMl)
      : STAND_IN_BOTTLE_ML;
  return Math.round((t * size) / 10);
}

/**
 * A stock-take is a blind count, and what the books expected is the house's
 * figure, not the counter's (DASH-G6): a line's answer to anyone who does not
 * hold the house's money keeps what they counted and drops what the books
 * said and the difference.
 */
export function blindCountForStaff(
  count: StockCountRecord | null,
): StockCountRecord | null {
  if (!count) return count;
  return {
    ...count,
    expectedQty: null,
    varianceQty: null,
    ...("expectedOpenMl" in count
      ? { expectedOpenMl: null, varianceOpenMl: null }
      : {}),
  };
}

/**
 * Map `record_stock_count`'s jsonb return to the API shape.
 *
 * Returns `null` only when the RPC returned nothing at all — which the callers
 * treat as a hard error rather than as "no count", because a successful RPC
 * always returns an object. Never invents fields: a missing key stays null.
 */
export function mapStockCountResult(raw: unknown): StockCountRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  const str = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v);

  return {
    countId: str(r.count_id),
    expectedQty: num(r.expected_qty),
    countedQty: num(r.counted_qty),
    varianceQty: num(r.variance_qty),
    transactionId: str(r.transaction_id),
    countedAt: str(r.counted_at),
    replayed: r.replayed === true,
    ...(typeof r.cost_applied === "boolean"
      ? { costApplied: r.cost_applied }
      : {}),
    // F-1544 lane 2: only when the writer said them (a walk's line or an
    // open-bottle count), so a spot count maps to exactly what it did.
    ...("held" in r
      ? {
          expectedOpenMl: num(r.expected_open_ml),
          countedOpenMl: num(r.counted_open_ml),
          varianceOpenMl: num(r.variance_open_ml),
          sessionId: str(r.session_id),
          held: r.held === true,
          ...(r.held === true ? { heldLineId: str(r.held_line_id) } : {}),
        }
      : {}),
  };
}
