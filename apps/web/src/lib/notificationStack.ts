import type { Notification } from "../services/api/notifications";

/** Extract a wine count from title/metadata for low-stock stack ranking. */
export function extractLowStockCount(n: Notification): number {
  const fromMeta = n.metadata?.count;
  if (typeof fromMeta === "number" && fromMeta > 0) return fromMeta;
  const burst = n.title.match(/(\d+)\s+wines?\s+dropped below par/i);
  if (burst) return Number.parseInt(burst[1], 10);
  const digest = n.title.match(/digest:\s*(\d+)\s+wine/i);
  if (digest) return Number.parseInt(digest[1], 10);
  return 1;
}

type StackMode = "max_count" | "newest";

function normalizeNotificationTitle(title: string): string {
  // Keep emoji as alternates (not a char class) — multi-codepoint emoji inside
  // [] trips no-misleading-character-class and matches incorrectly.
  return title
    .replace(/^(?:[\s\uFE0F\u200D]|⚠️|🚨|📦|🔔)+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Digest titles differ only by count — treat as the same recurring alert. */
function normalizeDigestTitle(title: string): string {
  return normalizeNotificationTitle(title).replace(
    /digest:\s*\d+\s+wines? below par/,
    "digest: wines below par",
  );
}

/**
 * The set of wines a low-stock notification is about, as a stable key — or
 * `null` when the notification does not say.
 *
 * Sorted, so two alerts naming the same wines in different orders are one
 * alert. `null` when `metadata.wines` is absent: there is nothing to compare,
 * and folding on no evidence is the inbox guessing that two alerts are the
 * same one.
 */
function lowStockWineSetKey(n: Notification): string | null {
  const wines = (n.metadata as Record<string, unknown> | undefined)?.wines;
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

function stackKey(n: Notification): { key: string; mode: StackMode } | null {
  if (n.type === "inventory_low_stock") {
    if (/dropped below par/i.test(n.title) || n.metadata?.mode === "instant") {
      // Was the constant `'inventory_low_stock:below_par_burst'` for EVERY
      // instant low-stock notification, regardless of which wines it named —
      // so `max_count` kept the bigger burst and threw the other away. Measured
      // on the sim tenant: two real unread notifications about different wines,
      // and the Alvear Solera 1927 alert never rendered ("TODAY (1)" over 2
      // rows). Collapsing is for REPETITION; two alerts about different wines
      // are not a repetition, and folding them is the inbox deciding what the
      // owner does not need to see.
      const wineSet = lowStockWineSetKey(n);
      if (wineSet === null) {
        // Nothing to compare it against — never fold it into anything.
        return null;
      }
      return {
        key: `inventory_low_stock:below_par_burst:${wineSet}`,
        mode: "max_count",
      };
    }
    if (/digest/i.test(n.title) || n.metadata?.mode === "digest") {
      return {
        key: `inventory_low_stock:digest:${normalizeDigestTitle(n.title)}`,
        mode: "newest",
      };
    }
  }

  const normalized = normalizeNotificationTitle(n.title);
  if (!normalized) return null;
  return { key: `${n.type}:${normalized}`, mode: "newest" };
}

function pickStackWinner(group: Notification[], mode: StackMode): Notification {
  if (mode === "newest") {
    return group.reduce((best, cur) =>
      new Date(cur.timestamp).getTime() >= new Date(best.timestamp).getTime()
        ? cur
        : best,
    );
  }

  return group.reduce((best, cur) => {
    const bc = extractLowStockCount(best);
    const cc = extractLowStockCount(cur);
    if (cc > bc) return cur;
    if (cc < bc) return best;
    return new Date(cur.timestamp).getTime() >=
      new Date(best.timestamp).getTime()
      ? cur
      : best;
  });
}

/**
 * Collapse repetitive notifications:
 * - Below-par bursts → one row, highest count wins
 * - Recurring digests / identical titles → one row, most recent wins
 */
export function collapseStackedNotifications(notifications: Notification[]): {
  items: Notification[];
  foldedCount: number;
  foldedById: Record<string, number>;
} {
  const passthrough: Notification[] = [];
  const stacks = new Map<string, { group: Notification[]; mode: StackMode }>();

  for (const n of notifications) {
    const entry = stackKey(n);
    if (!entry) {
      passthrough.push(n);
      continue;
    }
    const existing = stacks.get(entry.key);
    if (existing) {
      existing.group.push(n);
    } else {
      stacks.set(entry.key, { group: [n], mode: entry.mode });
    }
  }

  const collapsed: Notification[] = [];
  let foldedCount = 0;
  const foldedById: Record<string, number> = {};

  for (const { group, mode } of stacks.values()) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    const winner = pickStackWinner(group, mode);
    collapsed.push(winner);
    const folded = group.length - 1;
    foldedCount += folded;
    foldedById[winner.id] = folded;
  }

  const items = [...passthrough, ...collapsed].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return { items, foldedCount, foldedById };
}

export function stackedNotificationLabel(
  n: Notification,
  foldedInto?: number,
): string | null {
  if (foldedInto && foldedInto > 0) {
    return `${foldedInto} earlier duplicate${foldedInto === 1 ? "" : "s"} grouped`;
  }
  const count = extractLowStockCount(n);
  if (
    n.type === "inventory_low_stock" &&
    count > 1 &&
    /dropped below par/i.test(n.title)
  ) {
    return `${count} wines below par`;
  }
  return null;
}
