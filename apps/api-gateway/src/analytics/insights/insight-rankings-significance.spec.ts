import { stateBookFrom } from "./item-state";
import {
  InsightGeneratorService,
  InsightRecord,
} from "./insight-generator.service";

/**
 * "Lucas ranks #1 of 5 by average check ($188)."
 *
 * Read from production on 2026-10-03 (A-003), about a house whose servers were
 * dealt to checks uniformly at random: there was no best server to name. The
 * same walk found "Run Wild IPA and Malagousia land on the same check 6.3×
 * more than chance" (A-002) on baskets dealt round-robin, a rule that fired on
 * 200 of 200 shuffled copies of the data; and a stockout "#1" picked out of an
 * eight-way tie by inventory order, carrying a hard-coded z of 2.
 *
 * ADR 0272: a ranking or a pairing is printed only when the data can tell it
 * apart. These tests build Tuzlu's shape — the planted NULL — and pin that
 * nothing is ranked on it; then plant a real effect and pin that it is found.
 */

const WAITER = "waiter.avg_check.peer_rank";
const TABLE = "table.avg_check.peer_rank";
const BASKET = "wine.bottles.basket_affinity";
const STOCKOUT = "wine.stockout_risk.peer_rank";
const KEYS = [WAITER, TABLE, BASKET, STOCKOUT];

type Rows = Record<string, any[]>;

/**
 * The same thenable PostgREST stand-in baseline-honesty.spec.ts uses, except
 * that it honours a keyset page: `.order("id")`, `.gt("id", cursor)` and
 * `.limit(n)`. The bundle reads `pos_checks` and `wine_consumption_log`
 * through `readWholeWindow` (ADR 0292), which refuses a page longer than it
 * asked for; a Tuzlu quarter holds more than 1,000 checks, so a double that
 * ignored `.limit` handed back a page no server would.
 */
function makeClient(rowsByTable: Rows) {
  const passthrough = [
    "select",
    "eq",
    "neq",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "in",
  ];
  return {
    from: (table: string) => {
      const all = rowsByTable[table] ?? [];
      const page: { byId?: boolean; after?: string; limit?: number } = {};
      const builder: any = {};
      for (const m of passthrough) builder[m] = (..._args: any[]) => builder;
      builder.order = (col: string) => {
        if (col === "id") page.byId = true;
        return builder;
      };
      builder.gt = (col: string, val: unknown) => {
        if (col === "id") page.after = String(val);
        return builder;
      };
      builder.limit = (n: number) => {
        page.limit = n;
        return builder;
      };
      const rows = () => {
        let out = all;
        if (page.after !== undefined)
          out = out.filter((r) => String(r.id) > page.after!);
        if (page.byId)
          out = [...out].sort((a, b) =>
            String(a.id) < String(b.id)
              ? -1
              : String(a.id) > String(b.id)
                ? 1
                : 0,
          );
        return page.limit === undefined ? out : out.slice(0, page.limit);
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null });
      builder.single = () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      return builder;
    },
  };
}

function generatorFor(rows: Rows) {
  const client = makeClient({
    pos_checks: [],
    wine_consumption_log: [],
    procurement_orders: [],
    restaurant_inventory: [],
    restaurant_tables: [],
    restaurant_venue_profiles: [],
    analytics_goals: [],
    ...rows,
  });
  return new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({ dates: new Set(), readable: true, problem: null }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom([]),
        readable: true,
        problem: null,
      }),
    } as any,
  );
}

async function fire(rows: Rows): Promise<InsightRecord[]> {
  // Narrowed to the four types: uncapped, never persisted (ADR 0191).
  const out = await generatorFor(rows).generate("r1", { candidateKeys: KEYS });
  return out.insights;
}

const of = (xs: InsightRecord[], key: string) =>
  xs.filter((i) => i.candidateKey === key);

/** Deterministic PRNG (mulberry32) with a Box–Muller normal. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () =>
    Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  const pick = <T>(xs: T[]): T => xs[Math.floor(u() * xs.length)];
  return { u, normal, pick };
}

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const SERVERS = ["Kerem", "Deniz", "Priya", "Maya", "Lucas"];
const MENU = Array.from(
  { length: 120 },
  (_, i) => `Item ${String(i + 1).padStart(3, "0")}`,
);

interface House {
  checks?: number;
  /** Two $3,400 booth checks to Kerem, as on Tuzlu. */
  booth?: boolean;
  /** Multiply one server's checks by this factor. */
  plantServer?: { name: string; factor: number };
  /** Put both items on this share of checks, and each alone on `alone`. */
  plantPair?: { a: string; b: string; both: number; alone: number };
}

/**
 * Tuzlu's shape (gen.py:122-195 semantics): every check's server and table
 * are drawn uniformly, totals are lognormal around $185, and each day's item
 * lines are drawn by popularity, shuffled, and dealt round-robin to that day's
 * checks — so no server, table or pair differs from any other by design.
 */
function tuzlu(seed: number, house: House = {}): Rows {
  const { u, normal, pick } = rng(seed);
  const total = house.checks ?? 3300;
  const tables = Array.from({ length: 24 }, (_, i) => ({
    id: `t${i + 1}`,
    label: String(i + 1),
    seats: pick([2, 4, 6]),
    zone: null,
    is_outdoor: u() < 0.3,
    distance_to_kitchen_m: Math.round(2 + 28 * u()),
    distance_to_bar_m: Math.round(2 + 28 * u()),
    distance_to_pool_m: Math.round(2 + 28 * u()),
  }));
  const weights = MENU.map((_, i) => 1 / (i + 5));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const drawItem = () => {
    let r = u() * wSum;
    for (let i = 0; i < MENU.length; i++) {
      r -= weights[i];
      if (r <= 0) return MENU[i];
    }
    return MENU[MENU.length - 1];
  };

  const checks: any[] = [];
  const days = 89;
  for (let d = 1; d <= days; d++) {
    const today = Math.round(total / days);
    const lines = Array.from({ length: today }, () => 2 + Math.floor(u() * 4));
    const pool: string[] = [];
    for (const l of lines) for (let k = 0; k < l; k++) pool.push(drawItem());
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(u() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const dealt: string[][] = lines.map(() => []);
    let next = 0;
    for (let round = 0; next < pool.length; round++)
      for (let c = 0; c < today && next < pool.length; c++)
        if (dealt[c].length < lines[c]) dealt[c].push(pool[next++]);
    for (let c = 0; c < today; c++) {
      const server = pick(SERVERS);
      let amount = Math.max(20, 185 * Math.exp(0.45 * normal() - 0.10125));
      if (house.plantServer?.name === server)
        amount *= house.plantServer.factor;
      const items: any[] = dealt[c].map((name) => ({ name, is_wine: true }));
      const pp = house.plantPair;
      if (pp) {
        const r = u();
        if (r < pp.both) items.push({ name: pp.a }, { name: pp.b });
        else {
          if (u() < pp.alone) items.push({ name: pp.a });
          if (u() < pp.alone) items.push({ name: pp.b });
        }
      }
      checks.push(
        check(d, checks.length, server, pick(tables).id, amount, items),
      );
    }
  }
  if (house.booth) {
    checks.push(check(30, checks.length, "Kerem", "t1", 3400, []));
    checks.push(check(31, checks.length, "Kerem", "t2", 3400, []));
  }
  return { pos_checks: checks, restaurant_tables: tables };
}

function check(
  back: number,
  i: number,
  server: string,
  table: string,
  total: number,
  items: any[],
) {
  const date = dayBack(back);
  return {
    id: `chk-${i}`,
    source: "test",
    table_id: table,
    server_name: server,
    server_external_id: null,
    opened_at: `${date}T19:00:00.000Z`,
    closed_at: `${date}T21:00:00.000Z`,
    covers: 2,
    total: Math.round(total * 100) / 100,
    tip: 0,
    items,
  };
}

describe("A ranking or a pairing is printed only when the data can tell it apart (ADR 0272)", () => {
  it("names no #1 server, no #1 table and no pairing on Tuzlu's planted null", async () => {
    const xs = await fire(tuzlu(20261003, { booth: true }));
    // One assertion over all three, so a regression names every rule that
    // fired (before ADR 0272 all three did, on this exact house).
    expect({
      waiter: of(xs, WAITER).map((i) => i.sentence),
      table: of(xs, TABLE).map((i) => i.sentence),
      basket: of(xs, BASKET).map((i) => i.sentence),
    }).toEqual({ waiter: [], table: [], basket: [] });
  });

  it("holds its error rate: across 40 seeded null houses each rule fires on at most 2", async () => {
    const counts = { [WAITER]: 0, [TABLE]: 0, [BASKET]: 0 };
    for (let s = 1; s <= 40; s++) {
      const xs = await fire(
        tuzlu(9000 + s, { checks: 1200, booth: s % 2 === 0 }),
      );
      for (const k of Object.keys(counts) as Array<keyof typeof counts>)
        if (of(xs, k).length) counts[k]++;
    }
    // At alpha 0.05 the bound is 2 of 40 in expectation; Bonferroni and the
    // tie check make the real rate far lower. Any rule over 2 is named.
    expect(Object.entries(counts).filter(([, c]) => c > 2)).toEqual([]);
  });

  it("still finds a server planted 12% ahead, and names that server", async () => {
    const xs = await fire(
      tuzlu(31, { plantServer: { name: "Priya", factor: 1.12 } }),
    );
    const w = of(xs, WAITER);
    expect(w).toHaveLength(1);
    expect(w[0].entityLabel).toBe("Priya");
    expect(w[0].sentence).toMatch(/^Priya ranks #1 of 5 by average check/);
    // The z is the leader against the pooled rest, not a z among 5 means.
    expect(w[0].z!).toBeGreaterThan(3);
  });

  it("still finds a planted pairing, and names that pair", async () => {
    const xs = await fire(
      tuzlu(32, {
        plantPair: { a: "Ribeye", b: "Malbec", both: 0.06, alone: 0.1 },
      }),
    );
    const b = of(xs, BASKET);
    expect(b).toHaveLength(1);
    expect(b[0].evidence.pairA).toBe("Malbec");
    expect(b[0].evidence.pairB).toBe("Ribeye");
    expect(b[0].evidence.lift!).toBeGreaterThan(2);
  });

  it("withholds a server whose lead belongs to the tables they were given", async () => {
    // Two premium tables add $120 a check. Ana works them 80% of the time;
    // Ben really adds $15 a check. Ana leads on the raw mean by a mile — and
    // after adjusting for tables, Ben is on top. Nothing is printed.
    const { u, normal } = rng(77);
    const checks: any[] = [];
    for (let i = 0; i < 1200; i++) {
      const server = ["Ana", "Ben", "Cem"][i % 3];
      const premium = u() < (server === "Ana" ? 0.8 : 0.1);
      const table = premium
        ? ["p1", "p2"][i % 2]
        : ["n1", "n2", "n3", "n4"][i % 4];
      let amount = 185 + 40 * normal();
      if (premium) amount += 120;
      if (server === "Ben") amount += 15;
      checks.push(check(1 + (i % 80), i, server, table, amount, []));
    }
    const xs = await fire({ pos_checks: checks });
    expect(of(xs, WAITER)).toEqual([]);
  });

  describe("the stockout #1", () => {
    /** One wine whose 90 days of demand all landed on one import day. */
    function wine(i: number, sold: number, onHand: number) {
      const id = `w${i}`;
      return {
        inv: {
          id: `inv-${i}`,
          wine_name: `Wine ${i}`,
          stock_live: onHand,
          master_wine_id: id,
        },
        rows: Array.from({ length: 5 }, () => ({
          inventory_id: `inv-${i}`,
          quantity: sold / 5,
          volume_ml: null,
          created_at: `${dayBack(30)}T12:00:00.000Z`,
          restaurant_inventory: { master_wine_id: id },
        })),
      };
    }
    const rowsOf = (ws: ReturnType<typeof wine>[]) => ({
      restaurant_inventory: ws.map((w) => w.inv),
      wine_consumption_log: ws.flatMap((w) => w.rows),
    });

    it("prints no #1 out of an eight-way tie, and no z of 2", async () => {
      // Eight wines out of stock, each with all its demand on one day: the
      // same 61% risk, which floating point returns in three bit patterns.
      const sold = [5, 7, 10, 11, 17, 29, 31, 37];
      const ws = [
        ...sold.map((s, i) => wine(i, s, 0)),
        wine(8, 40, 10), // a lower risk, not tied
      ];
      const xs = await fire(rowsOf(ws));
      expect(of(xs, STOCKOUT)).toEqual([]);
      expect(xs.some((i) => i.z === 2)).toBe(false);
    });

    it("prints a #1 that stands alone, with no fabricated z and the wines really ranked", async () => {
      const ws = [
        wine(0, 10, 0), // 61%
        ...[5, 7, 11, 17, 29, 31].map((s, i) => wine(i + 1, s, s / 4)), // 27%
      ];
      const xs = await fire({
        ...rowsOf(ws),
        // An active row with no demand at all is not a ranked peer.
        restaurant_inventory: [
          ...ws.map((w) => w.inv),
          {
            id: "inv-x",
            wine_name: "Unsold",
            stock_live: 4,
            master_wine_id: "wx",
          },
        ],
      });
      const s = of(xs, STOCKOUT);
      expect(s).toHaveLength(1);
      expect(s[0].entityLabel).toBe("Wine 0");
      expect(s[0].z).toBeNull();
      expect(s[0].evidence.peerCount).toBe(7);
      expect(s[0].sentence).toMatch(/^Wine 0 ranks #1 of 7 by stockout risk/);
    });
  });
});
