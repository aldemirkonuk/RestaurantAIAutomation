import { orderCostOrNull, UncostedOrdersError } from "../analytics/order-cost";

/**
 * A bucket's spend: the whole sum of its recorded order costs, or null with how
 * many orders carry none and why (ADR 0020). A recorded 0 is no recorded cost.
 */
export interface BucketSpend {
  spend: number | null;
  /** Orders in the bucket with no recorded cost. */
  uncosted: number;
  /** Why `spend` is null; null when it is a figure. */
  unread: string | null;
}

export function bucketSpend(
  orders: Array<{ total_cost?: unknown; final_price?: unknown }>,
): BucketSpend {
  let sum = 0;
  let uncosted = 0;
  for (const o of orders) {
    const cost = orderCostOrNull(o);
    if (cost === null) uncosted += 1;
    else sum += cost;
  }
  if (uncosted > 0) {
    return {
      spend: null,
      uncosted,
      unread: new UncostedOrdersError(uncosted, orders.length).message,
    };
  }
  return { spend: sum, uncosted: 0, unread: null };
}

/** The summary when the orders could not be read: no figure and why, never $0. */
export const SPEND_UNREAD = {
  totalProcurementSpend: null,
  monthlyProcurementSpend: null,
  uncostedOrders: { total: 0, thisMonth: 0 },
  unread: {
    totalProcurementSpend: "Purchasing spend could not be read just now.",
    monthlyProcurementSpend: "Purchasing spend could not be read just now.",
  },
};
