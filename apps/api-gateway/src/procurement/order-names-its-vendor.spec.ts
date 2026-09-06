import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { QUANTITY_RECEIVED_UNIT_UNSTATED } from "./quantity-received-unit";

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
 *  * THE RECEIVED COUNT'S UNIT. Stated on a bottle order; REFUSED on a case
 *    order, because the receiving door writes that column in bottles and the
 *    desk writes it in the order's own unit, and the row does not say which.
 *    The refusal is the point of the field.
 *  * A ROUTE THAT DOES NOT SELECT THE COLUMN emits neither key.
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
function makeDb(result: { data: any; error?: any; count?: number }) {
  const selects: string[] = [];
  const q: any = {
    select(sel: string) {
      selects.push(sel);
      return q;
    },
    eq: () => q,
    in: () => q,
    gte: () => q,
    lte: () => q,
    order: () => q,
    range: () => q,
    single: () => q,
    maybeSingle: () => q,
    then: (resolve: (v: any) => void) =>
      resolve({
        data: result.data,
        error: result.error ?? null,
        count: result.count ?? (Array.isArray(result.data) ? result.data.length : 1),
      }),
  };
  const db = { supabase: { from: () => q } } as unknown as DatabaseService;
  return { db, selects };
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
    const { db, selects } = makeDb({ data: [orderRow()], count: 1 });
    const res = await service(db).listOrders("rest-1", {} as any);

    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain("provider:provider_id(name)");
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

describe("the received count travels with its unit (ADR 0070)", () => {
  it("states the unit on an order whose unit does not multiply", async () => {
    const { db } = makeDb({
      data: orderRow({ quantity_received: 3, unit_type: "bottle" }),
    });
    const order = await service(db).getOrder("rest-1", "ord-1");
    expect(order.quantityReceived).toBe(3);
    expect(order.quantityReceivedUom).toBe("bottle");
  });

  it("REFUSES the unit on a case order — the column has two writers", async () => {
    // The receiving door writes `quantity_received` in bottles
    // (`receiving.service.ts:504`); markDelivered, updateOrder and
    // verifyReceipt write it in the order's own unit. On a case order those
    // differ by the pack size and the row does not record which wrote it, so
    // the number arrives with no unit rather than under a guess.
    const { db } = makeDb({
      data: orderRow({ quantity_received: 36, unit_type: "case" }),
    });
    const order = await service(db).getOrder("rest-1", "ord-1");
    expect(order.quantityReceived).toBe(36);
    expect(order.quantityReceivedUom).toBeNull();
  });

  it("carries a null count as null, never as a zero", async () => {
    const { db } = makeDb({ data: orderRow({ quantity_received: null }) });
    const order = await service(db).getOrder("rest-1", "ord-1");
    // Nothing has been received. A 0 here would be a count somebody took.
    expect(order.quantityReceived).toBeNull();
    expect(order.quantityReceivedUom).toBe("bottle");
  });

  it("sends NEITHER key when the route did not select the column", async () => {
    // Same boundary argument as the vendor case above: the keys exist in memory
    // holding `undefined` and `JSON.stringify` drops them, and the wire is the
    // only shape a client can read. A route selecting a column list — the ones
    // that take `"status, delivered_at, ..."` — has not learned the column is
    // empty, and must not say it is.
    const svc: any = service(makeDb({ data: null }).db);
    const row: Record<string, unknown> = { ...orderRow(), wine_name: "Barolo Riserva" };
    delete row.quantity_received;
    const wire = JSON.parse(JSON.stringify(svc.mapOrderRow(row)));
    expect("quantityReceived" in wire).toBe(false);
    expect("quantityReceivedUom" in wire).toBe(false);

    // Selecting it and finding nothing is the OTHER answer, and it is sent.
    const selected = JSON.parse(
      JSON.stringify(svc.mapOrderRow({ ...row, quantity_received: null })),
    );
    expect("quantityReceived" in selected).toBe(true);
    expect(selected.quantityReceived).toBeNull();
    expect(selected.quantityReceivedUom).toBe("bottle");
  });

  it("the refusal has words a screen can print", () => {
    expect(QUANTITY_RECEIVED_UNIT_UNSTATED).toContain("bottles");
    expect(QUANTITY_RECEIVED_UNIT_UNSTATED).toContain("the order's own unit");
  });
});
