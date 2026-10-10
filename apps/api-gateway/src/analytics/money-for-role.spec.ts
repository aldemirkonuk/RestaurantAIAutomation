import { AnalyticsController } from "./analytics.controller";

/**
 * F-602 and F-603: the reorder register, the insight feed and the
 * recommendations feed carry the house's money only to a reader who holds it
 * (owner, manager; ADR 0145). Driven through the controller, so removing the
 * cut from a route fails here.
 */
const SKU = {
  id: "w1",
  name: "Yakut",
  onHand: 4,
  avgDailyDemand: 0.5,
  reorderPoint: 6,
  stockoutProbability: 0.4,
  abcClass: "A",
  unitCost: 18,
  costBasis: "invoice_lot_wac",
  inventoryValue: 72,
  eoq: 30,
};

const INSIGHTS = {
  source: "stored",
  insights: [
    {
      candidateKey: "sales.dow",
      sentence:
        "This Tuesday's sales were $1.2k, 12% below your average Tuesday.",
      evidence: { unit: "currency" },
    },
    {
      candidateKey: "units.top",
      sentence: "Yakut sold 14 bottles this week, the most of any wine.",
      evidence: { unit: "units" },
    },
    {
      candidateKey: "old.row",
      sentence: "Average check was $48 on Friday.",
      evidence: null,
    },
  ],
};

const RECS = {
  recommendations: [
    {
      ruleKey: "dead_stock_capital",
      observation:
        "$4,800 is locked in inventory that has not moved in 90 days (top: Yakut).",
      recommendation: "Run a by-the-glass feature.",
      rationale: "Cash sits still.",
    },
    {
      ruleKey: "stockout_imminent",
      observation: "Yakut has a 40% chance of stocking out.",
      recommendation: "Place the order today.",
      rationale: "Below its reorder point.",
    },
    {
      ruleKey: "spend_pace",
      observation: "Purchasing spend is up 12% vs the prior 30 days.",
      recommendation: "Check the orders.",
      rationale: "Last month was $9,310 against $8,300.",
    },
  ],
  rulesEvaluated: 3,
};

/** The same entries as the actions table stores them (the snapshot at the act). */
const STORED = RECS.recommendations.map((r) => ({
  ruleKey: r.ruleKey,
  ruleWide: false,
  status: "dismissed",
  observation: r.observation,
  recommendation: r.recommendation,
  category: null,
  urgency: null,
  updatedAt: "2026-10-09T00:00:00Z",
}));

function controller() {
  const analytics = {
    getInventoryScience: jest.fn(async () => ({
      skuCount: 1,
      reorderCount: 1,
      skus: [SKU],
      reorderList: [SKU],
    })),
  };
  const recommendations = { getRecommendations: jest.fn(async () => RECS) };
  const actions = {
    viewFor: jest.fn(async (_r: string, _u: unknown, list: unknown[]) => ({
      kept: list,
      hiddenForYou: 0,
      personalSnoozesReadable: true,
    })),
    listByStatus: jest.fn(async () => STORED),
    setActionAs: jest.fn(async () => ({
      row: STORED[0],
      audit: null,
      history: null,
      noteAudit: null,
      recordedAs: "pinned",
      personal: null,
    })),
    listHistory: jest.fn(async () => STORED),
    listForMe: jest.fn(async () =>
      STORED.map(({ ruleKey, observation, recommendation }) => ({
        ruleKey,
        snoozeUntil: "2026-10-20T00:00:00Z",
        observation,
        recommendation,
        category: null,
        urgency: null,
        updatedAt: null,
      })),
    ),
  };
  const generator = {
    readStored: jest.fn(async () => ({
      rows: INSIGHTS.insights,
      read: 3,
      withheld: { dismissed: 0 },
      suppressionsReadable: true,
    })),
  };
  const c = new AnalyticsController(
    analytics as any,
    {} as any,
    recommendations as any,
    actions as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    generator as any,
    {} as any,
    {} as any,
  );
  return c;
}

describe("the analytics reads staff can call carry no house money (F-602, F-603)", () => {
  it.each(["staff", "viewer", undefined])(
    "%s reads the reorder register without cost, value or order quantity",
    async (role) => {
      const out: any = await controller().getInventoryScience(
        "r1",
        undefined,
        undefined,
        { role },
      );
      expect(out.amountsWithheld).toBe(true);
      for (const s of [...out.skus, ...out.reorderList]) {
        expect(s).not.toHaveProperty("unitCost");
        expect(s).not.toHaveProperty("inventoryValue");
        expect(s).not.toHaveProperty("eoq");
        expect(s).toMatchObject({
          onHand: 4,
          reorderPoint: 6,
          stockoutProbability: 0.4,
          abcClass: "A",
        });
      }
    },
  );

  it.each(["owner", "manager"])(
    "a %s reads the whole register",
    async (role) => {
      const out: any = await controller().getInventoryScience(
        "r1",
        undefined,
        undefined,
        { role },
      );
      expect(out.amountsWithheld).toBeUndefined();
      expect(out.skus[0]).toMatchObject({
        unitCost: 18,
        inventoryValue: 72,
        eoq: 30,
      });
    },
  );

  it("staff read the insight cards that state no amount, and are told how many were left out", async () => {
    const out: any = await controller().getInsights(
      "r1",
      undefined,
      undefined,
      undefined,
      undefined,
      { userId: "u1", role: "staff" },
    );
    expect(out.insights.map((i: any) => i.candidateKey)).toEqual(["units.top"]);
    expect(out.withheldForYourRole).toBe(2);
    expect(JSON.stringify(out.insights)).not.toMatch(/\$\d/);
  });

  it("an owner reads every insight card", async () => {
    const out: any = await controller().getInsights(
      "r1",
      undefined,
      undefined,
      undefined,
      undefined,
      { userId: "u1", role: "owner" },
    );
    expect(out.insights).toHaveLength(3);
    expect(out.withheldForYourRole).toBeUndefined();
  });

  it("staff read the recommendations that state no amount, wherever the amount sits in the entry", async () => {
    const out: any = await controller().getRecommendations("r1", undefined, {
      userId: "u1",
      role: "staff",
    });
    expect(out.recommendations.map((r: any) => r.ruleKey)).toEqual([
      "stockout_imminent",
    ]);
    expect(out.withheldForYourRole).toBe(2);
    expect(out.rulesEvaluated).toBe(3);
  });

  it("a manager reads every recommendation", async () => {
    const out: any = await controller().getRecommendations("r1", undefined, {
      userId: "u1",
      role: "manager",
    });
    expect(out.recommendations).toHaveLength(3);
    expect(out.withheldForYourRole).toBeUndefined();
  });

  // The Snoozed / Dismissed / Done tabs, the history and the caller's own
  // snoozes read the stored words of the same entries: the feed's cut must
  // hold on each of them, or a staff member refused a card reads it there.
  const storedRoutes: Array<
    [string, (c: AnalyticsController, user: any) => Promise<any>]
  > = [
    [
      "GET /actions?status=all",
      (c, u) => c.listRecommendationActions("r1", "all", u),
    ],
    [
      "GET /actions?status=dismissed",
      (c, u) => c.listRecommendationActions("r1", "dismissed", u),
    ],
    ["GET /history", (c, u) => c.recommendationHistory("r1", u)],
    ["GET /snoozed-for-me", (c, u) => c.listSnoozedForMe("r1", u)],
  ];

  it.each(storedRoutes)(
    "staff read %s without the amounts in the stored words",
    async (_name, call) => {
      const out = await call(controller(), { userId: "u1", role: "staff" });
      expect(JSON.stringify(out)).not.toMatch(/[$€£₺¥]\s?\d/);
      expect(out.items.map((r: any) => r.ruleKey)).toEqual([
        "dead_stock_capital",
        "stockout_imminent",
        "spend_pace",
      ]);
      expect(out.items[0]).toMatchObject({
        observation: null,
        recommendation: null,
        withheldForYourRole: true,
      });
      expect(out.items[1]).toMatchObject({
        observation: "Yakut has a 40% chance of stocking out.",
      });
      expect(out.items[1].withheldForYourRole).toBeUndefined();
      expect(out.withheldForYourRole).toBe(1);
    },
  );

  it.each(storedRoutes)("an owner reads %s whole", async (_name, call) => {
    const out = await call(controller(), { userId: "u1", role: "owner" });
    expect(out.items[0].observation).toMatch(/\$4,800/);
    expect(out.withheldForYourRole).toBeUndefined();
  });

  it("staff pinning a card do not read its amounts back in the answer", async () => {
    const out: any = await controller().setRecommendationAction(
      "r1",
      { ruleKey: "dead_stock_capital", pinned: true } as any,
      { userId: "u1", role: "staff" },
    );
    expect(out).toMatchObject({
      ruleKey: "dead_stock_capital",
      observation: null,
      recommendation: null,
      withheldForYourRole: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/[$€£₺¥]\s?\d/);
  });

  it("a manager pinning a card reads it whole", async () => {
    const out: any = await controller().setRecommendationAction(
      "r1",
      { ruleKey: "dead_stock_capital", pinned: true } as any,
      { userId: "u1", role: "manager" },
    );
    expect(out.observation).toMatch(/\$4,800/);
  });
});

/**
 * F-863: the house's money does not always carry a sign. en-US prints a lira
 * figure as "TRY 12,400", a German house puts the sign after ("12.400 €"),
 * and a house with no recorded currency prints a bare "12,400". Whether an
 * entry says money is read from the entry — the engine's `amounts` tag, the
 * stored act's rule — not from a glyph.
 */
describe("staff read no house money in a lira house or one with no currency (F-863)", () => {
  const recsIn = (deadStock: string, spend: string) => ({
    recommendations: [
      {
        ruleKey: "dead_stock_capital",
        amounts: true,
        observation: `${deadStock} is locked in inventory that has not moved in 90 days (top: Yakut).`,
        recommendation: "Run a by-the-glass feature.",
        rationale: "Cash sits still.",
      },
      {
        ruleKey: "stockout_imminent",
        observation: "Yakut has a 40% chance of stocking out.",
        recommendation: "Place the order today.",
        rationale: "Below its reorder point.",
      },
      {
        ruleKey: "spend_acceleration",
        amounts: true,
        observation: `Purchasing spend is up 50% vs the prior 30 days (${spend}).`,
        recommendation: "Check the orders.",
        rationale: "Spend outruns demand.",
      },
    ],
    rulesEvaluated: 3,
  });
  const houses: Array<[string, string, string]> = [
    ["TRY", "TRY 12,400", "TRY 8,300"],
    ["no currency", "12,400", "8,300"],
  ];

  function over(feed: unknown, stored: unknown[]) {
    const c = controller() as any;
    c.recommendationsService.getRecommendations = jest.fn(async () => feed);
    c.recommendationActions.listByStatus = jest.fn(async () => stored);
    c.recommendationActions.listHistory = jest.fn(async () => stored);
    return c as AnalyticsController;
  }

  it.each(houses)(
    "%s: staff read the feed without the cards that print an amount",
    async (_h, dead, spend) => {
      const out: any = await over(recsIn(dead, spend), []).getRecommendations(
        "r1",
        undefined,
        { userId: "u1", role: "staff" },
      );
      expect(out.recommendations.map((r: any) => r.ruleKey)).toEqual([
        "stockout_imminent",
      ]);
      expect(out.withheldForYourRole).toBe(2);
    },
  );

  it.each(houses)("%s: an owner reads every card", async (_h, dead, spend) => {
    const out: any = await over(recsIn(dead, spend), []).getRecommendations(
      "r1",
      undefined,
      { userId: "u1", role: "owner" },
    );
    expect(out.recommendations).toHaveLength(3);
  });

  it.each(houses)(
    "%s: staff read the stored acts without their amounts",
    async (_h, dead, spend) => {
      // Stored acts carry the words, and a key that may name the period it fired in.
      const stored = recsIn(dead, spend).recommendations.map((r, i) => ({
        ruleKey: i === 0 ? `${r.ruleKey}#*#p30:2026-10` : r.ruleKey,
        ruleWide: false,
        status: "dismissed",
        observation: r.observation,
        recommendation: r.recommendation,
        category: null,
        urgency: null,
        updatedAt: "2026-10-09T00:00:00Z",
      }));
      const c = over(recsIn(dead, spend), stored);
      for (const out of [
        await c.listRecommendationActions("r1", "all", {
          userId: "u1",
          role: "staff",
        }),
        await c.recommendationHistory("r1", { userId: "u1", role: "staff" }),
      ] as any[]) {
        expect(JSON.stringify(out)).not.toContain(dead);
        expect(JSON.stringify(out)).not.toContain(spend);
        expect(out.items[1]).toMatchObject({
          observation: "Yakut has a 40% chance of stocking out.",
        });
        expect(out.withheldForYourRole).toBe(2);
      }
    },
  );

  it("staff read no insight sentence with a code or a trailing sign beside a figure, even unmarked", async () => {
    const c = controller() as any;
    c.insightGenerator.readStored = jest.fn(async () => ({
      rows: [
        {
          candidateKey: "old.try",
          sentence: "Average check was TRY 1.2k on Friday.",
          evidence: null,
        },
        {
          candidateKey: "old.eur",
          sentence: "Sales came in at 12.400 € on Friday.",
          evidence: null,
        },
        {
          candidateKey: "label",
          sentence: "Rioja DOC 2019 sold 6 bottles this week.",
          evidence: null,
        },
      ],
      read: 3,
      withheld: { dismissed: 0 },
      suppressionsReadable: true,
    }));
    const out: any = await c.getInsights(
      "r1",
      undefined,
      undefined,
      undefined,
      undefined,
      { userId: "u1", role: "staff" },
    );
    expect(out.insights.map((i: any) => i.candidateKey)).toEqual(["label"]);
    expect(out.withheldForYourRole).toBe(2);
  });
});
