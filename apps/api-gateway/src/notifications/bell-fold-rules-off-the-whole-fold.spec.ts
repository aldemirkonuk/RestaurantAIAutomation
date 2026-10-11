import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { foldKeyOf } from "./notification-fold-key";

/**
 * F-1125 (re-hit of F-253): ruling off a folded bell line ruled off only the
 * rows inside the bell's page of 25, so a burst of 60 identical lines came
 * back with 35 unread. The fold is now ruled off on the server, by its key,
 * over every unread row of the caller in the caller's house.
 */

type Row = Record<string, any>;

/** An in-memory `notifications` table behind the chain the service uses. */
function fakeDb(rows: Row[]) {
  const reads: Array<{ from: number; to: number }> = [];
  function builder() {
    const filters: Array<(r: Row) => boolean> = [];
    let update: Row | null = null;
    let range: [number, number] | null = null;
    const run = () => {
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (update) {
        for (const r of hit) Object.assign(r, update);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (range) {
        reads.push({ from: range[0], to: range[1] });
        hit = hit.slice(range[0], range[1] + 1);
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b: any = {
      select: () => b,
      update: (u: Row) => ((update = u), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (
        filters.push((r) => vs.includes(r[k])),
        b
      ),
      order: () => b,
      range: (a: number, z: number) => (
        (range = [a, z]),
        Promise.resolve(run())
      ),
      maybeSingle: () => {
        const { data } = run();
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  }
  return { db: { supabase: { from: () => builder() } }, reads };
}

const burst = (n: number, over: Row = {}): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `n-${i}`,
    user_id: "user-1",
    restaurant_id: "house-a",
    type: "order_pending",
    title: "🔔 Order waiting for approval",
    metadata: {},
    status: "unread",
    ...over,
  }));

function serviceOver(rows: Row[]) {
  const { db, reads } = fakeDb(rows);
  const service = new NotificationsService(
    {} as never,
    { get: () => undefined } as never,
    db as never,
  );
  return { service, reads };
}

describe("ruling off a folded bell line rules off the whole fold (F-1125)", () => {
  it("[PRE-FIX-FAILS] a burst of 60 identical lines is ruled off whole, not 25 of it", async () => {
    const rows = burst(60);
    const { service } = serviceOver(rows);
    const count = await service.markFoldAsRead({
      id: "n-0",
      userId: "user-1",
      restaurantId: "house-a",
    });
    expect(count).toBe(60);
    expect(rows.filter((r) => r.status === "unread")).toHaveLength(0);
  });

  it("reads past the database's 1000-row page", async () => {
    const rows = burst(2300);
    const { service, reads } = serviceOver(rows);
    await service.markFoldAsRead({
      id: "n-5",
      userId: "user-1",
      restaurantId: "house-a",
    });
    expect(reads.length).toBe(3);
    expect(rows.filter((r) => r.status === "unread")).toHaveLength(0);
  });

  it("leaves other lines, other people and other houses alone", async () => {
    const rows = [
      ...burst(3),
      ...burst(1, { id: "other-title", title: "Delivery overdue" }),
      ...burst(1, { id: "other-user", user_id: "user-2" }),
      ...burst(1, { id: "other-house", restaurant_id: "house-b" }),
    ];
    const { service } = serviceOver(rows);
    const count = await service.markFoldAsRead({
      id: "n-0",
      userId: "user-1",
      restaurantId: "house-a",
    });
    expect(count).toBe(3);
    expect(
      rows
        .filter((r) => r.status === "unread")
        .map((r) => r.id)
        .sort(),
    ).toEqual(["other-house", "other-title", "other-user"]);
  });

  it("a line the bell never folds is ruled off alone", async () => {
    const wines = { mode: "instant" };
    const rows = burst(3, {
      type: "inventory_low_stock",
      title: "Critical: Chablis",
      metadata: wines,
    });
    const { service } = serviceOver(rows);
    const count = await service.markFoldAsRead({
      id: "n-1",
      userId: "user-1",
      restaurantId: "house-a",
    });
    expect(count).toBe(1);
  });

  it("a row of somebody else, or of another house, is not found", async () => {
    const { service } = serviceOver(burst(2));
    await expect(
      service.markFoldAsRead({
        id: "n-0",
        userId: "user-2",
        restaurantId: "house-a",
      }),
    ).rejects.toThrow("Notification not found");
    await expect(
      service.markFoldAsRead({
        id: "n-0",
        userId: "user-1",
        restaurantId: "house-b",
      }),
    ).rejects.toThrow("Notification not found");
  });

  it("the route takes the person and the house from the session, never the request", async () => {
    const markFoldAsRead = jest.fn(async () => 4);
    const controller = new NotificationsController(
      { markFoldAsRead } as unknown as NotificationsService,
      {} as never,
    );
    const out = await controller.markFoldAsRead("n-0", {
      user: { userId: "user-1", restaurantId: "house-a" },
    } as any);
    expect(out).toEqual({ success: true, count: 4 });
    expect(markFoldAsRead).toHaveBeenCalledWith({
      id: "n-0",
      userId: "user-1",
      restaurantId: "house-a",
    });
  });
});

describe("the fold key matches the bell's (lib/notificationStack.ts stackKey)", () => {
  it("folds titles that differ only by leading emoji, spacing and case", () => {
    expect(foldKeyOf({ type: "system", title: "⚠️  Order  late" })).toBe(
      foldKeyOf({ type: "system", title: "order late" }),
    );
  });

  it("folds a digest across its counts, and a burst only on the same wines", () => {
    const digest = (n: number) => ({
      type: "inventory_low_stock",
      title: `Low stock digest: ${n} wines below par`,
    });
    expect(foldKeyOf(digest(3))).toBe(foldKeyOf(digest(9)));
    const burstOf = (wines: string[]) => ({
      type: "inventory_low_stock",
      title: "2 wines dropped below par",
      metadata: { wines: wines.map((wineId) => ({ wineId })) },
    });
    expect(foldKeyOf(burstOf(["a", "b"]))).toBe(foldKeyOf(burstOf(["b", "a"])));
    expect(foldKeyOf(burstOf(["a", "b"]))).not.toBe(
      foldKeyOf(burstOf(["a", "c"])),
    );
    expect(
      foldKeyOf({
        type: "inventory_low_stock",
        title: "3 wines dropped below par",
      }),
    ).toBeNull();
  });
});
