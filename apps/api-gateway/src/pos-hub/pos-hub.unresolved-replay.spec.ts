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

function makeDb(opts: { failQueueRead?: boolean } = {}) {
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

  class Query {
    private filters: Array<(r: Row) => boolean> = [];
    private op: Op = "select";
    private payload: any = null;
    private conflict: string[] = [];
    private max = Infinity;
    private one = false;
    constructor(private readonly table: string) {}
    select = () => this;
    order = () => this;
    single = () => ((this.one = true), this);
    maybeSingle = this.single;
    limit = (n: number) => ((this.max = n), this);
    eq = (col: string, val: any) => this.where((r) => r[col] === val);
    in = (col: string, vals: any[]) => this.where((r) => vals.includes(r[col]));
    ilike = (col: string, pattern: string) => {
      const exact = pattern.replace(/\\(.)/g, "$1").toLowerCase();
      return this.where((r) => String(r[col] ?? "").toLowerCase() === exact);
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
      if (this.op === "insert") {
        const row = { ...this.payload };
        if (this.table === "pos_unresolved_lines") {
          row.id = row.id ?? `q-${nextId++}`;
          row.resolved = false;
          row.reason = row.reason ?? "unmapped";
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
      // The real early return: a key already seen moves nothing.
      if (seenKeys.has(key)) return { data: "tx-existing", error: null };
      seenKeys.add(key);
      if (name === "apply_stock_movement") {
        stockMl[args.p_inventory_id] += Number(args.p_delta) * BOTTLE_ML;
      } else if (name === "record_glass_pour") {
        stockMl[args.p_inventory_id] -=
          Number(args.p_pours) * Number(args.p_pour_ml);
      }
      return { data: `tx-${seenKeys.size}`, error: null };
    },
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    tables,
    stockMl,
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
