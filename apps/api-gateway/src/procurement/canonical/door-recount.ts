/**
 * A RECOUNT SUPERSEDES THE EARLIER COUNT, ITEM BY ITEM (r33 w2 F5).
 *
 * A second door count on one delivery is its own document (the door refuses
 * the same count twice), and the stock follows it: `bookAtTheDoor` books the
 * difference between what the newer count says the shelf holds of an item and
 * what this delivery already put there. The difference check that gates
 * AGREED read EVERY door count instead, so the first count's old difference
 * ("288 against 24") kept blocking AGREED after the recount had put the shelf
 * right, and no answer to the new count could clear it.
 *
 * The rule, the same as the stock's: for each item, the door says what the
 * NEWEST count that names it says. A line of an earlier count is superseded
 * when a later count names the same item. "Later" is when the count says it
 * was counted (`extracted.countedAt`), else when it was recorded — the same
 * order the paper's "received at the door" reads (`door-received.ts`), so the
 * gate and the paper page name the same count. An item only the earlier count
 * names is still that count's (a recount of one wine does not un-count the
 * others).
 *
 * "The same item": the strongest identity both lines carry — the linked
 * shelf good, else the vendor's code, else the description (case and spacing
 * folded). A line with none of the three cannot be matched to a later one and
 * is kept.
 */

export interface CountDoc {
  id: string;
  created_at: string | null;
  extracted?: { countedAt?: string | null } | null;
}

/** When a count was counted, in ms; a count with no readable time is the oldest. */
function countedAt(d: CountDoc): number {
  const t = Date.parse(d.extracted?.countedAt ?? d.created_at ?? "");
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export interface CountLine {
  id: string;
  document_id: string;
  inventory_id: string | null;
  vendor_sku: string | null;
  description: string | null;
}

const fold = (v: string | null | undefined) =>
  v?.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr") || null;

/**
 * Whether two count lines are the same item. The strongest identity both
 * lines carry decides: two linked goods are the same only when they are the
 * same good (a shared description never overrides two different links).
 */
export function sameItem(a: CountLine, b: CountLine): boolean {
  if (a.inventory_id && b.inventory_id) return a.inventory_id === b.inventory_id;
  const skuA = fold(a.vendor_sku);
  const skuB = fold(b.vendor_sku);
  if (skuA && skuB) return skuA === skuB;
  const ad = fold(a.description);
  const bd = fold(b.description);
  return !!ad && ad === bd;
}

/** The ids of the count lines a later count supersedes. */
export function supersededCountLines(docs: CountDoc[], lines: CountLine[]): Set<string> {
  const out = new Set<string>();
  if (docs.length < 2) return out;
  // Newest first; a tie on the clock falls back to the id so the answer is
  // the same on every read.
  const order = [...docs].sort((a, b) => {
    const at = countedAt(a);
    const bt = countedAt(b);
    if (at !== bt) return bt > at ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const later: CountLine[] = [];
  for (const doc of order) {
    const docLines = lines.filter((l) => l.document_id === doc.id);
    for (const l of docLines) if (later.some((n) => sameItem(l, n))) out.add(l.id);
    // Added after the document's own lines are judged: two lines of one item
    // in ONE count add up (bookAtTheDoor), they never supersede each other.
    later.push(...docLines);
  }
  return out;
}
