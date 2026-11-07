import { PosHubService } from "./pos-hub.service";
import { CatalogMatcherService } from "./catalog-matcher.service";
import { PosMappingReviewService } from "./pos-mapping-review.service";
import { DatabaseService } from "../database/database.service";

/**
 * POS-2 (QA round 5): the unresolved-line queue was write-only, so mapping an
 * item later never healed the stock its earlier sales should have moved.
 * The in-memory database below keeps the one stock-RPC property that matters
 * here (a seen key moves nothing), so the assertions are about stock and the
 * queue, never argument shapes.
 */

type Row = Record<string, any>;
type Op = "select" | "update" | "insert" | "upsert";

const HOUSE = "house-a";
const OTHER_HOUSE = "house-b";
const BOTTLE_ML = 750;

function makeDb(
  opts: { failQueueRead?: boolean; failKey?: (key: string) => boolean } = {},
) {
  const tables: Record<string, Row[]> = {
    pos_unresolved_lines: [],
    pos_checks: [],
    pos_item_mappings: [],
    restaurant_inventory: [
      {
        id: "inv-merlot",
        restaurant_id: HOUSE,
        bottle_size_ml: BOTTLE_ML,
        pour_size_ml: 150,
        menu_price_current: 60,
      },
      {
        id: "inv-merlot-b",
        restaurant_id: OTHER_HOUSE,
        bottle_size_ml: BOTTLE_ML,
        pour_size_ml: 150,
        menu_price_current: 60,
      },
    ],
    restaurant_tables: [],
    wine_consumption_log: [],
    inventory_transactions: [],
    events: [],
    pos_catalog_match_proposals: [
      {
        id: "prop-1",
        restaurant_id: HOUSE,
        source: "generic_webhook",
        external_item_id: "merlot-1",
        item_name: "House Merlot",
        candidate_inventory_id: "inv-merlot",
        candidate_master_wine_id: null,
        status: "pending",
      },
    ],
  };
  const stockMl: Record<string, number> = {
    "inv-merlot": 12 * BOTTLE_ML,
    "inv-merlot-b": 12 * BOTTLE_ML,
  };
  const seenKeys = new Set<string>();
  let nextId = 1;

  const matches = (row: Row, filters: Array<(r: Row) => boolean>) =>
    filters.every((f) => f(row));
  // PostgREST's `col->>key` reads one key of a json column.
  const at = (row: Row, col: string) => {
    const [c, k] = col.split("->>");
    return k === undefined ? row[c] : (row[c]?.[k] ?? null);
  };
  /** Largest `.in()` list sent per table, to pin the chunking. */
  const widestIn: Record<string, number> = {};

  class Query {
    private filters: Array<(r: Row) => boolean> = [];
    private op: Op = "select";
    private payload: any = null;
    private conflict: string[] = [];
    private max = Infinity;
    private one = false;
    private sorts: Array<[string, boolean]> = [];
    private tooLong = false;
    constructor(private readonly table: string) {}
    select = () => this;
    order = (col: string, o: { ascending?: boolean } = {}) => (
      this.sorts.push([col, o.ascending !== false]),
      this
    );
    single = () => ((this.one = true), this);
    maybeSingle = this.single;
    limit = (n: number) => ((this.max = n), this);
    eq = (col: string, val: any) => this.where((r) => at(r, col) === val);
    gt = (col: string, val: any) =>
      this.where((r) => String(at(r, col)) > String(val));
    // A URL past 16 KB is refused (QA round 2, U-1).
    in = (col: string, vals: any[]) => {
      widestIn[this.table] = Math.max(widestIn[this.table] ?? 0, vals.length);
      if (encodeURIComponent(vals.join(",")).length > 16_000)
        this.tooLong = true;
      return this.where((r) => vals.includes(at(r, col)));
    };
    // As the wire behaves: PostgREST turns every `*` into `%` before
    // Postgres reads the pattern, then ILIKE (backslash escapes, `%`, `_`).
    ilike = (col: string, pattern: string) => {
      const sql = pattern.replace(/\*/g, "%");
      let re = "";
      for (let i = 0; i < sql.length; i++) {
        const c = sql[i];
        if (c === "\\" && i + 1 < sql.length)
          re += sql[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        else if (c === "%") re += "[\\s\\S]*";
        else if (c === "_") re += "[\\s\\S]";
        else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      const like = new RegExp(`^${re}$`, "i");
      return this.where((r) => like.test(String(r[col] ?? "")));
    };
    update = (patch: Row) => this.set("update", patch);
    insert = (row: Row) => this.set("insert", row);
    upsert = (row: Row, o: { onConflict?: string } = {}) => {
      this.conflict = (o.onConflict ?? "").split(",").filter(Boolean);
      return this.set("upsert", row);
    };
    private where(f: (r: Row) => boolean) {
      this.filters.push(f);
      return this;
    }
    private set(op: Op, payload: Row) {
      this.op = op;
      this.payload = payload;
      return this;
    }
    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      try {
        return Promise.resolve(this.run()).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    }
    private run(): { data: any; error: any } {
      const rows = tables[this.table];
      if (!rows) return { data: null, error: { message: `no ${this.table}` } };
      if (this.tooLong)
        return { data: null, error: { message: "414 URI Too Long" } };
      if (this.op === "insert") {
        const row = { ...this.payload };
        if (this.table === "pos_unresolved_lines") {
          row.id = row.id ?? `q-${nextId++}`;
          row.resolved = false;
          row.reason = row.reason ?? "unmapped";
          row.created_at =
            row.created_at ??
            new Date(Date.UTC(2026, 10, 5) + nextId * 1000).toISOString();
          const dupe = rows.find(
            (r) =>
              !r.resolved &&
              r.restaurant_id === row.restaurant_id &&
              r.source === row.source &&
              r.external_check_id === row.external_check_id &&
              r.external_item_id === row.external_item_id &&
              r.reason === row.reason,
          );
          if (dupe)
            return { data: null, error: { code: "23505", message: "dupe" } };
        }
        if (this.table === "wine_consumption_log") {
          if (rows.some((r) => r.notes === row.notes))
            return { data: null, error: { code: "23505", message: "dupe" } };
        }
        rows.push(row);
        return { data: row, error: null };
      }
      if (this.op === "upsert") {
        const row = { ...this.payload };
        const existing = rows.find((r) =>
          this.conflict.every((c) => r[c] === row[c]),
        );
        if (existing) Object.assign(existing, row);
        else rows.push({ id: `row-${nextId++}`, ...row });
        const saved = existing ?? rows[rows.length - 1];
        return { data: { ...saved }, error: null };
      }
      if (this.op === "update") {
        const hit = rows.filter((r) => matches(r, this.filters));
        for (const r of hit) Object.assign(r, this.payload);
        return { data: hit, error: null };
      }
      if (this.table === "pos_unresolved_lines" && opts.failQueueRead)
        return { data: null, error: { message: "connection reset" } };
      const found = rows
        .filter((r) => matches(r, this.filters))
        .sort((a, b) => {
          for (const [col, asc] of this.sorts) {
            const x = String(at(a, col) ?? "");
            const y = String(at(b, col) ?? "");
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        })
        .slice(0, this.max)
        .map((r) => ({ ...r }));
      if (this.one) return { data: found[0] ?? null, error: null };
      return { data: found, error: null };
    }
  }

  const client: any = {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: Row) => {
      const key = String(args.p_idempotency_key);
      // A seen key moves nothing; record_glass_pour says so.
      if (seenKeys.has(key))
        return {
          data:
            name === "record_glass_pour" ? { idempotent: true } : "tx-existing",
          error: null,
        };
      if (opts.failKey?.(key))
        return { data: null, error: { message: "stock write refused" } };
      seenKeys.add(key);
      if (name === "apply_stock_movement") {
        stockMl[args.p_inventory_id] += Number(args.p_delta) * BOTTLE_ML;
        tables.inventory_transactions.push({
          restaurant_id: args.p_restaurant_id,
          idempotency_key: key,
          transaction_date: args.p_occurred_at,
        });
      } else if (name === "record_glass_pour") {
        // COALESCE(p_pour_ml, ri.pour_size_ml, 150), as the function reads it.
        const inv = tables.restaurant_inventory.find(
          (r) => r.id === args.p_inventory_id,
        );
        stockMl[args.p_inventory_id] -=
          Number(args.p_pours) *
          Number(args.p_pour_ml ?? inv?.pour_size_ml ?? 150);
      }
      return { data: `tx-${seenKeys.size}`, error: null };
    },
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    tables,
    stockMl,
    widestIn,
    bottles: (id = "inv-merlot") => stockMl[id] / BOTTLE_ML,
  };
}

const sale = (id: string, qty: number, over: Row = {}) => ({
  externalCheckId: id,
  openedAt: "2026-11-01T18:00:00Z",
  closedAt: "2026-11-01T19:00:00Z",
  items: [
    { name: "Ribeye", externalItemId: "food-1", qty: 1, price: 40 },
    { name: "House Merlot", externalItemId: "merlot-1", qty, price: 60 },
  ],
  ...over,
});

const open = (tables: Record<string, Row[]>, house = HOUSE) =>
  tables.pos_unresolved_lines.filter(
    (r) => r.restaurant_id === house && !r.resolved,
  );

const mapMerlot = (service: PosHubService, over: Row = {}) =>
  service.upsertItemMapping(HOUSE, {
    source: "*",
    external_item_id: "merlot-1",
    item_name: "House Merlot",
    is_wine: true,
    inventory_id: "inv-merlot",
    sale_unit: "bottle",
    ...over,
  });

describe("PosHubService — a mapping replays the sales queued before it (POS-2)", () => {
  it("takes three days of an unmapped wine off stock when it is mapped, and says how many", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);

    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 1),
      sale("chk-2", 2, { closedAt: "2026-11-02T19:00:00Z" }),
      sale("chk-3", 1, { closedAt: "2026-11-03T19:00:00Z" }),
    ]);
    expect(bottles()).toBe(12); // unmapped: nothing moved
    expect(open(tables)).toHaveLength(3);

    const saved: any = await mapMerlot(service);

    expect(bottles()).toBe(8); // 1 + 2 + 1
    expect(open(tables)).toHaveLength(0);
    expect(saved.past_sales).toMatchObject({
      status: "done",
      applied: 3,
      already_applied: 0,
      still_waiting: 0,
      failed: 0,
    });
    expect(saved.past_sales.message).toBe(
      "3 past sales of this item came off stock.",
    );
    // Dated by the check's own close, as a live sale is (ADR 0281).
    const logged = tables.wine_consumption_log.map((r) => r.recorded_at);
    expect(logged.sort()).toEqual([
      "2026-11-01T19:00:00.000Z",
      "2026-11-02T19:00:00.000Z",
      "2026-11-03T19:00:00.000Z",
    ]);
    // The cleared rows say what they were resolved to.
    expect(
      tables.pos_unresolved_lines.every(
        (r) => r.resolved && r.resolved_inventory_id === "inv-merlot",
      ),
    ).toBe(true);
  });

  it("a line replayed twice depletes once", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);

    await mapMerlot(service);
    expect(bottles()).toBe(10);

    // The clearing write was lost, or a second save raced the first.
    for (const r of tables.pos_unresolved_lines) r.resolved = false;
    const again: any = await mapMerlot(service);

    expect(bottles()).toBe(10);
    expect(again.past_sales).toMatchObject({ applied: 0, already_applied: 1 });
    expect(tables.wine_consumption_log).toHaveLength(1);
  });

  it("uses the live key, so the till re-sending the check after the replay moves nothing", async () => {
    const { db, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);
    await mapMerlot(service);
    expect(bottles()).toBe(10);

    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);
    expect(bottles()).toBe(10);
  });

  it("replays from the stored check, so two lines of the wine on one check both come off", async () => {
    const { db, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 1, {
        items: [
          {
            name: "House Merlot",
            externalItemId: "merlot-1",
            qty: 1,
            price: 60,
          },
          { name: "Ribeye", externalItemId: "food-1", qty: 1, price: 40 },
          {
            name: "House Merlot",
            externalItemId: "merlot-1",
            qty: 2,
            price: 60,
          },
        ],
      }),
    ]);
    const saved: any = await mapMerlot(service);
    // One queue row for the pair (its dedupe index); the check has both.
    expect(bottles()).toBe(9);
    expect(saved.past_sales.applied).toBe(2);
  });

  it("touches only this house's queue and this house's stock", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 1)]);
    await service.ingest(OTHER_HOUSE, "generic_webhook", [sale("chk-1", 3)]);

    await mapMerlot(service);

    expect(bottles()).toBe(11);
    expect(bottles("inv-merlot-b")).toBe(12);
    expect(open(tables, OTHER_HOUSE)).toHaveLength(1);
  });

  it("clears a voided check's line without taking stock for it", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);
    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 2, { voided: true }),
    ]);

    const saved: any = await mapMerlot(service);

    expect(bottles()).toBe(12);
    expect(open(tables)).toHaveLength(0);
    expect(saved.past_sales).toMatchObject({
      applied: 0,
      cleared_without_stock: 1,
    });
  });

  it("a mapping with no pour size leaves the sale waiting under the narrower question, then applies it once answered", async () => {
    const { db, tables, stockMl } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 3)]);
    expect(open(tables).map((r) => r.reason)).toEqual(["unmapped"]);

    const first: any = await mapMerlot(service, { sale_unit: null });
    expect(stockMl["inv-merlot"]).toBe(12 * BOTTLE_ML);
    expect(open(tables).map((r) => r.reason)).toEqual(["no_sale_volume"]);
    expect(first.past_sales).toMatchObject({ applied: 0, still_waiting: 1 });

    const second: any = await mapMerlot(service, { sale_unit: "glass" });
    expect(stockMl["inv-merlot"]).toBe(12 * BOTTLE_ML - 3 * 150);
    expect(open(tables)).toHaveLength(0);
    expect(second.past_sales.applied).toBe(1);
  });

  it("a check holding the glass and the bottle SKU under one name books only the bottle's line, and says so", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    // The glass SKU was mapped earlier, still without a pour size.
    await mapMerlot(service, { external_item_id: "merlot-g", sale_unit: null });
    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 1, {
        items: [
          {
            name: "House Merlot",
            externalItemId: "merlot-g",
            qty: 1,
            price: 12,
          },
          {
            name: "House Merlot",
            externalItemId: "merlot-1",
            qty: 2,
            price: 60,
          },
        ],
      }),
    ]);
    expect(bottles()).toBe(12);

    const saved: any = await mapMerlot(service);

    expect(bottles()).toBe(10);
    expect(saved.past_sales).toMatchObject({
      applied: 1,
      still_waiting: 0,
      failed: 0,
    });
    expect(saved.past_sales.message).toBe(
      "1 past sale of this item came off stock.",
    );
    // The glass waits on its own mapping's question; the bottle is settled.
    expect(open(tables).map((r) => r.external_item_id)).toEqual(["merlot-g"]);
  });

  it("clears the bottle SKU's row when the glass SKU, mapped with no shelf, shares its name", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await mapMerlot(service, {
      external_item_id: "merlot-g",
      inventory_id: null,
      sale_unit: null,
    });
    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 1, {
        items: [
          {
            name: "House Merlot",
            externalItemId: "merlot-g",
            qty: 1,
            price: 12,
          },
          {
            name: "House Merlot",
            externalItemId: "merlot-1",
            qty: 2,
            price: 60,
          },
        ],
      }),
    ]);

    const saved: any = await mapMerlot(service);
    expect(bottles()).toBe(10);
    expect(saved.past_sales).toMatchObject({ applied: 1, still_waiting: 0 });
    expect(open(tables).map((r) => r.external_item_id)).toEqual(["merlot-g"]);

    // Saving again finds nothing of this item left to take.
    const again: any = await mapMerlot(service);
    expect(bottles()).toBe(10);
    expect(again.past_sales.message).toBe(
      "No past sales of this item were waiting.",
    );
  });

  it("counts a line that moved as applied when its neighbour's stock write fails, and keeps the row for the retry", async () => {
    const { db, tables, bottles } = makeDb({
      failKey: (k) => k.endsWith(":merlot-1:2"),
    });
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 1, {
        items: [
          {
            name: "House Merlot",
            externalItemId: "merlot-1",
            qty: 1,
            price: 60,
          },
          { name: "Ribeye", externalItemId: "food-1", qty: 1, price: 40 },
          {
            name: "House Merlot",
            externalItemId: "merlot-1",
            qty: 2,
            price: 60,
          },
        ],
      }),
    ]);

    const saved: any = await mapMerlot(service);

    expect(bottles()).toBe(11);
    expect(saved.past_sales).toMatchObject({ applied: 1, failed: 1 });
    expect(open(tables)).toHaveLength(1);
  });

  it("a name with a `*` in it replays only its own item's sales", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);

    const saved: any = await service.upsertItemMapping(HOUSE, {
      source: "*",
      item_name: "House *",
      is_wine: true,
      inventory_id: "inv-merlot",
      sale_unit: "bottle",
    });

    expect(bottles()).toBe(12);
    expect(saved.past_sales.message).toBe(
      "No past sales of this item were waiting.",
    );
    expect(open(tables)).toHaveLength(1);
  });

  it("a queue it cannot read says so, and the mapping is still saved", async () => {
    const { db, tables } = makeDb({ failQueueRead: true });
    const service = new PosHubService(db);

    const saved: any = await mapMerlot(service);

    expect(tables.pos_item_mappings).toHaveLength(1);
    expect(saved.past_sales).toMatchObject({
      status: "unavailable",
      applied: null,
    });
    expect(saved.past_sales.message).toMatch(/could not be read/);
  });

  it("says plainly when nothing was waiting", async () => {
    const { db } = makeDb();
    const service = new PosHubService(db);
    const saved: any = await mapMerlot(service);
    expect(saved.past_sales).toMatchObject({ status: "done", applied: 0 });
    expect(saved.past_sales.message).toBe(
      "No past sales of this item were waiting.",
    );
  });

  it("approving a catalog proposal replays too, and its reply says so", async () => {
    const { db, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);

    const matcher = new CatalogMatcherService(db, service);
    const one: any = await matcher.approveProposal(HOUSE, "prop-1", {
      sale_unit: "bottle",
    });

    expect(bottles()).toBe(10);
    expect(one.past_sales).toMatchObject({ status: "done", applied: 1 });
  });

  it("answering a sale unit in the review replays the waiting sales and says how many", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("chk-1", 2)]);
    await mapMerlot(service, { sale_unit: null });
    expect(bottles()).toBe(12);
    const mappingId = tables.pos_item_mappings[0].id;

    const review = new PosMappingReviewService(db, service);
    const answered = await review.setSaleUnit(HOUSE, mappingId, "bottle");

    expect(bottles()).toBe(10);
    expect(answered.past_sales).toMatchObject({ applied: 1 });
    expect(open(tables)).toHaveLength(0);
  });
});

/** What the Toast door leaves behind for an unmapped line (toast.service.ts). */
function toastSale(
  tables: Record<string, Row[]>,
  order: string,
  qty: number,
  over: { voided?: boolean; closedAt?: string | null } = {},
) {
  const closedAt =
    over.closedAt === undefined ? "2026-11-02T20:00:00Z" : over.closedAt;
  tables.events.push({
    restaurant_id: HOUSE,
    event_type: "pos_order_closed",
    payload: { toast_order_guid: order, toast_closed_at: closedAt },
  });
  if (over.voided)
    tables.events.push({
      restaurant_id: HOUSE,
      event_type: "pos_order_voided",
      payload: { toast_order_guid: order, toast_closed_at: closedAt },
    });
  tables.pos_unresolved_lines.push({
    id: `toast-${order}`,
    restaurant_id: HOUSE,
    source: "toast",
    external_check_id: order,
    external_item_id: "merlot-1",
    item_name: "House Merlot",
    qty,
    reason: "unmapped",
    resolved: false,
    created_at: "2026-11-02T20:00:01Z",
    raw: { guid: "merlot-1", name: "House Merlot", quantity: qty },
  });
}

describe("PosHubService — replay reaches every waiting sale (QA round 8c)", () => {
  it("replays a Toast-door sale under that door's own key, once", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    toastSale(tables, "order-1", 2);

    const saved: any = await mapMerlot(service, { source: "toast" });

    expect(bottles()).toBe(10);
    expect(saved.past_sales).toMatchObject({ applied: 1, still_waiting: 0 });
    expect(open(tables)).toHaveLength(0);
    // The door's own key, dated by the order's close.
    expect(tables.inventory_transactions).toEqual([
      expect.objectContaining({
        idempotency_key: "toast_sale_order-1_merlot-1",
        transaction_date: "2026-11-02T20:00:00.000Z",
      }),
    ]);

    // The clearing write was lost: the second save takes nothing twice.
    for (const r of tables.pos_unresolved_lines) r.resolved = false;
    const again: any = await mapMerlot(service, { source: "toast" });
    expect(bottles()).toBe(10);
    expect(again.past_sales).toMatchObject({ applied: 0, already_applied: 1 });
  });

  it("pours a Toast-door glass sale at the item's pour size", async () => {
    const { db, tables, stockMl } = makeDb();
    const service = new PosHubService(db);
    toastSale(tables, "order-1", 3);

    const saved: any = await mapMerlot(service, {
      source: "toast",
      sale_unit: "glass",
    });

    expect(stockMl["inv-merlot"]).toBe(12 * BOTTLE_ML - 3 * 150);
    expect(saved.past_sales.applied).toBe(1);
  });

  it("clears a voided Toast order without stock, and keeps an order with no close time waiting", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    toastSale(tables, "order-void", 2, { voided: true });
    toastSale(tables, "order-open", 1, { closedAt: null });

    const saved: any = await mapMerlot(service, { source: "toast" });

    expect(bottles()).toBe(12);
    expect(saved.past_sales).toMatchObject({
      applied: 0,
      cleared_without_stock: 1,
      still_waiting: 1,
    });
    expect(open(tables).map((r) => r.external_check_id)).toEqual([
      "order-open",
    ]);
  });

  it("500 older rows that cannot replay do not hide the newer ones", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    // Queued by the hub, but their checks are no longer stored.
    for (let i = 0; i < 500; i++)
      tables.pos_unresolved_lines.push({
        id: `gone-${String(i).padStart(3, "0")}`,
        restaurant_id: HOUSE,
        source: "generic_webhook",
        external_check_id: `gone-${i}`,
        external_item_id: "merlot-1",
        item_name: "House Merlot",
        qty: 1,
        reason: "unmapped",
        resolved: false,
        created_at: "2026-10-01T12:00:00Z",
        raw: { is_wine: true },
      });
    await service.ingest(HOUSE, "generic_webhook", [
      sale("chk-1", 1),
      sale("chk-2", 1),
    ]);

    const saved: any = await mapMerlot(service);

    expect(bottles()).toBe(10);
    expect(saved.past_sales).toMatchObject({
      applied: 2,
      still_waiting: 500,
      truncated: false,
    });
    expect(saved.past_sales.message).not.toMatch(/save the mapping again/);
  });

  it("books 500 lines per save and says more are waiting until the queue is drained", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    await service.ingest(
      HOUSE,
      "generic_webhook",
      Array.from({ length: 501 }, (_, i) => sale(`c-${i}`, 1)),
    );

    const first: any = await mapMerlot(service);
    expect(first.past_sales).toMatchObject({ applied: 500, truncated: true });
    expect(first.past_sales.message).toMatch(/save the mapping again/);

    const second: any = await mapMerlot(service);
    expect(second.past_sales).toMatchObject({ applied: 1, truncated: false });
    expect(bottles()).toBe(12 - 501);
    expect(open(tables)).toHaveLength(0);
  });

  it("reads the stored checks of 450 waiting sales in lists short enough for a URL", async () => {
    const { db, tables, bottles, widestIn } = makeDb();
    const service = new PosHubService(db);
    // Toast and Clover check ids are uuids: 36 characters each.
    const id = (i: number) =>
      `0d4c6c1e-8f0b-4c55-9a43-${String(i).padStart(12, "0")}`;
    await service.ingest(
      HOUSE,
      "generic_webhook",
      Array.from({ length: 450 }, (_, i) => sale(id(i), 1)),
    );

    const saved: any = await mapMerlot(service);

    expect(saved.past_sales).toMatchObject({ applied: 450, failed: 0 });
    expect(bottles()).toBe(12 - 450);
    expect(open(tables)).toHaveLength(0);
    expect(widestIn.pos_checks).toBeLessThanOrEqual(100);
  });
});
