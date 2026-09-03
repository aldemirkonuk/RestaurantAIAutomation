import * as fs from "fs";
import * as path from "path";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { ProcurementOrderStatus } from "../procurement/dto/procurement.dto";

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

    // ALTER TABLE [ONLY] [public.]name ADD COLUMN [IF NOT EXISTS] col ...
    const addRe =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;
    while ((m = addRe.exec(sql))) {
      const cols = schema.get(m[1]) ?? new Set<string>();
      cols.add(m[2]);
      schema.set(m[1], cols);
    }

    // ALTER TABLE ... DROP COLUMN [IF EXISTS] col
    const dropRe =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi;
    while ((m = dropRe.exec(sql))) schema.get(m[1])?.delete(m[2]);
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
      const svc = new InsightGeneratorService({
        getClient: () => client,
      } as any);
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
      const svc = new InsightGeneratorService({
        getClient: () => client,
      } as any);

      const bundle = await (svc as any).loadBundle(RESTAURANT);

      expect(client.schemaErrors).toEqual([]);
      expect(bundle.consumption).toHaveLength(1);
      expect(bundle.consumption[0].wineId).toBe("mw-42");
    });
  });
});
