import { stateBookFrom } from "./insights/item-state";
import * as fs from "fs";
import * as path from "path";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";
import { alterTableColumnClauses } from "../common/testing/migration-alter-clauses";

/**
 * Regression guard — analytics must not select columns that do not exist.
 *
 * `advanced-analytics.service.ts` selected `provider_name` and `wine_name`
 * from `procurement_orders`, and `insights/insight-generator.service.ts`
 * selected `provider_name` from the same table. Neither column exists (see
 * supabase/migrations/20260805000000_baseline_from_production.sql:4514-4568).
 * PostgREST rejects the WHOLE query with 42703 on a single unknown column, and
 * both call sites discarded `error` and fell back to `[]` — so
 * `getVendorScorecard` and `getCashflow` returned empty for every restaurant
 * forever, and the entire purchasing insight family stayed silent. An empty
 * result is indistinguishable from "nothing to report", which is why this ran
 * unnoticed in production.
 *
 * The stub below is therefore SCHEMA-AWARE: it reads the real column lists out
 * of supabase/migrations (the source of truth for DB shape) and reproduces
 * PostgREST's all-or-nothing 42703 behaviour. A test using a permissive stub
 * would pass against the broken code and prove nothing.
 */

// ===========================================================================
// Schema, parsed from the migrations rather than transcribed
// ===========================================================================

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  "../../../../supabase/migrations",
);

/** table -> column names, after CREATE TABLE + every later ADD/DROP COLUMN. */
function loadSchema(): Map<string, Set<string>> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    // Fail loudly: a guard that cannot check must not report success.
    throw new Error(
      `cannot verify analytics selects — migrations not found at ${MIGRATIONS_DIR}`,
    );
  }
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const schema = new Map<string, Set<string>>();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    // CREATE TABLE [IF NOT EXISTS] [public.]name ( ...body... );
    const createRe =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      const [, table, body] = m;
      const cols = schema.get(table) ?? new Set<string>();
      // Split on top-level commas only — numeric(10,2) must not split.
      let depth = 0;
      let buf = "";
      const parts: string[] = [];
      for (const ch of body) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          parts.push(buf);
          buf = "";
        } else buf += ch;
      }
      parts.push(buf);
      for (const raw of parts) {
        const line = raw.trim();
        if (
          !line ||
          /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(line)
        )
          continue;
        const col = line.match(/^"?(\w+)"?\s/);
        if (col) cols.add(col[1]);
      }
      schema.set(table, cols);
    }

    // Every ADD/DROP COLUMN clause of every ALTER TABLE, in file order, with
    // comments blanked first. The shared reader explains the two ways the
    // inline regexes that used to live here went blind: a multi-column
    // statement showed only its first clause, and a `;` inside a comment cut
    // the statement short (procurement_orders' seven recurrence_* columns).
    for (const clause of alterTableColumnClauses(sql)) {
      if (clause.op === "ADD") {
        const cols = schema.get(clause.table) ?? new Set<string>();
        cols.add(clause.column);
        schema.set(clause.table, cols);
      } else {
        schema.get(clause.table)?.delete(clause.column);
      }
    }
  }
  return schema;
}

const SCHEMA = loadSchema();

/** Split a PostgREST select list on top-level commas. */
function splitSelect(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Reproduce PostgREST column resolution: every bare token must be a real
 * column, every `relation(cols)` token must name a real table whose inner
 * tokens are real columns. Returns the first offending `table.column`, or null.
 */
function firstUnknownColumn(table: string, select: string): string | null {
  const cols = SCHEMA.get(table);
  if (!cols) throw new Error(`test schema has no table "${table}"`);
  for (const token of splitSelect(select)) {
    if (token === "*") continue;
    const embed = token.match(/^(?:(\w+):)?(\w+)\s*\(([\s\S]*)\)$/);
    if (embed) {
      const inner = firstUnknownColumn(embed[2], embed[3]);
      if (inner) return inner;
      continue;
    }
    const name = token.split(/[:\s]/)[0];
    if (!cols.has(name)) return `${table}.${name}`;
  }
  return null;
}

// ===========================================================================
// Schema-aware Supabase stub
// ===========================================================================

type Rows = Record<string, any[]>;

function makeClient(rowsByTable: Rows) {
  const schemaErrors: string[] = [];
  const passthrough = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "in",
  ];
  const client: any = {
    schemaErrors,
    from: jest.fn((table: string) => {
      let failure: string | null = null;
      const builder: any = {};
      for (const method of passthrough) {
        builder[method] = jest.fn((...args: any[]) => {
          if (method === "select" && typeof args[0] === "string") {
            const bad = firstUnknownColumn(table, args[0]);
            if (bad) {
              failure = bad;
              schemaErrors.push(bad);
            }
          }
          return builder;
        });
      }
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve(
          failure
            ? {
                data: null,
                // The shape PostgREST actually returns for an unknown column.
                error: {
                  code: "42703",
                  message: `column ${failure} does not exist`,
                },
              }
            : { data: rowsByTable[table] ?? [], error: null },
        ).then(resolve, reject);
      return builder;
    }),
  };
  return client;
}

/**
 * The generator now also reads the day-exclusion store and the manager's
 * dismissals. Neither belongs to this file's subject (schema drift in the
 * bundle queries), so both are stubbed at their honest "readable, empty"
 * values — a stub that reported `readable: false` would make every assertion
 * below pass for the wrong reason.
 */
function makeGenerator(client: any) {
  return new InsightGeneratorService(
    { getClient: () => client } as any,
    { load: async () => ({ dates: new Set<string>(), readable: true, problem: null }) } as any,
    { readState: async () => ({ book: stateBookFrom([]), readable: true, problem: null }) } as any,
  );
}

const RESTAURANT = "11111111-1111-1111-1111-111111111111";
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

/** Delivered orders shaped like real procurement_orders rows. */
const ORDER_ROWS = [
  {
    id: "o1",
    provider_id: "p1",
    providers: { name: "Rioja Imports" },
    total_cost: 1200,
    final_price: 1200,
    bottles_total: 24,
    quantity: 24,
    created_at: day(20),
    delivered_at: day(18),
    expected_delivery_date: day(19).substring(0, 10),
    status: ProcurementOrderStatus.DELIVERED,
  },
  {
    id: "o2",
    provider_id: "p2",
    providers: { name: "Loire Direct" },
    total_cost: 800,
    final_price: 800,
    bottles_total: 12,
    quantity: 12,
    created_at: day(10),
    delivered_at: day(8),
    expected_delivery_date: day(9).substring(0, 10),
    status: ProcurementOrderStatus.DELIVERED,
  },
];

describe("analytics selects only columns that exist (42703 regression)", () => {
  it("parses the real procurement_orders shape out of the migrations", () => {
    const cols = SCHEMA.get("procurement_orders")!;
    // Sanity-check the parser against the source of truth, so a broken parser
    // cannot make the assertions below vacuously pass.
    expect(cols.has("provider_id")).toBe(true);
    expect(cols.has("inventory_id")).toBe(true);
    expect(cols.has("total_cost")).toBe(true);
    // The two columns the analytics loaders invented.
    expect(cols.has("provider_name")).toBe(false);
    expect(cols.has("wine_name")).toBe(false);
    expect(SCHEMA.get("providers")!.has("name")).toBe(true);
  });

  it("[REVERT-FAILS] reads every ADD COLUMN clause of a multi-column ALTER TABLE, not just the first", () => {
    // supabase/migrations/20260805132000_counting_catalog_and_correlation_columns.sql:
    //   ALTER TABLE public.pos_item_mappings
    //       ADD COLUMN IF NOT EXISTS sale_unit character varying(10),
    //       ADD COLUMN IF NOT EXISTS total_sales_count integer DEFAULT 0,
    //       ADD COLUMN IF NOT EXISTS total_revenue numeric(12,2) DEFAULT 0,
    //       ADD COLUMN IF NOT EXISTS last_sale_at timestamp with time zone;
    // A regex matching "ALTER TABLE ... ADD COLUMN" as one literal run only
    // ever finds "sale_unit" (adjacent to "ALTER TABLE"); the three columns
    // after it have no "ALTER TABLE" of their own and were invisible to this
    // schema, so a real select naming them would 42703 here even though
    // PostgREST accepts it in production.
    const cols = SCHEMA.get("pos_item_mappings")!;
    expect(cols.has("sale_unit")).toBe(true);
    expect(cols.has("total_sales_count")).toBe(true);
    expect(cols.has("total_revenue")).toBe(true);
    expect(cols.has("last_sale_at")).toBe(true);
    // A genuinely nonexistent column must still be flagged — the fix must
    // not have made the parser permissive to close this gap.
    expect(cols.has("this_column_does_not_exist")).toBe(false);
  });

  it("[REVERT-FAILS] a `;` inside a comment does not end the ALTER TABLE statement", () => {
    // supabase/migrations/20260905235800_an_order_that_repeats_says_so_on_itself.sql:101-108
    //   ALTER TABLE public.procurement_orders
    //     -- ... Set once; never advanced.
    //     ADD COLUMN IF NOT EXISTS recurrence_anchored_on date,
    //     ...
    // Reading the statement body up to the first `;` stopped inside that
    // comment, so all seven recurrence_* columns of the table this guard
    // exists to protect were invisible and a real select naming one would
    // 42703 here.
    const cols = SCHEMA.get("procurement_orders")!;
    for (const col of [
      "recurrence_anchored_on",
      "recurrence_next_due_on",
      "recurrence_status",
      "recurrence_status_by",
      "recurrence_status_at",
      "recurrence_parent_order_id",
      "recurrence_occurrence_on",
    ]) {
      expect(cols.has(col)).toBe(true);
    }
    // Prose in a comment is not schema: "-- ALTER TABLE ADD COLUMN ..." in
    // 20260818030000_sensory_columns_generated.sql once minted a table "ADD".
    expect(SCHEMA.has("ADD")).toBe(false);
  });

  describe("AdvancedAnalyticsService", () => {
    const build = () => {
      const client = makeClient({ procurement_orders: ORDER_ROWS });
      const svc = new AdvancedAnalyticsService(
        { getClient: () => client } as any,
        {} as any,
        {} as any,
        {} as any,
      );
      return { client, svc };
    };

    it("getVendorScorecard returns vendors instead of an empty list", async () => {
      const { client, svc } = build();
      const out = await svc.getVendorScorecard(RESTAURANT);
      expect(client.schemaErrors).toEqual([]);
      expect(out.vendors).toHaveLength(2);
      expect(out.vendors.map((v: any) => v.vendorName).sort()).toEqual([
        "Loire Direct",
        "Rioja Imports",
      ]);
      expect(out.vendors[0].spend).toBeGreaterThan(0);
    });

    it("getCashflow reports real spend instead of zeroes", async () => {
      const { client, svc } = build();
      const out = await svc.getCashflow(RESTAURANT);
      expect(client.schemaErrors).toEqual([]);
      expect(out.spendLast30d).toBe(2000);
    });

    // ADR 0058 fixed the nine `=== "delivered"` sites and the four literals on
    // dashboard.service.ts. This one carried the SAME four literals — written
    // as `["pending", "awaiting_approval", "ordered", "in_transit"].includes(
    // o.status)` — and survived, because a membership test spelled as an array
    // is not a comparison and neither the sweep nor the guard read it.
    // `awaiting_approval` and `ordered` were never members under any casing.
    //
    // Rows below are UPPERCASE, as `ProcurementOrderStatus` writes them, so
    // reverting to the literals returns 0 and 0 rather than 900 and 2.
    it("counts committed open orders instead of reporting a structural zero", async () => {
      const client = makeClient({
        procurement_orders: [
          ...ORDER_ROWS,
          {
            id: "o3",
            provider_id: "p1",
            providers: { name: "Rioja Imports" },
            total_cost: 500,
            final_price: 500,
            bottles_total: 6,
            quantity: 6,
            created_at: day(3),
            delivered_at: null,
            expected_delivery_date: day(-4).substring(0, 10),
            status: ProcurementOrderStatus.IN_TRANSIT,
          },
          {
            id: "o4",
            provider_id: "p2",
            providers: { name: "Loire Direct" },
            total_cost: 400,
            final_price: 400,
            bottles_total: 12,
            quantity: 12,
            created_at: day(1),
            delivered_at: null,
            expected_delivery_date: day(-6).substring(0, 10),
            status: ProcurementOrderStatus.APPROVAL_NEEDED,
          },
        ],
      });
      const svc = new AdvancedAnalyticsService(
        { getClient: () => client } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const out = await svc.getCashflow(RESTAURANT);
      expect(client.schemaErrors).toEqual([]);
      expect(out.openOrderCount).toBe(2);
      expect(out.committedOpenOrders).toBe(900);
      // A delivered order is money already spent, never committed outflow —
      // the two figures must not double-count the same order.
      expect(out.spendLast30d).toBe(2000);
    });

    it("logs, rather than swallows, a query that really does fail", async () => {
      // A column that does not exist anywhere: the loader must still degrade to
      // an empty lens (one dead query must not 500 the page) but must say so.
      const client = makeClient({ procurement_orders: ORDER_ROWS });
      const realFrom = client.from;
      client.from = jest.fn((table: string) => {
        const b = realFrom(table);
        if (table === "procurement_orders") {
          const realSelect = b.select;
          b.select = (_s: string) => realSelect("id, no_such_column");
        }
        return b;
      });
      const svc = new AdvancedAnalyticsService(
        { getClient: () => client } as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const spy = jest
        .spyOn((svc as any).logger, "error")
        .mockImplementation(() => undefined);
      const out = await svc.getCashflow(RESTAURANT);
      expect(out.spendLast30d).toBe(0);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("procurement_orders"),
      );
      expect(spy.mock.calls[0][0]).toContain("42703");
      spy.mockRestore();
    });
  });

  describe("InsightGeneratorService", () => {
    it("loads the orders bundle, so the purchasing family can fire", async () => {
      const client = makeClient({
        procurement_orders: ORDER_ROWS.map((o) => ({
          provider_id: o.provider_id,
          providers: o.providers,
          total_cost: o.total_cost,
          final_price: o.final_price,
          bottles_total: o.bottles_total,
          quantity: o.quantity,
          delivered_at: o.delivered_at,
          created_at: o.created_at,
          status: o.status,
        })),
      });
      const svc = makeGenerator(client);
      const out = await svc.generate(RESTAURANT, { persist: false });
      expect(client.schemaErrors).toEqual([]);
      expect(out.availability).toContain("orders");
    });

    // The select at :224 is CORRECT — wine_consumption_log has no
    // master_wine_id column (analytics.service.ts:158 documents why), so it
    // resolves the wine through the inventory FK and PostgREST returns the
    // joined value NESTED under `restaurant_inventory`. The mapping then read
    // `c.master_wine_id` at the TOP level, which is always undefined — so
    // `if (!c.wineId) continue` at :394 and :578 skipped every row and both
    // per-wine sub-families silently produced nothing on real data.
    //
    // This is the sibling of the 42703 bugs above and fails the same way: not
    // an error, just permanent emptiness. A schema-aware stub cannot catch it,
    // because the QUERY is valid — only the read of its result is wrong. So
    // this asserts the mapped shape directly.
    it("maps wineId from the nested inventory join, not a top-level column", async () => {
      const client = makeClient({
        wine_consumption_log: [
          {
            inventory_id: "inv-1",
            quantity: 3,
            volume_ml: null,
            created_at: "2026-08-20T00:00:00.000Z",
            // Exactly the shape PostgREST returns for
            // `restaurant_inventory(master_wine_id)`.
            restaurant_inventory: { master_wine_id: "mw-42" },
          },
        ],
      });
      const svc = makeGenerator(client);

      const bundle = await (svc as any).loadBundle(RESTAURANT);

      expect(client.schemaErrors).toEqual([]);
      expect(bundle.consumption).toHaveLength(1);
      expect(bundle.consumption[0].wineId).toBe("mw-42");
    });
  });
});
