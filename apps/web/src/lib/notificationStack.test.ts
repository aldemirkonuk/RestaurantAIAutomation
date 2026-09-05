import { describe, it, expect } from "vitest";
import { collapseStackedNotifications } from "./notificationStack";
import type { Notification } from "../services/api/notifications";

/**
 * Intelligence-lens finding 3: a real unread high-priority notification was
 * folded away.
 *
 * `stackKey` returned the constant `'inventory_low_stock:below_par_burst'` for
 * every notification with `metadata.mode === 'instant'`, regardless of which
 * wines it concerned, and `pickStackWinner` kept the one with the higher
 * `count`. Measured on the sim tenant: two instant low-stock notifications about
 * DIFFERENT wines, and the Alvear Solera 1927 alert never rendered — "TODAY (1)"
 * over 2 rows.
 *
 * Collapsing is for repetition. Two alerts about different wines are not a
 * repetition, and folding them is the inbox deciding what the owner does not
 * need to see.
 */

let seq = 0;
function notif(
  o: Partial<Notification> & { wines?: string[] } = {},
): Notification {
  const { wines, ...rest } = o;
  seq += 1;
  return {
    id: `n-${seq}`,
    type: "inventory_low_stock",
    title: "⚠️ 2 wines dropped below par",
    message: "Just crossed below par",
    priority: "high",
    read: false,
    timestamp: `2026-09-03T0${seq}:00:00.000Z`,
    metadata: {
      mode: "instant",
      count: wines?.length ?? 2,
      ...(wines
        ? { wines: wines.map((w) => ({ wineId: w, wineName: w })) }
        : {}),
    },
    ...rest,
  } as Notification;
}

describe("collapseStackedNotifications — low-stock bursts", () => {
  it("keeps two bursts about DIFFERENT wines as two rows", () => {
    const a = notif({ wines: ["alvear", "tsantali"] });
    const b = notif({ wines: ["akakies"], title: "⚠️ Low stock: Akakies" });

    const { items, foldedCount } = collapseStackedNotifications([a, b]);

    expect(items).toHaveLength(2);
    expect(foldedCount).toBe(0);
    expect(items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("still folds two bursts about the SAME wines — that is a repetition", () => {
    const a = notif({ wines: ["alvear", "tsantali"] });
    const b = notif({ wines: ["tsantali", "alvear"] }); // same set, different order

    const { items, foldedCount } = collapseStackedNotifications([a, b]);

    expect(items).toHaveLength(1);
    expect(foldedCount).toBe(1);
  });

  it("never folds a burst whose wine set is unknown", () => {
    // No `wines` in metadata: there is nothing to compare, so folding would be
    // a guess that two alerts are the same alert.
    const a = notif({ metadata: { mode: "instant", count: 3 } as any });
    const b = notif({ metadata: { mode: "instant", count: 1 } as any });

    const { items } = collapseStackedNotifications([a, b]);

    expect(items).toHaveLength(2);
  });

  it("does not lose a high-priority unread row to a higher-count one", () => {
    // The exact shape measured: a 3-wine burst and a 1-wine burst about a
    // different wine. The 1-wine row is the one that vanished.
    const many = notif({
      wines: ["a", "b", "c"],
      title: "⚠️ 3 wines dropped below par",
    });
    const alvear = notif({
      wines: ["alvear"],
      title: "🚨 Critical: Alvear Solera 1927",
      priority: "critical",
    });

    const { items } = collapseStackedNotifications([many, alvear]);

    expect(items.some((i) => i.id === alvear.id)).toBe(true);
  });

  it("still collapses repeated digests, which really are one recurring alert", () => {
    const d1 = notif({
      title: "📦 Daily digest: 4 wines below par",
      metadata: { mode: "digest", count: 4 } as any,
    });
    const d2 = notif({
      title: "📦 Daily digest: 6 wines below par",
      metadata: { mode: "digest", count: 6 } as any,
    });

    const { items } = collapseStackedNotifications([d1, d2]);

    expect(items).toHaveLength(1);
  });
});
