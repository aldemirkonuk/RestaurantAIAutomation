import { InventoryService } from "../inventory/inventory.service";
import { MarginAdviceService } from "../pricing/margin-advice.service";
import { PriceLocksService } from "../pricing/price-locks.service";

/**
 * QA round 22 (#945): the analytics loaders and margin advice read the cost
 * agreed at delivery through `resolveUnitCost` (invoice, agreed, last price,
 * unknown), but the inventory list and the price-lock list still read the raw
 * rollup. So the inventory page and the lock list could disagree with
 * analytics about what a bottle cost.
 *
 * Each case runs the three real readers against one fake house and asserts
 * they give the same answer: margin advice (the reader #945 wired, the
 * reference), the inventory list, and the lock list's advice. The rows are the
 * ones QA measured in PGlite (round22-probes-mailsettle/945-sql-results.txt):
 *
 *   verified_then_sold          4 bottles, final, invoice 12.00
 *   verified_manual_then_sold   4 bottles, final, manual 12.50 (agreed at delivery)
 *   agreed_only                 6 bottles, PROVISIONAL, manual 12.12 (not settled)
 */

type Row = Record<string, any>;

function fakeClient(tables: Record<string, Row[]>, fails: Record<string, string> = {}) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const failed = () => ({ data: null, error: { message: fails[table] } });
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
      maybeSingle: async () => (fails[table] ? failed() : { data: rows()[0] ?? null, error: null }),
      then(resolve: any) {
        resolve(fails[table] ? failed() : { data: rows(), error: null });
      },
    };
    return api;
  };
  return { from, rpc: async () => ({ data: null, error: { message: "no rpc" } }) };
}

const H = "rest-1";
const INVOICE = "inv-invoice";
const AGREED = "inv-agreed";
const PROVISIONAL = "inv-provisional";

function wine(id: string, name: string): Row {
  return {
    id,
    restaurant_id: H,
    master_wine_id: `mw-${id}`,
    wine_name: name,
    is_active: true,
    deleted_at: null,
    sale_type: "bottle",
    menu_price_current: "60.00",
    menu_price_glass: null,
    last_purchase_price: null,
    bottle_size_ml: 750,
    master_wine_library: { name, vintage: 2020, bottle_size_ml: 750 },
  };
}

function lock(id: string, inventoryId: string): Row {
  return {
    id,
    restaurant_id: H,
    inventory_id: inventoryId,
    kind: "bottle",
    locked_price: "60.00",
    locked_by: "user-5",
    locked_at: new Date(Date.now() - 86_400_000).toISOString(),
    note: null,
    moved_from_lock_id: null,
    released_at: null,
  };
}

function house(): Record<string, Row[]> {
  return {
    restaurant_inventory: [
      wine(INVOICE, "verified_then_sold"),
      wine(AGREED, "verified_manual_then_sold"),
      wine(PROVISIONAL, "agreed_only"),
    ],
    // As the views answer for those lots (945-sql-results.txt).
    inventory_lot_rollup: [
      { inventory_id: INVOICE, restaurant_id: H, live_qty: 4, wac: "12.00", has_invoice_cost: true, wac_qty: 4 },
      { inventory_id: AGREED, restaurant_id: H, live_qty: 4, wac: "12.50", has_invoice_cost: false, wac_qty: 4 },
      { inventory_id: PROVISIONAL, restaurant_id: H, live_qty: 6, wac: "12.12", has_invoice_cost: false, wac_qty: 6 },
    ],
    inventory_lot_agreed_cost: [
      { inventory_id: INVOICE, restaurant_id: H, agreed_qty: 4, agreed_wac: "12.000000", has_agreed_cost: true },
      { inventory_id: AGREED, restaurant_id: H, agreed_qty: 4, agreed_wac: "12.500000", has_agreed_cost: true },
      // Provisional lots never enter the agreed view.
      // Another house's agreed cost must never price this house's wine.
      { inventory_id: PROVISIONAL, restaurant_id: "rest-2", agreed_qty: 6, agreed_wac: "99.000000", has_agreed_cost: true },
    ],
    house_price_locks: [lock("lock-invoice", INVOICE), lock("lock-agreed", AGREED), lock("lock-provisional", PROVISIONAL)],
    restaurants: [
      {
        id: H,
        target_margin_bottle_pct: "65.00",
        target_margin_glass_pct: "75.00",
        target_margin_band_pct: "2.00",
        target_margin_set_by: "user-5",
        target_margin_set_at: new Date().toISOString(),
        default_pour_ml: 150,
        pour_size_confirmed_by: "user-5",
        pour_size_confirmed_at: new Date().toISOString(),
      },
    ],
    restaurant_menus: [],
    menu_items: [],
    users: [{ user_id: "user-5", name: "Aylin", role: "manager", restaurant_id: H }],
    user_restaurant_access: [{ user_id: "user-5", restaurant_id: H, role: "manager", is_active: true }],
    inventory_location_breakdown: [],
    inventory_analytics: [],
  };
}

async function readAll(tables: Record<string, Row[]>, fails: Record<string, string> = {}) {
  const client = fakeClient(tables, fails);
  const db: any = {
    client,
    getClient: () => client,
    getRestaurantInventory: async (rid: string) =>
      (tables.restaurant_inventory ?? []).filter((r) => r.restaurant_id === rid),
  };
  const advice = new MarginAdviceService(db);
  const inventory = await new InventoryService(db).getRestaurantInventory(H);
  const locks = await new PriceLocksService(db, advice).list(H);
  const reference = fails.inventory_lot_agreed_cost ? null : await advice.adviseHouse(H);
  return {
    item: (id: string) => inventory.find((r: Row) => r.id === id)!,
    lock: (id: string) => locks.locks.find((l) => l.inventoryId === id)!,
    ref: (id: string) => reference!.wines.find((w) => w.inventoryId === id)!,
    inventory,
    locks,
  };
}

describe("the inventory list and the price locks read the same cost as analytics (QA 22, #945)", () => {
  it("invoice-verified lot: every reader says 12.00 from the invoice", async () => {
    const r = await readAll(house());
    expect(r.ref(INVOICE)).toMatchObject({ bottleCost: 12, costBasis: "invoice_lot_wac" });

    const item = r.item(INVOICE);
    expect(item.unitCost).toBe(12);
    expect(item.costBasis).toBe("invoice_lot_wac");
    expect(item.wac).toBe(12);
    expect(item.costProvenance).toBe("invoice");
    expect(item.costReadable).toBe(true);

    expect(r.lock(INVOICE).advice).toMatchObject({
      state: r.ref(INVOICE).bottle!.state,
      advisedPrice: r.ref(INVOICE).bottle!.advisedPrice,
    });
  });

  it("agreed lot: every reader says 12.50 agreed at delivery, never 'estimated' and never unknown", async () => {
    const r = await readAll(house());
    expect(r.ref(AGREED)).toMatchObject({ bottleCost: 12.5, costBasis: "agreed_lot_wac" });

    const item = r.item(AGREED);
    // The page's existing label used to call a settled, agreed price "estimated".
    expect(item.costProvenance).toBe("agreed");
    expect(item.wac).toBe(12.5);
    expect(item.unitCost).toBe(12.5);
    expect(item.costBasis).toBe("agreed_lot_wac");

    const l = r.lock(AGREED);
    expect(l.markers).not.toContain("advice_unknown");
    expect(l.advice).toMatchObject({
      state: r.ref(AGREED).bottle!.state,
      advisedPrice: r.ref(AGREED).bottle!.advisedPrice,
    });
    expect(l.advice!.advisedPrice).not.toBeNull();
  });

  it("unknown cost: an unsettled (provisional) price is unknown to every reader, and unknown is null, never 0", async () => {
    const r = await readAll(house());
    expect(r.ref(PROVISIONAL)).toMatchObject({ bottleCost: null, costBasis: "unknown" });

    const item = r.item(PROVISIONAL);
    // The page used to show the raw rollup average, 12.12 "estimated", for a
    // cost analytics calls unknown.
    expect(item.wac).toBeUndefined();
    expect(item.costProvenance).toBeUndefined();
    expect(item.unitCost).toBeNull();
    expect(item.unitCost).not.toBe(0);
    expect(item.costBasis).toBe("unknown");
    // The foreign house's 99.00 agreed cost did not leak in.
    expect(item.unitCost).not.toBe(99);

    const l = r.lock(PROVISIONAL);
    expect(l.markers).toContain("advice_unknown");
    expect(l.advice).toMatchObject({ state: "no_cost", advisedPrice: null });
    expect(l.advice!.state).toBe(r.ref(PROVISIONAL).bottle!.state);
    expect(l.adviceUnknownReason).toMatch(/no recorded cost/);
  });

  it("a failed read of the agreed costs is said, never taken for 'no recorded cost'", async () => {
    const r = await readAll(house(), { inventory_lot_agreed_cost: "permission denied" });
    expect(r.inventory.every((i: Row) => i.costReadable === false)).toBe(true);
    // The invoice is still read; the agreed-only wine is unknown, flagged as a failed read.
    expect(r.item(INVOICE).unitCost).toBe(12);
    expect(r.item(AGREED).unitCost).toBeNull();

    expect(r.locks.markersReadable).toBe(false);
    expect(r.locks.markersReason).toMatch(/agreed at delivery could not be read/);
    expect(r.lock(AGREED).advice).toBeNull();
    expect(r.lock(AGREED).markers).not.toContain("off_target");
  });
});
