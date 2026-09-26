/**
 * A line's history on the receiving desk, built from the door receipts already
 * recorded (founder, 2026-09-25, answer 2), ten entries a page (Q7 Approach 1,
 * 2026-09-22), newest first.
 *
 * Real: ReceivingService.lineHistory, the cursor helpers, and the shelf reader
 * the first page carries. The store is an in-memory fake that APPLIES every
 * filter, the or-cursor and the sort it is given, so a read that forgot its
 * house, a cursor that skips a tied row, or a page that drops an entry returns
 * the wrong rows here rather than passing by looking at nothing.
 */
import { ReceivingService } from "./receiving.service";
import {
  LINE_HISTORY_PAGE,
  formatLineHistoryCursor,
  kindOf,
  lineHistoryCursorFilter,
  parseLineHistoryCursor,
} from "./receiving-line-history";

type Row = Record<string, any>;
const REST = "rest-1";
const ORDER = "11111111-1111-4111-8111-111111111111";

/** Parses exactly the or-filter lineHistoryCursorFilter writes, and nothing else. */
function orPredicate(expr: string): (r: Row) => boolean {
  const m =
    /^occurred_at\.lt\."([^"]+)",and\(occurred_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)\)$/.exec(expr);
  if (!m) throw new Error(`the fake does not understand this or-filter: ${expr}`);
  const [, lt, eqAt, idLt] = m;
  if (lt !== eqAt) throw new Error("the two halves of the cursor name different instants");
  return (r) => r.occurred_at < lt || (r.occurred_at === eqAt && String(r.id) < idLt);
}

function fakeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const log: Array<{ table: string; filters: string[]; or: string | null; head: boolean }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const entry = { table, filters: [] as string[], or: null as string | null, head: false };
    log.push(entry);
    const sorts: Array<[string, boolean]> = [];
    let lim = Infinity;
    const run = () => {
      if (errors[table]) return { data: null, error: { message: errors[table] }, count: null };
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const [col, asc] of [...sorts].reverse()) {
        rows = [...rows].sort((a, b) =>
          a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1),
        );
      }
      if (entry.head) return { data: null, error: null, count: rows.length };
      return { data: rows.slice(0, lim), error: null, count: null };
    };
    const q: any = {
      select: (_c: string, o?: { head?: boolean }) => ((entry.head = !!o?.head), q),
      eq: (c: string, v: unknown) => (entry.filters.push(`${c}=${v}`), filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (
        entry.filters.push(`${c}=${vs.join("|")}`), filters.push((r) => vs.includes(r[c])), q
      ),
      or: (expr: string) => ((entry.or = expr), filters.push(orPredicate(expr)), q),
      order: (c: string, o: { ascending: boolean }) => (sorts.push([c, o.ascending]), q),
      limit: (n: number) => ((lim = n), q),
      range: () => q,
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      not: (c: string, op: string, v: unknown) => (
        filters.push((r) => (op === "is" ? (r[c] ?? null) !== v : r[c] !== v)), q
      ),
      maybeSingle: async () => {
        const r = run();
        return { data: r.error ? null : ((r.data ?? [])[0] ?? null), error: r.error };
      },
      then: (resolve: (v: any) => void) => resolve(run()),
    };
    return q;
  };
  return { db: { getClient: () => ({ from }) } as any, log };
}

const at = (minute: number) => `2026-09-25T10:${String(minute).padStart(2, "0")}:00+00:00`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function event(n: number, over: Row = {}): Row {
  return {
    id: uuid(n),
    restaurant_id: REST,
    order_id: ORDER,
    stage: "case_count",
    occurred_at: at(n),
    outcome: "accepted",
    counted_qty: 2,
    counted_uom: "case",
    counted_qty_bottles: 24,
    rejected_qty: 0,
    rejected_qty_bottles: 0,
    received_by: "user-door",
    ...over,
  };
}

function tables(events: Row[]): Record<string, Row[]> {
  return {
    procurement_orders: [
      {
        id: ORDER,
        restaurant_id: REST,
        order_number: "PO-7",
        inventory_id: "inv-1",
        provider_id: "prov-1",
        quantity: 5,
        unit_type: "case",
        bottles_total: 60,
        match_verified_at: "2026-09-25T11:00:00+00:00",
      },
      // Another house's order: the history must never answer for it.
      { id: uuid(999), restaurant_id: "rest-2", order_number: "PO-X", inventory_id: "inv-9" },
    ],
    procurement_receipt_events: [
      ...events,
      // Another house's event on the SAME order id: a read that forgot its house returns it.
      event(59, { id: uuid(5999), restaurant_id: "rest-2" }),
    ],
    users: [
      { user_id: "user-door", name: "Selin at the door" },
      { user_id: "user-desk", name: "Deniz" },
    ],
    inventory_transactions: [
      { id: "t1", restaurant_id: REST, order_id: ORDER, inventory_id: "inv-1", stock_type: "live", quantity_change: 58, idempotency_key: "order-delivered-live:x" },
    ],
    restaurant_inventory: [{ id: "inv-1", restaurant_id: REST, uom: "bottle" }],
    procurement_order_items: [{ id: "l1", restaurant_id: REST, order_id: ORDER, unit_type: "case", bottles_per_unit: 12 }],
  };
}

describe("the history cursor", () => {
  it("round-trips a row, and parses only its own grammar", () => {
    const c = formatLineHistoryCursor({ occurred_at: at(3), id: uuid(3) });
    expect(parseLineHistoryCursor(c)).toEqual({ occurredAt: at(3), id: uuid(3) });
    for (const bad of [
      at(3), // no id half: a timestamp-only cursor skips tied rows
      `${at(3)}|not-a-uuid`,
      `${at(3)}|${uuid(3)},id.gt.0`, // an attempt to append a filter
      `${at(3)})|${uuid(3)}`,
      "",
      null,
    ]) {
      expect(parseLineHistoryCursor(bad as any)).toBeNull();
    }
  });

  it("writes a quoted, tie-safe or-filter", () => {
    expect(lineHistoryCursorFilter({ occurredAt: at(3), id: uuid(3) })).toBe(
      `occurred_at.lt."${at(3)}",and(occurred_at.eq."${at(3)}",id.lt.${uuid(3)})`,
    );
  });

  it("names each stage, and never hides one it does not word", () => {
    expect(kindOf("case_count", "accepted")).toBe("door_count");
    expect(kindOf("case_count", "refused")).toBe("door_refused");
    expect(kindOf("reconciled", null)).toBe("desk_verified");
    expect(kindOf("bottle_count", null)).toBe("other");
  });
});

describe("ReceivingService.lineHistory", () => {
  it("returns the newest ten, says an older page exists, and hands back its marker", async () => {
    const events = Array.from({ length: 13 }, (_, i) => event(i + 1));
    const { db } = fakeDb(tables(events));
    const page = await new ReceivingService(db).lineHistory(REST, ORDER, null);
    expect(page.entries).toHaveLength(LINE_HISTORY_PAGE);
    expect(page.entries.map((e) => e.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => uuid(13 - i)),
    );
    expect(page.total).toBe(13);
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBe(`${at(4)}|${uuid(4)}`);
    expect(page.entries[0]).toMatchObject({
      kind: "door_count",
      countedQtyInCountedUom: 2,
      countedUom: "case",
      countedBottles: 24,
      recordedBy: "Selin at the door",
    });
    // The first page carries the ledger's received block (ADR 0192).
    expect(page.received).toMatchObject({ readable: true, quantityInStockUom: 58 });
    expect(page.matchVerifiedAt).toBe("2026-09-25T11:00:00+00:00");
  });

  it("the next page starts strictly after the marker, and the last page says so", async () => {
    const events = Array.from({ length: 13 }, (_, i) => event(i + 1));
    const { db, log } = fakeDb(tables(events));
    const svc = new ReceivingService(db);
    const first = await svc.lineHistory(REST, ORDER, null);
    const second = await svc.lineHistory(REST, ORDER, first.nextBefore);
    expect(second.entries.map((e) => e.id)).toEqual([uuid(3), uuid(2), uuid(1)]);
    expect(second.hasMore).toBe(false);
    expect(second.nextBefore).toBeNull();
    // An older page is only more entries.
    expect(second.received).toBeNull();
    expect(log.some((l) => l.table === "procurement_receipt_events" && l.or !== null)).toBe(true);
  });

  it("does not skip a row that shares the page boundary's instant", async () => {
    // Eleven rows at ONE instant: a timestamp-only cursor would lose the 11th.
    const events = Array.from({ length: 11 }, (_, i) => event(i + 1, { occurred_at: at(30) }));
    const { db } = fakeDb(tables(events));
    const svc = new ReceivingService(db);
    const first = await svc.lineHistory(REST, ORDER, null);
    const second = await svc.lineHistory(REST, ORDER, first.nextBefore);
    const seen = [...first.entries, ...second.entries].map((e) => e.id);
    expect(new Set(seen).size).toBe(11);
    expect(second.entries).toHaveLength(1);
  });

  it("reads only this house's events for this line", async () => {
    const { db, log } = fakeDb(tables([event(1)]));
    const page = await new ReceivingService(db).lineHistory(REST, ORDER, null);
    expect(page.entries.map((e) => e.id)).toEqual([uuid(1)]);
    expect(page.total).toBe(1);
    // Every read of the events — the page, the count, and the shelf reader's
    // door totals on the first page — is scoped to this house and this line.
    const reads = log.filter((l) => l.table === "procurement_receipt_events");
    expect(reads.length).toBeGreaterThanOrEqual(3);
    for (const r of reads) {
      expect(r.filters).toEqual(expect.arrayContaining([`restaurant_id=${REST}`, `order_id=${ORDER}`]));
    }
  });

  it("answers 404 for another house's order, exactly like a missing one", async () => {
    const { db, log } = fakeDb(tables([event(1)]));
    await expect(new ReceivingService(db).lineHistory(REST, uuid(999), null)).rejects.toMatchObject({
      status: 404,
    });
    // Nothing about the foreign line was read.
    expect(log.some((l) => l.table === "procurement_receipt_events")).toBe(false);
  });

  it("refuses a marker it did not give out, before reading anything", async () => {
    const { db, log } = fakeDb(tables([event(1)]));
    await expect(
      new ReceivingService(db).lineHistory(REST, ORDER, `${at(1)}|${uuid(1)},id.gt.0`),
    ).rejects.toMatchObject({ status: 400 });
    expect(log).toHaveLength(0);
  });

  it("words the desk's verification and a refusal at the door", async () => {
    const { db } = fakeDb(
      tables([
        event(1, { outcome: "refused", refusal_reason: "broken_case", counted_qty_bottles: 0, rejected_qty: 2, rejected_qty_bottles: 24 }),
        event(2, {
          stage: "reconciled",
          outcome: null,
          counted_qty: 58,
          counted_uom: "bottle",
          counted_qty_bottles: 58,
          rejected_qty_bottles: 2,
          invoice_qty_bottles: 60,
          received_by: "user-desk",
        }),
      ]),
    );
    const page = await new ReceivingService(db).lineHistory(REST, ORDER, null);
    expect(page.entries[0]).toMatchObject({
      kind: "desk_verified",
      invoiceBottles: 60,
      countedBottles: 58,
      rejectedBottles: 2,
      recordedBy: "Deniz",
    });
    expect(page.entries[1]).toMatchObject({
      kind: "door_refused",
      refusalReason: "broken_case",
      rejectedBottles: 24,
    });
  });

  it("a failed read of the events is an error, never an empty history", async () => {
    const { db } = fakeDb(tables([event(1)]), { procurement_receipt_events: "connection reset" });
    await expect(new ReceivingService(db).lineHistory(REST, ORDER, null)).rejects.toThrow(
      /history could not be read \(connection reset\)/,
    );
  });

  it("a failed read of the line itself is an error, not a 404", async () => {
    const { db } = fakeDb(tables([event(1)]), { procurement_orders: "permission denied" });
    await expect(new ReceivingService(db).lineHistory(REST, ORDER, null)).rejects.toThrow(
      /line could not be read \(permission denied\)/,
    );
  });

  it("a failed name read keeps the entries and says the names are missing", async () => {
    const { db } = fakeDb(tables([event(1)]), { users: "timeout" });
    const page = await new ReceivingService(db).lineHistory(REST, ORDER, null);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].recordedBy).toBeNull();
    expect(page.recordedByUnavailable).toBe(true);
  });

  it("an empty history is an empty list with a measured total of 0", async () => {
    const { db } = fakeDb(tables([]));
    const page = await new ReceivingService(db).lineHistory(REST, ORDER, null);
    expect(page.entries).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });
});

describe("the desk queue names each line by what was ordered", () => {
  const queueTables = (): Record<string, Row[]> => {
    const t = tables([]);
    t.procurement_orders = [
      { ...t.procurement_orders[0], match_status: "partial", discrepancy_notes: "58 of 60" },
      {
        id: uuid(2),
        restaurant_id: REST,
        order_number: "PO-8",
        inventory_id: "inv-2",
        provider_id: "prov-1",
        quantity: 6,
        unit_type: "bottle",
        bottles_total: 6,
        match_status: "qty_short",
      },
    ];
    t.procurement_credits = [];
    t.providers = [{ id: "prov-1", name: "Wine Warehouse" }];
    t.restaurant_inventory = [
      { id: "inv-1", restaurant_id: REST, uom: "bottle", wine_name: "Chablis 2022", display_name: null },
      // An empty wine_name falls back to the house's own display name.
      { id: "inv-2", restaurant_id: REST, uom: "bottle", wine_name: "  ", display_name: "House red" },
      // Another house's item with the same id must never name this house's line.
      { id: "inv-1", restaurant_id: "rest-2", uom: "bottle", wine_name: "Their wine" },
    ];
    return t;
  };

  it("carries the item's name on each row", async () => {
    const { db } = fakeDb(queueTables());
    const out: any = await new ReceivingService(db).managerQueue(REST);
    const byId = new Map(out.items.map((i: any) => [i.orderId, i]));
    expect((byId.get(ORDER) as any).itemName).toBe("Chablis 2022");
    expect((byId.get(uuid(2)) as any).itemName).toBe("House red");
    expect(out.itemNamesUnavailable).toBe(false);
  });

  it("a failed name read keeps the queue and says the names are missing", async () => {
    const { db } = fakeDb(queueTables());
    const from = db.getClient().from;
    // Fail only the NAME lookup (the read that selects the names), not the
    // shelf reader's unit read of the same table.
    const failing = {
      getClient: () => ({
        from: (table: string) => {
          const q = from(table);
          if (table !== "restaurant_inventory") return q;
          const select = q.select;
          q.select = (cols: string, o?: any) => {
            if (/wine_name/.test(cols)) {
              q.then = (r: any) => r({ data: null, error: { message: "timeout" } });
            }
            return select(cols, o);
          };
          return q;
        },
      }),
    } as any;
    const out: any = await new ReceivingService(failing).managerQueue(REST);
    expect(out.items).toHaveLength(2);
    expect(out.itemNamesUnavailable).toBe(true);
    for (const i of out.items) expect(i.itemName).toBeNull();
  });
});
