import type { HouseCurrency } from "@/api/types";
import { currencyCode } from "@/lib/invoiceMatch";

const fmt = (n: number, digits: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits });

/**
 * Money in the house's currency. A currency sign is a claim about the amount,
 * so this never prints "$" or defaults to USD (ADR 0117 Q25):
 *  - `undefined` (not read yet): the bare number, which claims no currency;
 *  - `null` / `readable: false` (the read failed): says it could not be read;
 *  - a valid ISO code: "TRY 1,240";
 *  - no code stated: says it is not recorded.
 */
export function houseMoney(
  amount: number,
  house: HouseCurrency | null | undefined,
  digits = 0,
): string {
  const n = fmt(amount, digits);
  if (house === undefined) return n;
  if (house === null || house.readable === false) return `${n} (currency could not be read)`;
  const code = currencyCode(house.code);
  return code ? `${code} ${n}` : `${n} (currency not recorded)`;
}

/**
 * Money on an order, in the order's own currency. Never falls back to the
 * house currency: an order may be in another currency than the house.
 */
export function orderMoney(
  amount: number,
  currency: string | null | undefined,
  digits = 0,
): string {
  const n = fmt(amount, digits);
  const code = currencyCode(currency);
  return code ? `${code} ${n}` : `${n} (currency not stated)`;
}
