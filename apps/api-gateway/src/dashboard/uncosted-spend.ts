import {
  anyOrderNamesCurrency,
  orderHouseCostOrNull,
  otherMoneyOf,
  unsummedOrdersSentence,
} from "../analytics/order-cost";

/**
 * The house's money as a spend reader needs it: its ISO code (null: the house
 * has not named one), or `unread` when the house's currency could not be read
 * while an order in the read names its own.
 */
export interface SpendHouse {
  code: string | null;
  unread: boolean;
}

/** No order names a currency, so the house's own was not needed. */
export const HOUSE_NOT_NEEDED: SpendHouse = { code: null, unread: false };

/**
 * A bucket's spend: the whole sum of its recorded order costs in the house's
 * money, or null with why (ADR 0020). A recorded 0 is no recorded cost. An
 * order in another currency is not summed into the house's figure and not
 * converted: it withholds the figure and is counted by its code, the rule the
 * reports keep (`order-cost.ts`, `orderHouseCostOrNull`). An order that names
 * no currency is the house's.
 */
export interface BucketSpend {
  spend: number | null;
  /** Orders in the house's money with no recorded cost. */
  uncosted: number;
  /** Orders not in the house's money, by code: `{ EUR: 1 }`. */
  notInHouseCurrency: Record<string, number>;
  /** Why `spend` is null; null when it is a figure. */
  unread: string | null;
}

export function bucketSpend(
  orders: Array<{ total_cost?: unknown; final_price?: unknown; currency?: unknown }>,
  house: SpendHouse,
): BucketSpend {
  // With the house's currency unread, every order that names one is unplaced:
  // counted against no house (`otherMoneyOf(rows, null)`), never assumed in.
  const otherMoney = otherMoneyOf(orders, house.unread ? null : house.code);
  let sum = 0;
  let unsummed = 0;
  for (const o of orders) {
    const cost = orderHouseCostOrNull(o, house.unread ? null : house.code);
    if (cost === null) unsummed += 1;
    else sum += cost;
  }
  const other = Object.values(otherMoney).reduce((a, b) => a + b, 0);
  const uncosted = unsummed - other;
  if (unsummed > 0) {
    return {
      spend: null,
      uncosted,
      notInHouseCurrency: otherMoney,
      unread: unsummedOrdersSentence(
        uncosted,
        orders.length,
        otherMoney,
        house.code,
        house.unread,
      ),
    };
  }
  return { spend: sum, uncosted: 0, notInHouseCurrency: {}, unread: null };
}

/**
 * The house's money for these orders. It is read only when one of them names
 * a currency: an order that names none is the house's, so no read is needed.
 * A failed read is `unread` (each figure it touches is withheld with the
 * reason), never a guess that every order is the house's.
 */
export async function spendHouseFor(
  client: any,
  restaurantId: string,
  orders: Array<{ currency?: unknown }>,
): Promise<SpendHouse> {
  if (!anyOrderNamesCurrency(orders)) return HOUSE_NOT_NEEDED;
  try {
    const { data, error } = await client
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .limit(1);
    if (error) return { code: null, unread: true };
    const code = (data?.[0] as { currency?: unknown } | undefined)?.currency;
    return {
      code: typeof code === "string" && /^[A-Z]{3}$/.test(code) ? code : null,
      unread: false,
    };
  } catch {
    return { code: null, unread: true };
  }
}

/** The summary when the orders could not be read: no figure and why, never $0. */
export const SPEND_UNREAD = {
  totalProcurementSpend: null,
  monthlyProcurementSpend: null,
  uncostedOrders: { total: 0, thisMonth: 0 },
  notInHouseCurrency: { total: {}, thisMonth: {} },
  unread: {
    totalProcurementSpend: "Purchasing spend could not be read just now.",
    monthlyProcurementSpend: "Purchasing spend could not be read just now.",
  },
};
