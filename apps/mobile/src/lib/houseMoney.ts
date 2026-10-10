/**
 * A figure in the house's own money, grouped the house's way (F-885).
 *
 * The phone printed `$` with en-US grouping on every money figure — the
 * Today strip, Insights, a wine's cost, an order's amount — so a lira house
 * read "$12,400" about lira. This mirrors the gateway's `houseMoney`
 * (`apps/api-gateway/src/common/house-money.ts`): the code is the house's
 * `restaurants.currency` and the locale its formats tag, both sent on
 * `/mobile/today-pulse`. No currency recorded prints the figure with no
 * symbol, never a dollar; no locale keeps en-US grouping, as before.
 *
 * Pure: no network, no clock.
 */
export interface HouseMoneyFrame {
  currency: string | null;
  locale: string | null;
}

export function houseMoney(
  value: number,
  frame: Partial<HouseMoneyFrame> | null | undefined,
  opts: { maxFractionDigits?: number } = {},
): string {
  const locale = usableLocale(frame?.locale);
  const body = Number(value).toLocaleString(locale, {
    maximumFractionDigits: opts.maxFractionDigits ?? 0,
  });
  const raw = frame?.currency;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) return body;
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
    }).formatToParts(1);
    // Keep the symbol and its spacing where the locale puts them; the number is ours.
    const numeric = new Set(["integer", "group", "decimal", "fraction"]);
    const first = parts.findIndex((p) => numeric.has(p.type));
    let last = first;
    parts.forEach((p, i) => {
      if (numeric.has(p.type)) last = i;
    });
    if (first < 0) return `${code} ${body}`;
    const before = parts.slice(0, first).map((p) => p.value).join("");
    const after = parts.slice(last + 1).map((p) => p.value).join("");
    return `${before}${body}${after}`;
  } catch {
    return `${code} ${body}`;
  }
}

/** The tag when this runtime formats with it; else en-US, the old default. */
function usableLocale(tag: string | null | undefined): string {
  if (typeof tag !== "string" || !tag.trim()) return "en-US";
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag.trim()]).length > 0
      ? tag.trim()
      : "en-US";
  } catch {
    return "en-US";
  }
}
