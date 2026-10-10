/**
 * F-918 — the currency a library reference price was recorded in.
 *
 * `master_wine_library.price_reference` is a bare number; since
 * 20270104500000_a_library_price_names_its_currency it has a sibling,
 * `price_reference_currency` (ISO 4217, three capitals, or NULL = not
 * recorded). The page shows a reference price beside a house's money only when
 * that column names the house's currency, so every writer of the price must
 * also say what currency it is in — and only when the source said so.
 *
 * The code is read off the same payload the price came from, under the
 * spellings submissions actually use. Nothing is inferred: not USD, not the
 * submitting house's currency (ADR 0117 Q25 — "never the house's by
 * inheritance"), not a symbol such as "$", which names several currencies.
 * No price means no currency either: a code with no figure states nothing.
 */
const ISO_4217 = /^[A-Z]{3}$/;

const CURRENCY_KEYS = [
  "priceReferenceCurrency",
  "price_reference_currency",
  "priceCurrency",
  "price_currency",
  "currency",
] as const;

export function priceReferenceCurrencyFromPayload(
  payload: Record<string, unknown> | null | undefined,
  price: unknown,
): string | null {
  if (price === null || price === undefined || price === "") return null;
  const p = payload ?? {};
  for (const key of CURRENCY_KEYS) {
    const value = p[key];
    if (value === null || value === undefined || value === "") continue;
    // The first spelling present decides; an unreadable one is not recorded,
    // it does not fall through to a looser key.
    if (typeof value !== "string") return null;
    const code = value.trim().toUpperCase();
    return ISO_4217.test(code) ? code : null;
  }
  return null;
}
