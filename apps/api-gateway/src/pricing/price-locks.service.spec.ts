import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { PriceLocksService, lockActError } from "./price-locks.service";
import { MarginAdviceService } from "./margin-advice.service";

/**
 * ADR 0193 round 3 -- a house holds a price. The founder, 2026-09-21,
 * verbatim: "add a section to that where you can lock price, but wha f that
 * menu item disappears? so think verify validate your decision and build".
 *
 * The lock list (L17, L23, L25) and the four acts (L2, L6, L20, L24) run for
 * real -- the service and the real MarginAdviceService it asks for each lock's
 * advice -- against a fake client that answers by table, applies eq / is / in
 * filters, and fails a table's reads on request. The SQL behind the acts is
 * proven separately in PGlite (p4-scratch/pglite-probe/cellar-r3-locks.mjs);
 * here the RPC answers the way that SQL does.
 */

type Row = Record<string, any>;

function fakeClient(tables: Record<string, Row[]>, rpc?: (fn: string, args: Row) => { data: unknown; error: unknown }) {
  const rpcs: Array<[string, Row]> = [];
  const failing = (table: string): string | undefined => (tables as any).__readFails?.[table];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const api: any = {
      select: () => api,
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return api;
      },
      neq(c: string, v: unknown) {
        filters.push((r) => r[c] !== v);
        return api;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return api;
      },
      in(c: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[c]));
        return api;
      },
      gt: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        if (failing(table)) return { data: null, error: { message: failing(table) } };
        return { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null };
      },
      then(resolve: any) {
        if (failing(table)) return resolve({ data: null, error: { message: failing(table) } });
        resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
      },
    };
    return api;
  };
  const client = {
    from,
    rpc: async (fn: string, args: Row) => {
      rpcs.push([fn, args]);
      return rpc ? rpc(fn, args) : { data: null, error: { message: `no rpc ${fn}` } };
    },
  };
  return { client, rpcs };
}

function service(tables: Record<string, Row[]>, rpc?: (fn: string, args: Row) => { data: unknown; error: unknown }) {
  const { client, rpcs } = fakeClient(tables, rpc);
  const db = { client } as any;
  return { svc: new PriceLocksService(db, new MarginAdviceService(db)), rpcs };
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY - 60_000).toISOString();

/**
 * Three open locks, one released:
 *   lock-a  Barolo bottle 50, on the current menu (which reads 55), advice says raise -> off_target, menu_differs
 *   lock-b  Chianti bottle 40, NOT on the current menu, set by someone who no longer manages the house
 *   lock-c  Soave glass 9, wine removed from inventory, no recorded cost -> advice_unknown
 *   lock-x  released: not listed
 */
function house(): Record<string, Row[]> {
  return {
    house_price_locks: [
      { id: "lock-a", restaurant_id: "rest-1", inventory_id: "inv-a", kind: "bottle", locked_price: "50.00", locked_by: "user-5", locked_at: ago(12), note: "season", moved_from_lock_id: null, released_at: null },
      { id: "lock-b", restaurant_id: "rest-1", inventory_id: "inv-b", kind: "bottle", locked_price: "40.00", locked_by: "user-6", locked_at: ago(40), note: null, moved_from_lock_id: null, released_at: null },
      { id: "lock-c", restaurant_id: "rest-1", inventory_id: "inv-c", kind: "glass", locked_price: "9.00", locked_by: "user-5", locked_at: ago(3), note: null, moved_from_lock_id: null, released_at: null },
      { id: "lock-x", restaurant_id: "rest-1", inventory_id: "inv-a", kind: "glass", locked_price: "10.00", locked_by: "user-5", locked_at: ago(90), note: null, moved_from_lock_id: null, released_at: ago(80) },
      // Another house's lock never appears here (L26).
      { id: "lock-z", restaurant_id: "rest-2", inventory_id: "inv-z", kind: "bottle", locked_price: "70.00", locked_by: "user-9", locked_at: ago(1), note: null, moved_from_lock_id: null, released_at: null },
    ],
    restaurant_inventory: [
      { id: "inv-a", restaurant_id: "rest-1", master_wine_id: "mw-a", wine_name: "Barolo", is_active: true, deleted_at: null, sale_type: "bottle", menu_price_current: "50.00", menu_price_glass: null, last_purchase_price: "20.00", bottle_size_ml: 750, master_wine_library: { name: "Barolo", vintage: 2019, bottle_size_ml: 750 } },
      { id: "inv-b", restaurant_id: "rest-1", master_wine_id: "mw-b", wine_name: "Chianti", is_active: true, deleted_at: null, sale_type: "bottle", menu_price_current: "40.00", menu_price_glass: null, last_purchase_price: "14.00", bottle_size_ml: 750 },
      { id: "inv-c", restaurant_id: "rest-1", master_wine_id: "mw-c", wine_name: "Soave", is_active: false, deleted_at: null, sale_type: "glass", menu_price_current: null, menu_price_glass: "9.00", last_purchase_price: null, bottle_size_ml: 750 },
    ],
    restaurant_menus: [{ id: "menu-1", restaurant_id: "rest-1", status: "active", name: "Autumn list" }],
    menu_items: [
      { id: "mi-a", menu_id: "menu-1", restaurant_id: "rest-1", wine_library_id: "mw-a", bottle_price: "55.00", by_glass_price: null, status: "approved" },
    ],
    restaurants: [
      {
        id: "rest-1",
        target_margin_bottle_pct: "65.00",
        target_margin_glass_pct: "75.00",
        target_margin_band_pct: "2.00",
        target_margin_set_by: "user-5",
        target_margin_set_at: ago(20),
        default_pour_ml: 150,
        pour_size_confirmed_by: "user-5",
        pour_size_confirmed_at: ago(20),
      },
    ],
    inventory_lot_rollup: [],
    users: [
      { user_id: "user-5", name: "Aylin", role: "manager", restaurant_id: "rest-1" },
      { user_id: "user-6", name: "Deniz", role: "staff", restaurant_id: "rest-1" },
    ],
    user_restaurant_access: [
      { user_id: "user-5", restaurant_id: "rest-1", role: "manager", is_active: true },
      // Deniz once managed this house; the row is no longer active.
      { user_id: "user-6", restaurant_id: "rest-1", role: "manager", is_active: false },
    ],
  };
}

describe("PriceLocksService.list -- every open lock, and the facts that say whether it still fits (L17, L23)", () => {
  it("lists every open lock of THIS house (released and foreign ones never), grouped by the current menu, with its markers", async () => {
    const { svc } = service(house());
    const r = await svc.list("rest-1");
    expect(r.readable).toBe(true);
    expect(r.scope).toBe("this house");
    expect(r.locks.map((l) => l.lockId).sort()).toEqual(["lock-a", "lock-b", "lock-c"]);
    const by = Object.fromEntries(r.locks.map((l) => [l.lockId, l]));

    expect(by["lock-a"]).toMatchObject({
      dormant: false,
      menuPrice: 55,
      lockedPrice: 50,
      ageDays: 12,
      lockedBy: { userId: "user-5", name: "Aylin" },
      wine: { name: "Barolo", vintage: 2019, active: true, housePrice: 50 },
    });
    expect(by["lock-a"].markers.sort()).toEqual(["menu_differs", "off_target"]);
    expect(by["lock-a"].advice).toMatchObject({ state: "raise", advisedPrice: 57.14 });

    expect(by["lock-b"].dormant).toBe(true);
    expect(by["lock-b"].markers.sort()).toEqual(["author_without_access", "not_on_current_menu"]);

    // A removed wine is LISTED (this read never filters is_active), and its unknown advice says why.
    expect(by["lock-c"].markers.sort()).toEqual(["advice_unknown", "not_on_current_menu", "wine_removed"]);
    expect(by["lock-c"].wine.active).toBe(false);
    expect(by["lock-c"].adviceUnknownReason).toMatch(/no recorded cost/);

    expect(r.counts).toEqual({ open: 3, onCurrentMenu: 1, notOnCurrentMenu: 2, toReview: 3 });
    expect(r.currentMenus).toEqual([{ menuId: "menu-1", name: "Autumn list" }]);
    expect(r.namesReadable).toBe(true);
    expect(r.markersReadable).toBe(true);
  });

  it("with no current menu, every lock is in the dormant group, marked no_current_menu", async () => {
    const t = house();
    t.restaurant_menus = [];
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.locks.every((l) => l.dormant && l.markers.includes("no_current_menu"))).toBe(true);
    expect(r.counts).toMatchObject({ onCurrentMenu: 0, notOnCurrentMenu: 3 });
  });

  it("a lock on target with a still-current author, on the menu at its price, needs no review", async () => {
    const t = house();
    t.house_price_locks = [{ ...t.house_price_locks[0], locked_price: "57.14" }];
    t.restaurant_inventory[0].menu_price_current = "57.14";
    t.menu_items[0].bottle_price = "57.14";
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.locks[0].markers).toEqual([]);
    expect(r.counts.toReview).toBe(0);
  });

  it("L10: the legacy single-house role still counts as managing the house (the same fallback the role check reads)", async () => {
    const t = house();
    t.user_restaurant_access = t.user_restaurant_access.filter((a) => a.user_id !== "user-5");
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.locks.find((l) => l.lockId === "lock-a")!.markers).not.toContain("author_without_access");
  });

  it("L25: a lock list that cannot be read answers readable:false with the reason -- never an empty list", async () => {
    const t = house();
    (t as any).__readFails = { house_price_locks: "permission denied" };
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.readable).toBe(false);
    expect(r.reason).toMatch(/could not be read: permission denied\. This is not the same as having none/);
  });

  it("L25: people who cannot be named are said to be unnamed, and no author marker is guessed", async () => {
    const t = house();
    (t as any).__readFails = { users: "timeout" };
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.readable).toBe(true);
    expect(r.namesReadable).toBe(false);
    expect(r.namesReason).toMatch(/could not be named: timeout/);
    expect(r.locks.some((l) => l.markers.includes("author_without_access"))).toBe(false);
    expect(r.markersReadable).toBe(false);
    expect(r.markersReason).toMatch(/still manages this house could not be read \(timeout\)/);
  });

  it("a current menu that cannot be read leaves the menu markers out and says so -- never 'not on the menu'", async () => {
    const t = house();
    (t as any).__readFails = { menu_items: "statement timeout" };
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.locks.some((l) => l.markers.includes("not_on_current_menu"))).toBe(false);
    expect(r.markersReason).toMatch(/current menu could not be read \(statement timeout\)/);
    // Last-call review, 2026-09-21: nor "on the menu". Unknown is its own answer
    // (null), so no lock is put in either group on an unread menu (L25).
    expect(r.locks.map((l) => l.dormant)).toEqual([null, null, null]);
    expect(r.counts).toMatchObject({ open: 3, onCurrentMenu: 0, notOnCurrentMenu: 0 });
  });

  it("L25: a lock whose wine cannot be read is in neither group -- never 'on the current menu'", async () => {
    const t = house();
    (t as any).__readFails = { restaurant_inventory: "connection reset" };
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.readable).toBe(true);
    expect(r.locks.map((l) => l.dormant)).toEqual([null, null, null]);
    expect(r.locks.some((l) => l.markers.includes("not_on_current_menu"))).toBe(false);
    expect(r.counts).toMatchObject({ open: 3, onCurrentMenu: 0, notOnCurrentMenu: 0 });
    expect(r.markersReason).toMatch(/the locked wines could not be read \(connection reset\)/);
  });

  it("with no current menu, a lock is dormant even when its wine cannot be read (no menu is known either way)", async () => {
    const t = house();
    t.restaurant_menus = [];
    (t as any).__readFails = { restaurant_inventory: "connection reset" };
    const { svc } = service(t);
    const r = await svc.list("rest-1");
    expect(r.locks.every((l) => l.dormant === true && l.markers.includes("no_current_menu"))).toBe(true);
  });
});

describe("PriceLocksService -- the acts", () => {
  const LOCK_ROW = {
    id: "lock-n",
    restaurant_id: "rest-1",
    inventory_id: "inv-a",
    kind: "bottle",
    locked_price: 50,
    locked_by: "user-5",
    locked_at: "2026-09-21T12:00:00Z",
    note: null,
    moved_from_lock_id: null,
    released_at: null,
    released_by: null,
    release_note: null,
  };

  it("L2: lock holds the price as it is now, by the person, and says so", async () => {
    const { svc, rpcs } = service(house(), () => ({ data: { outcome: "locked", lock: LOCK_ROW }, error: null }));
    const r = await svc.lock("rest-1", "inv-a", "bottle", "user-5", "hold it");
    expect(rpcs).toEqual([
      ["lock_house_menu_price", { p_restaurant_id: "rest-1", p_inventory_id: "inv-a", p_kind: "bottle", p_actor: "user-5", p_note: "hold it" }],
    ]);
    expect(r).toMatchObject({ outcome: "locked", housePrice: 50, lock: { lockId: "lock-n", lockedPrice: 50 } });
    expect(r.sentence).toMatch(/bottle price is locked at 50\.00 at this house/);
  });

  it.each([
    ["HPL02", "nothing_to_lock: this house has no bottle price for this wine, so there is nothing to hold; nothing was locked", ConflictException],
    ["HPL03", "already_locked: the bottle price is already locked at 50 since x (lock y); nothing was changed", ConflictException],
    ["23505", "duplicate key value violates unique constraint", ConflictException],
    ["P0002", "lock_house_menu_price: no wine inv-a in house rest-1; nothing was locked", NotFoundException],
    ["22023", "lock_house_menu_price: a lock names the person who set it; nothing was locked", BadRequestException],
    ["XX000", "connection reset", InternalServerErrorException],
  ])("a %s refusal is the HTTP answer it means", async (code, message, type) => {
    const { svc } = service(house(), () => ({ data: null, error: { code, message } }));
    await expect(svc.lock("rest-1", "inv-a", "bottle", "user-5")).rejects.toBeInstanceOf(type);
  });

  it("the refusal's words reach the person without the SQL prefix", () => {
    const e = lockActError({ code: "HPL02", message: "nothing_to_lock: this house has no glass price for this wine" }, "wine");
    expect(e.message).toBe("this house has no glass price for this wine");
  });

  it("a lock act that answers no outcome is an error, never a success", async () => {
    const { svc } = service(house(), () => ({ data: {}, error: null }));
    await expect(svc.lock("rest-1", "inv-a", "bottle", "user-5")).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("L24: releasing changes no price, and says when the current menu reads another one", async () => {
    const { svc } = service(house(), () => ({
      data: { outcome: "released", lock: { ...LOCK_ROW, released_at: "2026-09-21T13:00:00Z", released_by: "user-5" }, house_price: 50 },
      error: null,
    }));
    const r = await svc.release("rest-1", "lock-n", "user-5", null);
    expect(r.outcome).toBe("released");
    expect(r.sentence).toBe(
      "The lock is released. The current menu reads 55.00; the house price stays 50.00 until a menu is chosen or a manager changes it.",
    );
  });

  it("L24: when the current menu agrees (or does not list the wine), the release says nothing else changed", async () => {
    const t = house();
    t.menu_items[0].bottle_price = "50.00";
    const { svc } = service(t, () => ({ data: { outcome: "released", lock: LOCK_ROW, house_price: 50 }, error: null }));
    expect((await svc.release("rest-1", "lock-n", "user-5")).sentence).toBe(
      "The lock is released. The house bottle price stays 50.00; nothing else changed.",
    );
  });

  it("L24/L25: a current menu that cannot be read is said on the release, never guessed", async () => {
    const t = house();
    (t as any).__readFails = { restaurant_menus: "timeout" };
    const { svc } = service(t, () => ({ data: { outcome: "released", lock: LOCK_ROW, house_price: 50 }, error: null }));
    expect((await svc.release("rest-1", "lock-n", "user-5")).sentence).toMatch(
      /stays 50\.00\. Whether the current menu reads another price could not be read \(timeout\)/,
    );
  });

  it("L6: change and keep locked needs a price (400, no call), names the lock it saw, and says both prices", async () => {
    const { svc, rpcs } = service(house(), () => ({
      data: { outcome: "changed_and_locked", previous_lock_id: "lock-n", previous_price: 50, lock: { ...LOCK_ROW, id: "lock-m", locked_price: 58, moved_from_lock_id: "lock-n" } },
      error: null,
    }));
    await expect(svc.changeAndKeep("rest-1", "lock-n", undefined, "user-5")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.changeAndKeep("rest-1", "lock-n", -1, "user-5")).rejects.toBeInstanceOf(BadRequestException);
    expect(rpcs).toHaveLength(0);
    const r = await svc.changeAndKeep("rest-1", "lock-n", 58, "user-5", "new vintage");
    expect(rpcs[0]).toEqual([
      "change_locked_house_menu_price",
      { p_restaurant_id: "rest-1", p_lock_id: "lock-n", p_price: 58, p_actor: "user-5", p_note: "new vintage" },
    ]);
    expect(r).toMatchObject({ outcome: "changed_and_locked", previousLockId: "lock-n", lock: { lockId: "lock-m", movedFromLockId: "lock-n" } });
    expect(r.sentence).toBe("The bottle price is now 58.00 (it was 50.00) and stays locked.");
  });

  it("L6: naming a lock that is no longer open is a 409", async () => {
    const { svc } = service(house(), () => ({ data: null, error: { code: "HPL04", message: "lock_not_open: lock lock-n is no longer the open lock on this price" } }));
    await expect(svc.changeAndKeep("rest-1", "lock-n", 58, "user-5")).rejects.toBeInstanceOf(ConflictException);
  });

  it("L20: a move names its target and its price -- a missing one is a 400 before any call", async () => {
    const { svc, rpcs } = service(house(), () => ({
      data: { outcome: "moved", previous_lock_id: "lock-b", lock: { ...LOCK_ROW, id: "lock-m", inventory_id: "inv-a", locked_price: 42, moved_from_lock_id: "lock-b" } },
      error: null,
    }));
    await expect(svc.move("rest-1", "lock-b", "inv-a", undefined, "user-5")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.move("rest-1", "lock-b", undefined, 42, "user-5")).rejects.toBeInstanceOf(BadRequestException);
    expect(rpcs).toHaveLength(0);
    const r = await svc.move("rest-1", "lock-b", "inv-a", 42, "user-5");
    expect(rpcs[0][1]).toEqual({
      p_restaurant_id: "rest-1",
      p_lock_id: "lock-b",
      p_target_inventory_id: "inv-a",
      p_price: 42,
      p_actor: "user-5",
      p_note: null,
    });
    expect(r).toMatchObject({ outcome: "moved", previousLockId: "lock-b", lock: { movedFromLockId: "lock-b", lockedPrice: 42 } });
  });
});
