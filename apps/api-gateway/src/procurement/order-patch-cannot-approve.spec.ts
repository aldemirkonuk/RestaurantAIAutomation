import { HttpException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { ProcurementController } from "./procurement.controller";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { ProcurementOrderStatus as S } from "./dto/procurement.dto";
import {
  ORDER_MERGEABLE_STATUSES,
  ORDER_PRICE_OPEN_STATUSES,
} from "./order-transitions";
import { GATES_AFTER_LEDGER } from "./testing/passing-vendor-gates";

/**
 * An order is approved by a person holding Approve, and its approved price is
 * not edited afterwards (fix/order-patch-cannot-approve, 2026-10-01).
 *
 * WHAT PASSED BEFORE THIS FIX, measured against 4bd11a00e: 7 of 37 — only the
 * cases that pin what must keep working (an open order still takes a price, a
 * note on an approved order, the two folds into an open order and the fold's
 * line write). The other 30 failed. Rules: ADR 0254.
 *
 *   * `PATCH procurement/orders/:id` has no `@Roles` and hands the service no
 *     user. `updateOrder` refused only CANCELLED, and PENDING, APPROVAL_NEEDED
 *     and NEGOTIATING -> APPROVED are legal edges (the sealed act walks them),
 *     so any member of the house could approve an order with no seal, no
 *     approval rule and no approver recorded — and set `finalPrice` /
 *     `totalCost` on an order after it was approved.
 *   * `createOrder`'s dedup merge excluded seven "finished" states, so a new
 *     request for the same wine from the same vendor overwrote the quantity,
 *     prices and total of an APPROVED, APPROVAL_NEEDED or PARTIALLY_RECEIVED
 *     order.
 *
 * The harness below HONOURS the status filters (`eq`, `in`, `not ... in`) on
 * `procurement_orders`, reads and writes alike. A passthrough stub is how
 * `check_order_status_literals.py`'s defect went green; here a wrong filter
 * matches the wrong rows and the assertion sees it.
 */

type Row = Record<string, any>;

const HOUSE = "rest-1";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const INVENTORY = "22222222-2222-4222-8222-222222222222";
const PROVIDER = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
/** The route reads no role; this is whoever holds a session in the house. */
const STAFF = { userId: USER, restaurantId: HOUSE };

const EVERY_STATUS = Object.values(S);

interface Db {
  db: DatabaseService;
  orders: Row[];
  orderUpdates: Row[];
  orderInserts: Row[];
  /** Every UPDATE sent to `procurement_orders`, whether or not it matched a row. */
  updateAttempts: () => number;
  /** Every read of `procurement_orders`. */
  orderReads: () => number;
  /** Every DELETE or INSERT sent to `procurement_order_items`, with its order id. */
  lineWrites: Row[];
}

/**
 * `afterOrderRead` runs once, right after the first read of
 * `procurement_orders` settles — the window between a check and its write.
 * `afterOrderUpdate` runs once, right after the first UPDATE of
 * `procurement_orders` that matched a row — the window between the merge's
 * header and its line.
 */
function makeDb(
  seed: Row[],
  opts: {
    afterOrderRead?: (orders: Row[]) => void;
    afterOrderUpdate?: (orders: Row[]) => void;
  } = {},
): Db {
  const orders: Row[] = seed.map((r) => ({ ...r }));
  const orderUpdates: Row[] = [];
  const orderInserts: Row[] = [];
  const lineWrites: Row[] = [];
  let updateAttempts = 0;
  let orderReads = 0;
  let afterOrderRead = opts.afterOrderRead;
  let afterOrderUpdate = opts.afterOrderUpdate;

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row = {};
      let lastSelect = "";
      let limit: number | null = null;
      const filters: Array<(r: Row) => boolean> = [];
      const eqs: Row = {};

      const pick = (shape: "one" | "maybe" | "many", rows: Row[]) => {
        if (shape === "many") return { data: rows, error: null };
        if (rows.length === 1) return { data: rows[0], error: null };
        if (shape === "maybe" && rows.length === 0)
          return { data: null, error: null };
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
        };
      };

      const settle = (shape: "one" | "maybe" | "many") => {
        if (table === "providers")
          return { data: null, count: 1, error: null };
        if (table === "restaurant_inventory") {
          if (lastSelect.trim() === "id")
            return { data: { id: INVENTORY }, error: null };
          return { data: { master_wine_id: null, wine_name: "Barolo" }, error: null };
        }
        if (
          table === "procurement_order_items" &&
          (op === "delete" || op === "insert")
        ) {
          lineWrites.push({
            op,
            orderId: op === "insert" ? payload.order_id : eqs.order_id,
          });
        }
        if (table !== "procurement_orders")
          return { data: shape === "many" ? [] : null, error: null };

        if (op === "insert") {
          const row = {
            id: `new-order-${orderInserts.length + 1}`,
            ...payload,
            inventory: { wine_name: "Barolo" },
          };
          orderInserts.push({ ...payload });
          orders.push(row);
          return pick(shape, [row]);
        }

        const hit = orders.filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          updateAttempts++;
          for (const r of hit) {
            Object.assign(r, payload);
            orderUpdates.push({ id: r.id, ...payload });
          }
          const out = pick(shape, hit.map((r) => ({ ...r })));
          if (afterOrderUpdate && hit.length > 0) {
            const hook = afterOrderUpdate;
            afterOrderUpdate = undefined;
            hook(orders);
          }
          return out;
        }

        orderReads++;
        const rows = hit.map((r) => ({ ...r }));
        const out = pick(shape, limit === null ? rows : rows.slice(0, limit));
        if (afterOrderRead) {
          const hook = afterOrderRead;
          afterOrderRead = undefined;
          hook(orders);
        }
        return out;
      };

      const q: any = {
        select: (cols?: string) => {
          lastSelect = cols ?? "";
          return q;
        },
        insert: (p: Row) => {
          op = "insert";
          payload = p;
          return q;
        },
        update: (p: Row) => {
          op = "update";
          // supabase-js drops `undefined` keys before they reach PostgREST.
          payload = Object.fromEntries(
            Object.entries(p).filter(([, v]) => v !== undefined),
          );
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        eq: (col: string, v: unknown) => {
          eqs[col] = v;
          filters.push((r) => r[col] === v);
          return q;
        },
        in: (col: string, vs: unknown[]) => {
          filters.push((r) => vs.includes(r[col]));
          return q;
        },
        not: (col: string, operator: string, list: string) => {
          if (operator !== "in") throw new Error(`stub: not.${operator}`);
          const members = list
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^"|"$/g, ""));
          filters.push((r) => !members.includes(r[col]));
          return q;
        },
        neq: () => q,
        is: () => q,
        gt: () => q,
        lte: () => q,
        order: () => q,
        range: () => q,
        limit: (n: number) => {
          limit = n;
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("maybe"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;
  return {
    db,
    orders,
    orderUpdates,
    orderInserts,
    updateAttempts: () => updateAttempts,
    orderReads: () => orderReads,
    lineWrites,
  };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

function service(db: DatabaseService): ProcurementService {
  const svc = new ProcurementService(db, events, ledger, ...GATES_AFTER_LEDGER);
  for (const level of ["log", "warn", "error"] as const)
    jest.spyOn((svc as any).logger, level).mockImplementation(() => {});
  return svc;
}

function anOrder(status: S, extra: Row = {}): Row {
  return {
    id: ORDER_ID,
    restaurant_id: HOUSE,
    inventory_id: INVENTORY,
    provider_id: PROVIDER,
    order_number: "PO-2026-0007",
    status,
    quantity: 6,
    unit_type: "bottle",
    bottles_total: 6,
    quoted_price: 40,
    negotiated_price: null,
    final_price: 40,
    total_cost: 240,
    requested_at: "2026-09-30T10:00:00Z",
    inventory: { wine_name: "Barolo" },
    ...extra,
  };
}

async function refusal(fn: () => Promise<unknown>): Promise<HttpException> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof HttpException) return err;
    throw err;
  }
  throw new Error("expected a refusal, and the call succeeded");
}

const bodyOf = (err: HttpException) => err.getResponse() as Row;

describe("PATCH orders/:id cannot approve an order", () => {
  it.each([S.PENDING, S.APPROVAL_NEEDED, S.NEGOTIATING])(
    "refuses a move to APPROVED from %s, naming the hold, and writes nothing",
    async (from) => {
      const h = makeDb([anOrder(from)]);
      const controller = new ProcurementController(service(h.db));

      const err = await refusal(() =>
        controller.updateOrder(ORDER_ID, { status: S.APPROVED } as any, STAFF),
      );

      expect(err.getStatus()).toBe(422);
      expect(bodyOf(err).reason).toBe("approve_through_the_sealed_act");
      expect(bodyOf(err).message).toMatch(/approved through its own act/);
      expect(bodyOf(err).message).toMatch(/holding Approve/);
      expect(bodyOf(err).message).toMatch(/Nothing was changed\.$/);
      expect(h.updateAttempts()).toBe(0);
      expect(h.orderReads()).toBe(0);
      expect(h.orders[0].status).toBe(from);
    },
  );

  // The refusal is the first thing `updateOrder` does with a status: it reads
  // nothing, so it cannot be raced and does not depend on the order existing.
  // Moved after the transition read, this case would read once and answer 404.
  it("refuses before it reads the order, so a missing order gets the same answer", async () => {
    const h = makeDb([]);
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, { status: S.APPROVED } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(bodyOf(err).reason).toBe("approve_through_the_sealed_act");
    expect(h.orderReads()).toBe(0);
    expect(h.updateAttempts()).toBe(0);
  });

  it("refuses it with a price riding along, and the price is not written either", async () => {
    const h = makeDb([anOrder(S.PENDING)]);
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, {
        status: S.APPROVED,
        totalCost: 1,
      } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(h.orderUpdates).toHaveLength(0);
    expect(h.orders[0].total_cost).toBe(240);
  });
});

describe("PATCH orders/:id cannot reprice an order once it is approved", () => {
  it("pins the states whose price is still open: the three before a seal", () => {
    expect([...ORDER_PRICE_OPEN_STATUSES].sort()).toEqual(
      [S.APPROVAL_NEEDED, S.NEGOTIATING, S.PENDING].sort(),
    );
  });

  it.each([
    ["finalPrice", "final_price"],
    ["totalCost", "total_cost"],
    ["quotedPrice", "quoted_price"],
    ["negotiatedPrice", "negotiated_price"],
  ])(
    "refuses %s on an APPROVED order, in words, and writes nothing",
    async (field, column) => {
      const h = makeDb([anOrder(S.APPROVED)]);
      const controller = new ProcurementController(service(h.db));
      const before = h.orders[0][column];

      const err = await refusal(() =>
        controller.updateOrder(ORDER_ID, { [field]: 9999 } as any, STAFF),
      );

      expect(err.getStatus()).toBe(422);
      expect(bodyOf(err).reason).toBe("price_settled_by_approval");
      expect(bodyOf(err).message).toMatch(/price is the one that was approved/);
      expect(bodyOf(err).message).toMatch(/Nothing was changed\.$/);
      expect(h.updateAttempts()).toBe(0);
      expect(h.orders[0][column]).toBe(before);
    },
  );

  it.each(
    EVERY_STATUS.filter(
      (s) => ![S.PENDING, S.APPROVAL_NEEDED, S.NEGOTIATING].includes(s),
    ),
  )("refuses a total on an order that is %s", async (status) => {
    const h = makeDb([anOrder(status)]);
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, { totalCost: 1 } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(bodyOf(err).message).toMatch(/Nothing was changed\.$/);
    expect(h.orders[0].total_cost).toBe(240);
  });

  // Zero is a price. A truthiness test would read it as "no price sent" and
  // let an approved order be zeroed.
  it.each([
    ["totalCost", "total_cost"],
    ["finalPrice", "final_price"],
  ])("refuses a zero %s on an APPROVED order", async (field, column) => {
    const h = makeDb([anOrder(S.APPROVED)]);
    const before = h.orders[0][column];
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, { [field]: 0 } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(bodyOf(err).reason).toBe("price_settled_by_approval");
    expect(h.updateAttempts()).toBe(0);
    expect(h.orders[0][column]).toBe(before);
  });

  // A stored state outside the vocabulary is not "open": the read decides
  // nothing it cannot name.
  it("refuses a price on an order whose stored state this house does not know", async () => {
    const h = makeDb([anOrder("ON_HOLD" as S)]);
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, { totalCost: 1 } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(bodyOf(err).reason).toBe("price_settled_by_approval");
    expect(bodyOf(err).status).toBeNull();
    expect(bodyOf(err).message).toMatch(
      /could not be read as one this house knows/,
    );
    expect(bodyOf(err).message).toMatch(/Nothing was changed\.$/);
    expect(h.updateAttempts()).toBe(0);
    expect(h.orders[0].total_cost).toBe(240);
  });

  it.each([S.PENDING, S.APPROVAL_NEEDED, S.NEGOTIATING])(
    "still lets the price of a %s order change",
    async (status) => {
      const h = makeDb([anOrder(status)]);
      const out = await service(h.db).updateOrder(HOUSE, ORDER_ID, {
        finalPrice: 30,
        totalCost: 180,
      } as any);
      expect(h.orders[0].final_price).toBe(30);
      expect(h.orders[0].total_cost).toBe(180);
      expect(out.id).toBe(ORDER_ID);
    },
  );

  it("refuses a price change when the order is approved between the check and the write", async () => {
    const h = makeDb([anOrder(S.PENDING)], {
      afterOrderRead: (orders) => {
        orders[0].status = S.APPROVED;
      },
    });
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, { totalCost: 1 } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(bodyOf(err).reason).toBe("price_settled_by_approval");
    expect(h.orders[0].total_cost).toBe(240);
  });

  // APPROVED -> NEGOTIATING is a legal edge, so one PATCH carrying both the
  // step back and a new price must still be judged on the state the order is
  // in, not the one the body asks for — otherwise the step back is a way round.
  it("refuses a price that rides along with a step back out of APPROVED", async () => {
    const h = makeDb([anOrder(S.APPROVED)]);
    const err = await refusal(() =>
      service(h.db).updateOrder(HOUSE, ORDER_ID, {
        status: S.NEGOTIATING,
        totalCost: 1,
      } as any),
    );
    expect(err.getStatus()).toBe(422);
    expect(bodyOf(err).reason).toBe("price_settled_by_approval");
    expect(h.updateAttempts()).toBe(0);
    expect(h.orders[0].status).toBe(S.APPROVED);
    expect(h.orders[0].total_cost).toBe(240);
  });

  it("leaves a note on an approved order alone", async () => {
    const h = makeDb([anOrder(S.APPROVED)]);
    await service(h.db).updateOrder(HOUSE, ORDER_ID, {
      managerNotes: "call the rep",
    } as any);
    expect(h.orders[0].manager_notes).toBe("call the rep");
    expect(h.orders[0].status).toBe(S.APPROVED);
  });
});

describe("createOrder's merge never writes over an order past negotiation", () => {
  const request = {
    inventoryId: INVENTORY,
    providerId: PROVIDER,
    quantity: 12,
    finalPrice: 25,
  } as any;

  it("pins the states a request may be folded into: pending and in negotiation", () => {
    expect([...ORDER_MERGEABLE_STATUSES].sort()).toEqual(
      [S.NEGOTIATING, S.PENDING].sort(),
    );
  });

  it.each([S.APPROVED, S.APPROVAL_NEEDED, S.PARTIALLY_RECEIVED])(
    "starts a new order instead of folding into a %s one",
    async (status) => {
      const h = makeDb([anOrder(status)]);
      await service(h.db).createOrder(HOUSE, USER, request);

      // Not even attempted: the lookup itself passes over this order.
      expect(h.updateAttempts()).toBe(0);
      expect(h.orderInserts).toHaveLength(1);
      const kept = h.orders.find((r) => r.id === ORDER_ID)!;
      expect(kept.status).toBe(status);
      expect(kept.quantity).toBe(6);
      expect(kept.final_price).toBe(40);
      expect(kept.total_cost).toBe(240);
    },
  );

  it.each([S.PENDING, S.NEGOTIATING])(
    "still folds a re-quote into a %s order",
    async (status) => {
      const h = makeDb([anOrder(status)]);
      await service(h.db).createOrder(HOUSE, USER, request);

      expect(h.orderInserts).toHaveLength(0);
      expect(h.orderUpdates).toHaveLength(1);
      expect(h.orders[0].quantity).toBe(12);
      expect(h.orders[0].final_price).toBe(25);
    },
  );

  it("starts a new order when the open one is approved between the lookup and the write", async () => {
    const h = makeDb([anOrder(S.PENDING)], {
      afterOrderRead: (orders) => {
        orders[0].status = S.APPROVED;
      },
    });
    await service(h.db).createOrder(HOUSE, USER, request);

    expect(h.orderUpdates).toHaveLength(0);
    expect(h.orderInserts).toHaveLength(1);
    const kept = h.orders.find((r) => r.id === ORDER_ID)!;
    expect(kept.quantity).toBe(6);
    expect(kept.total_cost).toBe(240);
  });

  it("rewrites the line of the open order it folds into", async () => {
    const h = makeDb([anOrder(S.PENDING)]);
    await service(h.db).createOrder(HOUSE, USER, request);

    expect(h.lineWrites).toEqual([
      { op: "delete", orderId: ORDER_ID },
      { op: "insert", orderId: ORDER_ID },
    ]);
  });

  // The header UPDATE carries the open-states condition; the line is two more
  // statements after it. An approval landing in between must not have its
  // line (and, through the echo trigger, its header price) rewritten.
  it("leaves the line alone when the order is approved between the header and the line", async () => {
    const h = makeDb([anOrder(S.PENDING)], {
      afterOrderUpdate: (orders) => {
        orders[0].status = S.APPROVED;
      },
    });
    const svc = service(h.db);
    await svc.createOrder(HOUSE, USER, request);

    expect(h.orderUpdates).toHaveLength(1);
    expect(h.orderInserts).toHaveLength(0);
    expect(h.lineWrites.filter((w) => w.orderId === ORDER_ID)).toEqual([]);
    expect((svc as any).logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/left negotiation before its line was rewritten/),
      expect.objectContaining({ orderId: ORDER_ID }),
    );
  });
});
