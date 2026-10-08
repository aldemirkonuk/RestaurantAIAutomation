import {
  fUpperTail,
  multipleRegression,
  regressionSignificance,
} from "../engine";
import { Logger } from "@nestjs/common";
import { stateBookFrom } from "./item-state";
import {
  DRIVER_AVERAGES_REL_TOL,
  DRIVER_MIN_R2,
  INSIGHT_GENERATOR_VERSION,
  InsightGeneratorService,
  InsightRecord,
  SIGNIFICANCE_ALPHA,
  driverSentencePrints,
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

/**
 * The thenable PostgREST stand-in insight-rankings-significance.spec.ts uses.
 * A table named in `failing` answers with a Supabase error, as a statement
 * timeout gives (ADR 0292).
 */
function makeClient(rowsByTable: Rows, failing: string[] = []) {
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
        Promise.resolve(
          failing.includes(table)
            ? {
                data: null,
                error: { code: "57014", message: "statement timeout" },
              }
            : { data: rows, error: null },
        ).then(resolve, reject);
      return builder;
    },
  };
  return client;
}

async function fire(rows: Rows): Promise<InsightRecord[]> {
  return (await generateOver(rows)).insights;
}

async function generateOver(rows: Rows, failing: string[] = []) {
  const client = makeClient(
    {
      pos_checks: [],
      wine_consumption_log: [],
      procurement_orders: [],
      restaurant_inventory: [],
      restaurant_tables: [],
      restaurant_venue_profiles: [],
      analytics_goals: [],
      ...rows,
    },
    failing,
  );
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
  return generator.generate("r1", { candidateKeys: KEYS });
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

/**
 * The founder's two rulings on the driver sentence (ADR 0303, *Ruling
 * 2026-10-07*), verbatim. The first (asked 2026-10-06 19:57:41Z, answered
 * 2026-10-07 04:15:17Z): "F-test at alpha (Recommended)". The second
 * (answered 2026-10-07, recorded 12:04:50Z [Corrected 2026-10-07: answered
 * 12:02:43Z per the transcript; 12:04:50Z was the coordinator's later
 * date -u]): "F-test + r² > 0.15 (Recommended)". The sentence prints only
 * when the fit leaves a residual degree of freedom, its overall F-test
 * passes at SIGNIFICANCE_ALPHA (0.05), and its r² is above DRIVER_MIN_R2
 * (0.15).
 */
describe("The table driver sentence needs the fit's F-test at alpha and r² above 0.15 (founder, 2026-10-07)", () => {
  /** Hand-drawn tables, one per row of [kitchen m, bar m, seats, outdoor]. */
  const drawn = (rows: Array<Array<number | null>>) =>
    rows.map(([k, b, s, o], i) =>
      table(`d${i}`, String(i + 1), {
        distance_to_kitchen_m: k,
        distance_to_bar_m: b,
        seats: s,
        is_outdoor: o === null ? null : o === 1,
      }),
    );
  const fireDrawn = (rows: Array<Array<number | null>>, avg: number[]) => {
    const tables = drawn(rows);
    return fire({
      restaurant_tables: tables,
      pos_checks: tables.flatMap((t, i) => around(t.id, avg[i], 5)),
    });
  };
  /**
   * The ridge fit (λ 0.1) and F-test the generator makes over these tables,
   * for a fixture whose non-null columns are recorded on every table and
   * vary, so the generator keeps each of them. A case reads it to state
   * which side of each gate it sits on. Every `avg` passed here is a
   * multiple of 0.25, so the five checks `around` writes average to it
   * exactly.
   */
  const fitOf = (rows: Array<Array<number | null>>, avg: number[]) => {
    const cols = [0, 1, 2, 3].filter((j) => rows.every((r) => r[j] !== null));
    const reg = multipleRegression(
      rows.map((r) => cols.map((j) => r[j] as number)),
      avg,
      { ridgeLambda: 0.1 },
    )!;
    const test = regressionSignificance(reg.r2, avg.length, cols.length)!;
    return { r2: reg.r2, p: test.p };
  };
  const noise = [-18, 12, 25, -9, 3, -22, 16, -5, 9, -14];
  /** Forty tables with a kitchen distance only, the average check rising by `slope` a metre. */
  const forty = (slope: number) => {
    const rows = Array.from({ length: 40 }, (_, i) => [
      2 + i,
      null,
      null,
      null,
    ]);
    const avg = rows.map(
      ([k], i) => 180 + slope * (k as number) + noise[i % 10] * (1 + (i % 3)),
    );
    return { rows, avg };
  };

  it("a handful of tables fitting almost exactly does not print: r² far above 0.15, but p above alpha (five on three attributes, six on four)", async () => {
    // r² 0.995 on both, and p 0.09 and 0.11 on one residual degree of
    // freedom: chance fits that well this often.
    const fiveRows = [
      [5, 8, 2, null],
      [10, 6, 4, null],
      [15, 4, 4, null],
      [20, 2, 6, null],
      [25, 9, 2, null],
    ];
    const fiveAvg = [150, 171, 168, 192, 181];
    const sixRows = [
      [5, 8, 2, 0],
      [10, 6, 4, 1],
      [15, 4, 4, 0],
      [20, 2, 6, 1],
      [25, 9, 2, 0],
      [30, 3, 6, 1],
    ];
    const sixAvg = [150, 175, 168, 199, 181, 212];
    for (const [rows, avg] of [
      [fiveRows, fiveAvg],
      [sixRows, sixAvg],
    ] as const) {
      const fit = fitOf(rows as any, avg as any);
      expect(fit.r2).toBeGreaterThan(0.99);
      expect(fit.p).toBeGreaterThan(SIGNIFICANCE_ALPHA);
      expect(of(await fireDrawn(rows as any, avg as any), DRIVERS)).toEqual([]);
    }
  });

  it("five tables on four attributes leave no residual degree of freedom, so even an exact fit never prints", async () => {
    const rows = [
      [5, 8, 2, 0],
      [10, 6, 4, 1],
      [15, 4, 4, 0],
      [20, 2, 6, 1],
      [25, 9, 2, 1],
    ];
    const exact = rows.map(
      ([k, b, s, o]) => 100 + 2 * k + 3 * b + 5 * s + 10 * o,
    );
    expect(of(await fireDrawn(rows, exact), DRIVERS)).toEqual([]);
  });

  it("a weak driver on forty tables passes the F-test but explains 15% or less, so it does not print (r² 0.137, p 0.019)", async () => {
    const { rows, avg } = forty(1.25);
    const fit = fitOf(rows, avg);
    expect(fit.r2).toBeGreaterThan(0.13);
    expect(fit.r2).toBeLessThanOrEqual(0.15);
    expect(fit.p).toBeLessThanOrEqual(SIGNIFICANCE_ALPHA);
    expect(of(await fireDrawn(rows, avg), DRIVERS)).toEqual([]);
  });

  it("a driver on forty tables that passes the F-test and explains more than 15% prints", async () => {
    const { rows, avg } = forty(2.5);
    const fit = fitOf(rows, avg);
    expect(fit.r2).toBeGreaterThan(0.15);
    expect(fit.p).toBeLessThanOrEqual(SIGNIFICANCE_ALPHA);
    const d = of(await fireDrawn(rows, avg), DRIVERS);
    expect(d).toHaveLength(1);
    expect(d[0].evidence.drivers!.map((x) => x.attribute)).toEqual([
      "kitchen distance",
    ]);
    expect(d[0].effectPct!).toBeCloseTo(fit.r2, 12);
  });

  /**
   * The call site's wiring into driverSentencePrints: the test's k is the
   * attributes kept, its n the tables fitted (`fitRows`), and the record is
   * built with that same n. Six tables on all four attributes, the averages
   * on 100 + 2·kitchen + 3·bar + 5·seats + 10·outdoor (the five-on-four
   * case's line, one table more): the ridge fit's r² is 0.9997, and on
   * (4, 1) degrees of freedom its p is 0.026.
   */
  const sixOnFour = [
    [5, 8, 2, 0],
    [10, 6, 4, 1],
    [15, 4, 4, 0],
    [20, 2, 6, 1],
    [25, 9, 2, 0],
    [30, 3, 6, 1],
  ];
  const onTheLine = (rows: Array<Array<number | null>>) =>
    rows.map(
      ([k, b, s, o]) =>
        100 +
        2 * (k as number) +
        3 * (b as number) +
        5 * (s as number) +
        10 * (o as number),
    );

  it("six tables on four attributes fitting almost exactly print: the test's k is the attributes kept, so one residual degree of freedom is left", async () => {
    const avg = onTheLine(sixOnFour);
    const fit = fitOf(sixOnFour, avg);
    expect(fit.r2).toBeGreaterThan(0.999);
    expect(fit.p).toBeLessThanOrEqual(SIGNIFICANCE_ALPHA);
    // One more attribute than were kept leaves no residual degree of freedom.
    expect(regressionSignificance(fit.r2, 6, 5)).toBeNull();
    const d = of(await fireDrawn(sixOnFour, avg), DRIVERS);
    expect(d).toHaveLength(1);
    expect(d[0].evidence.drivers!.map((x) => x.attribute).sort()).toEqual([
      "bar distance",
      "kitchen distance",
      "outdoor",
      "seats",
    ]);
    expect(d[0].effectPct!).toBeCloseTo(fit.r2, 12);
  });

  it("a table missing a kept attribute is not fitted, and is not counted in the test's n: five fitted on three attributes do not print, though eight would", async () => {
    // The near-exact handful above (r² 0.995, p 0.09 on one residual degree
    // of freedom), and three more ranked tables with a kitchen and a bar
    // distance but no seat count. Seats are still kept (recorded and varying
    // on five tables), so those three leave the fit.
    const fitted = [
      [5, 8, 2, null],
      [10, 6, 4, null],
      [15, 4, 4, null],
      [20, 2, 6, null],
      [25, 9, 2, null],
    ];
    const fittedAvg = [150, 171, 168, 192, 181];
    const noSeats = [
      [30, 5, null, null],
      [35, 7, null, null],
      [40, 1, null, null],
    ];
    const fit = fitOf(fitted, fittedAvg);
    expect(fit.p).toBeGreaterThan(SIGNIFICANCE_ALPHA);
    // Counted over all eight ranked tables, the same r² would pass.
    expect(regressionSignificance(fit.r2, 8, 3)!.p).toBeLessThanOrEqual(
      SIGNIFICANCE_ALPHA,
    );
    const xs = await fireDrawn(
      [...fitted, ...noSeats],
      [...fittedAvg, 200, 210, 220],
    );
    expect(of(xs, DRIVERS)).toEqual([]);
  });

  it("the record is built with the tables fitted, not the tables ranked: its score's support is six tables, not nine", async () => {
    // The six above, and three more with no outdoor flag: ranked, but not
    // fitted. n reaches the record only through its score's support weight
    // (scoreOf), and the score is what is stored.
    const noOutdoor = [
      [35, 5, 4, null],
      [40, 7, 2, null],
      [45, 1, 6, null],
    ];
    const avg = onTheLine(sixOnFour);
    const fit = fitOf(sixOnFour, avg);
    const built = jest.spyOn(
      InsightGeneratorService.prototype as any,
      "record",
    );
    try {
      const d = of(
        await fireDrawn([...sixOnFour, ...noOutdoor], [...avg, 230, 240, 250]),
        DRIVERS,
      );
      expect(d).toHaveLength(1);
      expect(d[0].effectPct!).toBeCloseTo(fit.r2, 12);
      const calls = built.mock.calls.filter((c) => c[0] === DRIVERS);
      expect(calls).toHaveLength(1);
      expect((calls[0][4] as { n: number }).n).toBe(6);
      const scoreOf = (n: number) =>
        (InsightGeneratorService.prototype as any).scoreOf.call(null, {
          effectPct: d[0].effectPct,
          n,
        });
      expect(scoreOf(6)).not.toBe(scoreOf(9));
      expect(d[0].score).toBe(scoreOf(6));
    } finally {
      built.mockRestore();
    }
  });

  it("equal average checks are no fit, though the regression calls their r² 1", async () => {
    const rows = [5, 10, 15, 20, 25].map((k) => [k, null, null, null]);
    expect(
      of(await fireDrawn(rows, [180, 180, 180, 180, 180]), DRIVERS),
    ).toEqual([]);
  });

  it("eight tables whose averages are equal to the cent, but not in their last binary digits, are no fit either", async () => {
    // 180.10 + 180.20 + 180.30 sums to 180.19999999999996 a check, and
    // 180.00 + 180.10 + 180.50 to 180.20000000000002: both are 180.20.
    const low = [180.1, 180.2, 180.3];
    const high = [180, 180.1, 180.5];
    const tables = [5, 10, 15, 20, 25, 30, 35, 40].map((k, i) =>
      table(`f${i}`, String(i + 1), { distance_to_kitchen_m: k }),
    );
    const xs = await fire({
      restaurant_tables: tables,
      pos_checks: tables.flatMap((t, i) =>
        (i < 4 ? low : high).map((total) => closed(t.id, total)),
      ),
    });
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
    expect(sum(low) / 3).not.toBe(sum(high) / 3);
    expect(of(xs, DRIVERS)).toEqual([]);
  });
});

describe("driverSentencePrints: averages that vary, a residual degree of freedom, p at or under alpha, and r² above 0.15", () => {
  const varying = Array.from({ length: 40 }, (_, i) => 180 + i);

  it("does not print at r² exactly 0.15 on forty tables, where the F-test alone would pass", () => {
    expect(regressionSignificance(0.15, 40, 1)!.p).toBeLessThanOrEqual(
      SIGNIFICANCE_ALPHA,
    );
    expect(DRIVER_MIN_R2).toBe(0.15);
    expect(driverSentencePrints(0.15, varying, 1)).toBe(false);
    expect(driverSentencePrints(0.15000000000000002, varying, 1)).toBe(true);
  });

  it("does not print when r² is above 0.15 but p is above alpha", () => {
    const six = varying.slice(0, 6);
    expect(regressionSignificance(0.5, 6, 1)!.p).toBeGreaterThan(
      SIGNIFICANCE_ALPHA,
    );
    expect(driverSentencePrints(0.5, six, 1)).toBe(false);
    expect(driverSentencePrints(0.9, six, 1)).toBe(true);
  });

  it("does not print without a residual degree of freedom, even at r² 1", () => {
    expect(driverSentencePrints(1, varying.slice(0, 5), 4)).toBe(false);
    expect(driverSentencePrints(1, varying.slice(0, 6), 4)).toBe(true);
  });

  it("reads averages within DRIVER_AVERAGES_REL_TOL of the largest as equal, and 180.20 against 180.21 as varying", () => {
    expect(DRIVER_AVERAGES_REL_TOL).toBe(1e-9);
    const rounding = varying.map((_, i) =>
      i % 2 ? 180.20000000000002 : 180.19999999999996,
    );
    const cent = varying.map((_, i) => (i % 2 ? 180.21 : 180.2));
    expect(driverSentencePrints(0.9, rounding, 1)).toBe(false);
    expect(driverSentencePrints(0.9, cent, 1)).toBe(true);
    expect(
      driverSentencePrints(
        0.9,
        varying.map(() => 0),
        1,
      ),
    ).toBe(false);
  });
});

describe("The F upper tail the driver test reads (engine)", () => {
  it("matches the textbook 5% critical values to three decimals", () => {
    expect(fUpperTail(4.96, 1, 10)).toBeCloseTo(0.05, 3);
    expect(fUpperTail(4.1, 2, 10)).toBeCloseTo(0.05, 3);
    expect(fUpperTail(3.48, 4, 10)).toBeCloseTo(0.05, 3);
    expect(fUpperTail(3.1, 3, 20)).toBeCloseTo(0.05, 3);
    expect(fUpperTail(161.45, 1, 1)).toBeCloseTo(0.05, 4);
  });

  it("matches the closed forms: F(2, d) is (1 + 2f/d)^(-d/2), F(1, 1) at 1 is one half", () => {
    for (const [f, d] of [
      [0.3, 4],
      [4.1, 10],
      [9, 30],
    ])
      expect(fUpperTail(f, 2, d)).toBeCloseTo(
        (1 + (2 * f) / d) ** (-d / 2),
        12,
      );
    expect(fUpperTail(1, 1, 1)).toBeCloseTo(0.5, 12);
    expect(fUpperTail(0, 3, 7)).toBe(1);
    expect(fUpperTail(Number.POSITIVE_INFINITY, 3, 7)).toBe(0);
  });

  it("tests a fit's r² on (k, n − k − 1) degrees of freedom, and makes no test without a residual one", () => {
    const t = regressionSignificance(0.5, 12, 2)!;
    expect(t.df1).toBe(2);
    expect(t.df2).toBe(9);
    expect(t.f).toBeCloseTo(4.5, 12);
    expect(t.p).toBeCloseTo((1 + (2 * 4.5) / 9) ** -4.5, 12);
    expect(regressionSignificance(0.999, 5, 4)).toBeNull();
    expect(regressionSignificance(1, 6, 4)).toEqual({
      f: Number.POSITIVE_INFINITY,
      df1: 4,
      df2: 1,
      p: 0,
    });
  });
});

/**
 * Merge of be9a16ccf (#652, ADR 0292 fork 3 follow-on) into this branch,
 * 2026-10-08. Every table insight here takes a table's label, its hidden
 * flag or its attributes from the table list, a read besides the checks the
 * family is built on, so #652's rule holds for all of them: when that read
 * could not be made, none fires and the read is named. The server's #1 reads
 * only a check's own `table_id`, so it still fires. Each insight is first
 * shown firing with the list read, so its absence is not a fixture that
 * never fires.
 */
describe("A table list that could not be read leaves every table insight silent (ADR 0292, ADR 0303)", () => {
  // Five shown tables with a kitchen distance, average check rising $100 a
  // table with it, so table 5 is well ahead; a sixth table, hidden, ahead of
  // them all; Ana
  // $100 a check above Ben at every table; and an open check at table 5 far
  // past its pace.
  const rows = () => {
    const hand = [5, 10, 15, 20, 25].map((d, i) =>
      table(`h${i}`, String(i + 1), {
        seats: 4,
        is_outdoor: false,
        distance_to_kitchen_m: d,
      }),
    );
    const at = (id: string, mean: number) =>
      around(id, mean, 40, (j) => (j % 2 ? "Ben" : "Ana")).map((c) => ({
        ...c,
        total: c.total + (c.server_name === "Ana" ? 50 : -50),
      }));
    return {
      restaurant_tables: [
        ...hand,
        table("tp", "Patio", { hidden_at: HIDDEN_AT }),
      ],
      pos_checks: [
        ...[150, 250, 350, 450, 550].flatMap((mean, i) => at(`h${i}`, mean)),
        ...at("tp", 900),
        open("h4", 3000, 10),
      ],
    };
  };

  it("with the table list read, the table insights fire, the hidden one stays out, and the server's #1 fires", async () => {
    const out = await generateOver(rows());
    expect(out.sourcesUnread).toEqual([]);
    const tableKeys = new Set(
      out.insights
        .filter((i) => i.candidateKey.startsWith("table."))
        .map((i) => i.candidateKey),
    );
    expect(tableKeys).toEqual(new Set([TABLE_RANK, CORRELATION, DRIVERS, HOT]));
    expect(of(out.insights, TABLE_RANK).map((i) => i.sentence)).toEqual([
      expect.stringMatching(/^Table 5 ranks #1 of 5 by average check/),
    ]);
    expect(of(out.insights, HOT).map((i) => i.evidence.entity)).toEqual([
      "Table 5",
    ]);
    expect(out.insights.filter((i) => /Patio/.test(i.sentence))).toEqual([]);
    expect(of(out.insights, WAITER).map((i) => i.evidence.entity)).toEqual([
      "Ana",
    ]);
  });

  it("with the table list failing, no table insight fires, the list is named, and the server's #1 still fires", async () => {
    const quiet = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    try {
      const out = await generateOver(rows(), ["restaurant_tables"]);
      expect(out.sourcesUnread).toEqual(["table list"]);
      expect(
        out.insights.filter((i) => i.candidateKey.startsWith("table.")),
      ).toEqual([]);
      expect(
        out.insights.filter((i) => /Top table|A table/.test(i.sentence)),
      ).toEqual([]);
      expect(of(out.insights, WAITER).map((i) => i.evidence.entity)).toEqual([
        "Ana",
      ]);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("The stored insight cache", () => {
  // [2026-10-08, merge of be9a16ccf (#652): was "version 8 or later"; #652
  // landed 10 on main first, so this change is 11.] [2026-10-08, merge of
  // 8b22448dc: #626 (ADR 0297) landed 11 on main first, so this change is 12.]
  it("is at version 12 or later, so a row that ranked a hidden table is recomputed", () => {
    expect(INSIGHT_GENERATOR_VERSION).toBeGreaterThanOrEqual(12);
  });
});
