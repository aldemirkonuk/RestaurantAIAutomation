/**
 * A whole-figure amount in the house's own money, for sentences the gateway
 * writes (the mobile feed, the recommendation cards, the insight lines).
 *
 * Those sentences printed `$` in front of every figure, whatever
 * `restaurants.currency` held, so a house in Istanbul read "$12,400 is locked
 * in inventory" about lira (F-341). The code comes from the house's record;
 * `null` is "not recorded" (ADR 0117 Q25), so the figure prints with no
 * symbol at all, never a defaulted dollar. A code `Intl` cannot place prints
 * as itself ("ZZZ 1,240").
 *
 * `compact` keeps the insight lines' short form: `$600`, `$1.0k`, `€12.4k`.
 *
 * Pure: no database, no clock.
 */
export function houseMoney(
  value: number,
  currency: string | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  const v = Number(value);
  const body = opts.compact
    ? Math.abs(v) >= 1000
      ? (v / 1000).toFixed(1) + "k"
      : v.toFixed(0)
    : v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(code)) return body;
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).formatToParts(1);
  } catch {
    return `${code} ${body}`;
  }
  // Keep the symbol and its spacing where en-US puts them; the number is ours.
  const numeric = new Set(["integer", "group", "decimal", "fraction"]);
  const first = parts.findIndex((p) => numeric.has(p.type));
  let last = first;
  parts.forEach((p, i) => {
    if (numeric.has(p.type)) last = i;
  });
  const before = parts.slice(0, first).map((p) => p.value).join("");
  const after = parts.slice(last + 1).map((p) => p.value).join("");
  return `${before}${body}${after}`;
}

/**
 * `restaurants.currency` for one house, for the sentences above.
 *
 * Never throws: a failed or refused read answers `null`, which prints a figure
 * with no symbol — the same as a house that never said, and never a dollar.
 * The callers write prose, not a ledger, so the two are not told apart here;
 * a page that must tell them apart reads `GET /settings/currency`.
 */
export async function readHouseCurrency(
  client: { from: (table: string) => any } | null | undefined,
  restaurantId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client!
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const code = (row as { currency?: unknown } | null | undefined)?.currency;
    return typeof code === "string" && /^[A-Za-z]{3}$/.test(code.trim())
      ? code.trim().toUpperCase()
      : null;
  } catch {
    return null;
  }
}
