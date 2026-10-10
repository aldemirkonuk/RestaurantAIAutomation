/**
 * An order puts its bottles "on order" once, in bottles, and gives back
 * exactly that (F-491, F-494); an AI vendor reply approves only inside the
 * house's rules (F-492, ADR 0325).
 *
 * The database is a small in-memory table store that answers the query
 * shapes these paths use, so the assertions are about rows and stock
 * movements, not about which mock was called.
 */
import { ProcurementService } from "./procurement.service";
import { INBOUND_RESPONDER_AGENT_ID } from "../common/orchestrator/inbound-responder.service";

type Row = Record<string, any>;

function fakeDb(
  tables: Record<string, Row[]>,
  refuse: (args: Row) => string | null = () => null,
) {
  const movements: Row[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const run = () => {
      const rows = (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      return rows;
    };
    const b: any = {
      select: () => b,
      update: (p: Row) => ((patch = p), b),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), b),
      not: (k: string, _op: string, list: string) => (
        filters.push((r) => !list.includes(String(r[k]))), b
      ),
      insert: (row: Row) => ((tables[table] ??= []).push(row), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: any, rej: any) => {
        const rows = run();
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej);
      },
    };
    return b;
  };
  const rpc = async (name: string, args: Row) => {
    // HEAD moves the in-transit figure by delta, floored at 0
    // (move_in_transit_by_delta); it is not a stock movement.
    if (name === "move_in_transit_by_delta") {
      const it = tables.restaurant_inventory.find((r) => r.id === args.p_inventory_id);
      if (it) it.in_transit_quantity = Math.max(0, (it.in_transit_quantity ?? 0) + args.p_delta);
      return { error: null };
    }
    const refused = refuse(args);
    if (refused) return { error: { message: refused } };
    movements.push(args);
    const item = tables.restaurant_inventory.find((r) => r.id === args.p_inventory_id);
    if (item && args.p_stock_state === "shadow") item.shadow_stock += args.p_delta;
    return { error: null };
  };
  return { supabase: { from, rpc }, movements };
}

function build(
  order: Row,
  opts: {
    line?: Row;
    rules?: Row[];
    others?: Row[];
    refuse?: (args: Row) => string | null;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    procurement_orders: [
      { restaurant_id: "r1", reserved_bottles: null, ...order },
      ...(opts.others ?? []),
    ],
    procurement_order_items: opts.line
      ? [{ restaurant_id: "r1", order_id: order.id, ...opts.line }]
      : [],
    restaurant_inventory: [
      {
        id: "inv1",
        restaurant_id: "r1",
        master_wine_id: "w1",
        shadow_stock: 0,
        in_transit_quantity: 0,
      },
    ],
  };
  const db = fakeDb(tables, (args) => opts.refuse?.(args) ?? null);
  const thresholds = {
    read: async () => ({
      readable: true,
      thresholds: opts.rules ?? [],
      policyEmpty: (opts.rules ?? []).length === 0,
    }),
  };
  const svc = new ProcurementService(
    { supabase: db.supabase } as any,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    thresholds as any,
  ) as any;
  const row = tables.procurement_orders[0];
  const item = tables.restaurant_inventory[0];
  return { svc, row, item, movements: db.movements };
}

const bottleOrder = {
  id: "o1",
  inventory_id: "inv1",
  quantity: 12,
  unit_type: "bottle",
  bottles_total: 12,
  status: "APPROVED",
};

describe("F-491: an order reserves once and releases what it reserved", () => {
  it("approving again after a vendor's decline does not reserve a second time", async () => {
    const { svc, row, item, movements } = build(bottleOrder);
    await svc.reserveOrderOnce("r1", "o1");
    row.status = "NEGOTIATING"; // the vendor declined
    row.status = "APPROVED"; // and the house approved it again
    await svc.reserveOrderOnce("r1", "o1");
    expect(movements.filter((m) => m.p_delta > 0)).toHaveLength(1);
    expect(item.shadow_stock).toBe(12);
    expect(row.reserved_bottles).toBe(12);
  });

  it("cancelling from NEGOTIATING gives the bottles back, once", async () => {
    const { svc, row, item } = build(bottleOrder);
    await svc.reserveOrderOnce("r1", "o1");
    row.status = "NEGOTIATING";
    await svc.releaseOrderReservation("r1", "o1");
    await svc.releaseOrderReservation("r1", "o1");
    expect(item.shadow_stock).toBe(0);
    expect(item.in_transit_quantity).toBe(0);
    expect(row.reserved_bottles).toBe(0);
  });

  it("an order that never reserved releases nothing, whatever its status", async () => {
    const { svc, item, movements } = build({ ...bottleOrder, status: "CONFIRMED" });
    item.shadow_stock = 7; // another order's bottles
    await svc.releaseOrderReservation("r1", "o1");
    expect(movements).toHaveLength(0);
    expect(item.shadow_stock).toBe(7);
  });
});

describe("F-491/F-494: delivery gives back what the order put on order", () => {
  it("releases the order's own 12, not the 20 that arrived, leaving another order's 5", async () => {
    const { svc, row, item } = build(bottleOrder);
    await svc.reserveOrderOnce("r1", "o1");
    item.shadow_stock += 5; // another order's bottles
    item.in_transit_quantity += 5;
    await svc.markDelivered("r1", "o1", "u1", 20);
    expect(item.shadow_stock).toBe(5);
    expect(item.in_transit_quantity).toBe(5);
    expect(row.reserved_bottles).toBe(0);
  });

  it("a refused booking keeps the reservation, and the retry releases it", async () => {
    let liveDown = true;
    const { svc, row, item } = build(bottleOrder, {
      refuse: (a) =>
        liveDown && a.p_stock_state === "live" ? "the ledger is busy" : null,
    });
    await svc.reserveOrderOnce("r1", "o1");
    await expect(svc.markDelivered("r1", "o1", "u1")).rejects.toBeTruthy();
    expect(row.status).toBe("APPROVED"); // put back
    expect(row.reserved_bottles).toBe(12);
    expect(item.shadow_stock).toBe(12);
    expect(item.in_transit_quantity).toBe(12);

    liveDown = false;
    await svc.markDelivered("r1", "o1", "u1");
    expect(item.shadow_stock).toBe(0);
    expect(item.in_transit_quantity).toBe(0);
    expect(row.reserved_bottles).toBe(0);
  });

  it("a shadow release that fails stays on the order's record", async () => {
    const { svc, row, item } = build(bottleOrder, {
      refuse: (a) => (a.p_stock_state === "shadow" && a.p_delta < 0 ? "busy" : null),
    });
    await svc.reserveOrderOnce("r1", "o1");
    await svc.markDelivered("r1", "o1", "u1");
    expect(item.shadow_stock).toBe(12);
    expect(row.reserved_bottles).toBe(12);
  });

  it("a cancel whose release fails keeps the reservation for the next try", async () => {
    let down = true;
    const { svc, row, item } = build(bottleOrder, {
      refuse: (a) => (down && a.p_delta < 0 ? "busy" : null),
    });
    await svc.reserveOrderOnce("r1", "o1");
    await svc.releaseOrderReservation("r1", "o1");
    expect(row.reserved_bottles).toBe(12);
    expect(item.shadow_stock).toBe(12);
    down = false;
    await svc.releaseOrderReservation("r1", "o1");
    expect(row.reserved_bottles).toBe(0);
    expect(item.shadow_stock).toBe(0);
  });
});

describe("F-494: an order in cases reserves bottles", () => {
  it("2 cases of 12 put 24 bottles on order", async () => {
    const { svc, row, item } = build(
      { ...bottleOrder, quantity: 2, unit_type: "case", bottles_total: 24 },
      { line: { unit_type: "case", bottles_per_unit: 12 } },
    );
    await svc.reserveOrderOnce("r1", "o1");
    expect(item.shadow_stock).toBe(24);
    expect(item.in_transit_quantity).toBe(24);
    expect(row.reserved_bottles).toBe(24);
  });

  it("a case order whose pack size is not known reserves nothing and records it", async () => {
    const { svc, row, movements } = build({
      ...bottleOrder,
      quantity: 2,
      unit_type: "case",
      bottles_total: 3, // no whole pack size fits
    });
    await svc.reserveOrderOnce("r1", "o1");
    expect(movements).toHaveLength(0);
    expect(row.reserved_bottles).toBe(0);
  });
});

describe("F-492: a vendor's yes approves only inside the house's rules", () => {
  const accepted = {
    ...bottleOrder,
    status: "NEGOTIATING",
    total_cost: 300,
    provider_id: "p1",
    final_price: 25,
  };
  // An earlier order to the same vendor, so `new_vendor` is testable.
  const earlier = [
    { id: "o0", restaurant_id: "r1", provider_id: "p1", inventory_id: "inv9", status: "DELIVERED" },
  ];
  const ceiling = [
    { rule: "manager_ceiling", enabled: true, amountLimit: 500, percentLimit: null, requiredRole: "owner" },
  ];

  it("under the ceiling: approved by the agent, and the bottles go on order once", async () => {
    const { svc, row, item } = build(accepted, { rules: ceiling, others: earlier });
    const out = await svc.approveAcceptedOrderAsAgent("r1", "o1");
    expect(out).toEqual({ approved: true });
    expect(row.status).toBe("APPROVED");
    expect(row.approved_by).toBe(INBOUND_RESPONDER_AGENT_ID);
    expect(item.shadow_stock).toBe(12);
  });

  it("over the ceiling: held for a person, nothing on order", async () => {
    const { svc, row, movements } = build(
      { ...accepted, total_cost: 900 },
      { rules: ceiling, others: earlier },
    );
    const out = await svc.approveAcceptedOrderAsAgent("r1", "o1");
    expect(out.approved).toBe(false);
    expect(out.why).toContain("ceiling");
    expect(row.status).toBe("APPROVAL_NEEDED");
    expect(row.approved_by).toBeUndefined();
    expect(movements).toHaveLength(0);
  });

  it("an order already waiting for the owner stays waiting", async () => {
    const { svc, row, movements } = build(
      { ...accepted, status: "APPROVAL_NEEDED" },
      { rules: [], others: earlier },
    );
    const out = await svc.approveAcceptedOrderAsAgent("r1", "o1");
    expect(out.approved).toBe(false);
    expect(row.status).toBe("APPROVAL_NEEDED");
    expect(movements).toHaveLength(0);
  });
});
