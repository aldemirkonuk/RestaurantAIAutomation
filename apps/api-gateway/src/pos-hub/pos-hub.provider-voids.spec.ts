import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";
import { cloverAdapter, squareAdapter, toastAdapter } from "./pos-adapters";

/**
 * QA round 5, POS-1 (BLOCKER): voids and returns were invisible to the Toast,
 * Square and Clover adapters. Only the generic adapter set `voided`, so a
 * Toast check voided after close kept its bottles off the shelf and its money
 * in sales, and a Square itemized return never put stock back.
 *
 * The first block pins each adapter's mapping; the second runs the real hub
 * against a database whose `apply_stock_movement` is idempotent on its key
 * (as production's is, pos-hub.void-idempotency.spec.ts), so the assertions
 * are about the stock level and the stored row, not argument shapes.
 */

type Row = Record<string, any>;

const CLOSED = "2026-11-06T21:00:00Z";
const OPENED = "2026-11-06T19:00:00Z";

describe("POS-1: each provider maps its voids and returns onto `voided`", () => {
  it("Toast: a voided check is the same check, voided, with its lines as rung", () => {
    const [c] = toastAdapter.normalize({
      guid: "t-1",
      openedDate: OPENED,
      closedDate: CLOSED,
      voided: true,
      selections: [
        {
          displayName: "Caymus",
          item: { guid: "item-1" },
          quantity: 2,
          price: 180,
          voided: true,
          voidDate: "2026-11-06T22:00:00Z",
        },
      ],
    });
    expect(c.externalCheckId).toBe("t-1");
    expect(c.voided).toBe(true);
    // Voided with the check, after it closed: it took stock, so it returns it.
    expect(c.items[0].qty).toBe(2);
  });

  it("Toast: a deleted check is voided too", () => {
    const [c] = toastAdapter.normalize({
      guid: "t-2",
      openedDate: OPENED,
      deleted: true,
      selections: [],
    });
    expect(c.voided).toBe(true);
  });

  it("Toast: a check that stands is not voided", () => {
    const [c] = toastAdapter.normalize({
      guid: "t-3",
      openedDate: OPENED,
      selections: [],
    });
    expect(c.voided).toBe(false);
  });

  it("Toast: a voided selection on a check that stands sold nothing, and keeps its place", () => {
    const [c] = toastAdapter.normalize({
      guid: "t-4",
      openedDate: OPENED,
      closedDate: CLOSED,
      selections: [
        {
          displayName: "Caymus",
          item: { guid: "item-1" },
          quantity: 2,
          price: 180,
          voided: true,
        },
        {
          displayName: "Barolo",
          item: { guid: "item-2" },
          quantity: 1,
          price: 140,
        },
      ],
    });
    expect(c.voided).toBe(false);
    expect(c.items).toHaveLength(2);
    expect(c.items[0].qty).toBe(0);
    expect(c.items[0].qty * c.items[0].price).toBe(0);
    expect(c.items[1]).toMatchObject({
      externalItemId: "item-2",
      qty: 1,
      price: 140,
    });
  });

  it("Toast: on a voided check, a selection voided before the check closed returns nothing", () => {
    const [c] = toastAdapter.normalize({
      guid: "t-5",
      openedDate: OPENED,
      closedDate: CLOSED,
      voided: true,
      selections: [
        {
          displayName: "Caymus",
          item: { guid: "item-1" },
          quantity: 2,
          price: 180,
          voided: true,
          voidDate: "2026-11-06T20:00:00Z",
        },
        {
          displayName: "Barolo",
          item: { guid: "item-2" },
          quantity: 1,
          price: 140,
          voided: true,
          voidDate: "2026-11-06T22:00:00Z",
        },
      ],
    });
    expect(c.items.map((i) => i.qty)).toEqual([0, 1]);
  });

  it("Square: a CANCELED order is voided and never closed", () => {
    const [c] = squareAdapter.normalize({
      id: "sq-c",
      state: "CANCELED",
      created_at: OPENED,
      closed_at: CLOSED,
      line_items: [],
    });
    expect(c.voided).toBe(true);
    expect(c.closedAt).toBeNull();
  });

  it("Square: a COMPLETED order is not voided", () => {
    const [c] = squareAdapter.normalize({
      id: "sq-ok",
      state: "COMPLETED",
      created_at: OPENED,
      closed_at: CLOSED,
    });
    expect(c.voided).toBe(false);
  });

  it("Square: a return order gives its own check plus one voided, money-free return per return uid", () => {
    const checks = squareAdapter.normalize({
      id: "sq-ret",
      state: "COMPLETED",
      created_at: "2026-11-07T10:00:00Z",
      closed_at: "2026-11-07T10:05:00Z",
      net_amounts: { total_money: { amount: -18000 } },
      line_items: [],
      returns: [
        {
          uid: "ret-uid-1",
          source_order_id: "sq-sale",
          return_line_items: [
            {
              uid: "rli-1",
              source_line_item_uid: "li-1",
              name: "Caymus",
              quantity: "2",
              catalog_object_id: "item-1",
              base_price_money: { amount: 9000 },
            },
          ],
        },
      ],
    });
    expect(checks).toHaveLength(2);
    const [own, ret] = checks;
    expect(own.externalCheckId).toBe("sq-ret");
    expect(own.voided).toBe(false);
    expect(own.subtotal).toBeCloseTo(-180); // the money leaves sales here
    expect(ret).toMatchObject({
      externalCheckId: "sq-ret:return:ret-uid-1",
      voided: true,
      closedAt: "2026-11-07T10:05:00Z",
      subtotal: null,
      total: null,
      tip: null,
    });
    expect(ret.items).toEqual([
      expect.objectContaining({ externalItemId: "item-1", qty: 2, price: 90 }),
    ]);
  });

  it("Clover: a deleted order is voided", () => {
    const [c] = cloverAdapter.normalize({
      id: "clv-d",
      state: "locked",
      createdTime: 1,
      modifiedTime: 2,
      deletedTimestamp: 3,
    });
    expect(c.voided).toBe(true);
  });

  it("Clover: an order that stands is not voided", () => {
    const [c] = cloverAdapter.normalize({
      id: "clv-ok",
      state: "locked",
      createdTime: 1,
      modifiedTime: 2,
    });
    expect(c.voided).toBe(false);
  });

  it("Clover: a refunded line stays sold and is returned on its own voided check keyed by the line", () => {
    const checks = cloverAdapter.normalize({
      id: "clv-r",
      state: "locked",
      createdTime: Date.parse(OPENED),
      modifiedTime: Date.parse(CLOSED),
      lineItems: {
        elements: [
          {
            id: "li-a",
            name: "Caymus",
            item: { id: "item-1" },
            price: 9000,
            refunded: true,
            refund: { createdTime: Date.parse("2026-11-06T22:00:00Z") },
          },
          { id: "li-b", name: "Barolo", item: { id: "item-2" }, price: 14000 },
        ],
      },
    });
    expect(checks).toHaveLength(2);
    const [sale, refund] = checks;
    expect(sale.voided).toBe(false);
    expect(sale.items.map((i) => i.qty)).toEqual([1, 1]);
    expect(refund).toMatchObject({
      externalCheckId: "clv-r:refund:li-a",
      voided: true,
      closedAt: "2026-11-06T22:00:00.000Z",
      total: null,
    });
    expect(refund.items).toEqual([
      expect.objectContaining({ externalItemId: "item-1", qty: 1 }),
    ]);
  });

  it("Clover: a deleted order does not return its refunded lines a second time", () => {
    const checks = cloverAdapter.normalize({
      id: "clv-dr",
      state: "locked",
      createdTime: 1,
      modifiedTime: 2,
      deletedTimestamp: 3,
      lineItems: {
        elements: [{ id: "li-a", name: "Caymus", price: 9000, refunded: true }],
      },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].voided).toBe(true);
  });
});

/** A database whose apply_stock_movement is idempotent on its key, and which keeps the stored rows. */
function makeDb(opening: number, mappedIds: string[]) {
  const seen = new Set<string>();
  const state = { stockLive: opening };
  const rows = new Map<string, Row>();
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        insert: async () => ({ error: null }),
        upsert: async (row: Row) => {
          if (table === "pos_checks") rows.set(row.external_check_id, row);
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({
          data: mappedIds.map((id) => ({
            external_item_id: id,
            item_name: `wine ${id}`,
            is_wine: true,
            inventory_id: "inv-1",
            sale_unit: "bottle",
          })),
          error: null,
        });
      }
      if (table === "restaurant_inventory") {
        q.in = async () => ({
          data: [{ id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 }],
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (name: string, args: Row) => {
      const key = args.p_idempotency_key as string;
      if (name === "apply_stock_movement") {
        if (!seen.has(key)) {
          seen.add(key);
          state.stockLive += Number(args.p_delta) || 0;
        }
        return { data: key, error: null };
      }
      seen.add(key);
      return { data: key, error: null };
    },
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    state,
    rows,
  };
}

describe("POS-1 through the hub: stock comes back and sales drop", () => {
  it("repro F: a Toast check voided after close returns its 2 bottles and stops being a sale", async () => {
    const { db, state, rows } = makeDb(12, ["item-1"]);
    const hub = new PosHubService(db);
    const toastCheck = (over: Row = {}) => ({
      guid: "t-f",
      openedDate: OPENED,
      closedDate: CLOSED,
      amount: 180,
      selections: [
        {
          displayName: "Caymus",
          item: { guid: "item-1" },
          quantity: 2,
          price: 180,
        },
      ],
      ...over,
    });

    await hub.ingest("r1", "toast", toastCheck());
    expect(state.stockLive).toBe(10);
    expect(rows.get("t-f")?.voided).toBe(false);

    await hub.ingest("r1", "toast", toastCheck({ voided: true }));
    expect(state.stockLive).toBe(12);
    expect(rows.get("t-f")?.voided).toBe(true);

    // The same void delivered again moves nothing.
    await hub.ingest("r1", "toast", toastCheck({ voided: true }));
    expect(state.stockLive).toBe(12);
  });

  it("Toast: a selection voided before close takes no stock", async () => {
    const { db, state } = makeDb(12, ["item-1"]);
    const hub = new PosHubService(db);
    await hub.ingest("r1", "toast", {
      guid: "t-sel",
      openedDate: OPENED,
      closedDate: CLOSED,
      selections: [
        {
          displayName: "Caymus",
          item: { guid: "item-1" },
          quantity: 2,
          price: 180,
          voided: true,
        },
      ],
    });
    expect(state.stockLive).toBe(12);
  });

  it("repro G: a Square return order puts the 2 bottles back, once", async () => {
    const { db, state, rows } = makeDb(12, ["item-1"]);
    const hub = new PosHubService(db);
    await hub.ingest("r1", "square", {
      id: "sq-sale",
      state: "COMPLETED",
      created_at: OPENED,
      closed_at: CLOSED,
      net_amounts: { total_money: { amount: 18000 } },
      line_items: [
        {
          uid: "li-1",
          name: "Caymus",
          quantity: "2",
          catalog_object_id: "item-1",
          base_price_money: { amount: 9000 },
        },
      ],
    });
    expect(state.stockLive).toBe(10);

    const returnOrder = {
      id: "sq-ret",
      state: "COMPLETED",
      created_at: "2026-11-07T10:00:00Z",
      closed_at: "2026-11-07T10:05:00Z",
      net_amounts: { total_money: { amount: -18000 } },
      returns: [
        {
          uid: "ret-uid-1",
          source_order_id: "sq-sale",
          return_line_items: [
            {
              uid: "rli-1",
              source_line_item_uid: "li-1",
              name: "Caymus",
              quantity: "2",
              catalog_object_id: "item-1",
              base_price_money: { amount: 9000 },
            },
          ],
        },
      ],
    };
    await hub.ingest("r1", "square", returnOrder);
    expect(state.stockLive).toBe(12);
    // The return order's own row carries the money back out of sales; the
    // return's row is voided, so it is never read as a sale.
    expect(rows.get("sq-ret")).toMatchObject({ voided: false, subtotal: -180 });
    expect(rows.get("sq-ret:return:ret-uid-1")).toMatchObject({
      voided: true,
      subtotal: null,
    });

    await hub.ingest("r1", "square", returnOrder);
    expect(state.stockLive).toBe(12);
  });

  it("Clover: a refunded line puts its bottle back, once", async () => {
    const { db, state } = makeDb(12, ["item-1"]);
    const hub = new PosHubService(db);
    const order = (refunded: boolean) => ({
      id: "clv-1",
      state: "locked",
      createdTime: Date.parse(OPENED),
      modifiedTime: Date.parse(CLOSED),
      lineItems: {
        elements: [
          {
            id: "li-a",
            name: "Caymus",
            item: { id: "item-1" },
            price: 9000,
            refunded,
          },
        ],
      },
    });
    await hub.ingest("r1", "clover", order(false));
    expect(state.stockLive).toBe(11);
    await hub.ingest("r1", "clover", order(true));
    expect(state.stockLive).toBe(12);
    await hub.ingest("r1", "clover", order(true));
    expect(state.stockLive).toBe(12);
  });
});
