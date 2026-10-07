import { Logger } from "@nestjs/common";
import { RecommendationsService } from "./recommendations.service";
import {
  HISTORY_LIST_ROWS,
  RecommendationActionRow,
  RecommendationActionsService,
} from "./recommendation-actions.service";
import { buildSuppressionKey } from "./insights/suppression";
import { WholeReadError } from "../common/read-whole-window";
import { AnalyticsController } from "./analytics.controller";

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
  /** Any other state rows — snoozed (with an instant) or done. */
  rows?: Array<{
    key: string;
    status: "snoozed" | "done" | "active";
    snoozeUntil?: string | null;
  }>;
  dispositionsReadable?: boolean;
  impressions?: Record<string, string>;
}) {
  const map = new Map<string, RecommendationActionRow>();
  for (const r of opts.rows ?? [])
    map.set(r.key, {
      ruleKey: r.key,
      ruleWide: false,
      status: r.status,
      reason: null,
      snoozeUntil: r.snoozeUntil ?? null,
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
  for (const key of opts.dismissed ?? [])
    map.set(key, {
      ruleKey: key,
      ruleWide: false,
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
    // OPS-02: the leaf counts of an unread book are not counts. Zero
    // snoozed, dismissed and done would read as a house that never acted.
    expect(out.stateCounts).toBeNull();
  });
});

/**
 * The ONE shared per-item state on the feed (ADR 0191; founder, 2026-09-21:
 * "Build it right, in order"). The feed read snooze and done off the rule's
 * bare row only, so a snooze or a done written at the finding's own key —
 * the key the generator, Reports and the rails resolve — did nothing here.
 */
describe("snooze and done hold on the feed at the scope they were written", () => {
  const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const EARLIER = new Date(Date.now() - 60_000).toISOString();
  const finding = buildSuppressionKey(keysFor(), "insight");

  it("a snooze on this finding hides it, and the entry reads snoozed", async () => {
    const { svc } = makeService({
      rows: [{ key: finding, status: "snoozed", snoozeUntil: LATER }],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(
      WEEKDAY_RULE,
    );
    const all = await svc.getRecommendations(RID, { includeHidden: true });
    const entry = all.recommendations.find((r) => r.ruleKey === WEEKDAY_RULE)!;
    expect(entry.status).toBe("snoozed");
    expect(entry.snoozeUntil).toBe(LATER);
    expect(out.stateCounts.snoozed).toBe(1);
    expect(out.stateCounts.active).toBe(0);
    // A snooze is not a dismissal.
    expect(out.suppressed).toBe(0);
  });

  it("an elapsed snooze is back on the book", async () => {
    // `readDispositions` reports an elapsed snooze as active; the resolver
    // must not hide it either way.
    const { svc } = makeService({
      rows: [{ key: finding, status: "snoozed", snoozeUntil: EARLIER }],
    });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(WEEKDAY_RULE);
  });

  it("done on this finding hides it; next week's finding is another item", async () => {
    const { svc } = makeService({ rows: [{ key: finding, status: "done" }] });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(
      WEEKDAY_RULE,
    );
    expect(out.stateCounts.done).toBe(1);

    const other = makeService({
      rows: [
        {
          key: buildSuppressionKey(keysFor("d:2026-08-26"), "insight"),
          status: "done",
        },
      ],
    });
    const stands = await other.svc.getRecommendations(RID);
    expect(stands.recommendations.map((r) => r.ruleKey)).toContain(
      WEEKDAY_RULE,
    );
  });

  it("a scoped row for another subject is counted on its own leaf, once", async () => {
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
    expect(out.stateCounts.active).toBe(1);
    expect(out.stateCounts.dismissed).toBe(1);
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

/**
 * OPS-02 (scenario walk 2026-10-07): the house's recommendation book stopped
 * at PostgREST's `max_rows` and said nothing.
 *
 * `recommendation_actions` keeps one row per key a house ever acted on, and
 * nothing prunes it. `readDispositions` selected every row with no range,
 * count or order, so past 1,000 rows the database answered an arbitrary 1,000
 * of them under `readable: true`: dismissed and done entries stood again and
 * the leaf counts ran low. `listByStatus` stopped at the newest 1,000, and
 * History cut at 200 without saying so.
 *
 * The double below is PostgREST as far as these reads use it: every response
 * is cut at `cap` (max_rows) whatever was asked, `count: "exact"` is the size
 * of the filtered set before the limit, and `.gt("id", …)` is honoured, so a
 * later page's count is what lies past its cursor. Each case here was RED
 * against origin/main ca3582988's service before the fix.
 */

type Row = Record<string, any>;

interface Behaviour {
  cap?: number;
  /** 1-based request numbers that answer with an error. */
  failOn?: number[];
  /** Never report a count. */
  noCount?: boolean;
}

function fakeDb(rows: Row[], behave: Behaviour = {}) {
  const cap = behave.cap ?? 1000;
  const requests: Array<{ limit?: number; gt?: string; count?: string }> = [];
  const client = {
    from(table: string) {
      if (table !== "recommendation_actions")
        throw new Error(`unexpected table ${table}`);
      const eqs: Array<[string, unknown]> = [];
      const orders: Array<[string, boolean]> = [];
      let orFilter: string | null = null;
      let gt: string | null = null;
      let limit: number | null = null;
      let countMode: string | undefined;
      const b: any = {
        select(_cols: string, opts?: { count?: string }) {
          countMode = opts?.count;
          return b;
        },
        eq(col: string, val: unknown) {
          eqs.push([col, val]);
          return b;
        },
        or(expr: string) {
          orFilter = expr;
          return b;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orders.push([col, opts?.ascending !== false]);
          return b;
        },
        gt(col: string, val: string) {
          if (col !== "id") throw new Error("gt only on id here");
          gt = val;
          return b;
        },
        limit(n: number) {
          limit = n;
          return b;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          requests.push({ limit: limit ?? undefined, gt: gt ?? undefined, count: countMode });
          const n = requests.length;
          if (behave.failOn?.includes(n))
            return Promise.resolve({
              data: null,
              error: { message: "canceling statement due to statement timeout", code: "57014" },
              count: null,
            }).then(resolve, reject);
          let set = rows.filter((r) => eqs.every(([c, v]) => String(r[c]) === String(v)));
          if (orFilter === "status.in.(dismissed,done),acted_at.not.is.null")
            set = set.filter(
              (r) => r.status === "dismissed" || r.status === "done" || r.acted_at != null,
            );
          else if (orFilter) throw new Error(`unexpected or(${orFilter})`);
          if (gt !== null) set = set.filter((r) => String(r.id) > (gt as string));
          if (orders.length > 0)
            set = [...set].sort((a, c) => {
              for (const [col, asc] of orders) {
                const x = String(a[col]);
                const y = String(c[col]);
                if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
              }
              return 0;
            });
          const count =
            countMode === "exact" && !behave.noCount ? set.length : null;
          const take = Math.min(limit ?? Number.POSITIVE_INFINITY, cap);
          return Promise.resolve({
            data: set.slice(0, take),
            error: null,
            count,
          }).then(resolve, reject);
        },
      };
      return b;
    },
  };
  return { db: { getClient: () => client } as any, requests };
}

const pad = (i: number) => String(i).padStart(5, "0");
/** One minute apart, oldest first, so `updated_at` and `id` agree on order. */
const at = (i: number) =>
  new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();

function row(i: number, over: Row = {}): Row {
  return {
    id: `id-${pad(i)}`,
    restaurant_id: RID,
    rule_key: `rule_${i}#*#d:2026-01-01`,
    status: "done",
    reason: null,
    snooze_until: null,
    pinned: false,
    acted_at: null,
    updated_at: at(i),
    ...over,
  };
}

describe("the house's recommendation book past PostgREST max_rows (OPS-02)", () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterAll(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  describe("readDispositions reads the house's whole book (OPS-02)", () => {
    // 1,500 rows; the dismissal that matters sits past the first 1,000.
    const BOOK = Array.from({ length: 1500 }, (_, i) =>
      i === 1400
        ? row(i, { status: "dismissed", reason: "not_relevant" })
        : row(i),
    );

    it("holds a dismissal past the 1,000th row, in two keyset pages", async () => {
      const { db, requests } = fakeDb(BOOK);
      const out = await new RecommendationActionsService(db).readDispositions(RID);
      expect(out.readable).toBe(true);
      expect(out.map.size).toBe(1500);
      expect(out.map.get("rule_1400#*#d:2026-01-01")?.status).toBe("dismissed");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ limit: 1000, count: "exact" });
      expect(requests[1]).toMatchObject({ gt: "id-00999", count: "exact" });
    });

    it("the suppression list carries that dismissal too", async () => {
      const { db } = fakeDb(BOOK);
      const out = await new RecommendationActionsService(db).listSuppressions(RID);
      expect(out.readable).toBe(true);
      expect(out.keys.has("rule_1400#*#d:2026-01-01")).toBe(true);
    });

    it("a page that fails mid-book answers readable: false, never the first 1,000", async () => {
      const { db } = fakeDb(BOOK, { failOn: [2] });
      const out = await new RecommendationActionsService(db).readDispositions(RID);
      expect(out.readable).toBe(false);
      expect(out.map.size).toBe(0);
      expect(out.problem).toMatch(/could not be read whole/);
    });
  });

  describe("listByStatus lists the whole leaf, newest first (OPS-02)", () => {
    const LEAF = Array.from({ length: 1200 }, (_, i) =>
      row(i, { status: "dismissed", reason: "not_relevant" }),
    ).concat(Array.from({ length: 300 }, (_, i) => row(2000 + i, { status: "done" })));

    it("returns every one of 1,200 dismissed rows, newest first", async () => {
      const { db, requests } = fakeDb(LEAF);
      const items = await new RecommendationActionsService(db).listByStatus(
        RID,
        "dismissed",
      );
      expect(items).toHaveLength(1200);
      expect(items[0].ruleKey).toBe("rule_1199#*#d:2026-01-01");
      expect(items[1199].ruleKey).toBe("rule_0#*#d:2026-01-01");
      expect(items.every((r) => r.status === "dismissed")).toBe(true);
      expect(requests.length).toBeGreaterThanOrEqual(2);
    });

    it("refuses with WholeReadError when a page fails, rather than listing part of the leaf", async () => {
      const { db } = fakeDb(LEAF, { failOn: [2] });
      await expect(
        new RecommendationActionsService(db).listByStatus(RID, "dismissed"),
      ).rejects.toBeInstanceOf(WholeReadError);
    });
  });

  describe("listHistory says when it is the newest 200, not the history (OPS-02)", () => {
    it("1,234 acted rows: 200 shown, total 1,234, capped", async () => {
      const BOOK = Array.from({ length: 1234 }, (_, i) => row(i));
      const { db } = fakeDb(BOOK);
      const out = await new RecommendationActionsService(db).listHistory(RID);
      expect(HISTORY_LIST_ROWS).toBe(200);
      expect(out.items).toHaveLength(200);
      expect(out.total).toBe(1234);
      expect(out.capped).toBe(true);
      expect(out.limit).toBe(200);
      expect(out.items[0].ruleKey).toBe("rule_1233#*#d:2026-01-01");
    });

    it("50 acted rows: all shown, not capped", async () => {
      const BOOK = Array.from({ length: 50 }, (_, i) => row(i));
      const { db } = fakeDb(BOOK);
      const out = await new RecommendationActionsService(db).listHistory(RID);
      expect(out.items).toHaveLength(50);
      expect(out.total).toBe(50);
      expect(out.capped).toBe(false);
    });

    it("no count reported and a full window: capped, total null", async () => {
      const BOOK = Array.from({ length: 300 }, (_, i) => row(i));
      const { db } = fakeDb(BOOK, { noCount: true });
      const out = await new RecommendationActionsService(db).listHistory(RID);
      expect(out.items).toHaveLength(200);
      expect(out.total).toBeNull();
      expect(out.capped).toBe(true);
    });
  });

  describe("GET recommendations/:id/history carries the window to the page (OPS-02)", () => {
    it("answers { items, total, capped, limit }, not items alone", async () => {
      const BOOK = Array.from({ length: 1234 }, (_, i) => row(i));
      const { db } = fakeDb(BOOK);
      const self = { recommendationActions: new RecommendationActionsService(db) };
      const proto = AnalyticsController.prototype as unknown as Record<string, any>;
      const body = await proto.recommendationHistory.call(self, RID);
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(200);
      expect(body).toMatchObject({ total: 1234, capped: true, limit: 200 });
    });
  });
});
