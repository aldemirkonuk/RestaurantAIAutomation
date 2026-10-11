import { stateBookFrom } from "./item-state";
import { InsightGeneratorService } from "./insight-generator.service";
import { buildSuppressionKey } from "./suppression";
import { verbalize } from "./insight-verbalizer";
import { groupBaseline } from "../engine/comparisons";

/**
 * The house's zone row, which the insight bundle reads before filing any day
 * (ADR 0296, F-295). UTC here keeps this spec's dates on the calendar it
 * builds them on; the house-day filing itself is asserted in
 * `insight-unread-sources.spec.ts`.
 */
const HOUSE_ROW = [{ timezone: "UTC", country: null }];

/**
 * "Wednesday sales came in 100% lower than your average Wednesday."
 *
 * That sentence was not a hypothetical. On 2026-09-03 the local gateway
 * returned it, verbatim, from the live rule engine:
 *
 *   GET /api/v1/analytics/recommendations/550e8400-…
 *   → "Wednesday sales came in 100% lower than your average Wednesday
 *      ($0 vs $104)."
 *   → "sales fell 100% vs the previous week ($0 vs $2.4k)."
 *
 * Neither is a measurement. `toDaily` bucketed rows by day and filled every
 * gap with a literal 0, so a closure, a POS outage and a genuinely dead day
 * were the same number to every baseline downstream. The restaurant had not
 * lost 100% of its Wednesday trade; the system had no records for that day and
 * said "zero" — absence reported as a measurement, which is the same fault as
 * absence reported as health, told with a percentage.
 *
 * These tests pin the four withholding rules that replace it, and — the half
 * that matters — pin the sentence that must still be produced when the data
 * IS there, in exactly the shape the founder quoted.
 */

type Rows = Record<string, any[]>;

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
  return {
    from: (table: string) => {
      const rows =
        rowsByTable[table] ?? (table === "restaurants" ? HOUSE_ROW : []);
      const builder: any = {};
      for (const m of passthrough)
        builder[m] = (..._args: any[]) => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.single = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    },
  };
}

/** The same date arithmetic `toDaily` uses: `n = 1` is yesterday. */
function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function check(date: string, total: number) {
  return {
    id: `chk-${date}-${total}`,
    source: "test",
    table_id: null,
    server_name: null,
    server_external_id: null,
    opened_at: `${date}T18:00:00.000Z`,
    closed_at: `${date}T20:00:00.000Z`,
    covers: 2,
    total,
    tip: 0,
    items: null,
  };
}

interface Scenario {
  /** Revenue per day-back offset. Omit an offset entirely for "no records". */
  revenue: Map<number, number>;
  excluded?: string[];
  exclusionsReadable?: boolean;
  suppressions?: string[];
  suppressionsReadable?: boolean;
  /** `restaurants.currency`; the founder's sentence was a dollar house. */
  currency?: string | null;
}

function generatorFor(s: Scenario) {
  const checks = Array.from(s.revenue.entries()).map(([back, total]) =>
    check(dayBack(back), total),
  );
  const client = makeClient({
    pos_checks: checks,
    wine_consumption_log: [],
    procurement_orders: [],
    restaurant_inventory: [],
    restaurant_tables: [],
    restaurant_venue_profiles: [],
    analytics_goals: [],
    restaurants: [
      {
        timezone: "UTC",
        country: null,
        currency: s.currency === undefined ? "USD" : s.currency,
      },
    ],
  });
  return new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({
        dates: new Set(s.excluded ?? []),
        readable: s.exclusionsReadable ?? true,
        problem: null,
      }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom(
          (s.suppressions ?? []).map((ruleKey: string) => ({
            ruleKey,
            status: "dismissed",
            reason: "not_relevant",
            snoozeUntil: null,
          })),
        ),
        readable: s.suppressionsReadable ?? true,
        problem: null,
      }),
    } as any,
  );
}

/**
 * A 90-day trading history where one weekday earns more than the rest, and
 * yesterday — that same weekday — came in soft. This is the shape the founder's
 * sentence describes when it is TRUE.
 */
function tradingHistory(opts: {
  yesterday?: number | null;
  weekdayRate?: number;
  otherRate?: number;
  /** Day-back offsets to leave with no records at all. */
  blank?: number[];
} = {}) {
  const weekdayRate = opts.weekdayRate ?? 1000;
  const otherRate = opts.otherRate ?? 800;
  const target = weekdayOf(dayBack(1));
  const blank = new Set(opts.blank ?? []);
  const revenue = new Map<number, number>();
  for (let back = 90; back >= 1; back--) {
    if (blank.has(back)) continue;
    if (back === 1) {
      if (opts.yesterday === null) continue;
      revenue.set(back, opts.yesterday ?? 600);
      continue;
    }
    revenue.set(
      back,
      weekdayOf(dayBack(back)) === target ? weekdayRate : otherRate,
    );
  }
  return { revenue, target };
}

const WEEKDAY_BASELINE = "overall.revenue.vs_same_weekday";
const WEEK_OVER_WEEK = "overall.revenue.vs_prev_period_7d";

describe("baseline honesty — the 100% sentence", () => {
  it("still produces the founder's sentence when the day really was soft", async () => {
    const { revenue } = tradingHistory({ yesterday: 600 });
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    const hit = out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE);
    expect(hit).toBeDefined();
    // The shape, verbatim: "<Weekday> sales came in 40% lower than your
    // average <Weekday> ($600 vs $1.0k, over N past <Weekday>s)."
    expect(hit!.sentence).toMatch(
      /^\w+ sales came in 40% lower than your average \w+ \(\$600 vs \$1\.0k, over \d+ past \w+s\)\.$/,
    );
  });

  // F-341: the figures are in the house's own money. A euro house read "$600
  // vs $1.0k" about euros; a house that never said read dollars too.
  it("prints the figures in the house's own currency, and with none when none is recorded", async () => {
    const { revenue } = tradingHistory({ yesterday: 600 });
    const sentenceFor = async (currency: string | null) =>
      (
        await generatorFor({ revenue, currency }).generate("r1", {
          persist: false,
        })
      ).insights.find((i) => i.candidateKey === WEEKDAY_BASELINE)!.sentence;
    expect(await sentenceFor("EUR")).toContain("(€600 vs €1.0k, over");
    // en-US sets a code it has no symbol for with a no-break space.
    expect(await sentenceFor("TRY")).toContain(
      "(TRY\u00a0600 vs TRY\u00a01.0k, over",
    );
    const none = await sentenceFor(null);
    expect(none).toContain("(600 vs 1.0k, over");
    expect(none).not.toContain("$");
  });

  it("withholds rather than claiming a 100% collapse from a day with no records", async () => {
    const { revenue } = tradingHistory({ yesterday: null });
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    for (const i of out.insights) expect(i.sentence).not.toContain("100%");
    // And specifically: nothing is claimed about yesterday at all.
    const hit = out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE);
    if (hit) expect(hit.periodKey).not.toBe(`d:${dayBack(1)}`);
  });

  it("dates the sentence when it had to skip back past a day with no records", async () => {
    // Yesterday is blank; the day before is soft against its own weekday.
    const { revenue } = tradingHistory({ yesterday: null });
    revenue.set(2, 400);
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    const hit = out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE);
    expect(hit).toBeDefined();
    expect(hit!.sentence).toContain(dayBack(2));
    expect(hit!.periodKey).toBe(`d:${dayBack(2)}`);
  });

  it("keeps closures out of the average instead of letting them drag it down", async () => {
    // Six of the twelve same-weekday history days have no records. Counted as
    // zeros they halve the baseline and FLIP the verdict from "lower" to
    // "higher" — the sentence would have been wrong in direction, not just in
    // size.
    const target = weekdayOf(dayBack(1));
    const closures: number[] = [];
    for (let back = 8; back <= 90 && closures.length < 6; back += 7)
      if (weekdayOf(dayBack(back)) === target) closures.push(back);
    const { revenue } = tradingHistory({ yesterday: 600, blank: closures });
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    const hit = out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE);
    expect(hit).toBeDefined();
    expect(hit!.sentence).toContain("lower");
    expect(hit!.evidence.baseline).toBe(1000);
    expect(hit!.evidence.n).toBe(12 - closures.length);
  });

  it("withholds the week-over-week sentence when the windows are not comparable", async () => {
    const blank = [1, 2, 3, 4, 5, 6, 7];
    const { revenue } = tradingHistory({ yesterday: null, blank });
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    expect(
      out.insights.find((i) => i.candidateKey === WEEK_OVER_WEEK),
    ).toBeUndefined();
    for (const i of out.insights) expect(i.sentence).not.toContain("fell 100%");
  });

  it("refuses a weekday baseline built on fewer than three past days", async () => {
    // Nine trading days in total (past the nonZeroDays >= 7 gate), but only
    // two of them share yesterday's weekday.
    const target = weekdayOf(dayBack(1));
    const revenue = new Map<number, number>([[1, 600]]);
    // 8 and 15 days back are the only other days on yesterday's weekday;
    // the rest deliberately are not.
    for (const back of [8, 15, 2, 3, 4, 5, 6, 9]) revenue.set(back, 1000);
    const sameWeekday = Array.from(revenue.keys()).filter(
      (b) => b !== 1 && weekdayOf(dayBack(b)) === target,
    ).length;
    expect(sameWeekday).toBe(2);
    expect(revenue.size).toBe(9); // past the nonZeroDays >= 7 gate
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeUndefined();
  });

  it("never divides by a baseline of zero", () => {
    // Two guards, both deliberate: the comparator refuses to produce a ratio
    // against nothing, and the verbalizer refuses to render one.
    const cmp = groupBaseline(500, [0, 0, 0]);
    expect(cmp!.deltaPct).toBeNull();
    expect(cmp!.direction).toBe("in_line");
    expect(
      verbalize("baseline", {
        entity: "Wednesday",
        measureLabel: "sales",
        unit: "currency",
        value: 500,
        baseline: 0,
        deltaPct: null,
      }),
    ).toBeNull();
  });
});

describe("the manager's own exclusions reach the baseline", () => {
  it("drops an excluded day from the same-weekday history", async () => {
    const target = weekdayOf(dayBack(1));
    const { revenue } = tradingHistory({ yesterday: 600 });
    const excluded: string[] = [];
    for (let back = 8; back <= 90 && excluded.length < 3; back += 7)
      if (weekdayOf(dayBack(back)) === target) excluded.push(dayBack(back));

    const before = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    const after = await generatorFor({ revenue, excluded }).generate("r1", {
      persist: false,
    });
    const n = (out: any) =>
      out.insights.find((i: any) => i.candidateKey === WEEKDAY_BASELINE)
        ?.evidence.n;
    expect(n(before)).toBe(12);
    expect(n(after)).toBe(12 - excluded.length);
  });

  it("reports the excluded days, and whether the store could be read at all", async () => {
    const { revenue } = tradingHistory({ yesterday: 600 });
    const ok = await generatorFor({
      revenue,
      excluded: ["2026-08-15"],
    }).generate("r1", { persist: false });
    expect(ok.excludedDays).toEqual(["2026-08-15"]);
    expect(ok.exclusionsReadable).toBe(true);

    const broken = await generatorFor({
      revenue,
      exclusionsReadable: false,
    }).generate("r1", { persist: false });
    // An unreadable list is NOT an empty one, and the caller has to be able
    // to tell the difference before it presents these numbers as clean.
    expect(broken.exclusionsReadable).toBe(false);
  });
});

describe("a dismissal the generator honours", () => {
  /**
   * Before this, `dismiss` wrote a row that exactly one consumer read — the
   * recommendations feed's own filter — while the generator that produces the
   * sentence, and that also feeds Reports, the mobile tab and the hourly
   * `analytics_insights` persist, had never heard of it. Each test below
   * checks a scope BOUNDARY: what goes, and what must stay.
   */
  const ruleId = `insight:${WEEKDAY_BASELINE}`;
  const run = (suppressions: string[]) => {
    const { revenue } = tradingHistory({ yesterday: 600 });
    return generatorFor({ revenue, suppressions }).generate("r1", {
      persist: false,
    });
  };
  const target = () => ({
    ruleId,
    subject: undefined as string | undefined,
    periodKey: `d:${dayBack(1)}`,
  });
  const subjectName = () =>
    [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][weekdayOf(dayBack(1))];

  it("shows the insight when nothing is dismissed", async () => {
    const out = await run([]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeDefined();
    expect(out.suppressed).toBe(0);
  });

  it("insight scope removes exactly that finding", async () => {
    const key = buildSuppressionKey(
      { ...target(), subject: subjectName() },
      "insight",
    );
    const out = await run([key]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeUndefined();
    expect(out.suppressed).toBe(1);
  });

  it("insight scope leaves the same rule in another period standing", async () => {
    const key = buildSuppressionKey(
      { ruleId, subject: subjectName(), periodKey: "d:1999-01-01" },
      "insight",
    );
    const out = await run([key]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeDefined();
    expect(out.suppressed).toBe(0);
  });

  it("insight scope leaves the same rule about another subject standing", async () => {
    const key = buildSuppressionKey(
      { ruleId, subject: "a-weekday-that-is-not-this-one", periodKey: `d:${dayBack(1)}` },
      "insight",
    );
    const out = await run([key]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeDefined();
  });

  it("subject scope removes it whatever the period", async () => {
    const key = buildSuppressionKey(
      { ruleId, subject: subjectName() },
      "subject",
    );
    const out = await run([key]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeUndefined();
  });

  it("rule scope removes it, and touches nothing belonging to another rule", async () => {
    const out = await run([buildSuppressionKey({ ruleId }, "rule")]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeUndefined();
    // Everything else the run produced is still there.
    expect(out.insights.every((i) => i.candidateKey !== WEEKDAY_BASELINE)).toBe(
      true,
    );
    const clean = await run([]);
    expect(out.insights.length).toBe(clean.insights.length - 1);
  });

  it("a dismissal of a different rule silences nothing", async () => {
    const out = await run(["insight:overall.bottles.vs_same_weekday"]);
    expect(
      out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE),
    ).toBeDefined();
    expect(out.suppressed).toBe(0);
  });

  it("says when the dismissal list could not be read at all", async () => {
    const { revenue } = tradingHistory({ yesterday: 600 });
    const out = await generatorFor({
      revenue,
      suppressionsReadable: false,
    }).generate("r1", { persist: false });
    // Nothing is suppressed, and the caller is told the list is unreliable
    // rather than being handed a page that LOOKS clean.
    expect(out.suppressionsReadable).toBe(false);
  });

  it("carries the three scope keys on every insight so the UI builds none", async () => {
    const out = await run([]);
    const hit = out.insights.find((i) => i.candidateKey === WEEKDAY_BASELINE)!;
    expect(hit.suppression.scope).toBe("insight");
    expect(hit.suppression.keys.rule).toBe(ruleId);
    expect(hit.suppression.keys.subject).toBe(
      `${ruleId}#${subjectName().toLowerCase()}#*`,
    );
    expect(hit.suppression.key).toBe(hit.suppression.keys.insight);
  });
});

describe("week over week compares open days like for like (F-707)", () => {
  const flat = (rate: number, back: number[] = []) => {
    const revenue = new Map<number, number>();
    for (let b = 90; b >= 1; b--) if (!back.includes(b)) revenue.set(b, rate);
    return revenue;
  };
  const weekOverWeek = async (s: Scenario) =>
    (await generatorFor(s).generate("r1", { persist: false })).insights.find(
      (i) => i.candidateKey === WEEK_OVER_WEEK,
    );

  it("one closed day is not a 14% slide", async () => {
    const hit = await weekOverWeek({ revenue: flat(800, [3]) });
    expect(hit).toBeUndefined();
  });

  it("a day the manager excluded leaves both weeks, not just the count", async () => {
    // The sim's probe: one excluded 9,000 buyout against plain 1,000 days
    // printed "sales rose 114% vs the previous week ($15.0k vs $7.0k)".
    const revenue = flat(1000);
    revenue.set(3, 9000);
    const hit = await weekOverWeek({ revenue, excluded: [dayBack(3)] });
    expect(hit).toBeUndefined();
  });

  it("a real change across a closure is measured over the days open in both", async () => {
    const revenue = flat(1000, [3]);
    for (let b = 1; b <= 7; b++) if (b !== 3) revenue.set(b, 1200);
    const hit = await weekOverWeek({ revenue });
    expect(hit?.sentence).toBe(
      "sales rose 20% vs the previous week, counting only the 6 days open in both ($7.2k vs $6.0k).",
    );
  });

  it("is withheld when too few days were open in both weeks", async () => {
    const revenue = flat(1000, [1, 2, 3, 4]);
    for (let b = 5; b <= 7; b++) revenue.set(b, 1500);
    expect(await weekOverWeek({ revenue })).toBeUndefined();
  });
});

describe("the trend sentence counts open days and keeps calendar time (F-708)", () => {
  it("a house shut two days a week is not read as growing faster per week", async () => {
    // Growth of 20 a calendar day; closed Sundays and Mondays.
    const revenue = new Map<number, number>();
    for (let b = 90; b >= 1; b--) {
      const wd = weekdayOf(dayBack(b));
      if (wd === 0 || wd === 1) continue;
      revenue.set(b, 1000 + 20 * (90 - b));
    }
    const out = await generatorFor({ revenue }).generate("r1", {
      persist: false,
    });
    const hit = out.insights.find(
      (i) => i.candidateKey === "overall.revenue.trend_direction",
    );
    expect(hit).toBeDefined();
    const open = Array.from({ length: 28 }, (_, i) => 28 - i).filter((b) =>
      revenue.has(b),
    );
    const level = open.reduce((a, b) => a + revenue.get(b)!, 0) / open.length;
    // Per calendar week: 7 days × 20, as a share of an open day's level.
    expect(hit!.evidence.trendPctPerWeek).toBeCloseTo((7 * 20) / level, 6);
    expect(hit!.sentence).toContain(
      `per week over the ${open.length} open days in the last 28.`,
    );
  });
});

/**
 * A house with a weekly shape: quiet Monday to Thursday, a busy Friday and
 * Saturday, a middling Sunday. The sim's probe (F-1186, F-1187) ran on this
 * shape; each test below runs it ending on every weekday of one week, since
 * both faults moved with the day the generator ran.
 */
describe("a weekly shape is not news (F-1186, F-1187)", () => {
  // Sunday .. Saturday.
  const WEEK = [1500, 1000, 1000, 1000, 1000, 2500, 3000];
  // ±12% noise with a five-day cycle, so each weekday sees every multiplier
  // across the 90 days and no weekday's spread is 0.
  const NOISE = [1.0, 0.88, 1.12, 0.94, 1.06];
  const weekly = (growthPerDay = 0) => {
    const revenue = new Map<number, number>();
    for (let b = 90; b >= 1; b--)
      revenue.set(
        b,
        Math.round(
          WEEK[weekdayOf(dayBack(b))] *
            NOISE[b % 5] *
            (1 + growthPerDay * (90 - b)),
        ),
      );
    return revenue;
  };
  // Seven runs, Monday 2026-10-05 to Sunday 2026-10-11, each at noon UTC.
  const RUN_DAYS = Array.from(
    { length: 7 },
    (_, i) => new Date(Date.UTC(2026, 9, 5 + i, 12)),
  );
  const runOn = async (when: Date, revenue: () => Map<number, number>) => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "clearImmediate",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "queueMicrotask",
      ],
    });
    jest.setSystemTime(when);
    try {
      return (
        await generatorFor({ revenue: revenue() }).generate("r1", {
          persist: false,
        })
      ).insights;
    } finally {
      jest.useRealTimers();
    }
  };

  it("scores an ordinary Friday against Fridays, not against the whole week", async () => {
    for (const when of RUN_DAYS) {
      const xs = await runOn(when, () => weekly());
      expect({
        when: when.toISOString(),
        anomalies: xs
          .filter((i) => i.candidateKey.endsWith(".anomaly_day"))
          .map((i) => i.sentence),
      }).toEqual({ when: when.toISOString(), anomalies: [] });
    }
  });

  it("still flags a Tuesday that took a Saturday's money", async () => {
    // Tuesday 2026-10-06 is 4 days back from a Saturday 2026-10-10 run.
    const xs = await runOn(new Date(Date.UTC(2026, 9, 10, 12)), () => {
      const revenue = weekly();
      revenue.set(4, 3000);
      return revenue;
    });
    const hit = xs.find(
      (i) => i.candidateKey === "overall.revenue.anomaly_day",
    );
    expect(hit?.evidence.date).toBe("2026-10-06");
    expect(hit!.evidence.z!).toBeGreaterThanOrEqual(3);
  });

  it("claims no trend on flat weeks, whatever weekday it runs", async () => {
    for (const when of RUN_DAYS) {
      const xs = await runOn(when, () => weekly());
      expect({
        when: when.toISOString(),
        trend: xs
          .filter((i) => i.candidateKey.endsWith(".trend_direction"))
          .map((i) => i.sentence),
      }).toEqual({ when: when.toISOString(), trend: [] });
    }
  });

  it("reads real growth through the weekly shape, the same way every weekday", async () => {
    // +3% of the starting level a day: about 6% a week of the last month's level.
    for (const when of RUN_DAYS) {
      const xs = await runOn(when, () => weekly(0.03));
      const hit = xs.find(
        (i) => i.candidateKey === "overall.revenue.trend_direction",
      );
      expect(hit?.evidence.trendPctPerWeek).toBeGreaterThan(0.05);
    }
  });
});
