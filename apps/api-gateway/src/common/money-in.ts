/**
 * An amount in the words of its own money. Nothing here converts (ADR 0117:
 * a figure carries the currency it was recorded in).
 *
 * - A stated ISO 4217 code: that money's own mark, en-US grouping
 *   ("$1,240.50", "€25.00", "₺1,240.50", "CHF 1,240.50").
 * - No code, or one that is not three letters: the figure alone
 *   ("1,240.50"). A bare figure is honest; a `$` assumed dollars for every
 *   house (2026-11-12 walks: a lira house read `$` in its notifications,
 *   texts, emails and order notes).
 * - A well-formed code `Intl` does not know: the figure, then the code.
 *
 * THE SIGN is the web's rule (`fmtMoney`, pages/receipts/next/rc2-format.ts),
 * so a house reads the same characters in a notification as on its pages:
 * where en-US falls back to the bare code, the narrow sign is used only when
 * it is one character from Unicode's currency-symbol block (₺ ₽ ₴ ₸ …). A
 * narrow "$", "kr" or "£" is shared by several monies, so ARS or SEK keep
 * their code.
 *
 * `whole` drops the minor unit for a figure said in whole units ("₺1,241").
 *
 * KEEP THIS FILE BYTE-IDENTICAL on every branch that adds it: git merges an
 * identical add of one path without a conflict.
 */
export function moneyIn(
  n: number,
  code?: string | null,
  whole = false,
): string {
  const places = whole ? 0 : 2;
  const bare = n.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(c)) return bare;
  let said: string;
  try {
    said = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(n);
  } catch {
    return `${bare} ${c}`;
  }
  if (!said.includes(c)) return said;
  try {
    const glyph = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    if (glyph && /^[₠-⃏]$/.test(glyph)) {
      return said.replace(c, glyph).replace(/^(\D*?[^\d\s-])\s+(?=\d)/, "$1");
    }
  } catch {
    // An engine without narrowSymbol keeps the code, which is still honest.
  }
  return said;
}
