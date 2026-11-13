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
 * THE PLACES are the money's own (ISO 4217): two for lira, dollars and euros,
 * none for yen or won ("¥1,240", never "¥1,240.00"), three for the Kuwaiti or
 * Bahraini dinar. A bare figure keeps two places: with no money named, there is
 * no exponent to read.
 *
 * #1193 and #1194 add this file byte-identically; a change to it goes on a
 * branch stacked on one of them, never as a third add.
 */
export function moneyIn(
  n: number,
  code?: string | null,
  whole = false,
): string {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  // A bare figure (no code) is not in either table, so it keeps two places.
  const places = whole ? 0 : exponentOf(c);
  const bare = n.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
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

/**
 * ISO 4217's exponent for the codes where it is not two. Everything else in the
 * gateway's list (`common/iso-4217.ts`) carries two. CLDR, which `Intl` reads,
 * says the CASH convention instead for a few (HUF, COP and IDR print with no
 * decimals; IQD with none where ISO says three), so the table is explicit
 * rather than read from `Intl`.
 */
const ZERO_PLACES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_PLACES = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

function exponentOf(code: string): number {
  if (ZERO_PLACES.has(code)) return 0;
  if (THREE_PLACES.has(code)) return 3;
  return 2;
}

/**
 * Codes whose minor unit at the payment provider is not known to match ISO
 * 4217. Stripe's own docs name ISK and UGX as special cases (two places in its
 * API for backwards compatibility, where ISO says none) and list MGA as
 * zero-decimal (ISO says two); IQD and LYD are three-place in ISO and not
 * confirmed there. For these an amount in minor units is not scaled: whose
 * minor units it is would be a guess, and a wrong guess is a figure 100 times
 * off.
 */
const PROVIDER_PLACES_DIFFER = new Set(["ISK", "UGX", "MGA", "IQD", "LYD"]);

/**
 * An amount held in MINOR units (cents, kuruş), said as money: 5000 TRY minor
 * units is "₺50.00", 5000 JPY is "¥5,000", 5000 KWD is "KWD 5.000".
 *
 * `null` when it cannot be scaled honestly, and the caller then says the minor
 * units with their code instead of a figure 100 times too large or too small:
 *   - the code is not a three-letter code;
 *   - the code's minor unit differs between ISO 4217 and the payment provider
 *     (`PROVIDER_PLACES_DIFFER`);
 *   - the amount is not a whole number of minor units.
 */
export function moneyFromMinor(
  minor: number,
  code?: string | null,
): string | null {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(c) || PROVIDER_PLACES_DIFFER.has(c)) return null;
  if (!Number.isSafeInteger(minor)) return null;
  return moneyIn(minor / 10 ** exponentOf(c), c);
}
