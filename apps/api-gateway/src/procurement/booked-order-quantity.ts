import { ServiceUnavailableException } from "@nestjs/common";

/** Receipts are immutable bottle movements; the order's display cache is not. */
export async function readBookedOrderBottles(
  db: any,
  restaurantId: string,
  orderId: string,
  inventoryId: string,
  excludeDoorReceipts = false,
): Promise<number> {
  return (
    await readBookedOrderLedger(
      db,
      restaurantId,
      orderId,
      inventoryId,
      excludeDoorReceipts,
    )
  ).bottles;
}

/**
 * The same read, also saying how many movements it summed.
 *
 * `movements` only ever grows: the ledger is append-only, so every correction
 * that lands adds a row. `verifyReceipt` keys its correction on it (F-464), so
 * two requests that read the same ledger state share one key and the second is
 * a no-op, while a later verification reads a longer ledger and gets its own.
 */
export async function readBookedOrderLedger(
  db: any,
  restaurantId: string,
  orderId: string,
  inventoryId: string,
  excludeDoorReceipts = false,
): Promise<{ bottles: number; movements: number }> {
  const pageSize = 500;
  let total = 0;
  let movements = 0;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from("inventory_transactions")
      .select("id, quantity_change, idempotency_key")
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("inventory_id", inventoryId)
      .eq("stock_type", "live")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data)) {
      throw new ServiceUnavailableException(
        "The stock already booked for this order could not be read. No receipt correction was made; try again when its ledger is available.",
      );
    }
    for (const row of data) {
      if (
        excludeDoorReceipts &&
        String(row.idempotency_key ?? "").startsWith("door-receipt:")
      )
        continue;
      const quantity = Number(row.quantity_change);
      if (row.quantity_change == null || !Number.isSafeInteger(quantity)) {
        throw new ServiceUnavailableException(
          "This order's ledger contains an unreadable bottle quantity. No receipt correction was made.",
        );
      }
      total += quantity;
      movements++;
    }
    if (data.length < pageSize) break;
  }
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new ServiceUnavailableException(
      "This order's booked bottle total could not be reconciled. No receipt correction was made.",
    );
  }
  return { bottles: total, movements };
}
