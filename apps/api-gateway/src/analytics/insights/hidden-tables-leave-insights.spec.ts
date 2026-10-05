import { stateBookFrom } from "./item-state";
import {
  INSIGHT_GENERATOR_VERSION,
  InsightGeneratorService,
  InsightRecord,
} from "./insight-generator.service";

/**
 * ADR 0303, the insights' part. A table is what the till names, and the owner
 * or a manager may hide one. Founder fork F2 (2026-10-04), verbatim: "Out of
 * every figure (Recommended)" — a hidden table leaves every table figure,
 * insights included. Asked whether hidden tables also leave the waiter
 * adjustment's table control (2026-10-05), verbatim: "Keep them in the
 * control (Recommended)".
 *
 * And a learned table carries no seat count, distance or outdoor flag: an
 * unknown is not a zero (ADR 0051, ADR 0053), so the driver fit reads only
 * what was recorded.
 */

const TABLE_RANK = "table.avg_check.peer_rank";
const CORRELATION = "table.avg_check.attribute_correlation";
const DRIVERS = "table.avg_check.driver_weights";
const HOT = "table.revenue.hot_entity_live";
const WAITER = "waiter.avg_check.peer_rank";
const KEYS = [TABLE_RANK, CORRELATION, DRIVERS, HOT, WAITER];

type Rows = Record<string, any[]>;

/** The thenable PostgREST stand-in insight-rankings-significance.spec.ts uses. */
function makeClient(rowsByTable: Rows) {
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
  const selects: Record<string, string[]> = {};
  const client = {
    selects,
    from: (table: string) => {
      const rows = rowsByTable[table] ?? [];
      const builder: any = {};
      for (const m of passthrough) builder[m] = (..._args: any[]) => builder;
      builder.select = (cols: string) => {
        (selects[table] ??= []).push(cols);
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.single = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    },
  };
  return client;
}

async function fire(rows: Rows): Promise<InsightRecord[]> {
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
  const generator = new InsightGeneratorService(
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
  // Narrowed to the table and waiter types: uncapped, never persisted.
  const out = await generator.generate("r1", { candidateKeys: KEYS });
  return out.insights;
}

const of = (xs: InsightRecord[], key: string) =>
  xs.filter((i) => i.candidateKey === key);

const HIDDEN_AT = "2026-10-04T09:00:00.000Z";

/** A table row as the bundle reads it; a learned one records nothing. */
function table(
  id: string,
  label: string,
  attrs: Partial<{
    seats: number | null;
    is_outdoor: boolean | null;
    distance_to_kitchen_m: number | null;
    distance_to_bar_m: number | null;
    hidden_at: string | null;
  }> = {},
) {
  return {
    id,
    label,
    zone: null,
    seats: null,
    is_outdoor: null,
    distance_to_kitchen_m: null,
    distance_to_bar_m: null,
    distance_to_pool_m: null,
    hidden_at: null,
    ...attrs,
  };
}

let seq = 0;
/** A closed check two hours long, `back` days ago. */
function closed(
  tableId: string | null,
  total: number,
  server: string | null = null,
  back = 3,
) {
  const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  return {
    id: `chk-${++seq}`,
    source: "test",
    table_id: tableId,
    server_name: server,
    server_external_id: null,
    opened_at: `${day}T19:00:00.000Z`,
    closed_at: `${day}T21:00:00.000Z`,
    covers: 2,
    total,
    tip: 0,
    items: [],
  };
}

/** A check still open, opened `minutesAgo` minutes ago. */
function open(tableId: string | null, total: number, minutesAgo = 20) {
  return {
    ...closed(tableId, total),
    opened_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    closed_at: null,
  };
}

/** `n` checks around `mean`, with a small spread so variances are not 0. */
function around(
  tableId: string | null,
  mean: number,
  n: number,
  server: (i: number) => string | null = () => null,
) {
  return Array.from({ length: n }, (_, i) =>
    closed(tableId, mean + ((i % 5) - 2) * 3, server(i), 1 + (i % 60)),
  );
}

describe("A hidden table leaves every table insight (ADR 0303, fork F2)", () => {
  it("reads hidden_at with the house's tables, in the one bundle read", async () => {
    const client = makeClient({});
    const generator = new InsightGeneratorService(
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
    await generator.generate("r1", { candidateKeys: KEYS });
    expect(client.selects.restaurant_tables).toHaveLength(1);
    expect(client.selects.restaurant_tables[0]).toMatch(/\bhidden_at\b/);
  });

  it("ranks only the tables the house shows: a hidden table is never #1, and is not counted among the peers", async () => {
    const xs = await fire({
      restaurant_tables: [
        table("t1", "1"),
        table("t2", "2"),
        table("t3", "3"),
        table("t4", "4"),
        table("tp", "Patio", { hidden_at: HIDDEN_AT }),
      ],
      pos_checks: [
        ...around("tp", 400, 40),
        ...around("t1", 260, 40),
        ...around("t2", 180, 40),
        ...around("t3", 180, 40),
        ...around("t4", 180, 40),
      ],
    });
    const rank = of(xs, TABLE_RANK);
    expect(rank.map((i) => i.sentence)).toEqual([
      expect.stringMatching(/^Table 1 ranks #1 of 4 by average check/),
    ]);
    expect(xs.filter((i) => /Patio/.test(i.sentence))).toEqual([]);
  });

  it("ranks no retired table and no check without a table either", async () => {
    // "gone" is not in the read (it reads active tables only); before ADR
    // 0303's insights part it was ranked as "Top table".
    const xs = await fire({
      restaurant_tables: [table("t1", "1"), table("t2", "2"), table("t3", "3")],
      pos_checks: [
        ...around("gone", 500, 40),
        ...around(null, 450, 40),
        ...around("t1", 260, 40),
        ...around("t2", 180, 40),
        ...around("t3", 180, 40),
      ],
    });
    expect(of(xs, TABLE_RANK).map((i) => i.sentence)).toEqual([
      expect.stringMatching(/^Table 1 ranks #1 of 3 by average check/),
    ]);
  });

  it("watches no open check at a hidden table, and none without a table; a shown table still surges", async () => {
    const history = (id: string | null) =>
      [90, 95, 100, 105, 110, 115].map((t) => closed(id, t));
    const xs = await fire({
      restaurant_tables: [
        table("t1", "1"),
        table("tp", "Patio", { hidden_at: HIDDEN_AT }),
      ],
      pos_checks: [
        ...history("t1"),
        ...history("tp"),
        ...history(null),
        open("t1", 300),
        open("tp", 300),
        open(null, 300),
      ],
    });
    expect(of(xs, HOT).map((i) => i.evidence.entity)).toEqual(["Table 1"]);
  });

  it("an all-hidden house gets no table insight at all, and still gets its server's", async () => {
    const xs = await fire({
      restaurant_tables: [
        table("ta", "A", { hidden_at: HIDDEN_AT }),
        table("tb", "B", { hidden_at: HIDDEN_AT }),
        table("tc", "C", { hidden_at: HIDDEN_AT }),
      ],
      pos_checks: [
        ...around("ta", 400, 40, () => "Ana"),
        ...around("tb", 180, 40, () => "Ben"),
        ...around("tc", 180, 40, () => "Ben"),
        open("ta", 300),
      ],
    });
    expect(xs.filter((i) => i.candidateKey.startsWith("table."))).toEqual([]);
    expect(
      of(xs, WAITER).map((i) => i.entityLabel ?? i.evidence.entity),
    ).toEqual(["Ana"]);
  });
});

describe("The waiter adjustment keeps hidden tables in its control (founder, 2026-10-05)", () => {
  // Two tables, one hidden. If the hidden table's checks left the control,
  // it would have one level, the table-adjusted fit would not run, and the
  // waiter's sentence would lose "Still #1 after adjusting ...".
  const rows = () => ({
    restaurant_tables: [
      table("t1", "1"),
      table("tp", "Patio", { hidden_at: HIDDEN_AT }),
    ],
    pos_checks: [
      // The hidden table adds 20 a check for both servers.
      ...around("t1", 240, 20, () => "Ana"),
      ...around("tp", 260, 20, () => "Ana"),
      ...around("t1", 140, 20, () => "Ben"),
      ...around("tp", 160, 20, () => "Ben"),
    ],
  });

  it("fits the server over every check with a table, hidden ones included", async () => {
    const w = of(await fire(rows()), WAITER);
    expect(w).toHaveLength(1);
    expect(w[0].evidence.entity).toBe("Ana");
    expect(w[0].evidence.attributeReading).toBe(
      "Still #1 after adjusting for which tables they worked.",
    );
  });

  it("keeps a hidden table's checks in the server's own figure", async () => {
    const w = of(await fire(rows()), WAITER);
    // Ana's 40 checks average 250; without the 20 at the hidden table, 240.
    expect(w[0].evidence.value).toBeCloseTo(250, 6);
    expect(w[0].evidence.peerCount).toBe(2);
  });
});

describe("The table driver fit reads only what was recorded (ADR 0051, 0053, 0303)", () => {
  it("fits no driver when no attribute is recorded on enough tables", async () => {
    // Four tables drawn by hand, two learned from the till with nothing
    // recorded. Read as 0 m from the kitchen, 0 seats and indoors, the two
    // learned tables used to make a fit with r² far above the 0.15 gate.
    const hand = [
      table("h1", "1", {
        seats: 2,
        is_outdoor: false,
        distance_to_kitchen_m: 5,
        distance_to_bar_m: 8,
      }),
      table("h2", "2", {
        seats: 4,
        is_outdoor: true,
        distance_to_kitchen_m: 10,
        distance_to_bar_m: 6,
      }),
      table("h3", "3", {
        seats: 4,
        is_outdoor: false,
        distance_to_kitchen_m: 15,
        distance_to_bar_m: 4,
      }),
      table("h4", "4", {
        seats: 6,
        is_outdoor: true,
        distance_to_kitchen_m: 20,
        distance_to_bar_m: 2,
      }),
    ];
    const learned = [table("l1", "T7"), table("l2", "T8")];
    const xs = await fire({
      restaurant_tables: [...hand, ...learned],
      pos_checks: [
        ...around("h1", 180, 5),
        ...around("h2", 190, 5),
        ...around("h3", 185, 5),
        ...around("h4", 195, 5),
        ...around("l1", 420, 5),
        ...around("l2", 410, 5),
      ],
    });
    expect(of(xs, DRIVERS)).toEqual([]);
  });

  it("fits over the recorded tables only, and weighs only the attributes recorded and varying", async () => {
    // Five tables with a kitchen distance, average check rising with it;
    // seats recorded but all 4, outdoor all false, bar distance never
    // recorded; two learned tables with nothing recorded and wild checks.
    const hand = [5, 10, 15, 20, 25].map((d, i) =>
      table(`h${i}`, String(i + 1), {
        seats: 4,
        is_outdoor: false,
        distance_to_kitchen_m: d,
      }),
    );
    const learned = [table("l1", "T7"), table("l2", "T8")];
    const xs = await fire({
      restaurant_tables: [...hand, ...learned],
      pos_checks: [
        ...hand.flatMap((t, i) => around(t.id, 150 + 10 * i, 5)),
        ...around("l1", 600, 5),
        ...around("l2", 20, 5),
      ],
    });
    const d = of(xs, DRIVERS);
    expect(d).toHaveLength(1);
    expect(d[0].evidence.drivers!.map((x) => x.attribute)).toEqual([
      "kitchen distance",
    ]);
    expect(d[0].evidence.drivers![0].weight).toBeGreaterThan(0.99);
  });
});

describe("The stored insight cache", () => {
  it("is at version 8 or later, so a row that ranked a hidden table is recomputed", () => {
    expect(INSIGHT_GENERATOR_VERSION).toBeGreaterThanOrEqual(8);
  });
});
