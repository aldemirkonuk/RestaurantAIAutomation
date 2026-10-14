import { HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { TransactionType } from "../inventory-ledger/dto/inventory-ledger.dto";

/**
 * F-1731. A pour or a breakage kept on a phone with no signal was booked when
 * it was SENT, with no tap time: at 23:40 the bartender pours in the cellar,
 * at 23:55 a colleague counts that shelf on another phone (the bottle already
 * gone), at 00:10 the pour is sent and taken off a second time, dated the
 * next day. A late act now says how old it is: it is dated by its tap, and a
 * count of its shelf (or of every shelf) taken after the tap refuses it.
 *
 * The services are built without their constructors, as in
 * stock-wrappers-refuse-foreign-items.spec.ts; the RPC fails after the gate so
 * each case stops there and its arguments can be read.
 */
type Count = { id: string; location_id: string | null; counted_at: string };

function clientWith(opts: { counts?: Count[]; landed?: boolean }) {
  const rpc = jest.fn().mockResolvedValue({
    data: null,
    error: { message: "stubbed rpc failure after the gate" },
  });
  const gts: Array<{ table: string; col: string; at: string }> = [];
  const client = {
    rpc,
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        gt: (col: string, at: string) => {
          gts.push({ table, col, at });
          return chain;
        },
        limit: () =>
          Promise.resolve({
            data:
              table === "stock_counts"
                ? (opts.counts ?? []).filter(
                    (c) => c.counted_at > gts[gts.length - 1].at,
                  )
                : opts.landed
                  ? [{ id: "landed" }]
                  : [],
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({ data: { id: "item" }, error: null }),
        then: (res: (v: unknown) => unknown) =>
          // storage_locations: every shelf named is the house's own.
          Promise.resolve({ data: [{ id: "L-cellar" }], error: null }).then(
            res,
          ),
      };
      return chain;
    },
  };
  return { client, rpc };
}

const quietLogger = { error: () => {}, warn: () => {}, log: () => {} };
const HOUSE = "house";
const ITEM = "item";
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function pourService(opts: { counts?: Count[]; landed?: boolean } = {}) {
  const { client, rpc } = clientWith(opts);
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = quietLogger;
  return { svc: svc as InventoryService, rpc };
}

function ledgerService(opts: { counts?: Count[]; landed?: boolean } = {}) {
  const { client, rpc } = clientWith(opts);
  const svc = Object.create(InventoryLedgerService.prototype) as any;
  svc.databaseService = { supabase: client };
  svc.logger = quietLogger;
  return { svc: svc as InventoryLedgerService, rpc };
}

const pour = (over: Record<string, unknown> = {}) => ({
  pours: 1,
  locationId: "L-cellar",
  idempotencyKey: "pour:item:k1",
  ...over,
});

const breakage = (over: Record<string, unknown> = {}) =>
  ({
    inventoryId: ITEM,
    transactionType: TransactionType.WASTE,
    quantityChange: -1,
    reason: "Breakage",
    fromLocationId: "L-cellar",
    idempotencyKey: "adjust:item:k1",
    ...over,
  }) as any;

async function refusal(p: Promise<unknown>): Promise<HttpException> {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  return err as HttpException;
}

describe("F-1731: a pour kept on a phone is dated by its tap", () => {
  it("[REVERT-FAILS] a pour sent 30 minutes late is dated 30 minutes back", async () => {
    const { svc, rpc } = pourService();
    await svc
      .recordPour(HOUSE, ITEM, pour({ occurredAgoMs: 30 * MIN }), "u1", "staff")
      .catch(() => undefined);
    expect(rpc).toHaveBeenCalledTimes(1);
    const at = Date.parse(rpc.mock.calls[0][1].p_occurred_at);
    expect(Date.now() - at).toBeGreaterThanOrEqual(30 * MIN);
    expect(Date.now() - at).toBeLessThan(31 * MIN);
  });

  it("[REVERT-FAILS] another phone's count of the shelf after the tap refuses it, and nothing moves", async () => {
    const { svc, rpc } = pourService({
      counts: [
        { id: "c1", location_id: "L-cellar", counted_at: ago(15 * MIN) },
      ],
    });
    const err = await refusal(
      svc.recordPour(HOUSE, ITEM, pour({ occurredAgoMs: 30 * MIN }), "u1"),
    );
    expect(err.getStatus()).toBe(409);
    expect(err.message).toMatch(/counted after this pour/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] a count of every shelf after the tap refuses a pour that names no shelf", async () => {
    const { svc, rpc } = pourService({
      counts: [{ id: "c1", location_id: null, counted_at: ago(15 * MIN) }],
    });
    const err = await refusal(
      svc.recordPour(
        HOUSE,
        ITEM,
        pour({ locationId: null, occurredAgoMs: 30 * MIN }),
        "u1",
      ),
    );
    expect(err.getStatus()).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a count taken BEFORE the tap, or of another shelf, does not stand", async () => {
    const { svc, rpc } = pourService({
      counts: [
        { id: "c0", location_id: "L-cellar", counted_at: ago(45 * MIN) },
        { id: "c1", location_id: "L-bar", counted_at: ago(15 * MIN) },
      ],
    });
    await svc
      .recordPour(HOUSE, ITEM, pour({ occurredAgoMs: 30 * MIN }), "u1")
      .catch(() => undefined);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a pour that already landed replays instead of being refused", async () => {
    const { svc, rpc } = pourService({
      landed: true,
      counts: [{ id: "c1", location_id: null, counted_at: ago(15 * MIN) }],
    });
    await svc
      .recordPour(HOUSE, ITEM, pour({ occurredAgoMs: 30 * MIN }), "u1")
      .catch(() => undefined);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a pour sent at once carries no date and reads no counts, exactly as before", async () => {
    const { svc, rpc } = pourService({
      counts: [{ id: "c1", location_id: null, counted_at: ago(-MIN) }],
    });
    await svc.recordPour(HOUSE, ITEM, pour(), "u1").catch(() => undefined);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_occurred_at");
  });

  it("an age that is not a time is refused, not booked now", async () => {
    const { svc, rpc } = pourService();
    const err = await refusal(
      svc.recordPour(HOUSE, ITEM, pour({ occurredAgoMs: -5 }), "u1"),
    );
    expect(err.getStatus()).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("past 72 hours only an owner or a manager keeps the tap time (ADR 0286)", async () => {
    const fourDays = 96 * 60 * MIN;
    const staff = pourService();
    await staff.svc
      .recordPour(HOUSE, ITEM, pour({ occurredAgoMs: fourDays }), "u1", "staff")
      .catch(() => undefined);
    expect(
      Date.now() - Date.parse(staff.rpc.mock.calls[0][1].p_occurred_at),
    ).toBeLessThan(MIN);
    const manager = pourService();
    await manager.svc
      .recordPour(
        HOUSE,
        ITEM,
        pour({ occurredAgoMs: fourDays }),
        "u1",
        "manager",
      )
      .catch(() => undefined);
    expect(
      Date.now() - Date.parse(manager.rpc.mock.calls[0][1].p_occurred_at),
    ).toBeGreaterThanOrEqual(fourDays);
  });
});

describe("F-1731: a breakage kept on a phone is dated by its tap", () => {
  it("[REVERT-FAILS] a late breakage is dated by its tap", async () => {
    const { svc, rpc } = ledgerService();
    await svc
      .createTransaction(
        HOUSE,
        "u1",
        breakage({ occurredAgoMs: 30 * MIN }),
        "staff",
      )
      .catch(() => undefined);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("apply_stock_movement");
    const at = Date.parse(rpc.mock.calls[0][1].p_occurred_at);
    expect(Date.now() - at).toBeGreaterThanOrEqual(30 * MIN);
  });

  it("[REVERT-FAILS] a count of the shelf after the tap refuses it, and nothing moves", async () => {
    const { svc, rpc } = ledgerService({
      counts: [
        { id: "c1", location_id: "L-cellar", counted_at: ago(15 * MIN) },
      ],
    });
    const err = await refusal(
      svc.createTransaction(HOUSE, "u1", breakage({ occurredAgoMs: 30 * MIN })),
    );
    expect(err.getStatus()).toBe(409);
    expect(err.message).toMatch(/counted after this change/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a change sent at once carries no date, exactly as before", async () => {
    const { svc, rpc } = ledgerService();
    await svc.createTransaction(HOUSE, "u1", breakage()).catch(() => undefined);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_occurred_at");
  });
});
