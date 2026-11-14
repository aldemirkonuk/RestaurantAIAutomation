/**
 * r31 walk w2, F1: a pack typed at the door reaches the paper's billed side
 * and the cost.
 *
 * P1 as walked: an invoice bills "2 cases" of a Brut at 1800 a case (line
 * total 3600) and never says how many bottles a case holds, so its line is
 * stored with pack 1. The door, holding the case, says 12 and books 24
 * bottles. Before this fix the delivery read OVER SHIP "24 against 2", told
 * the house it differed, refused AGREED, and VERIFIED left the lot
 * provisional. With the door's pack: billed 24, verdict ok, lot cost 150.
 *
 * The client below FILTERS on `.eq` / `.in` (the shared delivery mock does
 * not), so a pack read from the wrong paper or the wrong line is a failure
 * here, not a pass for a reason that is not true of the database.
 */

import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryStockService } from "./delivery-stock.service";
import { doorCountsOfPapers, withTheDoorsPack } from "./door-received";
import { doorAgainstPaper } from "./from-parsed-document";

const REST = "rest-1";
const DEL = "del-1";
const PAPER = "paper-1";
const DOOR = "door-1";
const ITEM = "item-brut";

type Row = Record<string, unknown>;

function tableClient(tables: Record<string, Row[]>, rpcs: { fn: string; args: Row }[] = []) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let single = false;
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const v of ["select", "order", "limit", "range", "not", "is", "neq", "gte", "lte"]) chain[v] = self;
    chain.eq = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return chain;
    };
    chain.in = (col: string, vals: unknown[]) => {
      rows = rows.filter((r) => vals.includes(r[col]));
      return chain;
    };
    chain.maybeSingle = () => {
      single = true;
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve);
    return chain;
  };
  return {
    getClient: () => ({
      from,
      rpc: async (fn: string, args: Row) => {
        rpcs.push({ fn, args });
        return { data: { lots_matched: 1, lots_finalised: 1, bottles_finalised: 24 }, error: null };
      },
    }),
  };
}

/** P1: the paper bills 2 cases at 1800, pack never stated; the door counts 2 cases of 12. */
function p1(over: { paperPack?: number; doorPack?: number; doorUom?: string; paperUom?: string } = {}): Record<string, Row[]> {
  const paperPack = over.paperPack ?? 1;
  const doorPack = over.doorPack ?? 12;
  const paperUom = over.paperUom ?? "case";
  return {
    deliveries: [{ id: DEL, restaurant_id: REST, state: "AGREED", order_id: null }],
    inventory_transactions: [{ delivery_id: DEL, inventory_id: ITEM, quantity_change: 2 * doorPack }],
    document_deliveries: [
      { document_id: PAPER, delivery_id: DEL, role: "invoice" },
      { document_id: DOOR, delivery_id: DEL, role: "door_count" },
    ],
    procurement_documents: [
      { id: PAPER, restaurant_id: REST, doc_number: "P1", currency: "TRY", extracted: null, created_at: "2026-11-13T09:00:00Z" },
      { id: DOOR, restaurant_id: REST, extracted: { countedFor: PAPER, countedAt: "2026-11-13T10:00:00Z" }, created_at: "2026-11-13T10:00:00Z" },
    ],
    procurement_document_lines: [
      {
        id: "pl-1", document_id: PAPER, restaurant_id: REST, line_no: 1, inventory_id: ITEM,
        qty: 2, uom: paperUom, pack_size: paperPack, qty_bottles: 2 * paperPack, free_goods_qty: 0,
        unit_price: 1800, line_total: 3600, price_base_qty: null, price_base_uom: null,
        description: "Local Check Brut NV KOLİ", vendor_sku: null, format_ml: 750,
      },
      {
        id: "dl-1", document_id: DOOR, restaurant_id: REST, line_no: 1, inventory_id: ITEM,
        qty: 2, uom: over.doorUom ?? paperUom, pack_size: doorPack, qty_bottles: 2 * doorPack, free_goods_qty: 0,
        unit_price: null, line_total: null, description: "Local Check Brut NV KOLİ", vendor_sku: null, format_ml: 750,
      },
    ],
    restaurant_inventory: [{ id: ITEM, restaurant_id: REST, uom: "bottle" }],
    restaurants: [{ id: REST, currency: "TRY" }],
    delivery_proposals: [],
  };
}

describe("withTheDoorsPack (r31 w2 F1)", () => {
  const line = (over: Row = {}) => ({ uom: "case", pack_size: 1, qty: 2, qty_bottles: 2, ...over });

  it("a case the paper sizes nowhere is read with the door's pack", () => {
    expect(withTheDoorsPack(line(), 12)).toMatchObject({ pack_size: 12, qty_bottles: 24, pack_from_door: 12 });
  });

  it("a pack and a split case are read the same way", () => {
    expect(withTheDoorsPack(line({ uom: "pack" }), 6)).toMatchObject({ qty_bottles: 12, pack_from_door: 6 });
    expect(withTheDoorsPack(line({ uom: "split_case" }), 6)).toMatchObject({ qty_bottles: 12, pack_from_door: 6 });
  });

  it("a pack the paper states is never overridden from the door", () => {
    const r = withTheDoorsPack(line({ pack_size: 6, qty_bottles: 12 }), 12);
    expect(r).toMatchObject({ pack_size: 6, qty_bottles: 12 });
    expect(r.pack_from_door).toBeUndefined();
  });

  it("a bottle line, and a door that states no pack, are read as stored", () => {
    expect(withTheDoorsPack(line({ uom: "bottle" }), 12)).toEqual(line({ uom: "bottle" }));
    expect(withTheDoorsPack(line(), 1)).toEqual(line());
    expect(withTheDoorsPack(line(), null)).toEqual(line());
  });

  it("counts from the paper's own quantity, not a stored bottle figure", () => {
    expect(withTheDoorsPack(line({ qty: 3, qty_bottles: 3 }), 12).qty_bottles).toBe(36);
    expect(withTheDoorsPack({ uom: "case", pack_size: 1, qty_bottles: 3 }, 12).qty_bottles).toBe(36);
  });
});

describe("doorCountsOfPapers keeps the door's pack (r31 w2 F1)", () => {
  it("per paper line: what was counted and the pack the door gave", async () => {
    const r = await doorCountsOfPapers(tableClient(p1()).getClient(), REST, [PAPER]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...(r.value.get(PAPER)?.received ?? [])]).toEqual([[1, 24]]);
    expect([...(r.value.get(PAPER)?.packs ?? [])]).toEqual([[1, 12]]);
  });

  it("a later count's pack wins; a later count that states none leaves the earlier one", async () => {
    const t = p1({ doorPack: 6 });
    t.procurement_documents.push(
      { id: "door-2", restaurant_id: REST, extracted: { countedFor: PAPER, countedAt: "2026-11-13T11:00:00Z" } },
      { id: "door-3", restaurant_id: REST, extracted: { countedFor: PAPER, countedAt: "2026-11-13T12:00:00Z" } },
    );
    t.document_deliveries.push(
      { document_id: "door-2", delivery_id: DEL, role: "door_count" },
      { document_id: "door-3", delivery_id: DEL, role: "door_count" },
    );
    t.procurement_document_lines.push(
      { document_id: "door-2", restaurant_id: REST, line_no: 1, qty_bottles: 24, pack_size: 12 },
      { document_id: "door-3", restaurant_id: REST, line_no: 1, qty_bottles: 0, pack_size: 1 },
    );
    const r = await doorCountsOfPapers(tableClient(t).getClient(), REST, [PAPER]);
    expect(r.ok && [...(r.value.get(PAPER)?.packs ?? [])]).toEqual([[1, 12]]);
  });

  it("another paper's count gives this paper no pack", async () => {
    const t = p1();
    (t.procurement_documents[1].extracted as Row).countedFor = "another-paper";
    const r = await doorCountsOfPapers(tableClient(t).getClient(), REST, [PAPER]);
    expect(r.ok && r.value.get(PAPER)).toBeUndefined();
  });
});

describe("the door's pack on the billed side (r31 w2 F1)", () => {
  it("P1's numbers: 24 counted against 24 billed is ok", () => {
    expect(doorAgainstPaper(24, 24, { received: 24 } as never)).toBe("ok");
  });

  it("the difference scan reads P1 as no difference, so AGREED is not refused", async () => {
    const svc = new DeliveryService(
      tableClient(p1()) as unknown as DatabaseService,
      {} as DeliveryClockService,
      {} as NotificationsService,
      {} as DeliveryStockService,
    );
    const scan = await (svc as unknown as { scanDifferences: (d: Row) => Promise<{ status: string; differing?: unknown[]; unmatched?: unknown[] }> })
      .scanDifferences({ id: DEL, restaurant_id: REST, order_id: null });
    expect(scan.status).toBe("compared");
    expect(scan.differing ?? []).toEqual([]);
    expect(scan.unmatched ?? []).toEqual([]);
  });

  it("with a pack the paper states, the door's pack is not used (12 counted against 6 billed differs)", async () => {
    // The paper says 3 to a case (6 bottles); the door booked 2 cases of 12.
    const t = p1({ paperPack: 3, doorPack: 12 });
    const svc = new DeliveryService(
      tableClient(t) as unknown as DatabaseService,
      {} as DeliveryClockService,
      {} as NotificationsService,
      {} as DeliveryStockService,
    );
    const scan = await (svc as unknown as { scanDifferences: (d: Row) => Promise<{ differing?: unknown[] }> })
      .scanDifferences({ id: DEL, restaurant_id: REST, order_id: null });
    expect((scan.differing ?? []).length).toBe(1);
  });
});

describe("VERIFIED prices a case through the door's pack (r31 w2 F1)", () => {
  it("P1: 1800 a case of 12 is 150 a bottle, final, and the basis says the pack is the door's", async () => {
    const rpcs: { fn: string; args: Row }[] = [];
    const svc = new DeliveryStockService(tableClient(p1(), rpcs) as unknown as DatabaseService);
    const res = await svc.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stillProvisional).toEqual([]);
    expect(res.value.finalised).toHaveLength(1);
    expect(res.value.finalised[0]).toMatchObject({ inventoryId: ITEM, unitCost: 150, provenance: "invoice" });
    expect(res.value.finalised[0].basis).toContain("12 is what the door counted");
    const call = rpcs.find((c) => c.fn === "finalise_delivery_cost");
    expect(call?.args).toMatchObject({ p_inventory_id: ITEM, p_unit_cost: 150 });
  });

  it("the money holds whatever the pack: a door that says 6 gives 300 a bottle (12 × 300 = 3600)", async () => {
    const rpcs: { fn: string; args: Row }[] = [];
    const svc = new DeliveryStockService(tableClient(p1({ doorPack: 6 }), rpcs) as unknown as DatabaseService);
    const res = await svc.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok && res.value.finalised[0]?.unitCost).toBe(300);
  });

  it("with no door count on the delivery, the case price stays held as before", async () => {
    const t = p1();
    t.document_deliveries = t.document_deliveries.filter((r) => r.role !== "door_count");
    const svc = new DeliveryStockService(tableClient(t) as unknown as DatabaseService);
    const res = await svc.finaliseAtVerified(REST, DEL, "u1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.finalised).toEqual([]);
    expect(res.value.stillProvisional[0]?.reason).toContain("does not state how many bottles a case holds");
  });
});
