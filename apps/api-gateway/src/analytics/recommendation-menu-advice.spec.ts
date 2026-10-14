import { RecommendationsService } from "./recommendations.service";
import { menuEngineeringForRole } from "./analytics.controller";

/**
 * Sim wave 58 (owner weekly review, menu pricing): four rules said more than
 * they had read.
 *
 * - F-1734: "Raise those prices 5–8%" went to plowhorses margin advice calls
 *   on target, says to lower, or a lock holds; and "put one puzzle wine
 *   by-the-glass" to a wine sold only by the glass.
 * - F-1743: weekly_demand_slide gave house-wide advice on one wine's week.
 * - F-1744: spend_acceleration claimed demand it never read, and read a new
 *   house's first month against an empty one.
 */

type Ctx = {
  menu?: any;
  insights?: any[];
  cashflow?: any;
  advice?: any;
  locks?: any;
};

function feed(c: Ctx) {
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
  return new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => c.menu ?? null,
      getSeasonality: async () => null,
      getCashflow: async () => c.cashflow ?? null,
    } as any,
    { generate: async () => ({ insights: c.insights ?? [] }) } as any,
    { listGoals: async () => [] } as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: true,
        problem: null,
      }),
    } as any,
    { supabase, getClient: () => supabase } as any,
    c.advice === undefined
      ? undefined
      : ({ adviseHouse: async () => c.advice } as any),
    c.locks === undefined ? undefined : ({ list: async () => c.locks } as any),
  ).getRecommendations("r-1");
}

const rec = async (c: Ctx, key: string) =>
  (await feed(c)).recommendations.find((r) => r.ruleKey === key);

const horse = (id: string, name: string, extra: any = {}) => ({
  id,
  name,
  quadrant: "plowhorse",
  priceBasis: "bottle",
  ...extra,
});
const kind = (state: string, locked: any = null) => ({
  kind: "bottle",
  state,
  sentence: "…",
  locked,
});
const advice = (wines: Array<[string, any]>) => ({
  target: { set: true, glassPct: null, pourConfirmed: false },
  wines: wines.map(([inventoryId, bottle]) => ({
    inventoryId,
    wineName: inventoryId,
    bottle,
    glass: null,
  })),
  counts: {},
  locks: { readable: true, reason: null, held: 0 },
});
const NO_LOCKS = {
  readable: true,
  locks: [],
  counts: { open: 0, toReview: 0 },
};

describe("plowhorse_repricing reads the house's target and its locks (F-1734)", () => {
  const menu = {
    items: [
      horse("a", "Efes"),
      horse("b", "Barolo"),
      horse("c", "Rioja"),
      horse("d", "Chablis"),
    ],
  };

  it("drops a plowhorse on target, one advised lower and one a lock holds; names the advised raise", async () => {
    const r = await rec(
      {
        menu,
        advice: advice([
          ["a", kind("on_target")],
          ["b", kind("lower")],
          ["c", kind("raise")],
          ["d", kind("raise", { lockId: "l1" })],
        ]),
        locks: NO_LOCKS,
      },
      "plowhorse_repricing",
    );
    // Only Rioja is left: one drink is not a rule's two.
    expect(r).toBeUndefined();
  });

  it("an advised raise is sent to the advice's own price, never a flat 5–8%", async () => {
    const r = await rec(
      {
        menu,
        advice: advice([
          ["a", kind("raise")],
          ["b", kind("raise")],
          ["c", kind("on_target")],
          ["d", kind("lower")],
        ]),
        locks: NO_LOCKS,
      },
      "plowhorse_repricing",
    );
    expect(r?.observation).toMatch(/^2 drinks sell fast/);
    expect(r?.recommendation).toContain(
      "Your price advice already has a raise-to price for Efes, Barolo",
    );
    expect(r?.recommendation).not.toMatch(/5–8%/);
  });

  it("a lock on the drink's price is read from the lock list too", async () => {
    const r = await rec(
      {
        menu: { items: [horse("a", "Efes"), horse("b", "Barolo")] },
        advice: null,
        locks: {
          ...NO_LOCKS,
          locks: [{ inventoryId: "a", kind: "bottle" }],
        },
      },
      "plowhorse_repricing",
    );
    expect(r).toBeUndefined();
  });

  it("with no advice to check against, the general nudge stays", async () => {
    const r = await rec({ menu }, "plowhorse_repricing");
    expect(r?.recommendation).toMatch(/^Raise those prices 5–8%/);
  });

  it("a puzzle sold only by the glass is not sent to the glass list", async () => {
    const puzzles = {
      items: [
        { id: "p1", name: "Narince", quadrant: "puzzle", priceBasis: "glass" },
        { id: "p2", name: "Kalecik", quadrant: "puzzle", priceBasis: "bottle" },
      ],
    };
    expect(await rec({ menu: puzzles }, "puzzle_activation")).toBeUndefined();
    puzzles.items.push({
      id: "p3",
      name: "Öküzgözü",
      quadrant: "puzzle",
      priceBasis: "bottle",
    });
    expect(await rec({ menu: puzzles }, "puzzle_activation")).toBeDefined();
  });
});

describe("weekly_demand_slide is the house's week, not one wine's (F-1743)", () => {
  const insight = (candidateKey: string, effectPct: number) => ({
    candidateKey,
    category: "sales",
    effectPct,
    sentence: "Sales moved.",
    evidence: { unit: "units" },
  });

  it("one wine from 2 bottles to 1 in a week the house rose does not fire it", async () => {
    const r = await rec(
      {
        insights: [
          insight("overall.bottles.vs_prev_period_7d", 0.12),
          insight("wine.bottles.vs_prev_period_7d", -0.5),
        ],
      },
      "weekly_demand_slide",
    );
    expect(r).toBeUndefined();
  });

  it("the house's own week down fires it", async () => {
    const r = await rec(
      { insights: [insight("overall.bottles.vs_prev_period_7d", -0.2)] },
      "weekly_demand_slide",
    );
    expect(r).toBeDefined();
  });
});

describe("spend_acceleration claims no demand it did not read (F-1744)", () => {
  const cashflow = (priorWindowWhole: boolean) => ({
    paceDeltaPct: 0.5,
    spendLast30d: 8300,
    priorWindowWhole,
  });

  it("fires on a whole prior month, and its reasoning names no demand", async () => {
    const r = await rec({ cashflow: cashflow(true) }, "spend_acceleration");
    expect(r).toBeDefined();
    expect(
      `${r?.observation} ${r?.recommendation} ${r?.rationale}`,
    ).not.toMatch(/demand/i);
  });

  it("a house not yet buying for the whole prior 30 days does not read its first month as a rise", async () => {
    expect(
      await rec({ cashflow: cashflow(false) }, "spend_acceleration"),
    ).toBeUndefined();
  });
});

describe("staff are not sent a kind's margin median (F-1735)", () => {
  it("strips the margin from each kind's pair as from the top-level one", () => {
    const out = menuEngineeringForRole(
      {
        medians: { velocityPerDay: null, marginPerBottle: null },
        mediansByKind: [
          { kind: "beer", velocityPerDay: 0.3, marginPerBottle: 7 },
        ],
        items: [],
      },
      "staff",
    );
    expect(out.mediansByKind).toEqual([{ kind: "beer", velocityPerDay: 0.3 }]);
  });
});
