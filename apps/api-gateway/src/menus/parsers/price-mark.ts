import { currencyCode } from "../../common/iso-4217";

/**
 * The money a menu FILE names for a price (r40, r36 menu audit N1 for CSV and
 * Excel menus).
 *
 * A spreadsheet's price was read as a bare number: `readMenuPrice("€12")` is
 * 12, and a header "Şişe Fiyatı (EUR)" lost its "(EUR)" with the brackets
 * (`headerKey`). In a lira house that 12 became the house's bottle price in
 * lira, with nothing on any screen saying the file was priced in euros.
 *
 * This file only NAMES the money, as written: it never converts and never
 * decides whether the house may take the price. That is `menu-money.ts`
 * (`lineMoney`, #1543), which reads `currency` and `also_priced` on every
 * import, whatever read the line. A mark this file cannot place is not a
 * money ("12 cl", "(kadeh)"), and the price is read as before.
 */

/** Marks that name exactly one money. `$`, `£` and `¥` name a family, so they are not here. */
const ONE_MONEY: Record<string, string> = {
  "₺": "TRY",
  tl: "TRY",
  ytl: "TRY",
  "€": "EUR",
  "us$": "USD",
  "₹": "INR",
  "₽": "RUB",
  "₴": "UAH",
  "₾": "GEL",
  "₪": "ILS",
  zł: "PLN",
  kč: "CZK",
  ft: "HUF",
};
/** Marks that name a family of monies (USD, CAD, AUD… all print `$`). */
const FAMILY = new Set(["$", "£", "¥"]);

/** Whether `text` names a money: a mark this file knows, or a real ISO 4217 code. */
export function isMoneyMark(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t === "") return false;
  return t.toLowerCase() in ONE_MONEY || FAMILY.has(t) || currencyCode(t) !== null;
}

/** The one money a mark names, or null when it names a family ("$") or none. */
export function oneMoneyOf(mark: string | null | undefined): string | null {
  if (!mark) return null;
  const t = mark.trim();
  return currencyCode(t) ?? ONE_MONEY[t.toLowerCase()] ?? null;
}

/**
 * Two marks are different monies only when each names exactly one and they
 * differ: "TL" and "₺" are one money, "€" and "TL" are two, and "$" and
 * "USD" may be one, so they are never split apart.
 */
export function differentMoney(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = oneMoneyOf(a);
  const y = oneMoneyOf(b);
  return x !== null && y !== null && x !== y;
}

const MARK = "US\\$|YTL|TL|zł|Kč|Ft|[₺$€£¥₹₽₴₾₪]|[A-Za-z]{3}";
const LEAD = new RegExp(`^(${MARK})(?=\\d)`, "i");
const TAIL = new RegExp(`\\d(${MARK})$`, "i");

/**
 * The money mark a price cell starts or ends with, as written: "€12",
 * "45,50 TL", "12 EUR", "₺ 1.250". null when the cell names none, or when
 * what it starts or ends with is not a money ("12cl" has no mark it knows).
 */
export function cellMoneyMark(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, "");
  const hit = LEAD.exec(s)?.[1] ?? TAIL.exec(s)?.[1] ?? null;
  return isMoneyMark(hit) ? hit : null;
}

/**
 * The money a header names: in brackets ("Şişe Fiyatı (TL)", "Bottle [EUR]")
 * or by a mark anywhere in it ("Price €"). A bracket that names no money
 * ("Fiyat (kadeh)") is passed over. null when the header names none.
 */
export function headerMoneyMark(header: unknown): string | null {
  const h = String(header ?? "");
  for (const m of h.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)) {
    const inside = (m[1] ?? m[2] ?? "").trim();
    if (isMoneyMark(inside)) return inside;
  }
  const mark = /US\$|[₺€£¥₹₽₴₾₪$]/.exec(h.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, " "));
  return mark ? mark[0] : null;
}

/**
 * The money an Excel number format prints: `[$€-x-euro2] #,##0.00`,
 * `"₺"#,##0.00`, `#,##0.00 "TL"`, `$#,##0`. A stored number in such a cell
 * carries no mark of its own; the format is what the owner sees. A locale
 * tag with no money (`[$-41F]`) and a date or plain number format name none.
 */
export function excelFormatMark(numFmt: unknown): string | null {
  if (typeof numFmt !== "string" || numFmt === "") return null;
  for (const m of numFmt.matchAll(/\[\$([^\]-]*)/g)) {
    const t = m[1].trim();
    if (isMoneyMark(t)) return t;
  }
  for (const m of numFmt.matchAll(/"([^"]*)"/g)) {
    const t = m[1].trim();
    if (isMoneyMark(t)) return t;
  }
  const bare = /US\$|[₺€£¥₹₽₴₾₪$]/.exec(numFmt.replace(/\[[^\]]*\]|"[^"]*"/g, ""));
  return bare ? bare[0] : null;
}
