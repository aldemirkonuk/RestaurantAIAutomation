import { ServiceUnavailableException } from "@nestjs/common";

/**
 * What a delivered order cost, or that its cost is not known.
 *
 * `procurement_orders` carries two money columns: `total_cost` (what the
 * order came to) and `final_price` (the price settled for it). Either can be
 * NULL on an order nobody has costed yet, and `0` is not a cost anyone
 * recorded: no supplier delivers a case for nothing. The readers used to write
 * `o.total_cost || o.final_price || 0`, so an uncosted order joined every
 * purchasing total as $0. A "keep purchases under $25k" goal then read lower
 * than the truth and could read as met (ADR 0020: a smaller number is not a
 * smaller truth, it is a wrong one).
 *
 * The rule, the same one `AnalyticsService.loadDeliveredOrders` already keeps
 * for the financial summary: a recorded figure above 0, `total_cost` first,
 * else `null`. A total that would rest on a `null` is refused, never summed
 * short.
 */
export function orderCostOrNull(o: {
  total_cost?: unknown;
  final_price?: unknown;
}): number | null {
  return positive(o?.total_cost) ?? positive(o?.final_price);
}

function positive(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

const orders = (n: number) => `${n} delivered order${n === 1 ? "" : "s"}`;

/**
 * The currency an order was placed in (`procurement_orders.currency`): an
 * ISO 4217 code, or null when the order names none.
 */
export function orderCurrency(o: { currency?: unknown }): string | null {
  const c = o?.currency;
  if (typeof c !== "string") return null;
  const code = c.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Whether any of these orders names its currency (so the house's is needed). */
export function anyOrderNamesCurrency(
  rows: Array<{ currency?: unknown }>,
): boolean {
  return rows.some((o) => orderCurrency(o) !== null);
}

/**
 * The currency an order's figure is in when it is NOT the house's own, else
 * null. An order that names no currency is read as the house's: it was placed
 * by the house before an order carried its money (the column has no backfill,
 * by design), and every reader has always printed it in the house's money.
 * With no house currency named, an order that names one is not in it.
 */
export function orderInOtherMoney(
  o: { currency?: unknown },
  house: string | null,
): string | null {
  const code = orderCurrency(o);
  return code !== null && code !== house ? code : null;
}

/**
 * What a delivered order cost IN THE HOUSE'S MONEY, or null: no recorded
 * cost, or a cost in another currency. Nothing here converts one money into
 * another, so an order in euros is not a lira figure, and a lira total that
 * held it would mix two monies; one that dropped it would be short. A total
 * that would rest on a `null` is withheld, as for an uncosted order.
 */
export function orderHouseCostOrNull(
  o: { total_cost?: unknown; final_price?: unknown; currency?: unknown },
  house: string | null,
): number | null {
  return orderInOtherMoney(o, house) !== null ? null : orderCostOrNull(o);
}

/** Orders in another currency, counted by code: `{ EUR: 2, USD: 1 }`. */
export type OtherMoneyCounts = Readonly<Record<string, number>>;

/** Count the orders in money other than `house`, by their code. */
export function otherMoneyOf(
  rows: Array<{ currency?: unknown }>,
  house: string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of rows) {
    const code = orderInOtherMoney(o, house);
    if (code) out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

const countOf = (m: OtherMoneyCounts) =>
  Object.values(m).reduce((a, b) => a + b, 0);

/** "2 in EUR and 1 in USD", most first. */
function otherMoneyList(m: OtherMoneyCounts): string {
  const parts = Object.entries(m)
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([code, n]) => `${n} in ${code}`);
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Why a purchasing total over `total` delivered orders is not summed, in the
 * house's words, or null when it can be. `house` is the house's currency
 * (null: not named); `houseUnread` says the house's currency could not be
 * read, so no order that names one can be placed.
 */
export function unsummedOrdersSentence(
  uncosted: number,
  total: number,
  otherMoney: OtherMoneyCounts = {},
  house: string | null = null,
  houseUnread = false,
): string | null {
  const other = countOf(otherMoney);
  if (uncosted <= 0 && other <= 0) return null;
  const parts: string[] = [];
  if (other > 0) {
    const verb = other === 1 ? "is" : "are";
    const which = other === 1 ? "that order" : "those orders";
    parts.push(
      houseUnread
        ? `${other} of the ${orders(total)} in this window ${verb} placed in a named currency (${otherMoneyList(otherMoney)}), and the house's own currency could not be read, so it cannot be said whether ${which} ${verb} in house currency.`
        : house === null
          ? `${other} of the ${orders(total)} in this window ${verb} not in house currency (${otherMoneyList(otherMoney)}): the house has not named its currency in Settings, and nothing here converts one currency into another.`
          : `${other} of the ${orders(total)} in this window ${verb} not in house currency (${otherMoneyList(otherMoney)}; the house keeps ${house}), and nothing here converts one currency into another, so a total would mix two monies or leave ${which} out.`,
    );
  }
  if (uncosted > 0) {
    parts.push(
      other > 0
        ? `${uncosted} ${uncosted === 1 ? "carries" : "carry"} no recorded cost; record what ${uncosted === 1 ? "that order" : "those orders"} cost to read it.`
        : `${uncosted} of the ${orders(total)} in this window ${uncosted === 1 ? "carries" : "carry"} no recorded cost, so a total would be short rather than true. Record what ${uncosted === 1 ? "that order" : "those orders"} cost to read it.`,
    );
  }
  return `Purchasing spend could not be summed: ${parts.join(" ")}`;
}

/**
 * A purchasing total that would rest on an order whose cost is not known in
 * the house's money: no recorded cost, or a cost in another currency
 * (`otherMoney`, by code). The goal reads "could not be read" with this
 * sentence (`GoalsService.listGoalsWithProgress`), as a bottles goal does
 * with `UncountedConsumptionError`.
 */
export class UncostedOrdersError extends Error {
  constructor(
    readonly uncosted: number,
    readonly total: number,
    readonly otherMoney: OtherMoneyCounts = {},
    readonly house: string | null = null,
  ) {
    super(unsummedOrdersSentence(uncosted, total, otherMoney, house) ?? "");
    this.name = "UncostedOrdersError";
  }
}

/**
 * The house's currency could not be read while orders in the window name
 * theirs, so no reader can say which of them are in house currency. Refused,
 * never summed as if all were. A 503, as a window that could not be read
 * whole is (`WholeReadError`).
 */
export class HouseMoneyUnreadError extends ServiceUnavailableException {
  constructor(readonly readFailure?: unknown) {
    super(
      "Purchasing spend could not be summed: the house's currency could not be read, so it cannot be said which orders are in house currency.",
    );
    this.name = "HouseMoneyUnreadError";
  }
}
