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
  };
}
