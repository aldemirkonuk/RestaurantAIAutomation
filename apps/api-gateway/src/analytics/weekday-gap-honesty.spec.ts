/**
 * F-709: "X is reliably your strongest day" is printed only when the
 * seasonality read says the two days stand apart (`separated`); otherwise the
 * card says the day has tended to be the strongest.
 */
import { RecommendationsService } from "./recommendations.service";
import { personalBookFrom, personalView } from "./insights/item-state";

function feed(seasonality: Record<string, unknown>) {
  const supabase = {
    from: () => {
      const b: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"])
        b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return b;
    },
  };
  const actions = {
    readDispositions: async () => ({
      map: new Map(),
      readable: true,
      problem: null,
    }),
    viewFor: async (
      _rid: string,
      _viewer: string | null,
      items: any[],
      targetOf: any,
    ) => ({
      ...personalView(items, targetOf, personalBookFrom([])),
      personalSnoozesReadable: true,
    }),
  };
  return new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => seasonality,
      getCashflow: async () => null,
    } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
    actions as any,
    { supabase, getClient: () => supabase } as any,
  );
}

const observationOf = async (seasonality: Record<string, unknown>) => {
  const out = await feed(seasonality).getRecommendations("r1");
  return out.recommendations.find((r: any) => r.ruleKey === "weekday_gap")
    ?.observation;
};

describe("weekday_gap says 'reliably' only when the days stand apart", () => {
  it("a gap the data cannot separate is a tendency, not 'reliably'", async () => {
    const s = await observationOf({
      bestDay: "Friday",
      worstDay: "Tuesday",
      separated: false,
    });
    expect(s).toBeDefined();
    expect(s).not.toContain("reliably");
    expect(s).toContain("Friday has tended to be your strongest day");
  });

  it("a separated gap keeps the firm sentence", async () => {
    const s = await observationOf({
      bestDay: "Friday",
      worstDay: "Tuesday",
      separated: true,
    });
    expect(s).toBe(
      "Friday is reliably your strongest day; Tuesday the weakest.",
    );
  });
});
