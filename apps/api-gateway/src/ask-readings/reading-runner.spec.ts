import { READING_CATALOGUE, QUESTION_DISPOSITIONS } from "./reading-catalogue";
import { ReadingRunner, readingWindow } from "./reading-runner";
import { RecordingSession, ReadingFailure } from "./recording-session";
import { Finding, ReadingArgs, ReadingId } from "./reading.types";

type Row = Record<string, any>;
/** A filtering, paginating fake: tenant filters must execute to hide distractors. */
class Books {
  readonly calls: Array<{ table: string; filters: string[]; offset: number }> = [];
  fail = new Set<string>();
  unknownCount = false;
  countChange = false;
  constructor(readonly tables: Record<string, Row[]>) {}
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const filterNames: string[] = [];
    let offset = 0, end = 999, sorted = false;
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => { filters.push(r => r[k] === v); filterNames.push(`${k}=${v}`); return q; },
      is: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
      gte: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] >= v); return q; },
      lt: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] < v); return q; },
      order: () => { sorted = true; return q; },
      range: (a: number, b: number) => { offset = a; end = b; return q; },
      then: (resolve: any, reject: any) => {
        this.calls.push({ table, filters: filterNames, offset });
        if (this.fail.has(table)) return Promise.resolve({ data: null, count: null, error: { code: "XX001", message: "not absence" } }).then(resolve, reject);
        let data = (this.tables[table] || []).filter(r => filters.every(f => f(r)));
        if (sorted) data = [...data].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const count = this.unknownCount ? null : data.length + (this.countChange && offset ? 1 : 0);
        return Promise.resolve({ data: data.slice(offset, end + 1), count, error: null }).then(resolve, reject);
      },
    };
    return q;
  }
}
const rid = "house-a";
const house = (id: string, rest: Row = {}): Row => ({ id, restaurant_id: rid, ...rest });
const item = (id: string, rest: Row = {}): Row => house(id, { display_name: id, wine_name: id, uom: "bottle", kind: "wine", stock_live: 2,
  shadow_stock: 4, in_transit_quantity: 12, threshold_min: 3, is_active: true, deleted_at: null, ...rest });
const order = (id: string, rest: Row = {}): Row => house(id, { order_number: id, status: "CONFIRMED", inventory_id: "item-a", quantity: 2, unit_type: "CASE", expected_delivery_date: "2026-09-12", ...rest });
const doc = (id: string, rest: Row = {}): Row => house(id, { doc_type: "invoice", doc_number: id, status: "verified", currency: "TRY",
  extracted: { currencyFiledFrom: "stated on document" }, verified_at: "2026-09-12T12:00:00Z", verified_by: "manager", ...rest });
const fixture = () => new Books({
  restaurants: [{ id: rid, threshold_configured: false }],
  restaurant_inventory: [item("item-a"), item("item-b", { stock_live: 9, in_transit_quantity: 0 }), item("item-c", { stock_live: 3, in_transit_quantity: null }),
    item("foreign-item", { restaurant_id: "house-b", stock_live: 99999 })],
  inventory_lots: [house("lot-1", { inventory_id: "item-a", location_id: "cellar", stock_state: "live", qty: 4 }),
    house("lot-2", { inventory_id: "item-a", location_id: "cellar", stock_state: "live", qty: 6 }),
    house("lot-3", { inventory_id: "item-a", location_id: null, stock_state: "shadow", qty: 3 })],
  storage_locations: [house("cellar", { name: "Cellar" })],
  inventory_transactions: [house("move-1", { inventory_id: "item-a", quantity_change: 12, stock_type: "live", transaction_date: "2026-09-12T11:00:00.000Z" }),
    house("move-2", { inventory_id: "item-a", quantity_change: -3, stock_type: "live", transaction_date: "2026-09-12T12:00:00.000Z" }),
    house("move-3", { inventory_id: "item-a", quantity_change: 9, stock_type: "shadow", transaction_date: "2026-09-12T13:00:00.000Z" })],
  procurement_orders: [order("order-a"), order("order-b", { status: "DELIVERED" }), order("order-c", { expected_delivery_date: null }),
    order("order-future", { expected_delivery_date: "2026-09-20" }), order("foreign-order", { restaurant_id: "house-b" })],
  procurement_order_items: [house("order-line-1", { order_id: "order-a", inventory_id: "item-a", wine_name: "item-a", quantity: 2, unit_type: "case", bottles_per_unit: 6, total_bottles: 12 }),
    house("order-line-2", { order_id: "order-a", inventory_id: "item-b", wine_name: "item-b", quantity: 3, unit_type: "bottle", bottles_per_unit: 1, total_bottles: 3 })],
  procurement_documents: [doc("receipt-a"), doc("new-unverified", { status: "needs_review", verified_at: null }), doc("pending-doc", { status: "received", verified_at: null })],
  procurement_document_lines: [house("receipt-line", { document_id: "receipt-a", inventory_id: "item-a", qty: 2, uom: "case", pack_size: 6, unit_price: 360, price_base_qty: 1, price_base_uom: "case" })],
  procurement_document_links: [],
  pos_checks: [house("check-a", { closed_at: "2026-09-12T12:00:00.000Z", covers: 2, voided: false }), house("check-b", { closed_at: "2026-09-12T13:00:00.000Z", covers: 3, voided: false }),
    house("check-void", { closed_at: "2026-09-12T12:00:00.000Z", covers: 50, voided: true }), house("check-open", { closed_at: null, covers: 50, voided: false })],
  wine_consumption_log: [house("glass-a", { inventory_id: "item-a", consumption_type: "glass", quantity: 1, volume_ml: 150, recorded_at: "2026-09-12T12:00:00.000Z" }),
    house("glass-b", { inventory_id: "item-a", consumption_type: "glass", quantity: 1, volume_ml: 150, recorded_at: "2026-09-12T12:00:00.000Z" }),
    house("bottle-a", { inventory_id: "item-a", consumption_type: "bottle", quantity: 1, volume_ml: 750, recorded_at: "2026-09-12T12:00:00.000Z" })],
  calendar_events: [house("event-a", { title: "Dinner", start_date: "2026-09-12", start_time: "18:00", status: "scheduled", is_recurring: false, parent_event_id: null }),
    house("cancelled", { title: "Cancelled", start_date: "2026-09-12", status: "cancelled", is_recurring: false, parent_event_id: null })],
  providers: [house("owned", { name: "Owned vendor", is_active: true, deleted_at: null }),
    { id: "shared", restaurant_id: null, name: "Shared vendor", is_active: true, deleted_at: null },
    { id: "unlinked", restaurant_id: null, name: "Unlinked shared", is_active: true, deleted_at: null }],
  restaurant_providers: [house("vendor-link", { provider_id: "shared", is_active: true })],
  analytics_goals: [house("goal-a", { name: "Target A", metric_key: "covers", target_value: 40, status: "active", current_value: 0 }),
    house("goal-b", { name: "Target B", metric_key: "days", target_value: 2, status: "active", current_value: 0 })],
});
const args: ReadingArgs = { subjectId: "item-a", from: "2026-09-12", to: "2026-09-12" };
const run = (books: Books, id: ReadingId, input: ReadingArgs = args) => new ReadingRunner(books, () => new Date("2026-09-13T12:00:00Z")).run(rid, id, input);
const cells = (finding: Finding) => finding.rows.flatMap(r => r.cells);
const value = (finding: Finding, key: string) => cells(finding).find(c => c.key === key)?.value;

const known: Array<[ReadingId, string, number, string]> = [
  ["inventory.position", "item-a:stock_live", 2, "restaurant_inventory"],
  ["inventory.low_stock", "below:count", 1, "restaurant_inventory"],
  ["inventory.in_transit", "item-a:in_transit_quantity", 12, "restaurant_inventory"],
  ["inventory.locations", "cellar:live:qty", 10, "inventory_lots"],
  ["inventory.movements", "lane:live:net", 9, "inventory_transactions"],
  ["orders.open", "orders:count", 3, "procurement_orders"],
  ["orders.lines", "order-line-1:quantity", 2, "procurement_order_items"],
  ["orders.late_deliveries", "orders:count", 1, "procurement_orders"],
  ["receipts.verified_line", "receipt-line:unit_price", 360, "procurement_document_lines"],
  ["sales.check_activity", "covers:sum", 5, "pos_checks"],
  ["sales.consumption", "consumption:volume", 1050, "wine_consumption_log"],
  ["calendar.upcoming", "events:count", 1, "calendar_events"],
  ["vendors.active", "vendors:count", 2, "providers"],
  ["documents.waiting", "documents:count", 2, "procurement_documents"],
  ["goals.targets", "goal-a:target_value", 40, "analytics_goals"],
];
describe("ADR 0145 declared fifteen-reading numerical/error floor", () => {
  test("the measured fixture floor exactly covers the catalogue", () => {
    expect(new Set(known.map(k => k[0]))).toEqual(new Set(READING_CATALOGUE.map(r => r.id)));
    expect(known).toHaveLength(15);
    for (const reader of READING_CATALOGUE) expect(QUESTION_DISPOSITIONS[reader.id]).toEqual({ kind: "reading", id: reader.id });
  });
  test.each(known)("%s computes known rows, with actual trace", async (id, key, expected) => {
    const finding = await run(fixture(), id, id === "orders.lines" ? { subjectId: "order-a" } : args);
    expect(finding.outcome).toBe("read");
    expect(value(finding, key)).toBe(expected);
    expect(finding.trace.length).toBeGreaterThan(0);
    expect(finding.rowsScanned).toBeGreaterThan(0);
    expect(cells(finding).every(c => c.id && c.sourceRelations.length)).toBe(true);
    expect(JSON.stringify(finding)).not.toContain("foreign-");
  });
  test.each(known)("%s refuses a forced source error, never empties it", async (id, _key, _expected, table) => {
    const books = fixture(); books.fail.add(table);
    const finding = await run(books, id, id === "orders.lines" ? { subjectId: "order-a" } : args);
    expect(finding.outcome).toBe("could_not_read");
    expect(finding.failedSources).toContain(table);
    expect(finding.rows).toEqual([]);
    expect(finding.rowsScanned).toBeNull();
  });
});

describe("proof, scope, absence and provenance regressions", () => {
  test("actual multi-page reads exceed Supabase's first page without inventing a count", async () => {
    const books = fixture(); books.tables.analytics_goals = Array.from({ length: 1201 }, (_, i) => house(`g-${i.toString().padStart(4, "0")}`, { status: "active", target_value: i, metric_key: "covers" }));
    const finding = await run(books, "goals.targets");
    expect(value(finding, "goals:count")).toBe(1201);
    expect(books.calls.map(c => c.offset)).toEqual([0, 500, 1000]);
    expect(finding.trace.map(t => t.rowsScanned)).toEqual([500, 500, 201]);
  });
  test("unknown count and moving pagination cannot claim completeness", async () => {
    const books = fixture(); books.unknownCount = true;
    expect((await run(books, "goals.targets")).reason).toBe("invalid_source_result");
    books.unknownCount = false; books.countChange = true;
    books.tables.analytics_goals = Array.from({ length: 501 }, (_, i) => house(`g-${i}`, { status: "active" }));
    expect((await run(books, "goals.targets")).reason).toBe("source_changed");
  });
  test("an empty real register is a measured empty result", async () => {
    const books = fixture(); books.tables.analytics_goals = [];
    const finding = await run(books, "goals.targets");
    expect(finding.outcome).toBe("not_in_your_books");
    expect(value(finding, "goals:count")).toBe(0);
    expect(finding.trace[0].outcome).toBe("empty");
  });
  // KL audit J4: a filter that matched nothing in a register that HAS rows is
  // a true zero read out of the books, never "not in your books".
  test("forty closed orders and no open one is a read zero, not an empty register", async () => {
    const books = fixture();
    books.tables.procurement_orders = Array.from({ length: 40 }, (_, i) => order(`closed-${i}`, { status: "DELIVERED" }));
    const finding = await run(books, "orders.open");
    expect(finding.outcome).toBe("read");
    expect(finding.reason).toBeNull();
    expect(finding.rowsScanned).toBe(40);
    expect(value(finding, "orders:count")).toBe(0);
  });
  test("items that exist with none below threshold is a read zero", async () => {
    const books = fixture();
    books.tables.restaurant_inventory = books.tables.restaurant_inventory.map(r => ({ ...r, stock_live: 50 }));
    const finding = await run(books, "inventory.low_stock");
    expect(finding.outcome).toBe("read");
    expect(value(finding, "below:count")).toBe(0);
  });
  test("documents that exist with none waiting is a read zero", async () => {
    const books = fixture();
    books.tables.procurement_documents = [doc("receipt-a")];
    const finding = await run(books, "documents.waiting");
    expect(finding.outcome).toBe("read");
    expect(value(finding, "documents:count")).toBe(0);
  });
  test("a register with no rows at all is still not in your books", async () => {
    const books = fixture();
    books.tables.procurement_orders = [];
    const finding = await run(books, "orders.open");
    expect(finding.outcome).toBe("not_in_your_books");
    expect(finding.reason).toBe("empty_register");
    expect(finding.rowsScanned).toBe(0);
  });
  test("a foreign house's rows never make this house's register look non-empty", async () => {
    const books = fixture();
    books.tables.procurement_orders = [order("foreign-closed", { restaurant_id: "house-b", status: "DELIVERED" })];
    const finding = await run(books, "orders.open");
    expect(finding.outcome).toBe("not_in_your_books");
  });
  // KL audit J10: "past the stated delivery date" is only true before today.
  test.each([
    ["a window ending today", { from: "2026-09-01", to: "2026-09-13" }],
    ["a window in 2099", { from: "2099-01-01", to: "2099-01-31" }],
  ])("late deliveries refuses %s before reading anything", async (_name, window) => {
    const books = fixture();
    books.tables.procurement_orders.push(order("order-2099", { expected_delivery_date: "2099-01-15" }));
    const finding = await run(books, "orders.late_deliveries", window);
    expect(finding.outcome).toBe("requirements_unsatisfied");
    expect(finding.reason).toBe("invalid_window");
    expect(books.calls).toEqual([]);
    expect(JSON.stringify(finding)).not.toContain("order-2099");
  });
  test("late deliveries still reads a window that ended yesterday", async () => {
    const finding = await run(fixture(), "orders.late_deliveries", { from: "2026-09-01", to: "2026-09-12" });
    expect(finding.outcome).toBe("read");
    expect(value(finding, "orders:count")).toBe(1);
  });
  test("null stock/volume is not zero and a default threshold remains an assumption", async () => {
    const books = fixture(); books.tables.restaurant_inventory[0].stock_live = null;
    const position = await run(books, "inventory.position");
    expect(value(position, "item-a:stock_live")).toBeNull();
    books.tables.restaurant_inventory[0].stock_live = 2;
    const low = await run(books, "inventory.low_stock");
    expect(cells(low).find(c => c.key === "item-a:threshold_min")?.provenance).toBe("defaulted");
    books.tables.restaurants[0].threshold_configured = true;
    expect(cells(await run(books, "inventory.low_stock")).find(c => c.key === "item-a:threshold_min")?.provenance).toBe("stated");
    books.tables.wine_consumption_log[0].volume_ml = null;
    expect(value(await run(books, "sales.consumption"), "consumption:volume")).toBeNull();
  });
  test("ambiguity is counted independently; no first candidate shortcut", async () => {
    const finding = await run(fixture(), "inventory.position", { subjectText: "item" });
    expect(finding.outcome).toBe("clarify");
    expect(finding.choices).toHaveLength(3);
    expect(finding.rows).toEqual([]);
    expect((await run(fixture(), "inventory.position", { subjectId: "foreign-item" })).reason).toBe("subject_not_found");
  });
  test("foreign child under an owned parent fails, null legacy child remains parent-scoped", async () => {
    const books = fixture(); books.tables.procurement_order_items[0].restaurant_id = "house-b";
    expect((await run(books, "orders.lines", { subjectId: "order-a" })).reason).toBe("scope_mismatch");
    books.tables.procurement_order_items[0].restaurant_id = null;
    expect((await run(books, "orders.lines", { subjectId: "order-a" })).outcome).toBe("read");
  });
  test("foreign vendor behind a junction fails closed; revoked owned link wins", async () => {
    const books = fixture(); books.tables.providers[1].restaurant_id = "house-b";
    expect((await run(books, "vendors.active")).reason).toBe("scope_mismatch");
    books.tables.providers[1].restaurant_id = null;
    books.tables.restaurant_providers.push(house("revoked", { provider_id: "owned", is_active: false }));
    const finding = await run(books, "vendors.active");
    expect(value(finding, "vendors:count")).toBe(1);
    expect(JSON.stringify(finding)).not.toContain("Unlinked shared");
  });
  test("receipt linkage, verification and currency provenance are independent requirements", async () => {
    const books = fixture(); books.tables.procurement_document_lines[0].inventory_id = null;
    expect((await run(books, "receipts.verified_line")).reason).toBe("missing_verified_link");
    books.tables.procurement_document_lines[0].inventory_id = "item-a";
    books.tables.procurement_documents[0].extracted = {};
    expect((await run(books, "receipts.verified_line")).reason).toBe("missing_currency_provenance");
    books.tables.procurement_documents[0].extracted = { currencyFiledFrom: "stated on document" };
    books.tables.procurement_document_lines[0].restaurant_id = "house-b";
    expect((await run(books, "receipts.verified_line")).reason).toBe("scope_mismatch");
  });
  test("a Reading that never executes a query cannot mint a hollow figure", () => {
    const session = new RecordingSession(fixture());
    expect(() => session.count({} as any, "fabricated", "Stock")).toThrow(ReadingFailure);
    expect(() => session.finish("inventory.position", {}, [{ key: "bad", cells: [{ id: "made-up", value: 12 } as any] }])).toThrow(ReadingFailure);
  });
  test("figures from one run cannot be smuggled into another", async () => {
    const first = await run(fixture(), "inventory.position");
    const second = new RecordingSession(fixture());
    expect(() => second.finish("inventory.position", {}, first.rows)).toThrow(ReadingFailure);
  });
  test("stable fingerprints ignore cell UUIDs and detect changed quantities", async () => {
    const books = fixture();
    const a = await run(books, "inventory.position"), b = await run(books, "inventory.position");
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(cells(a)[0].id).not.toBe(cells(b)[0].id);
    books.tables.restaurant_inventory[0].stock_live = 7;
    expect((await run(books, "inventory.position")).fingerprint).not.toBe(a.fingerprint);
  });
  test("retired versions do not quietly execute today's code", async () => {
    const books = fixture();
    const result = await new ReadingRunner(books).run(rid, "inventory.position", args, 0);
    expect(result.reason).toBe("unknown_reading_version");
    expect(books.calls).toEqual([]);
  });
  test("timestamp windows are exact inclusive calendar dates, with no guessed period", () => {
    expect(readingWindow({ from: "2026-09-12", to: "2026-09-12" })).toEqual({ from: "2026-09-12T00:00:00.000Z", to: "2026-09-13T00:00:00.000Z" });
    expect(() => readingWindow({ from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => readingWindow({})).toThrow();
  });
  test("the shared Calendar resolver counts old recurring series once, applying an owned cancellation", async () => {
    const books = fixture();
    books.tables.calendar_events = [house("series", { title: "Service", start_date: "2020-01-01", status: "scheduled", is_recurring: true, recurrence_rule_id: "rule", parent_event_id: null })];
    books.tables.calendar_recurrence_rules = [house("rule", { calendar_event_id: "series", frequency: "daily", interval_value: 1, end_type: "never" })];
    books.tables.calendar_recurrence_exceptions = [{ id: "exception", recurrence_rule_id: "rule", original_date: "2026-09-12", exception_type: "deleted" }];
    const result = await run(books, "calendar.upcoming", { from: "2026-09-11", to: "2026-09-13" });
    expect(value(result, "events:count")).toBe(2);
    expect(result.sourcesQueried).toContain("calendar_recurrence_exceptions");
    expect(cells(result).filter(c => c.label === "Date").every(c => c.provenance === "derived")).toBe(true);
    books.fail.add("calendar_recurrence_exceptions");
    expect((await run(books, "calendar.upcoming", { from: "2026-09-11", to: "2026-09-13" })).outcome).toBe("could_not_read");
  });
});
