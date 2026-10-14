import { HttpStatus } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { InventoryController } from "./inventory.controller";
import {
  blindCountForStaff,
  mapStockCountResult,
  openTenthsToMl,
} from "./stock-count-result";

/**
 * F-1544, lane 2: a count names its open bottles and its stock-take.
 * The founder's picks, 2026-10-12 (S224): F2 (a) a line posts at once as its
 * counter and only a second line for the same shelf in one walk is held;
 * F3 (a) staff enter tenths, the one writer stores integer ml.
 *
 * The SQL (open ml set under the lock, the hold, the replay) is proven in
 * PGlite: supabase/tests/20270113100000_a_count_names_its_open_bottles_test.sql.
 * This file proves what the gateway sends and refuses.
 */

const HOUSE = "house-a";
const ITEM = "item-yakut";
const SHELF = "shelf-bar";
const WALK = "session-1";
const ME = "user-bartender";
const HOUR = 3_600_000;

const BASE_RESULT = {
  count_id: "c1",
  expected_qty: 6,
  counted_qty: 5,
  variance_qty: -1,
  transaction_id: "t1",
  counted_at: "2026-10-12T22:00:00Z",
  location_id: SHELF,
  replayed: false,
};

/** A client whose reads answer from `tables`, one array per table. */
function service(
  tables: Record<string, any[]> = {},
  result: Record<string, unknown> = BASE_RESULT,
) {
  const rpc = jest.fn().mockResolvedValue({ data: result, error: null });
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const rows = tables[table] ?? [];
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      in: () => chain,
      is: () => chain,
      limit: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === "restaurant_inventory" && !tables[table]
              ? { id: ITEM }
              : (rows[0] ?? null),
          error: null,
        }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return chain;
  };
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => ({ rpc, from }) };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  svc.fetchLotRollup = jest.fn().mockResolvedValue(new Map());
  svc.fetchLocationBreakdown = jest.fn().mockResolvedValue(new Map());
  svc.gradePhotoCountSuggestion = jest.fn().mockResolvedValue(undefined);
  return { svc: svc as InventoryService & Record<string, any>, rpc, reads };
}

const walk = (kind = "closing") => ({
  stock_count_sessions: [{ id: WALK, kind }],
});

describe("tenths of a bottle become integer ml (F3 a)", () => {
  it("reads tenths against the item's bottle, and 750 ml when it states none (ADR 0297)", () => {
    expect(openTenthsToMl(7, 750)).toBe(525);
    expect(openTenthsToMl(13, 750)).toBe(975);
    expect(openTenthsToMl(3, 1000)).toBe(300);
    expect(openTenthsToMl(5, null)).toBe(375);
    expect(openTenthsToMl(0, 700)).toBe(0);
  });

  it("refuses what is not a whole number of tenths at or above nothing", () => {
    for (const bad of [-1, 2.5, "x", null, ""]) {
      expect(openTenthsToMl(bad, 750)).toBeNull();
    }
  });
});

describe("F-1675 -- an item counted whole is never a shelf line of a walk (ADR 0343 §4)", () => {
  const line = (clientCountId: string) => ({
    countedQty: 3,
    clientCountId,
    performedBy: ME,
    locationId: SHELF,
    sessionId: WALK,
  });

  it("[REVERT-FAILS] refuses a walk line for an item with bottles on no shelf, counting nothing", async () => {
    const { svc, rpc } = service({
      ...walk(),
      inventory_lots: [
        { location_id: SHELF, qty: 3 },
        { location_id: null, qty: 2 },
      ],
    });
    const out = svc.recordSpotCount(HOUSE, ITEM, line("find-1"));
    await expect(out).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await expect(out).rejects.toThrow(/counted whole on Inventory/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] refuses one for an item with bottles on a place that holds other places", async () => {
    const { svc, rpc } = service({
      ...walk(),
      inventory_lots: [{ location_id: "zone-cellar", qty: 4 }],
      storage_locations: [{ id: "rack-a", is_active: true }],
    });
    await expect(
      svc.recordSpotCount(HOUSE, ITEM, line("find-2")),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("posts a walk line for an item whose bottles are all on shelves", async () => {
    const { svc, rpc } = service({
      ...walk(),
      inventory_lots: [{ location_id: SHELF, qty: 3 }],
      storage_locations: [],
    });
    await svc.recordSpotCount(HOUSE, ITEM, line("find-3"));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a spot count with no walk is exactly what it was: nothing read for it", async () => {
    const { svc, rpc, reads } = service({
      inventory_lots: [{ location_id: null, qty: 2 }],
    });
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "spot-w",
      locationId: SHELF,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(reads).not.toContain("storage_locations");
  });
});

describe("a line of a stock-take names its walk and its open bottles", () => {
  it("sends the walk and the open ml in tenths converted on the item's bottle", async () => {
    const { svc, rpc } = service({
      ...walk(),
      restaurant_inventory: [{ id: ITEM, bottle_size_ml: 700 }],
    });
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "line-1",
      performedBy: ME,
      locationId: SHELF,
      sessionId: WALK,
      openTenths: 4,
    });
    const [, args] = rpc.mock.calls[0];
    expect(args).toMatchObject({
      p_session_id: WALK,
      p_counted_open_ml: 280,
      p_location_id: SHELF,
      p_performed_by: ME,
      p_idempotency_key: `count:${ITEM}:line-1`,
    });
  });

  it("a spot count that names open ml only sends it, and no walk", async () => {
    const { svc, rpc, reads } = service();
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "spot-1",
      locationId: SHELF,
      openMl: 0,
    });
    const [, args] = rpc.mock.calls[0];
    expect(args.p_counted_open_ml).toBe(0);
    expect(args).not.toHaveProperty("p_session_id");
    expect(reads).not.toContain("stock_count_sessions");
  });

  it("a spot count naming neither answers in exactly the base's shape", async () => {
    const { svc } = service();
    const out: any = await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "spot-2",
    });
    expect(Object.keys(out.count).sort()).toEqual([
      "countId",
      "countedAt",
      "countedQty",
      "expectedQty",
      "replayed",
      "transactionId",
      "varianceQty",
    ]);
  });

  it("refuses another house's walk, counting nothing", async () => {
    const { svc, rpc } = service({ stock_count_sessions: [] });
    await expect(
      svc.recordSpotCount(HOUSE, ITEM, {
        countedQty: 5,
        clientCountId: "line-2",
        sessionId: "someone-elses",
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an opening walk's lines are opening counts, and only its lines are", async () => {
    const opening = service(walk("opening"));
    await expect(
      opening.svc.recordSpotCount(HOUSE, ITEM, {
        countedQty: 5,
        clientCountId: "line-3",
        sessionId: WALK,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    const closing = service(walk("closing"));
    await expect(
      closing.svc.recordSpotCount(HOUSE, ITEM, {
        countedQty: 5,
        clientCountId: "line-4",
        sessionId: WALK,
        opening: true,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(opening.rpc).not.toHaveBeenCalled();
    expect(closing.rpc).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a line taken after the walk was stopped or signed off counts nothing; one taken before lands (F-1660)", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    for (const ended of [
      { status: "abandoned", abandoned_at: tenMinAgo },
      { status: "signed_off", signed_off_at: tenMinAgo },
    ]) {
      const late = service({
        stock_count_sessions: [{ id: WALK, kind: "closing", ...ended }],
      });
      await expect(
        late.svc.recordSpotCount(HOUSE, ITEM, {
          countedQty: 0,
          clientCountId: "line-after",
          sessionId: WALK,
          countedAgoMs: 60_000,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
      expect(late.rpc).not.toHaveBeenCalled();
      const early = service({
        stock_count_sessions: [{ id: WALK, kind: "closing", ...ended }],
      });
      await early.svc.recordSpotCount(HOUSE, ITEM, {
        countedQty: 5,
        clientCountId: "line-before",
        sessionId: WALK,
        countedAgoMs: 20 * 60_000,
      });
      expect(early.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses open bottles said twice, below nothing, or in parts of a tenth", async () => {
    const { svc, rpc } = service(walk());
    for (const open of [
      { openMl: 100, openTenths: 1 },
      { openMl: -5 },
      { openMl: 12.5 },
      { openTenths: 2.5 },
    ]) {
      await expect(
        svc.recordSpotCount(HOUSE, ITEM, {
          countedQty: 1,
          clientCountId: "bad",
          sessionId: WALK,
          ...open,
        }),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("a line older than 72 h needs an owner or a manager (ADR 0286)", () => {
  it("refuses a bartender's line counted 73 h ago, in words, counting nothing", async () => {
    const { svc, rpc } = service(walk());
    await expect(
      svc.recordSpotCount(HOUSE, ITEM, {
        countedQty: 5,
        clientCountId: "old-1",
        sessionId: WALK,
        locationId: SHELF,
        countedAgoMs: 73 * HOUR,
        role: "staff",
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps a manager's, dated when it was counted", async () => {
    const { svc, rpc } = service(walk());
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "old-2",
      sessionId: WALK,
      locationId: SHELF,
      countedAgoMs: 73 * HOUR,
      role: "manager",
    });
    const [, args] = rpc.mock.calls[0];
    expect(Date.now() - Date.parse(args.p_counted_at)).toBeGreaterThanOrEqual(
      73 * HOUR,
    );
  });

  it("control: a spot count of the same age is taken as before (strict no-op)", async () => {
    const { svc, rpc } = service();
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "old-3",
      locationId: SHELF,
      countedAgoMs: 73 * HOUR,
      role: "staff",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("a queued open-bottle count a pour overtook is refused (F-249 for open ml)", () => {
  it("refuses it when a glass of the item was poured since", async () => {
    const { svc, rpc } = service({
      ...walk(),
      pour_events: [{ id: "pour-1" }],
    });
    await expect(
      svc.recordSpotCount(HOUSE, ITEM, {
        countedQty: 5,
        clientCountId: "q-1",
        sessionId: WALK,
        locationId: SHELF,
        openMl: 300,
        countedAgoMs: HOUR,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("control: a sealed-only count does not read the pours", async () => {
    const { svc, rpc, reads } = service({
      ...walk(),
      pour_events: [{ id: "pour-1" }],
    });
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "q-2",
      sessionId: WALK,
      locationId: SHELF,
      countedAgoMs: HOUR,
    });
    expect(reads).not.toContain("pour_events");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a retried line already held replays, even though stock moved since", async () => {
    const { svc, rpc } = service({
      ...walk(),
      stock_count_held_lines: [{ id: "held-1" }],
      pour_events: [{ id: "pour-1" }],
      inventory_transactions: [{ id: "sale-1", metadata: null }],
    });
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 5,
      clientCountId: "q-3",
      sessionId: WALK,
      locationId: SHELF,
      openMl: 300,
      countedAgoMs: HOUR,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("a held line and a blind answer", () => {
  const HELD = {
    count_id: null,
    held: true,
    held_line_id: "h1",
    held_against: "c0",
    counted_qty: 9,
    counted_open_ml: 0,
    counted_at: "2026-10-12T22:00:00Z",
    location_id: SHELF,
    session_id: WALK,
    replayed: false,
  };

  it("maps a held line as held, with no count, and grades no photo", async () => {
    const { svc } = service(walk(), HELD);
    const out: any = await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 9,
      clientCountId: "dup-1",
      sessionId: WALK,
      locationId: SHELF,
    });
    expect(out.count).toMatchObject({
      held: true,
      heldLineId: "h1",
      countId: null,
      sessionId: WALK,
    });
    expect((svc as any).gradePhotoCountSuggestion).not.toHaveBeenCalled();
  });

  it("drops the books' figure and the difference for staff, keeps what they counted", () => {
    const count = mapStockCountResult({
      ...BASE_RESULT,
      expected_open_ml: 600,
      counted_open_ml: 150,
      variance_open_ml: -450,
      session_id: WALK,
      held: false,
    });
    expect(blindCountForStaff(count)).toMatchObject({
      countedQty: 5,
      countedOpenMl: 150,
      expectedQty: null,
      varianceQty: null,
      expectedOpenMl: null,
      varianceOpenMl: null,
    });
  });

  async function viaController(role: string, sessionId?: string) {
    const ctl = Object.create(InventoryController.prototype) as any;
    ctl.inventoryService = {
      recordSpotCount: jest.fn().mockResolvedValue({
        item: null,
        count: mapStockCountResult({
          ...BASE_RESULT,
          ...(sessionId ? { session_id: sessionId, held: false } : {}),
        }),
      }),
    };
    const out = await ctl.recordSpotCount(
      HOUSE,
      ITEM,
      { countedQty: 5, clientCountId: "c", sessionId },
      { userId: ME, role },
    );
    return { out, svc: ctl.inventoryService };
  }

  it("a bartender's walk line answers blind; a manager's answers in full", async () => {
    const staff = await viaController("staff", WALK);
    expect(staff.out.count).toMatchObject({
      expectedQty: null,
      varianceQty: null,
    });
    expect(staff.svc.recordSpotCount.mock.calls[0][2]).toMatchObject({
      sessionId: WALK,
      role: "staff",
      performedBy: ME,
    });
    const boss = await viaController("manager", WALK);
    expect(boss.out.count).toMatchObject({ expectedQty: 6, varianceQty: -1 });
  });

  it("control: a bartender's spot count answers as it did", async () => {
    const staff = await viaController("staff");
    expect(staff.out.count).toMatchObject({ expectedQty: 6, varianceQty: -1 });
  });
});

describe("a walk's shelf line for an item counted whole is refused (F-1683, the F-945 rule)", () => {
  const line = {
    countedQty: 12,
    clientCountId: "line-whole",
    performedBy: ME,
    locationId: SHELF,
    sessionId: WALK,
  };

  it("refuses when the item has live bottles on no shelf (an opening file with no Shelf column)", async () => {
    const { svc, rpc } = service({
      ...walk(),
      inventory_lots: [{ location_id: null, qty: 12 }],
    });
    await expect(svc.recordSpotCount(HOUSE, ITEM, line)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      message: expect.stringMatching(/Count it on Inventory, all at once/),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when the bottles sit on a place that holds other places", async () => {
    const { svc, rpc } = service({
      ...walk(),
      inventory_lots: [{ location_id: "zone-cellar", qty: 12 }],
      storage_locations: [
        { parent_id: "zone-cellar", is_active: true, deleted_at: null },
      ],
    });
    await expect(svc.recordSpotCount(HOUSE, ITEM, line)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("control: bottles on leaf shelves post the line as before", async () => {
    const { svc, rpc } = service({
      ...walk(),
      inventory_lots: [{ location_id: SHELF, qty: 12 }],
      storage_locations: [
        { parent_id: "zone-cellar", is_active: true, deleted_at: null },
      ],
    });
    await svc.recordSpotCount(HOUSE, ITEM, line);
    expect(rpc).toHaveBeenCalledWith(
      "record_stock_count",
      expect.objectContaining({ p_location_id: SHELF, p_session_id: WALK }),
    );
  });

  it("control: a spot count with no stock-take is not touched", async () => {
    const { svc, rpc } = service({
      inventory_lots: [{ location_id: null, qty: 12 }],
    });
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 12,
      clientCountId: "spot-1",
      locationId: SHELF,
    });
    expect(rpc).toHaveBeenCalled();
  });
});
