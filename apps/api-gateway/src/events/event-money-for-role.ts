import { holdsHouseMoney } from "../procurement/documents/document-money-gate";

/**
 * WHAT AN EVENT'S PAYLOAD CARRIES TO A ROLE THAT DOES NOT HOLD THE HOUSE'S
 * MONEY (F-1065).
 *
 * `events.payload` is open-ended: the gateway writes some of it (an order
 * change carries the order's `totalCost`) and any signed-in page may post the
 * rest (`POST /events`; a wine update may carry a `price`). `GET /events` and
 * the `event:new` socket handed every payload to every member of the house,
 * so staff read each order's total there after the order reads stopped
 * sending it (F-433, F-958). The founder's rule (ADR 0145, the F-957..F-959
 * call): staff see no house money, and the gateway stops sending it.
 *
 * A payload has no fixed shape, so this cannot be an allowlist the way
 * `orderForRole` is. It is a strip list by key NAME, applied at every depth:
 * any key that names a cost, a price, an amount, revenue, spend, a margin, a
 * profit or a total of money is left out. The keys are OMITTED, never nulled,
 * and the reader is told `amountsWithheld: true`.
 */
const MONEY_KEY =
  /cost|price|amount|revenue|spend|margin|profit|^(sub)?total$|^value$|^previousvalue$/i;

/** True for a payload key that names money. */
export function isMoneyKey(key: string): boolean {
  return MONEY_KEY.test(key);
}

function strip(value: unknown): { kept: unknown; cut: boolean } {
  if (Array.isArray(value)) {
    let cut = false;
    const kept = value.map((v) => {
      const r = strip(v);
      cut = cut || r.cut;
      return r.kept;
    });
    return { kept, cut };
  }
  if (value && typeof value === "object") {
    let cut = false;
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isMoneyKey(k)) {
        cut = true;
        continue;
      }
      const r = strip(v);
      cut = cut || r.cut;
      kept[k] = r.kept;
    }
    return { kept, cut };
  }
  return { kept: value, cut: false };
}

/** A payload with every money key left out, and whether any was. */
export function payloadWithoutMoney<T>(payload: T): {
  payload: T;
  cut: boolean;
} {
  const r = strip(payload);
  return { payload: r.kept as T, cut: r.cut };
}

/** One event as this role may read it. */
export function eventForRole<E extends { payload: Record<string, any> }>(
  event: E,
  role: string | null | undefined,
): E & { amountsWithheld?: true } {
  if (holdsHouseMoney(role)) return event;
  const { payload, cut } = payloadWithoutMoney(event.payload);
  if (!cut) return event;
  return { ...event, payload, amountsWithheld: true };
}
