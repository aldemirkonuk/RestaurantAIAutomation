import {
  releaseAcceptedShare,
  releaseKey,
  firstReleaseKey,
} from "./order-reservation";

/**
 * F-143 — the door lets go of the accepted share of an order's reservation.
 *
 * The fake below is a small LEDGER, not canned answers: apply_stock_movement
 * appends rows, honours the unique idempotency key and refuses to go
 * negative, and every read is answered from those rows. The behaviour under
 * test is convergence — a retry, a second truck, markDelivered and a
 * collision must all land on the same released total — and only a ledger can
 * show that.
 */

type Row = Record<string, any>;

const R = "r1";
const ITEM = "inv1";
const APPROVED = "2026-09-20T10:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(APPROVED) + ms).toISOString();

function makeLedger(opts: {
  orders: Row[];
  txns?: Row[];
  shadow?: number;
  inTransit?: number;
  /** Return 23505 for the first N rpc calls (another caller took the key). */
  collide?: number;
  /** Fail every read of inventory_transactions. */
  ledgerError?: boolean;
}) {
  const txns: Row[] = (opts.txns ?? []).map((t, i) => ({
    id: t.id ?? `t${i}`,
    restaurant_id: R,
    inventory_id: ITEM,
    delivery_id: null,
    transaction_type: "adjustment",
    source: "order",
    ...t,
  }));
  const item = {
    id: ITEM,
    restaurant_id: R,
    shadow_stock:
      opts.shadow ??
      txns
        .filter((t) => t.stock_type === "shadow")
        .reduce((a, t) => a + t.quantity_change, 0),
    in_transit_quantity: opts.inTransit ?? 0,
  };
  let collide = opts.collide ?? 0;
  let nextId = 1000;
  const calls = { rpc: [] as Row[], updates: [] as Row[] };

  const tables: Record<string, Row[]> = {
    procurement_orders: opts.orders,
    inventory_transactions: txns,
    restaurant_inventory: [item],
  };

  const client: any = {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      let lo = 0;
      let hi = Infinity;
      let updatePayload: Row | null = null;
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (preds.push((r) => r[c] === v), q),
        neq: (c: string, v: any) => (preds.push((r) => r[c] !== v), q),
        is: (c: string, v: any) => (preds.push((r) => (r[c] ?? null) === v), q),
        gte: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] >= v), q),
        lte: (c: string, v: any) => (preds.push((r) => r[c] != null && r[c] <= v), q),
        order: () => q,
        range: (a: number, b: number) => {
          lo = a;
          hi = b;
          return q;
        },
        update: (p: Row) => {
          updatePayload = p;
          return q;
        },
        maybeSingle: async () => {
          if (table === "inventory_transactions" && opts.ledgerError)
            return { data: null, error: { message: "ledger down" } };
          const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          return { data: hit[0] ?? null, error: null };
        },
        then(resolve: any, reject: any) {
          if (updatePayload) {
            calls.updates.push({ table, ...updatePayload });
            for (const r of (tables[table] ?? []).filter((r) => preds.every((p) => p(r))))
              Object.assign(r, updatePayload);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          if (table === "inventory_transactions" && opts.ledgerError)
            return Promise.resolve({ data: null, error: { message: "ledger down" } }).then(resolve, reject);
          const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          return Promise.resolve({
            data: rows.slice(lo, hi === Infinity ? undefined : hi + 1),
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name: string, p: Row) {
      expect(name).toBe("apply_stock_movement");
      calls.rpc.push(p);
      if (collide > 0) {
        collide--;
        return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }
      const dupe = txns.find((t) => t.idempotency_key === p.p_idempotency_key);
      if (dupe) return { data: dupe.id, error: null };
      if (p.p_stock_state === "shadow" && item.shadow_stock + p.p_delta < 0)
        return { data: null, error: { code: "P0001", message: "stock would go negative" } };
      if (p.p_stock_state === "shadow") item.shadow_stock += p.p_delta;
      const row = {
        id: `t${nextId++}`,
        restaurant_id: p.p_restaurant_id,
        inventory_id: p.p_inventory_id,
        order_id: p.p_order_id ?? null,
        stock_type: p.p_stock_state,
        quantity_change: p.p_delta,
        transaction_type: p.p_transaction_type,
        source: p.p_source,
        idempotency_key: p.p_idempotency_key ?? null,
        transaction_date: new Date().toISOString(),
        delivery_id: null,
      };
      txns.push(row);
      return { data: row.id, error: null };
    },
  };
  return { client, txns, item, calls };
}

function order(over: Row = {}): Row {
  return {
    id: "o1",
    restaurant_id: R,
    inventory_id: ITEM,
    quantity: 24,
    unit_type: "bottle",
    bottles_total: 24,
    approved_at: APPROVED,
    cancelled_at: null,
    cancel_reason_code: null,
    status: "PARTIALLY_RECEIVED",
    ...over,
  };
}

/** Approval's reservation, as reserveOrderShadowStock writes it today: no order id. */
function reserve(qty: number, msAfterApproval = 100): Row {
  return {
    order_id: null,
    stock_type: "shadow",
    quantity_change: qty,
    transaction_type: "purchase",
    source: "order",
    idempotency_key: null,
    transaction_date: at(msAfterApproval),
  };
}

function booked(qty: number, key: string, extra: Row = {}): Row {
  return {
    order_id: "o1",
    stock_type: "live",
    quantity_change: qty,
    transaction_type: "purchase",
    idempotency_key: key,
    transaction_date: at(60_000),
    ...extra,
  };
}

const run = (client: any) =>
  releaseAcceptedShare(client, { restaurantId: R, orderId: "o1", via: "door receipt" });

const releases = (txns: Row[]) =>
  txns.filter((t) => t.stock_type === "shadow" && t.quantity_change < 0 && t.order_id === "o1");

describe("releaseAcceptedShare (F-143)", () => {
  it("lets go of the accepted share under the key markDelivered uses, and keeps the short reserved", async () => {
    const l = makeLedger({
      orders: [order()],
      txns: [reserve(24), booked(18, "door-receipt:e1")],
      inTransit: 24,
    });
    const out = await run(l.client);
    expect(out).toEqual({ released: 18, target: 18 });
    expect(l.calls.rpc).toHaveLength(1);
    expect(l.calls.rpc[0]).toMatchObject({
      p_stock_state: "shadow",
      p_delta: -18,
      p_order_id: "o1",
      p_restaurant_id: R,
      p_idempotency_key: "order-delivered-shadow:o1",
    });
    expect(l.item.shadow_stock).toBe(6);
    // The display counter follows what is still reserved.
    expect(l.item.in_transit_quantity).toBe(6);
  });

  it("a retry of the same receipt moves nothing", async () => {
    const l = makeLedger({ orders: [order()], txns: [reserve(24), booked(18, "door-receipt:e1")] });
    await run(l.client);
    const again = await run(l.client);
    expect(again).toEqual({ released: 0, target: 18 });
    expect(releases(l.txns)).toHaveLength(1);
    expect(l.item.shadow_stock).toBe(6);
  });

  it("the second truck lets go of its own share under the next numbered key", async () => {
    const l = makeLedger({ orders: [order()], txns: [reserve(24), booked(18, "door-receipt:e1")] });
    await run(l.client);
    l.txns.push({ ...booked(6, "door-receipt:e2"), id: "t-e2", restaurant_id: R, inventory_id: ITEM, delivery_id: null });
    const out = await run(l.client);
    expect(out).toEqual({ released: 6, target: 24 });
    expect(l.calls.rpc[1].p_idempotency_key).toBe("order-delivered-shadow:o1:2");
    expect(l.item.shadow_stock).toBe(0);
  });

  it("does nothing after markDelivered already let go under the shared key", async () => {
    const l = makeLedger({
      orders: [order()],
      txns: [
        reserve(24),
        booked(24, "order-delivered-live:o1"),
        { order_id: "o1", stock_type: "shadow", quantity_change: -24, idempotency_key: "order-delivered-shadow:o1", transaction_date: at(50_000) },
      ],
    });
    const out = await run(l.client);
    expect(out).toEqual({ released: 0, target: 24 });
    expect(l.calls.rpc).toHaveLength(0);
  });

  it("a reservation made in cases lets go of its accepted share of cases", async () => {
    // Approval reserved `quantity` = 2 (cases), not 24 bottles.
    const l = makeLedger({
      orders: [order({ quantity: 2, unit_type: "case", bottles_total: 24 })],
      txns: [reserve(2), booked(12, "door-receipt:e1")],
    });
    expect(await run(l.client)).toEqual({ released: 1, target: 1 });
    expect(l.item.shadow_stock).toBe(1);
  });

  it("never lets go of more than the order reserved when more arrives", async () => {
    const l = makeLedger({ orders: [order()], txns: [reserve(24), booked(30, "door-receipt:e1")] });
    expect(await run(l.client)).toEqual({ released: 24, target: 24 });
  });

  it("reads a reservation that carries the order's id before guessing by time", async () => {
    const l = makeLedger({
      orders: [order()],
      txns: [
        { order_id: "o1", stock_type: "shadow", quantity_change: 10, transaction_type: "purchase", transaction_date: at(-86_400_000) },
        reserve(24),
        booked(10, "door-receipt:e1"),
      ],
    });
    // target = min(10, floor(10 × 10 / 24)) = 4 — the order-id row (10), not the timed one (24).
    expect(await run(l.client)).toEqual({ released: 4, target: 4 });
  });

  it("refuses to work out a share for a legacy case order whose bottle figure equals its case count", async () => {
    const l = makeLedger({
      orders: [order({ quantity: 2, unit_type: "case", bottles_total: 2 })],
      txns: [reserve(2), booked(12, "door-receipt:e1")],
    });
    const out = await run(l.client);
    expect(out.released).toBe(0);
    expect(out.issue).toMatch(/cannot be worked out/);
    expect(l.calls.rpc).toHaveLength(0);
  });

  it.each([
    ["CANCELLED status", { status: "CANCELLED" }],
    ["a cancelled_at stamp", { cancelled_at: at(1000) }],
    ["a cancel reason", { cancel_reason_code: "vendor_out_of_stock" }],
  ])("lets go of nothing for an order with %s (the cancel already did)", async (_l, over) => {
    const l = makeLedger({ orders: [order(over)], txns: [reserve(24), booked(18, "door-receipt:e1")] });
    expect(await run(l.client)).toEqual({ released: 0, target: 0 });
    expect(l.calls.rpc).toHaveLength(0);
  });

  it("lets go of nothing when approval made no reservation for the order", async () => {
    // The confirm-by-us path writes approved_at and never reserves.
    const l = makeLedger({ orders: [order()], txns: [booked(18, "door-receipt:e1")], shadow: 40 });
    expect(await run(l.client)).toEqual({ released: 0, target: 0 });
    expect(l.calls.rpc).toHaveLength(0);
  });

  it("will not take a reservation another order on the item could own", async () => {
    const l = makeLedger({
      orders: [order(), order({ id: "o2", approved_at: at(3_000) })],
      txns: [reserve(24, 3_100), booked(18, "door-receipt:e1")],
    });
    const out = await run(l.client);
    expect(out.released).toBe(0);
    expect(out.issue).toMatch(/cannot be told/);
    expect(l.calls.rpc).toHaveLength(0);
  });

  it("re-reads and lands when another caller took the key first", async () => {
    const l = makeLedger({ orders: [order()], txns: [reserve(24), booked(18, "door-receipt:e1")], collide: 1 });
    expect(await run(l.client)).toEqual({ released: 18, target: 18 });
    expect(l.calls.rpc).toHaveLength(2);
  });

  it("says so when the item holds less reserved stock than the share", async () => {
    const l = makeLedger({ orders: [order()], txns: [reserve(24), booked(18, "door-receipt:e1")], shadow: 5 });
    const out = await run(l.client);
    expect(out.released).toBe(5);
    expect(out.issue).toBeDefined();
  });

  it("counts a truck booked by both the door and the delivery model once", async () => {
    const l = makeLedger({
      orders: [order()],
      txns: [
        reserve(24),
        booked(12, "door-receipt:e1"),
        booked(12, "delivery-line:d1:doc1:1", { delivery_id: "d1" }),
      ],
    });
    expect(await run(l.client)).toEqual({ released: 12, target: 12 });
  });

  it("never throws: an unreadable ledger is an issue, and nothing moves", async () => {
    const l = makeLedger({ orders: [order()], txns: [reserve(24)], ledgerError: true });
    const out = await run(l.client);
    expect(out.released).toBe(0);
    expect(out.issue).toMatch(/could not be read/);
    expect(l.calls.rpc).toHaveLength(0);
  });

  it("numbers keys from the releases already in the ledger", () => {
    expect(firstReleaseKey("o9")).toBe("order-delivered-shadow:o9");
    expect(releaseKey("o9", 0)).toBe("order-delivered-shadow:o9");
    expect(releaseKey("o9", 1)).toBe("order-delivered-shadow:o9:2");
    expect(releaseKey("o9", 4)).toBe("order-delivered-shadow:o9:5");
  });
});
