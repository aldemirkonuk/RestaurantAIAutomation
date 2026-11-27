/**
 * What identifies one till line, and how much of a unit it sold (r57, table
 * side decisions D2, D3, D5). Pure, so the arithmetic is tested without a
 * database.
 */

export interface LineIdentity {
  /** The provider's own stable id for this line, when its adapter has one. */
  line_id?: string | null;
  external_item_id?: string | null;
  name: string;
  /** Modifier ids or names, already sorted and joined by the adapter. */
  modifiers?: string | null;
  price?: number | null;
}

/**
 * D2. The idempotency key of each line of one check, in line order.
 *
 * A provider's stable line id is the key. Without one the key is the item,
 * its modifiers, its unit price and the occurrence among identical lines. The
 * line's position is never part of it: a closed check re-sent with an earlier
 * line removed used to renumber every later line, so each got a new key and
 * depleted a second time.
 */
export function saleLineKeys(
  source: string,
  checkId: string,
  items: LineIdentity[],
): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const lineId = String(it.line_id ?? "").trim();
    if (lineId) return `pos:${source}:${checkId}:L:${lineId}`;
    const price =
      it.price === null ||
      it.price === undefined ||
      Number.isNaN(Number(it.price))
        ? "np"
        : Number(it.price).toFixed(4);
    const same = `${it.external_item_id ?? it.name}|${it.modifiers ?? ""}|${price}`;
    const nth = seen.get(same) ?? 0;
    seen.set(same, nth + 1);
    return `pos:${source}:${checkId}:${same}:#${nth}`;
  });
}

/**
 * D3. A line's quantity as whole units plus a fraction of one unit. Clover
 * rings by-measure lines in thousandths, so the fraction is read to three
 * places; a quantity under half a thousandth is nothing.
 */
export function splitQty(qty: unknown): { whole: number; frac: number } {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return { whole: 0, frac: 0 };
  const milli = Math.round(n * 1000);
  return { whole: Math.floor(milli / 1000), frac: (milli % 1000) / 1000 };
}

/**
 * D3. The millilitres a fraction of one unit draws. The pour RPC takes whole
 * millilitres, so this is exact to the millilitre, and never zero for a real
 * fraction.
 */
export function fractionMl(unitMl: number, frac: number): number {
  return frac > 0 ? Math.max(1, Math.round(unitMl * frac)) : 0;
}
