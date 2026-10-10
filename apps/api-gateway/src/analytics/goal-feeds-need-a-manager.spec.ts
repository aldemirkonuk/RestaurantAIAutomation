/**
 * F-814 — the insight feed and the recommendations feed are read by everyone,
 * but a goals-category insight and a `goal_behind_<id>` card name the goal and
 * how far along it is: the figures the goal routes keep for owners and
 * managers (F-299). For any other role those items are left out; the rest of
 * each feed still answers.
 */
import { AnalyticsController } from "./analytics.controller";

const proto = AnalyticsController.prototype as any;
const GOAL_ID = "11111111-2222-3333-4444-555555555555";

const INSIGHTS = [
  {
    candidate_key: "overall.revenue.goal_pace",
    category: "goals",
    headline: "Revenue goal 40% done",
  },
  {
    candidate_key: "overall.revenue.vs_same_weekday",
    category: "sales",
    headline: "Wednesday up",
  },
];

const RECS = [
  {
    ruleKey: `goal_behind_${GOAL_ID}`,
    category: "goals",
    observation: 'Goal "Food cost" is behind',
  },
  {
    ruleKey: "low_margin_items",
    category: "pricing",
    observation: "Two dishes earn little",
  },
];

function insightsSelf() {
  const self = Object.create(AnalyticsController.prototype);
  self.insightGenerator = {
    readStored: async () => ({
      rows: INSIGHTS.map((r) => ({ ...r })),
      read: INSIGHTS.length,
      withheld: { dismissed: 0, snoozed: 0, done: 0 },
      suppressionsReadable: true,
    }),
  };
  self.recommendationActions = {
    viewFor: async (_r: string, _v: string | null, items: any[]) => ({
      kept: items,
      hiddenForYou: 0,
      personalSnoozesReadable: true,
    }),
  };
  return self;
}

function recsSelf() {
  return {
    recommendationsService: {
      getRecommendations: async () => ({
        recommendations: RECS.map((r) => ({ ...r })),
        rulesEvaluated: 2,
      }),
    },
  };
}

describe("GET /analytics/insights — goal insights only for owners and managers (F-814)", () => {
  it.each(["owner", "manager", "Manager "])(
    "%s sees the goal insight",
    async (role) => {
      const out = await insightsSelf().getInsights(
        "r1",
        undefined,
        undefined,
        undefined,
        undefined,
        {
          userId: "u1",
          role,
        },
      );
      expect(out.insights.map((i: any) => i.category)).toEqual([
        "goals",
        "sales",
      ]);
    },
  );

  it.each(["staff", "chef", "admin", null, undefined])(
    "%s gets the feed without the goal insight",
    async (role) => {
      const out = await insightsSelf().getInsights(
        "r1",
        undefined,
        undefined,
        undefined,
        undefined,
        {
          userId: "u1",
          role,
        },
      );
      expect(out.insights.map((i: any) => i.category)).toEqual(["sales"]);
      expect(out.source).toBe("stored");
    },
  );
});

describe("GET /analytics/recommendations — goal cards only for owners and managers (F-814)", () => {
  it.each(["owner", "manager"])("%s sees the goal card", async (role) => {
    const out: any = await proto.getRecommendations.call(
      recsSelf(),
      "r1",
      undefined,
      {
        userId: "u1",
        role,
      },
    );
    expect(out.recommendations.map((r: any) => r.ruleKey)).toEqual([
      `goal_behind_${GOAL_ID}`,
      "low_margin_items",
    ]);
  });

  it.each(["staff", "chef", "admin", undefined])(
    "%s gets the feed without the goal card",
    async (role) => {
      const out: any = await proto.getRecommendations.call(
        recsSelf(),
        "r1",
        undefined,
        {
          userId: "u1",
          role,
        },
      );
      expect(out.recommendations.map((r: any) => r.ruleKey)).toEqual([
        "low_margin_items",
      ]);
      expect(out.rulesEvaluated).toBe(2);
    },
  );
});

/**
 * A goal card an owner or manager dismissed, snoozed or marked done keeps its
 * snapshot — 'Goal "Food cost" is behind its linear pace (NN% done).' — so
 * the tabs, the history and the caller's own snoozes leave it out the same
 * way. An insight put away by category "goals" goes with it.
 */
const PUT_AWAY = [
  {
    ruleKey: `goal_behind_${GOAL_ID}`,
    category: null,
    status: "dismissed",
    observation: 'Goal "Food cost" is behind its linear pace (40% done).',
  },
  {
    ruleKey: "overall.revenue.goal_pace",
    category: "goals",
    status: "done",
    observation: "Revenue goal 40% done",
  },
  {
    ruleKey: "low_margin_items",
    category: "pricing",
    status: "snoozed",
    observation: "Two dishes earn little",
  },
];

function actionsSelf() {
  const rows = () => PUT_AWAY.map((r) => ({ ...r }));
  return {
    recommendationActions: {
      listByStatus: async () => rows(),
      listHistory: async () => rows(),
      listForMe: async () => rows(),
    },
  };
}

const READS: Array<[string, (self: any, user: any) => Promise<any>]> = [
  [
    "GET recommendations/:rid/actions",
    (self, user) =>
      proto.listRecommendationActions.call(self, "r1", "all", user),
  ],
  [
    "GET recommendations/:rid/history",
    (self, user) => proto.recommendationHistory.call(self, "r1", user),
  ],
  [
    "GET recommendations/:rid/snoozed-for-me",
    (self, user) => proto.listSnoozedForMe.call(self, "r1", user),
  ],
];

describe.each(READS)(
  "%s — put-away goal cards only for owners and managers (F-814)",
  (_name, read) => {
    it.each(["owner", "manager"])("%s sees them", async (role) => {
      const out = await read(actionsSelf(), { userId: "u1", role });
      expect(out.items.map((r: any) => r.ruleKey)).toEqual(
        PUT_AWAY.map((r) => r.ruleKey),
      );
    });

    it.each(["staff", "chef", "admin", undefined])(
      "%s gets the rest without them",
      async (role) => {
        const out = await read(actionsSelf(), { userId: "u1", role });
        expect(out.items.map((r: any) => r.ruleKey)).toEqual([
          "low_margin_items",
        ]);
        expect(JSON.stringify(out)).not.toContain("Food cost");
      },
    );
  },
);
