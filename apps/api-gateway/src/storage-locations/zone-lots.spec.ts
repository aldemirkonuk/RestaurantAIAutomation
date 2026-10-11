import { ZonesService } from "../cellar/zones.service";
import { StorageLocationsService } from "./storage-locations.service";

/**
 * F-1331: one shelf had three bottle counts that disagreed, and a stock move
 * updated only one. The Storage Locations dialog read `current_occupancy` and
 * `wine_location_mappings`, the cellar floor counted
 * `restaurant_inventory.storage_location_id` titles, and only the cellar map
 * read the lots that receiving and `transfer_stock` write. Every count below
 * now reads the live lots, so a delivery and a transfer move all of them.
 *
 * The seed is built to disagree on purpose: the zone row says 40, a stale
 * mapping says 3 bottles are on Rack B, and the inventory row is filed under
 * Rack B. None of those is a bottle on a shelf.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const RACK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RACK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BAROLO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Row = Record<string, unknown>;

/** A Supabase stand-in that applies the filters the reads use. */
function fakeDb(rows: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const result = () => ({
      data: (rows[table] ?? []).filter((r) => filters.every((f) => f(r))),
      error: null,
    });
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (
        filters.push((r) => (r[c] ?? null) === v),
        q
      ),
      in: (c: string, vs: unknown[]) => (
        filters.push((r) => vs.includes(r[c])),
        q
      ),
      gt: (c: string, v: number) => (filters.push((r) => Number(r[c]) > v), q),
      not: (c: string, _op: "is", v: unknown) => (
        filters.push((r) => (r[c] ?? null) !== v),
        q
      ),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: result().data[0] ?? null,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return q;
  };
  const supabase = { from };
  return { supabase, getClient: () => supabase } as never;
}

function zone(id: string, name: string) {
  return {
    id,
    restaurant_id: HOUSE,
    zone: name,
    name,
    capacity_bottles: 60,
    current_occupancy: 40,
    deleted_at: null,
    zone_confirmed_at: "2026-10-01T10:00:00Z",
    zone_provenance: "confirmed",
  };
}

function house() {
  return {
    storage_locations: [zone(RACK_A, "Rack A"), zone(RACK_B, "Rack B")],
    inventory_lots: [] as Row[],
    wine_location_mappings: [
      {
        id: "m1",
        restaurant_id: HOUSE,
        wine_id: BAROLO,
        location_id: RACK_B,
        quantity: 3,
      },
    ],
    restaurant_inventory: [
      {
        id: "inv-1",
        restaurant_id: HOUSE,
        storage_location_id: RACK_B,
        deleted_at: null,
      },
    ],
    master_wine_library: [{ id: BAROLO, wine_name: "Barolo" }],
  };
}

/** What receiving writes: a live lot on the shelf it arrived to. */
function receive(rows: ReturnType<typeof house>, at: string, qty: number) {
  rows.inventory_lots.push({
    id: `lot-${rows.inventory_lots.length + 1}`,
    restaurant_id: HOUSE,
    inventory_id: "inv-1",
    master_wine_id: BAROLO,
    location_id: at,
    stock_state: "live",
    qty,
  });
}

/**
 * What transfer_stock does (20270101100000_a_moved_bottle_keeps_its_lot.sql):
 * take from the source shelf's lot and put a lot on the destination shelf.
 */
function transfer(
  rows: ReturnType<typeof house>,
  fromId: string,
  toId: string,
  qty: number,
) {
  const src = rows.inventory_lots.find(
    (l) => l.location_id === fromId && Number(l.qty) >= qty,
  )!;
  src.qty = Number(src.qty) - qty;
  rows.inventory_lots.push({
    ...src,
    id: `lot-moved-${toId}`,
    location_id: toId,
    qty,
  });
}

async function threeCounts(rows: ReturnType<typeof house>) {
  const db = fakeDb(rows);
  const locations = new StorageLocationsService(db);
  const zones = new ZonesService(db);
  const dialog = await locations.listLocations(HOUSE);
  const floor = await zones.read(HOUSE);
  const wines: Record<string, Array<{ quantity: number }>> = {
    [RACK_A]: await locations.getWinesAtLocation(HOUSE, RACK_A),
    [RACK_B]: await locations.getWinesAtLocation(HOUSE, RACK_B),
  };
  const count = (id: string) => ({
    dialog: dialog.find((z) => z.id === id)!.current_count,
    winesStoredHere: wines[id].reduce((n, w) => n + w.quantity, 0),
    floor: floor.confirmed.find((z) => z.id === id)!.itemsAssigned,
  });
  return { a: count(RACK_A), b: count(RACK_B), wines };
}

describe("F-1331 — one shelf, one count, from its lots", () => {
  it("a delivery received onto Rack A shows on all three surfaces", async () => {
    const rows = house();
    receive(rows, RACK_A, 12);
    const { a, b, wines } = await threeCounts(rows);
    expect(a).toEqual({ dialog: 12, winesStoredHere: 12, floor: 12 });
    // Not the row's 40, not the stale mapping's 3, not the title filed there.
    expect(b).toEqual({ dialog: 0, winesStoredHere: 0, floor: 0 });
    expect(wines[RACK_A]).toEqual([
      expect.objectContaining({
        wineId: BAROLO,
        wineName: "Barolo",
        quantity: 12,
      }),
    ]);
  });

  it("a transfer moves the number on all three surfaces", async () => {
    const rows = house();
    receive(rows, RACK_A, 12);
    transfer(rows, RACK_A, RACK_B, 5);
    const { a, b } = await threeCounts(rows);
    expect(a).toEqual({ dialog: 7, winesStoredHere: 7, floor: 7 });
    expect(b).toEqual({ dialog: 5, winesStoredHere: 5, floor: 5 });
  });

  it("shadow stock, empty lots and another house's lots are not on the shelf", async () => {
    const rows = house();
    receive(rows, RACK_A, 4);
    rows.inventory_lots.push(
      {
        ...rows.inventory_lots[0],
        id: "shadow",
        stock_state: "shadow",
        qty: 9,
      },
      { ...rows.inventory_lots[0], id: "empty", qty: 0 },
      {
        ...rows.inventory_lots[0],
        id: "theirs",
        restaurant_id: OTHER,
        qty: 50,
      },
    );
    const { a } = await threeCounts(rows);
    expect(a).toEqual({ dialog: 4, winesStoredHere: 4, floor: 4 });
  });

  it("a delete refusal counts the lots and names the wine", async () => {
    const rows = house();
    receive(rows, RACK_A, 12);
    const svc = new StorageLocationsService(fakeDb(rows));
    await expect(svc.deleteLocation(HOUSE, RACK_A)).rejects.toMatchObject({
      message: expect.stringContaining(
        "12 bottles are still in this zone: Barolo (12).",
      ),
    });
  });
});
