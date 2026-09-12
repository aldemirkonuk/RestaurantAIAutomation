import { RecommendationsService } from "./recommendations.service";
import { RecommendationActionRow } from "./recommendation-actions.service";
import { buildSuppressionKey } from "./insights/suppression";

/**
 * The feed's half of "if the person says dismiss, it should be avoided at all
 * costs" — plus the end of the em dash under "Standing".
 *
 * Two defects are pinned here:
 *
 *  1. `dismiss` wrote `status='dismissed'` against a BARE rule key, and the
 *     feed filtered on `status === 'active'`. That worked, and only that
 *     worked: it was the widest scope in the system with nothing on screen
 *     saying so, and it could not express "this Wednesday" at all.
 *  2. "How long has this stood" rendered as an em dash on every untouched
 *     entry, while `recommendation_impressions` had been recording the answer
 *     since 2026-08-17 and nothing read it.
 */

const RID = "r-1";
const WEEKDAY_RULE = "sales_below_weekday_baseline";
const PERIOD = "d:2026-09-02";

function insight(over: Partial<Record<string, unknown>> = {}) {
  return {
    candidateKey: "overall.revenue.vs_same_weekday",
    category: "sales",
    sentence:
      "Wednesday sales came in 40% lower than your average Wednesday ($600 vs $1.0k, over 12 past Wednesdays).",
    score: 2,
    effectPct: -0.4,
    z: -2,
    entityKey: "Wednesday",
    entityLabel: "Wednesday",
    evidence: {},
    subject: "Wednesday",
    periodKey: PERIOD,
    periodStart: null,
    periodEnd: null,
    ...over,
  };
}

function makeService(opts: {
  dismissed?: string[];
  dispositionsReadable?: boolean;
  impressions?: Record<string, string>;
}) {
  const map = new Map<string, RecommendationActionRow>();
  for (const key of opts.dismissed ?? [])
    map.set(key, {
      ruleKey: key,
      status: "dismissed",
      reason: "not_relevant",
      snoozeUntil: null,
      pinned: false,
      actedAt: null,
      feedback: null,
      assignedTo: null,
      assignedName: null,
      assignedAt: null,
      observation: null,
      recommendation: null,
      category: null,
      urgency: null,
      updatedAt: "2026-09-02T10:00:00.000Z",
    });

  const impressionQueries: string[] = [];
  const supabase = {
    from: (table: string) => {
      const builder: any = {};
      let ruleKey = "";
      for (const m of ["select", "order", "limit", "insert"])
        builder[m] = () => builder;
      builder.eq = (col: string, val: string) => {
        if (col === "rule_key") ruleKey = val;
        return builder;
      };
      builder.then = (resolve: any, reject: any) => {
        if (table === "recommendation_impressions" && ruleKey) {
          impressionQueries.push(ruleKey);
          const at = opts.impressions?.[ruleKey];
          return Promise.resolve({
            data: at ? [{ shown_at: at }] : [],
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      };
      return builder;
    },
  };

  const svc = new RecommendationsService(
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
    { generate: async () => ({ insights: [insight()] }) } as any,
    { listGoals: async () => [] } as any,
    {
      readDispositions: async () => ({
        map,
        readable: opts.dispositionsReadable ?? true,
        problem: null,
      }),
    } as any,
    { supabase, getClient: () => supabase } as any,
  );
  return { svc, impressionQueries };
}

const keysFor = (periodKey: string | null = PERIOD) => ({
  ruleId: WEEKDAY_RULE,
  subject: "Wednesday",
  periodKey,
});

describe("a dismissal the feed honours, at the scope it was made", () => {
  it("stands when nothing has been dismissed", async () => {
    const { svc } = makeService({});
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(WEEKDAY_RULE);
    expect(out.suppressed).toBe(0);
    expect(out.suppressionsReadable).toBe(true);
  });

  it("carries the three scope keys, and the scope its default key really has", async () => {
    const { svc } = makeService({});
    const out = await svc.getRecommendations(RID);
    const entry = out.recommendations.find((r) => r.ruleKey === WEEKDAY_RULE)!;
    expect(entry.suppression).toEqual({
      key: `${WEEKDAY_RULE}#wednesday#${PERIOD}`,
      scope: "insight",
      keys: {
        insight: `${WEEKDAY_RULE}#wednesday#${PERIOD}`,
        subject: `${WEEKDAY_RULE}#wednesday#*`,
        rule: WEEKDAY_RULE,
      },
    });
  });

  it("this exact finding: gone, and counted", async () => {
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor(), "insight")],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(
      WEEKDAY_RULE,
    );
    expect(out.suppressed).toBe(1);
  });

  it("this exact finding: another period is untouched", async () => {
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor("d:2026-08-26"), "insight")],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(WEEKDAY_RULE);
    expect(out.suppressed).toBe(0);
  });

  it("this rule for this subject: gone whatever the period", async () => {
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor(), "subject")],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(
      WEEKDAY_RULE,
    );
  });

  it("this rule for another subject: untouched", async () => {
    const { svc } = makeService({
      dismissed: [
        buildSuppressionKey(
          { ruleId: WEEKDAY_RULE, subject: "Friday" },
          "subject",
        ),
      ],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(WEEKDAY_RULE);
  });

  it("this rule entirely: gone", async () => {
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor(), "rule")],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(
      WEEKDAY_RULE,
    );
  });

  it("a bare key written before scopes existed still silences the rule", async () => {
    const { svc } = makeService({ dismissed: [WEEKDAY_RULE] });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(
      WEEKDAY_RULE,
    );
  });

  it("a dismissal of some other rule silences nothing", async () => {
    const { svc } = makeService({ dismissed: ["dead_stock_capital"] });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(WEEKDAY_RULE);
    expect(out.suppressed).toBe(0);
  });

  it("includeHidden still returns suppressed entries, for the dismissed leaf", async () => {
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor(), "insight")],
    });
    const out = await svc.getRecommendations(RID, { includeHidden: true });
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(WEEKDAY_RULE);
    // …and the count still reports what WOULD have been withheld.
    expect(out.suppressed).toBe(1);
  });

  it("the Standing count agrees with the book it is counting", async () => {
    // A scoped suppression leaves the entry's OWN row absent, so its `status`
    // still reads "active". Counting it there printed "1 standing" over an
    // empty list — the leaf tab and the book disagreeing about one fact.
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor(), "insight")],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations).toHaveLength(0);
    expect(out.stateCounts.active).toBe(0);
    expect(out.stateCounts.dismissed).toBe(1);
  });

  it("counts a scoped dismissal once, not twice", async () => {
    const { svc } = makeService({
      dismissed: [buildSuppressionKey(keysFor(), "subject")],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.stateCounts.dismissed).toBe(1);
  });

  it("says when the dismissal store could not be read", async () => {
    const { svc } = makeService({ dispositionsReadable: false });
    const out = await svc.getRecommendations(RID);
    expect(out.suppressionsReadable).toBe(false);
  });
});

describe("standing — the first time a rule was ever shown", () => {
  it("comes from the impressions log, not from the disposition row", async () => {
    const { svc, impressionQueries } = makeService({
      impressions: { [WEEKDAY_RULE]: "2026-08-20T19:04:00.000Z" },
    });
    const out = await svc.getRecommendations(RID);
    const entry = out.recommendations.find((r) => r.ruleKey === WEEKDAY_RULE)!;
    expect(entry.firstSeenAt).toBe("2026-08-20T19:04:00.000Z");
    expect(impressionQueries).toContain(WEEKDAY_RULE);
  });

  it("stays null — an em dash on the page — when nothing recorded it", async () => {
    const { svc } = makeService({});
    const out = await svc.getRecommendations(RID);
    const entry = out.recommendations.find((r) => r.ruleKey === WEEKDAY_RULE)!;
    expect(entry.firstSeenAt).toBeNull();
  });
});
