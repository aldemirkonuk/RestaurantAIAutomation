import { currencyCode } from "../common/iso-4217";

/**
 * Which money a menu's price is in, and whether the house may take it as its
 * own (r36 menu audit N1, 2026-11-13).
 *
 * A menu line's price used to be taken as the house's money whatever the menu
 * printed: an Antalya house whose menu prints "€12" got 12 as its own bottle
 * price in lira on Inventory, and every margin built on it was wrong, with
 * nothing on any screen saying so. The house-currency rule
 * (20260905120000_a_house_names_its_money.sql) is that every recorded price
 * carries its own currency and nothing converts. This file applies it to a
 * menu:
 *
 *   - a price whose printed money is the house's, or that prints no money at
 *     all, is the house's price (a bare "12" on a Turkish menu is lira);
 *   - when the menu prints the line in several monies ("₺450 / €12"), the
 *     column in the house's money is taken;
 *   - a price printed only in another money is HELD: no price is taken from
 *     the line, and the line says why. The house's own price stands. It is
 *     never converted, because there is no rate anywhere in this system;
 *   - a house that has not named its money takes the price as read, as
 *     before: there is nothing to compare it with, and holding every price of
 *     such a house would empty its menu.
 *
 * A mark like "$" names a family, not one money (USD, CAD, AUD, MXN all print
 * it), so it is held only when the house's money is not in that family.
 */

const DOLLAR_SIGN = [
  "USD", "CAD", "AUD", "NZD", "SGD", "HKD", "TWD", "MXN", "ARS", "CLP", "COP",
  "CUP", "DOP", "UYU", "BSD", "BBD", "BZD", "BMD", "BND", "KYD", "FJD", "GYD",
  "JMD", "LRD", "NAD", "SBD", "SRD", "TTD", "XCD",
];
const POUND_SIGN = ["GBP", "EGP", "LBP", "SYP", "SSP", "SDG", "FKP", "GIP", "SHP"];
const YEN_SIGN = ["JPY", "CNY"];

/** Marks a menu prints, and the monies each could mean. Matched whole, case-insensitive. */
const MARKS: ReadonlyArray<[string, readonly string[]]> = [
  ["₺", ["TRY"]],
  ["TL", ["TRY"]],
  ["YTL", ["TRY"]],
  ["€", ["EUR"]],
  ["£", POUND_SIGN],
  ["US$", ["USD"]],
  ["$", DOLLAR_SIGN],
  ["¥", YEN_SIGN],
  ["₹", ["INR"]],
  ["₽", ["RUB"]],
  ["₴", ["UAH"]],
  ["₾", ["GEL"]],
  ["₪", ["ILS"]],
  ["zł", ["PLN"]],
  ["Kč", ["CZK"]],
  ["Ft", ["HUF"]],
];

/**
 * The monies a printed mark or code could name, or null when it names none
 * this file knows. An ISO 4217 code names itself ("eur" too). A word nobody
 * can read as money is null: the line is then read as printing no money,
 * which is how it was read before.
 */
export function moneyOfMark(mark: unknown): readonly string[] | null {
  if (typeof mark !== "string") return null;
  const text = mark.trim();
  if (text === "") return null;
  const code = currencyCode(text);
  if (code) return [code];
  const hit = MARKS.find(([m]) => m.toLowerCase() === text.toLowerCase());
  return hit ? hit[1] : null;
}

/**
 * The mark a typed price starts or ends with, as typed, or null. "45 TL",
 * "€12", "12 EUR", "₺ 1 250". Only a mark at either end counts: a mark in the
 * middle is not a price at all and parseMenuPrice refuses it.
 */
export function typedMark(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, "");
  const lead = /^(US\$|YTL|TL|zł|Kč|Ft|[₺$€£¥₹₽₴₾₪]|[A-Za-z]{3}(?=\d))/i.exec(s);
  if (lead) return lead[1];
  const tail = /(?:\d)(US\$|YTL|TL|zł|Kč|Ft|[₺$€£¥₹₽₴₾₪]|[A-Za-z]{3})$/i.exec(s);
  return tail ? tail[1] : null;
}

/** The monies a typed price's mark could name, or null when it names none. */
export function typedMoneyOf(raw: unknown): readonly string[] | null {
  const mark = typedMark(raw);
  return mark === null ? null : moneyOfMark(mark);
}

/** A printed price, or null when it is not a usable number. */
function amount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** One printed column of a line: its money and its two prices. */
interface PricedColumn {
  mark: string | null;
  glass: number | null;
  bottle: number | null;
}

function columnsOf(item: Record<string, unknown>): PricedColumn[] {
  const first: PricedColumn = {
    mark: typeof item.currency === "string" ? item.currency : null,
    glass: amount(item.by_glass_price),
    bottle: amount(item.bottle_price),
  };
  const also = Array.isArray(item.also_priced) ? item.also_priced : [];
  const more = also
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      mark: typeof c.currency === "string" ? c.currency : null,
      glass: amount(c.by_glass_price),
      bottle: amount(c.bottle_price),
    }));
  return [first, ...more];
}

/** Whether a line names any money at all, so the house's money is worth reading. */
export function namesMoney(item: Record<string, unknown>): boolean {
  return columnsOf(item).some((c) => moneyOfMark(c.mark) !== null);
}

/** What the house takes from one line's prices. */
export type LineMoney =
  /** The prices as read: in the house's money, or no money printed, or the house names none. */
  | { kind: "as_read" }
  /** Another printed column was in the house's money; these are its prices. */
  | { kind: "house_column"; glass: number | null; bottle: number | null }
  /** No column is in the house's money: no price is taken, and the line says why. */
  | { kind: "held"; note: string };

function printed(c: PricedColumn): string {
  const mark = c.mark ?? "";
  const code = moneyOfMark(mark);
  const label = code && code.length === 1 ? code[0] : mark;
  const parts: string[] = [];
  if (c.bottle !== null) parts.push(`${c.bottle.toFixed(2)} ${label} a bottle`);
  if (c.glass !== null) parts.push(`${c.glass.toFixed(2)} ${label} a glass`);
  return parts.join(" and ");
}

/**
 * The house's take on one read line.
 *
 * `house` is the house's own money (restaurants.currency), null when the house
 * has not named it; `houseUnreadable` is the reason the house's money could
 * not be read, when it could not.
 */
export function lineMoney(
  item: Record<string, unknown>,
  house: string | null,
  houseUnreadable: string | null = null,
): LineMoney {
  const columns = columnsOf(item);
  const first = columns[0];
  const firstMoney = moneyOfMark(first.mark);
  // No money printed beside the line's own prices, or no price to hold.
  if (firstMoney === null || (first.glass === null && first.bottle === null)) return { kind: "as_read" };
  if (houseUnreadable !== null) {
    return {
      kind: "held",
      note:
        `The menu prints this line at ${printed(first)}, and this house's own money could not be read (${houseUnreadable}). ` +
        `No price was taken from this line, so the house's own price for it stands. A manager can set one on Inventory, under Your price.`,
    };
  }
  if (house === null) return { kind: "as_read" };
  if (firstMoney.includes(house)) return { kind: "as_read" };
  const other = columns
    .slice(1)
    .find((c) => (moneyOfMark(c.mark) ?? []).includes(house) && (c.glass !== null || c.bottle !== null));
  if (other) return { kind: "house_column", glass: other.glass, bottle: other.bottle };
  return {
    kind: "held",
    note:
      `The menu prints this line at ${printed(first)}, and this house's money is ${house}. ` +
      `Nothing converts between currencies, so no price was taken from this line, and the house's own price for it stands. ` +
      `A manager can set one on Inventory, under Your price.`,
  };
}

/**
 * Why a typed price may not be the house's, or null when it may. A typed
 * price with no mark, or with the house's own mark, is the house's. One whose
 * mark names another money is refused: it would be stored as a number in the
 * house's money. A house that names no money takes the number, as before.
 */
export function typedMoneyRefusal(raw: unknown, house: string | null): string | null {
  const mark = typedMark(raw);
  if (mark === null || house === null) return null;
  const money = moneyOfMark(mark);
  if (money === null || money.includes(house)) return null;
  const named = money.length === 1 ? money[0] : `"${mark}"`;
  return `"${String(raw).trim()}" is in ${named}, and this house's money is ${house}. Nothing converts between currencies: type the price in ${house}. Nothing was changed.`;
}
