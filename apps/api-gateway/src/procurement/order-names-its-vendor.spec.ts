import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * The order routes name the vendor, and the received count states its unit.
 *
 * WHAT THIS SUITE IS FOR, case by case — a file of "it works" assertions
 * proves nothing about a change whose whole subject is the difference between
 * three kinds of nothing:
 *
 *  * THE NAME ARRIVES. The plain case, on all three routes, because the four
 *    surfaces that wanted it read three different ones.
 *  * `null` VS THE KEY BEING ABSENT. A route that joins `providers` and finds
 *    nothing has learned something; a route that does not join has not. If
 *    those two serialise the same way then "this order has no vendor" and
 *    "nobody asked" are the same sentence on screen, which is the fault this
 *    change exists to end. Asserted with `in`, not with `toBeUndefined`,
 *    because `{ providerName: undefined }` and `{}` are equal to `toEqual` and
 *    only one of them is right.
 *  * THE SHAPES POSTGREST CAN RETURN. A to-one embed comes back as an object,
 *    as `null`, and — read the other way round — as a one-element array. The
 *    array is the dangerous one: it is truthy and has no `name`, so a naive
 *    read reports every vendor as unnameable.
 *  * WHAT THE ORDER RECEIVED (ADR 0192). It is the stock ledger's sum for the
 *    order and its item, shown in cases and loose bottles, never rounded, and
 *    never read from `procurement_orders.quantity_received` — a row carrying
 *    36 in that column with an empty ledger reads as nothing received. A
 *    failed ledger read is `readable:false`, never a zero. A route that did not
 *    read the ledger sends no `received` key.
 */

type Row = Record<string, any>;

/**
 * A supabase-js stand-in for the three read routes.
 *
 * Every chain method returns `this`, and the object is a thenable, so it
 * satisfies both `await q.single()` and `await q.order().range()` without
 * caring which of the two the route uses. `select` records what was asked for,
 * which is how the embed itself is asserted rather than only its effect.
 */
function makeDb(
  result: { data: any; error?: any; count?: number },
  /**
   * What the OTHER tables hold — the ledger, the door's events, the items and
   * the order lines the received reading takes (ADR 0192). A table named here
   * with `error` answers that error instead. Unnamed tables are empty.
   */
  tables: Record<string, Row[] | { error: { message: string } }> = {},
) {
  const selects: string[] = [];
  const orderSelects: string[] = [];
  const reads: string[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const q: any = {
      select(sel: string) {
        selects.push(sel);
        if (table === "procurement_orders") orderSelects.push(sel);
        reads.push(table);
        return q;
      },
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      },
      in: (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[col]));
        return q;
      },
      gte: () => q,
      lte: () => q,
      order: () => q,
      range: () => q,
      single: () => q,
      maybeSingle: () => q,
      then: (resolve: (v: any) => void) => {
        if (table === "procurement_orders") {
          return resolve({
            data: result.data,
            error: result.error ?? null,
            count:
              result.count ?? (Array.isArray(result.data) ? result.data.length : 1),
          });
        }
        const t = tables[table];
        if (t && !Array.isArray(t)) return resolve({ data: null, error: t.error });
        return resolve({
          data: (t ?? []).filter((r) => filters.every((f) => f(r))),
          error: null,
        });
      },
    };
    return q;
  };
  const db = { supabase: { from } } as unknown as DatabaseService;
  return { db, selects, orderSelects, reads };
}

function service(db: DatabaseService) {
  return new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
  );
}

/** One `procurement_orders` row as `select("*")` returns it. */
function orderRow(over: Row = {}): Row {
  return {
    id: "ord-1",
    order_number: "ORD-2026-00042",
    restaurant_id: "rest-1",
    inventory_id: "inv-1",
    provider_id: "prov-1",
    quantity: 5,
    unit_type: "bottle",
    bottles_total: 5,
    quoted_price: null,
    negotiated_price: null,
    final_price: 420,
    total_cost: 2100,
    status: "CONFIRMED",
    requested_at: "2026-09-01T00:00:00.000Z",
    approved_at: null,
    delivered_at: null,
    completed_at: null,
    is_emergency: false,
    priority_level: null,
    quantity_received: null,
    inventory: { wine_name: "Barolo Riserva" },
    provider: { name: "Vinifera Imports" },
    procurement_order_items: [],
    ...over,
  };
}

describe("the orders routes join the vendor's name", () => {
  it("embeds providers on the list route, in the SAME statement as the order", async () => {
    const { db, orderSelects } = makeDb({ data: [orderRow()], count: 1 });
    const res = await service(db).listOrders("rest-1", {} as any);

    // ONE statement against the orders table; the other reads on this route
    // are the ledger's (ADR 0192), which the received block below covers.
    expect(orderSelects).toHaveLength(1);
    expect(orderSelects[0]).toContain("provider:provider_id(name)");
    expect(res.orders[0].providerName).toBe("Vinifera Imports");
  });

  it("embeds providers on the detail route and on the pending queue", async () => {
    const detail = makeDb({ data: orderRow() });
    expect((await service(detail.db).getOrder("rest-1", "ord-1")).providerName).toBe(
      "Vinifera Imports",
    );
    expect(detail.selects[0]).toContain("provider:provider_id(name)");

    const pending = makeDb({ data: [orderRow({ status: "APPROVAL_NEEDED" })] });
    const rows = await service(pending.db).listPendingOrders("rest-1");
    expect(rows[0].providerName).toBe("Vinifera Imports");
    expect(pending.selects[0]).toContain("provider:provider_id(name)");
  });

  it.each([
    ["a null embed — the FK is null", null, null],
    ["an embed with no name", {}, null],
    ["an embed whose name is blank", { name: "   " }, null],
    ["a one-element array, which PostgREST can return", [{ name: "Acme" }], "Acme"],
    ["an empty array", [], null],
  ])("reads %s", async (_label, provider, expected) => {
    const { db } = makeDb({ data: orderRow({ provider }) });
    const order = await service(db).getOrder("rest-1", "ord-1");
    // The KEY is present in every one of these: the route joined. Only the
    // VALUE says whether a name came back.
    expect("providerName" in order).toBe(true);
    expect(order.providerName).toBe(expected);
  });

  it("a route that does not join sends NO providerName key at all", async () => {
    // `updateOrder`, `approveOrder` and `createOrder` select without the embed,
    // so their rows carry no `provider_name` and the DTO must stay silent
    // rather than assert `null` — "we did not ask" is not "there is nobody".
    //
    // Driven through `mapOrderRow` directly because those three routes each
    // need a transition check, a seal and a write to reach it, and none of that
    // is what is under test: the rule is a property of the MAPPER, keyed on
    // whether the row carries the field at all.
    //
    // Asserted after a JSON round trip, which is the only shape a client ever
    // sees. In memory the key exists holding `undefined` — deliberately, so the
    // object literal in `mapOrderRow` can keep every field explicit — and
    // `JSON.stringify` drops it. `in` on the in-memory object would therefore
    // be testing the wrong side of the boundary.
    const svc: any = service(makeDb({ data: null }).db);
    const notJoined: Record<string, unknown> = { ...orderRow(), wine_name: "Barolo Riserva" };
    delete notJoined.provider;
    const wire = JSON.parse(JSON.stringify(svc.mapOrderRow(notJoined)));
    expect("providerName" in wire).toBe(false);

    // And the joining case, through the same boundary, so the pair is proved
    // to differ rather than each being asserted alone.
    const joined = { ...notJoined, provider_name: null };
    const joinedWire = JSON.parse(JSON.stringify(svc.mapOrderRow(joined)));
    expect("providerName" in joinedWire).toBe(true);
    expect(joinedWire.providerName).toBeNull();
  });
});

describe("what the order received is the ledger's count (ADR 0192)", () => {
  /** A 5-case order at 12 a case, as the line states it. */
  const caseOrder = () =>
    orderRow({ quantity: 5, unit_type: "case", bottles_total: 60, status: "DELIVERED" });
  const item = { id: "inv-1", restaurant_id: "rest-1", uom: "bottle" };
  const line = {
    id: "line-1",
    order_id: "ord-1",
    restaurant_id: "rest-1",
    unit_type: "case",
    bottles_per_unit: 12,
  };
  const ledgerRow = (id: string, change: number, key: string, over: Row = {}) => ({
    id,
    restaurant_id: "rest-1",
    order_id: "ord-1",
    inventory_id: "inv-1",
    stock_type: "live",
    quantity_change: change,
    idempotency_key: key,
    ...over,
  });

  it("states five cases and five loose bottles, never a rounded case count", async () => {
    const { db } = makeDb(
      { data: caseOrder() },
      {
        restaurant_inventory: [item],
        procurement_order_items: [line],
        inventory_transactions: [
          ledgerRow("t1", 60, "order-delivered-live:ord-1"),
          ledgerRow("t2", 5, "door-receipt:ev-2"),
        ],
      },
    );
    const order = await service(db).getOrder("rest-1", "ord-1");
    expect(order.received).toMatchObject({
      readable: true,
      quantityInStockUom: 65,
      stockUom: "bottle",
      packUnit: "case",
      packSize: 12,
      packs: 5,
      looseInStockUom: 5,
      words: "5 cases + 5 bottles",
    });
  });

  it("does NOT read procurement_orders.quantity_received: 36 in the column, an empty ledger, reads as nothing received", async () => {
    const { db } = makeDb(
      { data: { ...caseOrder(), quantity_received: 36 } },
      { restaurant_inventory: [item], procurement_order_items: [line] },
    );
    const order = await service(db).getOrder("rest-1", "ord-1");
    expect(order.received?.quantityInStockUom).toBe(0);
    expect(order.received?.words).toBe("0 bottles");
    const wire = JSON.parse(JSON.stringify(order));
    expect("quantityReceived" in wire).toBe(false);
    expect("quantityReceivedUom" in wire).toBe(false);
  });

  it("a ledger that cannot be read is readable:false with words, never a zero", async () => {
    const { db } = makeDb(
      { data: caseOrder() },
      {
        restaurant_inventory: [item],
        inventory_transactions: { error: { message: "connection reset" } },
      },
    );
    const order = await service(db).getOrder("rest-1", "ord-1");
    expect(order.received?.readable).toBe(false);
    expect(order.received?.quantityInStockUom).toBeNull();
    expect(order.received?.why).toContain("connection reset");
  });

  it("the list route reads the ledger ONCE for the whole page, not once per order", async () => {
    const two = [caseOrder(), { ...caseOrder(), id: "ord-2", inventory_id: "inv-1" }];
    const { db, reads } = makeDb(
      { data: two, count: 2 },
      {
        restaurant_inventory: [item],
        procurement_order_items: [line, { ...line, id: "line-2", order_id: "ord-2" }],
        inventory_transactions: [
          ledgerRow("t1", 24, "door-receipt:a"),
          ledgerRow("t2", 7, "door-receipt:b", { order_id: "ord-2" }),
        ],
      },
    );
    const res = await service(db).listOrders("rest-1", {} as any);
    expect(reads.filter((t) => t === "inventory_transactions")).toHaveLength(1);
    expect(res.orders.map((o) => o.received?.words)).toEqual([
      "2 cases",
      "7 bottles",
    ]);
  });

  it.each([
    ["the canonical field", { quantityReceivedInOrderUom: 5 }],
    ["its deprecated alias", { quantityReceived: 5 }],
  ])("updateOrder refuses %s before anything is read or written", async (_l, body) => {
    // It used to write the column from the body with no stock movement, so any
    // caller could make an order "receive" a number the shelf never saw.
    const { db, reads } = makeDb({ data: orderRow() });
    let thrown: any;
    try {
      await service(db).updateOrder("rest-1", "ord-1", body as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.getStatus?.()).toBe(400);
    expect(thrown.getResponse().reason).toBe("received_is_the_ledger");
    expect(thrown.getResponse().message).toContain("ADR 0192");
    expect(reads).toHaveLength(0);
  });

  it("sends NO received key from a route that did not read the ledger", () => {
    const svc: any = service(makeDb({ data: null }).db);
    const row: Record<string, unknown> = { ...orderRow(), wine_name: "Barolo Riserva" };
    const wire = JSON.parse(JSON.stringify(svc.mapOrderRow(row)));
    expect("received" in wire).toBe(false);
  });
});
