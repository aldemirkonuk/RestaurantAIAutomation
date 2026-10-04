import {
  RecommendationsService,
  SALES_DIP_WEEK_DAYS,
  salesDipAdvice,
  salesDipWhen,
} from "./recommendations.service";

/**
 * A sales dip says when it is for, and only a sales dip raises it (ADR 0291).
 *
 * Found on the 2026-10-03 analytics walk (AW01, A-004): /recommendations said
 * "Tonight: brief the floor…" about Saturday 2026-08-15, seven weeks old. The
 * dip rule restates `*.vs_same_weekday`, which compares the NEWEST day its
 * series observed — up to 90 days back — and the rule stamped every such
 * entry `urgency: "now"` whatever that day's age. A second defect sat in the
 * same finder: it matched the comparator's name in any category, so a soft
 * purchasing day (`overall.purchase_spend.vs_same_weekday`) could raise a
 * "brief the floor" sales card.
 *
 * Period keys are built relative to the real clock, the way the generator
 * builds them (`toDaily` ends at yesterday, UTC).
 */

const RULE = "sales_below_weekday_baseline";
const DAY_MS = 86400000;

function dayBack(n: number, from = Date.now()): string {
  return new Date(from - n * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(date: string): string {
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][new Date(`${date}T00:00:00Z`).getUTCDay()];
}

function dip(over: Partial<Record<string, unknown>> = {}) {
  const date = dayBack(1);
  return {
    candidateKey: "overall.revenue.vs_same_weekday",
    category: "sales",
    sentence: `${weekdayOf(date)} sales came in 15% lower than your average ${weekdayOf(date)}.`,
    score: 2,
    effectPct: -0.15,
    z: -2,
    entityKey: weekdayOf(date),
    entityLabel: weekdayOf(date),
    evidence: {},
    subject: weekdayOf(date),
    periodKey: `d:${date}`,
    periodStart: null,
    periodEnd: null,
    ...over,
  };
}

/** A dip whose day is `n` days old, named the way the generator names it. */
function dipDaysAgo(n: number) {
  const date = dayBack(n);
  return dip({ subject: weekdayOf(date), periodKey: `d:${date}` });
}

function makeService(insights: Array<Record<string, unknown>>) {
  const supabase = {
    from: () => {
      const builder: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"])
        builder[m] = () => builder;
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return builder;
    },
  };
  return new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    { generate: async () => ({ insights }) } as any,
    { listGoals: async () => [] } as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: true,
        problem: null,
      }),
    } as any,
    { supabase, getClient: () => supabase } as any,
  );
}

async function entryFor(insights: Array<Record<string, unknown>>) {
  const out = await makeService(insights).getRecommendations("r-1");
  return out.recommendations.find((r) => r.ruleKey === RULE);
}

describe("a sales dip is urgent only when its day is recent (AW01)", () => {
  it("control: a dip yesterday is tonight's, in the words it always had", async () => {
    const entry = await entryFor([dipDaysAgo(1)]);
    expect(entry?.urgency).toBe("now");
    expect(entry?.recommendation).toBe(
      "Tonight: brief the floor on top-margin picks, run one by-the-glass feature, and pair your strongest server with the weakest section. A soft day is a staffing-and-suggestion problem before it's a demand problem.",
    );
  });

  it("a dip 5 days old is this week's: no 'Tonight', and it names the weekday and the age", async () => {
    const date = dayBack(5);
    const entry = await entryFor([dipDaysAgo(5)]);
    expect(entry?.urgency).toBe("this_week");
    expect(entry?.recommendation).not.toMatch(/tonight/i);
    expect(entry?.recommendation).toMatch(
      new RegExp(`^Before the next ${weekdayOf(date)}:`),
    );
    expect(entry?.recommendation).toContain(`${weekdayOf(date)} ${date}`);
    expect(entry?.recommendation).toContain("5 days ago");
  });

  it("a dip 49 days old (the 2026-08-15 card on 2026-10-03) is this month's", async () => {
    const entry = await entryFor([dipDaysAgo(49)]);
    expect(entry?.urgency).toBe("this_month");
    expect(entry?.recommendation).not.toMatch(/tonight/i);
    expect(entry?.recommendation).toContain("49 days ago");
  });

  it("a dip whose day cannot be read is never 'now'", async () => {
    for (const periodKey of [
      null,
      "d:2026-02-31",
      "d:yesterday",
      "p7:2026-10-01",
    ]) {
      const entry = await entryFor([dip({ periodKey })]);
      expect(entry).toBeDefined();
      expect(entry?.urgency).toBe("this_month");
      expect(entry?.recommendation).not.toMatch(/tonight/i);
    }
  });
});

describe("only a sales dip raises the sales card", () => {
  it("a purchasing dip on the same comparator raises nothing", async () => {
    const entry = await entryFor([
      dip({
        candidateKey: "overall.purchase_spend.vs_same_weekday",
        category: "purchasing",
        effectPct: -0.3,
      }),
    ]);
    expect(entry).toBeUndefined();
  });

  it("a bottles-sold dip (a house with only the cellar log) still does", async () => {
    const entry = await entryFor([
      dip({
        candidateKey: "overall.bottles.vs_same_weekday",
        category: "sales",
      }),
    ]);
    expect(entry?.urgency).toBe("now");
  });

  it("a purchasing dip ranked first does not shadow the sales dip behind it", async () => {
    const entry = await entryFor([
      dip({
        candidateKey: "overall.purchase_spend.vs_same_weekday",
        category: "purchasing",
        effectPct: -0.3,
        periodKey: `d:${dayBack(30)}`,
      }),
      dipDaysAgo(1),
    ]);
    expect(entry?.urgency).toBe("now");
    expect(entry?.periodKey).toBe(`d:${dayBack(1)}`);
  });
});

describe("salesDipWhen — the bands", () => {
  const now = new Date("2026-10-03T15:30:00.000Z");
  const at = (n: number) => `d:${dayBack(n, now.getTime())}`;

  it.each([
    [0, "now"],
    [1, "now"],
    [2, "this_week"],
    [SALES_DIP_WEEK_DAYS, "this_week"],
    [SALES_DIP_WEEK_DAYS + 1, "this_month"],
    [49, "this_month"],
  ])("a day %i days old is %s", (age, urgency) => {
    const when = salesDipWhen(at(age as number), now);
    expect(when.urgency).toBe(urgency);
    expect(when.ageDays).toBe(age);
  });

  it("counts whole UTC days: late in the UTC day, yesterday is still 1", () => {
    const late = new Date("2026-10-03T23:59:59.000Z");
    expect(salesDipWhen("d:2026-10-02", late)).toEqual({
      urgency: "now",
      date: "2026-10-02",
      ageDays: 1,
    });
    expect(salesDipWhen("d:2026-08-15", late).ageDays).toBe(49);
  });

  it("an unreadable or future day has no age and is this month's", () => {
    for (const key of [
      null,
      undefined,
      "",
      "d:",
      "d:2026-02-31",
      "t28:2026-10-02",
      "d:2026-10-05",
    ])
      expect(salesDipWhen(key, now)).toEqual({
        urgency: "this_month",
        date: null,
        ageDays: null,
      });
  });

  it("the copy for an undated day names the subject and says its age is unknown", () => {
    const text = salesDipAdvice(salesDipWhen(null, now), "Saturday");
    expect(text).toMatch(/^Before the next Saturday:/);
    expect(text).toContain("cannot be said");
    expect(text).not.toMatch(/tonight/i);
  });
});
