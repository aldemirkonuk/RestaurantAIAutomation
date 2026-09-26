import { ServiceUnavailableException } from "@nestjs/common";

/** Receipts are immutable bottle movements; the order's display cache is not. */
export async function readBookedOrderBottles(
  db: any,
  restaurantId: string,
  orderId: string,
  inventoryId: string,
  excludeDoorReceipts = false,
): Promise<number> {
  const pageSize = 500;
  let total = 0;
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
    }
    if (data.length < pageSize) break;
  }
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new ServiceUnavailableException(
      "This order's booked bottle total could not be reconciled. No receipt correction was made.",
    );
  }
  return total;
}
