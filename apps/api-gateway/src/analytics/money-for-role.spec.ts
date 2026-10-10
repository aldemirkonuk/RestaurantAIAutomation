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
    { candidateKey: "sales.dow", sentence: "This Tuesday's sales were $1.2k, 12% below your average Tuesday.", evidence: { unit: "currency" } },
    { candidateKey: "units.top", sentence: "Yakut sold 14 bottles this week, the most of any wine.", evidence: { unit: "units" } },
    { candidateKey: "old.row", sentence: "Average check was $48 on Friday.", evidence: null },
  ],
};

const RECS = {
  recommendations: [
    { ruleKey: "dead_stock_capital", observation: "$4,800 is locked in inventory that has not moved in 90 days (top: Yakut).", recommendation: "Run a by-the-glass feature.", rationale: "Cash sits still." },
    { ruleKey: "stockout_imminent", observation: "Yakut has a 40% chance of stocking out.", recommendation: "Place the order today.", rationale: "Below its reorder point." },
    { ruleKey: "spend_pace", observation: "Purchasing spend is up 12% vs the prior 30 days.", recommendation: "Check the orders.", rationale: "Last month was $9,310 against $8,300." },
  ],
  rulesEvaluated: 3,
};

function controller() {
  const analytics = {
    getInventoryScience: jest.fn(async () => ({ skuCount: 1, reorderCount: 1, skus: [SKU], reorderList: [SKU] })),
  };
  const recommendations = { getRecommendations: jest.fn(async () => RECS) };
  const actions = {
    viewFor: jest.fn(async (_r: string, _u: unknown, list: unknown[]) => ({ kept: list, hiddenForYou: 0, personalSnoozesReadable: true })),
  };
  const generator = { readStored: jest.fn(async () => ({ rows: INSIGHTS.insights, read: 3, withheld: { dismissed: 0 }, suppressionsReadable: true })) };
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
  it.each(["staff", "viewer", undefined])("%s reads the reorder register without cost, value or order quantity", async (role) => {
    const out: any = await controller().getInventoryScience("r1", undefined, undefined, { role });
    expect(out.amountsWithheld).toBe(true);
    for (const s of [...out.skus, ...out.reorderList]) {
      expect(s).not.toHaveProperty("unitCost");
      expect(s).not.toHaveProperty("inventoryValue");
      expect(s).not.toHaveProperty("eoq");
      expect(s).toMatchObject({ onHand: 4, reorderPoint: 6, stockoutProbability: 0.4, abcClass: "A" });
    }
  });

  it.each(["owner", "manager"])("a %s reads the whole register", async (role) => {
    const out: any = await controller().getInventoryScience("r1", undefined, undefined, { role });
    expect(out.amountsWithheld).toBeUndefined();
    expect(out.skus[0]).toMatchObject({ unitCost: 18, inventoryValue: 72, eoq: 30 });
  });

  it("staff read the insight cards that state no amount, and are told how many were left out", async () => {
    const out: any = await controller().getInsights("r1", undefined, undefined, undefined, undefined, { userId: "u1", role: "staff" });
    expect(out.insights.map((i: any) => i.candidateKey)).toEqual(["units.top"]);
    expect(out.withheldForYourRole).toBe(2);
    expect(JSON.stringify(out.insights)).not.toMatch(/\$\d/);
  });

  it("an owner reads every insight card", async () => {
    const out: any = await controller().getInsights("r1", undefined, undefined, undefined, undefined, { userId: "u1", role: "owner" });
    expect(out.insights).toHaveLength(3);
    expect(out.withheldForYourRole).toBeUndefined();
  });

  it("staff read the recommendations that state no amount, wherever the amount sits in the entry", async () => {
    const out: any = await controller().getRecommendations("r1", undefined, { userId: "u1", role: "staff" });
    expect(out.recommendations.map((r: any) => r.ruleKey)).toEqual(["stockout_imminent"]);
    expect(out.withheldForYourRole).toBe(2);
    expect(out.rulesEvaluated).toBe(3);
  });

  it("a manager reads every recommendation", async () => {
    const out: any = await controller().getRecommendations("r1", undefined, { userId: "u1", role: "manager" });
    expect(out.recommendations).toHaveLength(3);
    expect(out.withheldForYourRole).toBeUndefined();
  });
});
