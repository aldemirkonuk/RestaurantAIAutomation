import { PosHubService } from "./pos-hub.service";
import { CatalogMatcherService } from "./catalog-matcher.service";
import { PosMappingReviewService } from "./pos-mapping-review.service";
import { DatabaseService } from "../database/database.service";
import { ToastService } from "../toast/toast.service";
import * as fs from "fs";
import * as path from "path";

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
    private skip = 0;
    private one = false;
    private sorts: Array<[string, boolean, boolean]> = []; // col, asc, nulls first
    private tooLong = false;
    constructor(private readonly table: string) {}
    select = () => this;
    // As PostgREST: nulls last ascending, unless nullsFirst says.
    order = (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => (
      this.sorts.push([col, o.ascending !== false, o.nullsFirst ?? o.ascending === false]),
      this
    );
    range = (from: number, to: number) => ((this.skip = from), (this.max = to - from + 1), this);
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
          for (const [col, asc, nullsFirst] of this.sorts) {
            const [x, y] = [at(a, col), at(b, col)].map((v) => (v == null ? null : String(v)));
            if ((x === null) !== (y === null)) return (x === null) === nullsFirst ? -1 : 1;
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        })
        .slice(this.skip, this.skip + this.max)
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

/** `n` hub rows whose checks are no longer stored: each costs a read only. */
function rowsWithNoCheck(tables: Record<string, Row[]>, n: number) {
  for (let i = 0; i < n; i++)
    tables.pos_unresolved_lines.push({
      id: `gone-${String(i).padStart(5, "0")}`,
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
}

describe("PosHubService — a line that cannot book uses no allowance (QA round 11b)", () => {
  it("1000 sales whose stock write keeps failing do not hide a newer one", async () => {
    // The hub's line key holds the check id: `:s-` is every old check.
    const { db, tables, bottles } = makeDb({ failKey: (k) => k.includes(":s-") });
    const service = new PosHubService(db);
    await service.ingest(
      HOUSE,
      "generic_webhook",
      Array.from({ length: 1000 }, (_, i) => sale(`s-${i}`, 1)),
    );
    await service.ingest(HOUSE, "generic_webhook", [sale("fresh-1", 1)]);

    const saved: any = await mapMerlot(service);

    expect(bottles()).toBe(11);
    expect(saved.past_sales).toMatchObject({
      applied: 1,
      failed: 1000,
      truncated: false,
    });
    expect(open(tables).some((r) => r.external_check_id === "fresh-1")).toBe(
      false,
    );
  });

  it("sales waiting on a pour size never say more are waiting behind them", async () => {
    const { db, tables, stockMl } = makeDb();
    tables.restaurant_inventory[0].pour_size_ml = null;
    const service = new PosHubService(db);
    await service.ingest(
      HOUSE,
      "generic_webhook",
      Array.from({ length: 1000 }, (_, i) => sale(`g-${i}`, 1)),
    );
    await service.ingest(HOUSE, "generic_webhook", [sale("fresh-1", 1)]);

    for (let save = 0; save < 2; save++) {
      const saved: any = await mapMerlot(service, { sale_unit: "glass" });
      expect(saved.past_sales).toMatchObject({
        applied: 0,
        still_waiting: 1001,
        truncated: false,
      });
      expect(saved.past_sales.message).not.toMatch(/save the mapping again/);
    }
    expect(stockMl["inv-merlot"]).toBe(12 * BOTTLE_ML);
    expect(open(tables)).toHaveLength(1001);
  });

  it("600 Toast-door sales whose stock write keeps failing do not hide a newer one", async () => {
    const { db, tables, bottles } = makeDb({
      failKey: (k) => k.startsWith("toast_sale_F-"),
    });
    const service = new PosHubService(db);
    for (let i = 0; i < 600; i++)
      toastSale(tables, `F-${String(i).padStart(3, "0")}`, 1);
    toastSale(tables, "G-fresh", 1);

    const saved: any = await mapMerlot(service, { source: "toast" });

    expect(bottles()).toBe(11);
    expect(saved.past_sales).toMatchObject({
      applied: 1,
      failed: 600,
      truncated: false,
    });
  });
});

// QA round 15 on PR #866: rows that never settle came back first on every
// save and filled its tries or its read, so a sale behind them never booked.
describe("PosHubService — a line that keeps failing goes to the back (QA round 15)", () => {
  const fresh = (t: Record<string, Row[]>) =>
    open(t).filter((r) => String(r.external_check_id).startsWith("fresh-"));
  // Once mapped, a sale books live: a row queued later is copied from fresh-1.
  const queueLate = (t: Record<string, Row[]>, id: string) => {
    const was = (x: Row) => x.external_check_id === "fresh-1";
    t.pos_checks.push({ ...t.pos_checks.find(was)!, external_check_id: id });
    t.pos_unresolved_lines.push({
      ...t.pos_unresolved_lines.find(was)!,
      id: `late-${id}`,
      external_check_id: id,
      resolved: false,
      replay_tried_at: null,
      created_at: "2026-12-01T00:00:00.000Z",
    });
  };
  const applied = async (s: PosHubService) =>
    ((await mapMerlot(s)) as any).past_sales;

  it("2,100 failing sales hold a newer one for one save, then never again; they book once accepted", async () => {
    let refusing = true;
    const { db, tables, bottles } = makeDb({
      failKey: (k) => refusing && k.includes(":s-"),
    });
    const service = new PosHubService(db);
    await service.ingest(
      HOUSE,
      "generic_webhook",
      Array.from({ length: 2100 }, (_, i) => sale(`s-${i}`, 1)),
    );
    await service.ingest(HOUSE, "generic_webhook", [sale("fresh-1", 1)]);

    // A save tries at most 2,000 lines and says more are waiting.
    const first = await applied(service);
    expect(first).toMatchObject({ applied: 0, failed: 2000, truncated: true });
    expect(first.message).toMatch(/save the mapping again/);
    expect(bottles()).toBe(12);
    expect(await applied(service)).toMatchObject({ applied: 1, truncated: true });
    expect(fresh(tables)).toHaveLength(0);
    queueLate(tables, "fresh-2");
    expect(await applied(service)).toMatchObject({ applied: 1, failed: 1999 });
    expect(bottles()).toBe(10);

    refusing = false;
    const booked: number[] = [];
    for (let save = 0; save < 6; save++) booked.push((await applied(service)).applied);
    expect(booked).toEqual([500, 500, 500, 500, 100, 0]);
    expect(bottles()).toBe(10 - 2100);
    expect(open(tables)).toHaveLength(0);
  });

  it("5,200 rows with no stored check hold a newer sale for one save, then never again", async () => {
    const { db, tables, bottles } = makeDb();
    const service = new PosHubService(db);
    rowsWithNoCheck(tables, 5200);
    await service.ingest(HOUSE, "generic_webhook", [sale("fresh-1", 1)]);

    // A save reads at most 5,000 rows and says more are waiting.
    expect(await applied(service)).toMatchObject({ still_waiting: 5000, truncated: true });
    expect((await applied(service)).applied).toBe(1);
    queueLate(tables, "fresh-2");
    expect((await applied(service)).applied).toBe(1);
    expect(bottles()).toBe(10);
    expect(open(tables)).toHaveLength(5200);
  });

  it("a line sent to the back stays open and listed; only this house's open rows are stamped", async () => {
    const { db, tables } = makeDb({ failKey: (k) => k.includes(":s-") });
    const service = new PosHubService(db);
    await service.ingest(HOUSE, "generic_webhook", [sale("s-1", 2), sale("s-2", 1), sale("ok-1", 1)]);
    await service.ingest(OTHER_HOUSE, "generic_webhook", [sale("s-9", 1)]);

    const past = await applied(service);

    expect(past).toMatchObject({ applied: 1, failed: 2, truncated: false });
    expect(past.message).toMatch(/2 past sales could not be taken off stock and stayed in the unmatched list; save the mapping again/);
    const row = (h: string, c: string) =>
      tables.pos_unresolved_lines.find((r) => r.restaurant_id === h && r.external_check_id === c)!;
    for (const c of ["s-1", "s-2"])
      expect(row(HOUSE, c)).toMatchObject({ resolved: false, replay_tried_at: expect.any(String) });
    expect(row(HOUSE, "ok-1")).toMatchObject({ resolved: true });
    expect(row(HOUSE, "ok-1").replay_tried_at ?? null).toBeNull();
    expect(row(OTHER_HOUSE, "s-9").replay_tried_at ?? null).toBeNull();
    const listed = await new PosMappingReviewService(db, service).listUnresolvedLines(HOUSE);
    expect(listed.summary).toMatchObject({ open_lines: 2, qty_total: 3 });
    expect(listed.items).toEqual([expect.objectContaining({ external_item_id: "merlot-1", occurrences: 2 })]);
  });
});

/**
 * QA round 11b, D3. A Toast order still waiting behind the allowance when the
 * till voids it: on this stack the door books the void as `+qty`
 * (`toast.service.ts`, `applyOrderSaleEffects`) although its sale was never
 * booked, so stock rises by a bottle nobody sold. PR #805 makes every void
 * call `return_glass_pour(p_sale_key => toast_sale_...)`, which gives back
 * only what that sale booked and refuses (P0002) when it booked nothing.
 * Skipped until #805 is on this branch; it runs, and must pass, once the Toast
 * door's void calls `return_glass_pour`.
 */
const voidGivesBackOnlyWhatWasBooked = fs
  .readFileSync(path.join(__dirname, "../toast/toast.service.ts"), "utf8")
  .includes("return_glass_pour");

describe("PosHubService — a void after the mapping gives back only what was booked (QA round 11b)", () => {
  (voidGivesBackOnlyWhatWasBooked ? it : it.skip)(
    "a void of an order still waiting behind the allowance adds no stock (needs PR #805)",
    async () => {
      const { db, tables, bottles } = makeDb();
      const client: any = (db as any).getClient();
      // return_glass_pour as #805 defines it: back only what the sale key
      // booked, once; P0002 when the sale booked nothing.
      const booked = new Map<string, number>();
      const rpc = client.rpc;
      client.rpc = async (name: string, args: Row) => {
        if (name === "return_glass_pour") {
          const took = booked.get(String(args.p_sale_key));
          if (!took)
            return { data: null, error: { code: "P0002", message: "no sale" } };
          booked.delete(String(args.p_sale_key));
          return rpc("apply_stock_movement", {
            ...args,
            p_delta: Math.min(took, Number(args.p_pours)),
            p_stock_state: "live",
          });
        }
        const res = await rpc(name, args);
        if (!res.error && Number(args.p_delta) < 0)
          booked.set(String(args.p_idempotency_key), -Number(args.p_delta));
        return res;
      };
      const hub = new PosHubService(db);
      const toast = new ToastService(
        { get: (_k: string, d: any) => d } as any,
        {} as any,
        { supabase: client, getClient: () => client } as any,
      );
      const order = (o: string, type: string) => ({
        eventType: type,
        eventId: `e-${type}-${o}`,
        order: {
          guid: o,
          items: [{ guid: "merlot-1", name: "House Merlot", quantity: 1, unitPrice: 60 }],
        },
      });
      for (let i = 0; i < 501; i++) {
        const o = `W-${String(i).padStart(3, "0")}`;
        await (toast as any).applyOrderSaleEffects(HOUSE, order(o, "order.closed"));
        tables.events.push({
          restaurant_id: HOUSE,
          event_type: "pos_order_closed",
          payload: { toast_order_guid: o, toast_closed_at: "2026-11-02T20:00:00Z" },
        });
      }
      const first: any = await mapMerlot(hub, { source: "toast" });
      expect(first.past_sales).toMatchObject({ applied: 500, truncated: true });
      const waiting = open(tables).map((r) => r.external_check_id);
      expect(waiting).toHaveLength(1);

      // The till voids the waiting order after the mapping exists.
      await (toast as any).applyOrderSaleEffects(
        HOUSE,
        order(waiting[0], "order.voided"),
      );
      tables.events.push({
        restaurant_id: HOUSE,
        event_type: "pos_order_voided",
        payload: { toast_order_guid: waiting[0], toast_closed_at: "2026-11-02T20:00:00Z" },
      });
      await mapMerlot(hub, { source: "toast" });

      expect(bottles()).toBe(12 - 500);
      expect(open(tables)).toHaveLength(0);
    },
  );
});

