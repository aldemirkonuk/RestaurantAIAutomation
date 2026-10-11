/**
 * The bell's fold, on the server (F-253, F-1125).
 *
 * The bell reads one page of 25 unread rows and folds repeats into one line
 * (`apps/web/src/lib/notificationStack.ts`, `stackKey`). Ruling a folded line
 * off used to send only the ids inside that page, so a burst of 60 identical
 * lines cleared 25 and came back with 35. The server now rules off every
 * unread row in the fold, and to do that it must fold exactly as the web does.
 *
 * This is a COPY of `stackKey`'s key, not of its winner rule: the two must be
 * kept in step. A row the web would never fold (`null` here) is ruled off
 * alone, so a drift can only under-reach, never rule off a line the person
 * did not see.
 */

export interface FoldableRow {
  type?: string | null;
  title?: string | null;
  metadata?: unknown;
}

function normalizeTitle(title: string): string {
  return title
    .replace(/^(?:[\s️‍]|⚠️|🚨|📦|🔔)+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeDigestTitle(title: string): string {
  return normalizeTitle(title).replace(
    /digest:\s*\d+\s+wines? below par/,
    "digest: wines below par",
  );
}

function lowStockWineSetKey(metadata: Record<string, unknown>): string | null {
  const wines = metadata.wines;
  if (!Array.isArray(wines) || wines.length === 0) return null;
  const ids = wines
    .map((w) => {
      const rec = w as Record<string, unknown> | null;
      const id = rec?.wineId ?? rec?.wine_id ?? rec?.wineName ?? rec?.wine_name;
      return typeof id === "string" || typeof id === "number"
        ? String(id)
        : null;
    })
    .filter((x): x is string => x !== null);
  if (ids.length === 0) return null;
  return [...new Set(ids)].sort().join("|");
}

/** The key two rows share when the bell folds them into one line; null = never folded. */
export function foldKeyOf(row: FoldableRow): string | null {
  const type = String(row.type ?? "");
  const title = String(row.title ?? "");
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};

  if (type === "inventory_low_stock") {
    if (/dropped below par/i.test(title) || metadata.mode === "instant") {
      const wineSet = lowStockWineSetKey(metadata);
      return wineSet === null
        ? null
        : `inventory_low_stock:below_par_burst:${wineSet}`;
    }
    if (/digest/i.test(title) || metadata.mode === "digest") {
      return `inventory_low_stock:digest:${normalizeDigestTitle(title)}`;
    }
  }

  const normalized = normalizeTitle(title);
  return normalized ? `${type}:${normalized}` : null;
}
