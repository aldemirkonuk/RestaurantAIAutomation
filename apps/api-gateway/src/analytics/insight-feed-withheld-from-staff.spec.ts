/**
 * GET insights/:restaurantId is the feed /reports reads. Staff still read the
 * takings through it ("Monday sales came in 12% lower ... ($450 vs $512)",
 * "sales fell 3% ... ($3.8k vs $3.9k)") while the lenses and the till were
 * withheld (WALK-reports-r106, finding 2). The feed keeps the sentences the
 * role may read and counts the rest, by the rule of #1435 (ADR 0348 decision
 * 3), without carrying that PR.
 *
 * Tests marked [REVERT-FAILS] fail against the controller without the guard.
 */
import "reflect-metadata";
import { AnalyticsController } from "./analytics.controller";
import { INSIGHT_CANDIDATES } from "./insights/insight-catalog";
import { insightClasses } from "./insights/insight-feed-role";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const keyWith = (pred: (k: string) => boolean) =>
  INSIGHT_CANDIDATES.map((c) => c.key).find(pred) as string;
const MONEY = keyWith((k) => (insightClasses(k) ?? []).includes("money"));
const TILL = keyWith(
  (k) =>
    (insightClasses(k) ?? []).includes("sales") &&
    !(insightClasses(k) ?? []).includes("money"),
);
const SERVER = keyWith((k) => (insightClasses(k) ?? []).includes("people"));
const VOLUME = keyWith((k) => (insightClasses(k) ?? []).length === 0);

const row = (candidateKey: string, text: string) => ({ candidateKey, text });
const ROWS = [
  row(MONEY, "Monday sales came in 12% lower than usual ($450 vs $512)"),
  row(TILL, "Saturday had 31 checks, up from 24"),
  row(SERVER, "Ayla's sales ranked first this week"),
  row(VOLUME, "Bottles sold are up 8% on last week"),
  row("custom.not-in-the-catalogue", "A sentence with an unknown type"),
];

function controller() {
  const insightGenerator = {
    readStored: jest.fn().mockResolvedValue({
      read: ROWS.length,
      rows: ROWS.map((r) => ({ candidate_key: r.candidateKey, text: r.text })),
      withheld: { dismissed: 0 },
      suppressionsReadable: true,
    }),
    generate: jest.fn().mockResolvedValue({ source: "live", insights: ROWS }),
  };
  const recommendationActions = {
    viewFor: jest.fn(async (_h: string, _u: string, list: unknown[]) => ({
      kept: list,
      hiddenForYou: 0,
      personalSnoozesReadable: true,
    })),
  };
  const c = Object.create(AnalyticsController.prototype) as AnalyticsController;
  Object.assign(c, { insightGenerator, recommendationActions });
  return { c, insightGenerator };
}

describe("the insight feed is read by role", () => {
  it("fixtures name one money, one till, one server and one volume type", () => {
    expect([MONEY, TILL, SERVER, VOLUME].every(Boolean)).toBe(true);
  });

  it.each([["staff"], [undefined], [null], ["waiter"]])(
    "[REVERT-FAILS] role %p reads no money, till, server or unknown sentence",
    async (role) => {
      const { c } = controller();
      const out: any = await c.getInsights(HOUSE, undefined, undefined, undefined, undefined, {
        userId: "u1",
        role,
      });
      const text = JSON.stringify(out.insights);
      expect(text).not.toMatch(/\$450|\$512|12%|checks|Ayla|unknown type/);
      expect(out.insights).toHaveLength(1);
      expect(out.insights[0].text).toMatch(/Bottles sold/);
      expect(out.withheldForRole).toBe(4);
    },
  );

  it("[REVERT-FAILS] a live compute is cut the same way", async () => {
    const { c } = controller();
    const out: any = await c.getInsights(HOUSE, "true", undefined, undefined, undefined, {
      userId: "u1",
      role: "staff",
    });
    expect(out.insights.map((i: any) => i.candidateKey)).toEqual([VOLUME]);
  });

  it("[REVERT-FAILS] staff naming a money type are not computed for", async () => {
    const { c, insightGenerator } = controller();
    const out: any = await c.getInsights(HOUSE, undefined, undefined, undefined, MONEY, {
      userId: "u1",
      role: "staff",
    });
    expect(out.insights).toEqual([]);
    expect(out.withheldForRole).toBe(1);
    expect(insightGenerator.generate).not.toHaveBeenCalled();
  });

  it.each([["owner"], ["manager"]])("%s reads the whole feed, unmarked", async (role) => {
    const { c } = controller();
    const out: any = await c.getInsights(HOUSE, undefined, undefined, undefined, undefined, {
      userId: "u1",
      role,
    });
    expect(out.insights).toHaveLength(ROWS.length);
    expect(out.withheldForRole).toBeUndefined();
  });
});
