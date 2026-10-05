import { AnalyticsService } from "./analytics.service";
import { RecommendationsService } from "./recommendations.service";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";

/**
 * "The 25 at the highest risk are listed."
 *
 * On Tuzlu (A-070) the restock register sorted its reorder list by stockout
 * probability alone and cut it at 25. Five wines shared 27% across rows 23–27:
 * the cut kept two of them — whichever two `loadInventory` happened to return
 * first — and the page said the 25 listed were the 25 at the highest risk.
 * ADR 0272: within a tie the order is the data's (cover, then bottles, then
 * name), never the database's; and a cut never splits a tie group.
 */

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

interface Sku {
  id: string;
  sold: number;
  cover: number;
  /** Days with a sale; 14 (the fewest a measured risk needs) unless set. */
  days?: number;
  /** Bottles on hand, when not cover × the mean daily demand. */
  onHand?: number;
}

const bottlesOf = (s: Sku) => s.onHand ?? (s.cover * s.sold) / 90;

/**
 * Thirty wines below their reorder point, each with its demand spread evenly
 * over the 14 days a risk needs (ADR 0299), so risk is a function of cover
 * alone: 22 at distinct covers, then FIVE at 9 days — one risk, about 37%,
 * which floating point returns in more than one bit pattern — then three at
 * lower risk. Every cover is below the 17.2 days the reorder point covers.
 *
 * (ADR 0272 wrote these on Tuzlu's one-import-day shape, covers 2.5× these;
 * ADR 0299 gives such a series no risk at all, so the shape moved, not the
 * assertions.)
 */
function cellar(): Sku[] {
  const distinct = Array.from({ length: 22 }, (_, i) => ({
    id: `d${String(i).padStart(2, "0")}`,
    sold: 9,
    cover: i * 0.4,
  }));
  const tied = [5, 7, 10, 11, 17].map((sold, i) => ({
    id: `tie${i}`,
    sold,
    cover: 9,
  }));
  const lower = [12, 14, 16].map((cover, i) => ({
    id: `low${i}`,
    sold: 9,
    cover,
  }));
  return [...distinct, ...tied, ...lower];
}

async function reorderList(skus: Sku[]) {
  const service = new AnalyticsService({ getClient: () => null } as any);
  jest.spyOn(service as any, "loadInventory").mockResolvedValue(
    skus.map((s) => ({
      id: s.id,
      name: `Wine ${s.id}`,
      type: "red",
      qty: bottlesOf(s),
      bottles: bottlesOf(s),
      unitCost: 10,
      costBasis: "invoiced_lot",
      unitPrice: 30,
      thresholdMin: 0,
      reorderPoint: 0,
      masterWineId: `m-${s.id}`,
      inventoryValue: bottlesOf(s) * 10,
    })),
  );
  jest.spyOn(service as any, "loadConsumption").mockResolvedValue(
    // A wine that sold nothing has no consumption row at all. The rest sold
    // on 14 days, the fewest a measured risk needs (ADR 0299), unless the
    // row says otherwise — fewer gives no risk, more gives a steadier one.
    skus
      .filter((s) => s.sold > 0)
      .flatMap((s) =>
        Array.from({ length: s.days ?? 14 }, (_, d) => ({
          masterWineId: `m-${s.id}`,
          inventoryId: s.id,
          qty: s.sold / (s.days ?? 14),
          date: dayBack(1 + d),
        })),
      ),
  );
  return service.getInventoryScience("r1");
}

describe("the restock cut keeps its ties (A-070, ADR 0272)", () => {
  it("lists every wine tied with the 25th, not two of five", async () => {
    const out = await reorderList(cellar());
    expect(out.reorderCount).toBe(30);
    const ids = out.reorderList.map((s: any) => s.id);
    expect(ids).toHaveLength(27);
    for (const t of ["tie0", "tie1", "tie2", "tie3", "tie4"])
      expect(ids).toContain(t);
    expect(ids).not.toContain("low0");
  });

  it("returns the same order whatever order the database returned", async () => {
    const forward = (await reorderList(cellar())).reorderList.map(
      (s: any) => s.id,
    );
    const shuffled = cellar();
    // A fixed permutation: reversed, then every other row rotated.
    shuffled.reverse();
    for (let i = 0; i + 1 < shuffled.length; i += 2)
      [shuffled[i], shuffled[i + 1]] = [shuffled[i + 1], shuffled[i]];
    const back = (await reorderList(shuffled)).reorderList.map(
      (s: any) => s.id,
    );
    expect(back).toEqual(forward);
  });

  it('lists no wine with no sale and nothing on hand, and counts them instead (fork 3, founder: "Out of both, say a count")', async () => {
    // The lane verifier's probe: 5 wines with demand below their reorder
    // point, and 40 that sold nothing and hold nothing. ADR 0272 bounded the
    // cut so that it filled to 25 with 20 of the 40; the founder's answer to
    // fork 3 takes all 40 out of the list and counts them.
    const withDemand = [0, 1, 2, 3, 4].map((cover, i) => ({
      id: `d${i}`,
      sold: 9,
      cover: cover * 0.4,
    }));
    const none = Array.from({ length: 40 }, (_, i) => ({
      id: `z${String(i).padStart(2, "0")}`,
      sold: 0,
      cover: 0,
    }));
    // No sale, but bottles on the shelf: not below any reorder point.
    const stocked = { id: "shelf", sold: 0, cover: 0, onHand: 3 };
    const out = await reorderList([...none, stocked, ...withDemand]);
    expect(out.reorderCount).toBe(45);
    expect(out.noDemandCount).toBe(40);
    expect(out.reorderList.map((s: any) => s.id)).toEqual([
      "d0",
      "d1",
      "d2",
      "d3",
      "d4",
    ]);
    const reversed = await reorderList([...withDemand, ...none].reverse());
    expect(reversed.reorderList.map((s: any) => s.id)).toEqual([
      "d0",
      "d1",
      "d2",
      "d3",
      "d4",
    ]);
    expect(reversed.noDemandCount).toBe(40);
  });

  it("does not call two risks that merely print alike a tie (control: passes before ADR 0272 too)", async () => {
    // 24 distinct risks, then two wines whose risks differ in the third
    // decimal and print as the same whole percent (34%), straddling row 25.
    const distinct = Array.from({ length: 24 }, (_, i) => ({
      id: `d${String(i).padStart(2, "0")}`,
      sold: 9,
      cover: i * 0.4,
    }));
    const near = [
      { id: "pa", sold: 9, cover: 9.6 },
      { id: "pb", sold: 9, cover: 9.62 },
    ];
    const out = await reorderList([...distinct, ...near]);
    const risk = (id: string) =>
      out.skus.find((s: any) => s.id === id)!.stockoutProbability as number;
    expect(Math.round(risk("pa") * 100)).toBe(Math.round(risk("pb") * 100));
    expect(risk("pa")).not.toBe(risk("pb"));
    const ids = out.reorderList.map((s: any) => s.id);
    expect(ids).toHaveLength(25);
    expect(ids[24]).toBe("pa");
  });
});

/**
 * "What to buy back" runs soonest out first (ADR 0272 Decision 4, amended
 * 2026-10-04). The founder's answer (AskUserQuestion, 2026-10-04 ~20:50Z):
 * "Soonest to run out (Recommended)" — days of cover for every row, the
 * percentage only breaking a tie. Before it, the list put every measured
 * risk first, so a wine already empty sat behind a measured 37%.
 */
describe('the restock list runs soonest out first (founder: "Soonest to run out")', () => {
  it("orders every row by days of cover, measured or not (fails before)", async () => {
    const out = await reorderList([
      { id: "m-week", sold: 9, cover: 9 }, // measured, about 37%
      { id: "u-four", sold: 9, cover: 4, days: 5 }, // no risk: 5 sale days
      { id: "m-two", sold: 9, cover: 2 }, // measured, about 79%
      { id: "u-out", sold: 9, cover: 0, days: 3 }, // empty, no risk
    ]);
    expect(out.reorderList.map((s: any) => s.id)).toEqual([
      "u-out",
      "m-two",
      "u-four",
      "m-week",
    ]);
  });

  it("lets the percentage break a tie in days of cover, unmeasured last (fails before)", async () => {
    const out = await reorderList([
      // Sold on 89 of 90 days: a steady swing, so even half a day of cover
      // reads nearly 100% — above every empty wine below.
      { id: "steady", sold: 89, cover: 0.5, days: 89 },
      { id: "lumpy-a", sold: 9, cover: 0, days: 14 }, // empty, about 87%
      { id: "lumpy-b", sold: 9, cover: 0, days: 30 }, // empty, about 97%
      { id: "thin", sold: 9, cover: 0, days: 2 }, // empty, no risk
    ]);
    const risk = (id: string): number =>
      out.reorderList.find((s: any) => s.id === id)!.stockoutProbability!;
    expect(risk("steady")).toBeGreaterThan(risk("lumpy-b"));
    expect(risk("lumpy-b")).toBeGreaterThan(risk("lumpy-a"));
    expect(out.reorderList.map((s: any) => s.id)).toEqual([
      "lumpy-b",
      "lumpy-a",
      "thin",
      "steady",
    ]);
  });

  it("lists every wine already out when they straddle row 25, not 25 of them by name (fails before)", async () => {
    // 30 wines that sold in the window and hold nothing: 10 measured, 20 on
    // too few days for a risk. Then three with a little stock left.
    const measured = Array.from({ length: 10 }, (_, i) => ({
      id: `m${String(i).padStart(2, "0")}`,
      sold: 9,
      cover: 0,
    }));
    const thin = Array.from({ length: 20 }, (_, i) => ({
      id: `u${String(i).padStart(2, "0")}`,
      sold: 9,
      cover: 0,
      days: 3,
    }));
    const left = [1, 2, 3].map((cover) => ({
      id: `c${cover}`,
      sold: 9,
      cover,
    }));
    const out = await reorderList([...left, ...thin, ...measured]);
    expect(out.reorderCount).toBe(33);
    const ids = out.reorderList.map((s: any) => s.id);
    expect(ids).toHaveLength(30);
    expect(ids.slice(0, 10)).toEqual(measured.map((s) => s.id));
    expect(ids.slice(10)).toEqual(thin.map((s) => s.id));
    const reversed = await reorderList(
      [...measured, ...thin, ...left].reverse(),
    );
    expect(reversed.reorderList.map((s: any) => s.id)).toEqual(ids);
  });
});

/**
 * The "Tonight" card (`stockout_imminent`) speaks of a chance of running out,
 * so it names the wine most likely to. It read row 1 of the list, which was
 * that wine while the list ran highest risk first. Soonest out first, row 1 is
 * often a wine with no measured risk, and the riskiest wine can sit past the
 * cut — so the register picks it from every wine below its reorder point
 * (`mostAtRisk`), and the card reads that. These run the register's real
 * output through the card; on the base they pass too (row 1 WAS the riskiest
 * there), and against this branch's list they fail when the card reads row 1
 * or only the listed rows (mutation-checked, see the PR).
 */
describe("the Tonight card names the wine most at risk, not row 1", () => {
  async function tonight(invSci: unknown) {
    const supabase = {
      from: () => {
        const b: any = {};
        for (const m of [
          "select",
          "order",
          "limit",
          "insert",
          "eq",
          "in",
          "gte",
        ])
          b[m] = () => b;
        b.then = (resolve: any, reject: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject);
        return b;
      },
    };
    const svc = new RecommendationsService(
      {
        getFinancialSummary: async () => null,
        getRiskProfile: async () => null,
        getInventoryScience: async () => invSci,
      } as any,
      {
        getMenuEngineering: async () => null,
        getSeasonality: async () => null,
        getCashflow: async () => null,
      } as any,
      { generate: async () => ({ insights: [] }) } as any,
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
    const out = await svc.getRecommendations("r1");
    return out.recommendations.find((r) => r.ruleKey === "stockout_imminent");
  }
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  it("names the riskiest wine though row 1 is an empty wine with no measured risk", async () => {
    const register = await reorderList([
      { id: "thin", sold: 9, cover: 0, days: 2 }, // empty, no risk: row 1
      { id: "lumpy", sold: 9, cover: 3 }, // about 47%
      { id: "steady", sold: 89, cover: 0.5, days: 89 }, // nearly 100%
    ]);
    expect(register.reorderList.map((s: any) => s.id)).toEqual([
      "thin",
      "steady",
      "lumpy",
    ]);
    const steady = register.reorderList[1];
    expect(steady.stockoutProbability).toBeGreaterThan(
      register.reorderList[2].stockoutProbability!,
    );
    const card = await tonight(register);
    expect(card?.observation).toBe(
      `Wine steady has a ${pct(steady.stockoutProbability!)} chance of stocking out before a 7-day replenishment (on hand: ${steady.onHand}).`,
    );
  });

  it("names the riskiest wine when it sits past the 25-row cut, behind wines with no measured risk", async () => {
    // 26 wines sold on 2 days (no risk) run out sooner than one sold on 14
    // days with 5 days of cover (about 63%), so it is row 27 and not listed.
    const thin = Array.from({ length: 26 }, (_, i) => ({
      id: `t${String(i).padStart(2, "0")}`,
      sold: 9,
      cover: i * 0.1,
      days: 2,
    }));
    const register = await reorderList([
      ...thin,
      { id: "late", sold: 9, cover: 5 },
    ]);
    expect(register.reorderCount).toBe(27);
    expect(register.reorderList.map((s: any) => s.id)).not.toContain("late");
    expect(
      register.reorderList.every((s: any) => s.stockoutProbability == null),
    ).toBe(true);
    const card = await tonight(register);
    expect(card?.observation).toMatch(/^Wine late has a \d+% chance/);
    expect(register.mostAtRisk.stockoutProbability).toBeGreaterThan(0.4);
  });

  it("stays silent when no wine below its reorder point has a measured risk above 40% (control)", async () => {
    const register = await reorderList([
      { id: "thin", sold: 9, cover: 0, days: 2 },
      { id: "thin2", sold: 9, cover: 1, days: 3 },
    ]);
    expect(register.mostAtRisk.stockoutProbability).toBeNull();
    expect(await tonight(register)).toBeUndefined();
  });
});

describe("the restock export says the order and counts the wines with no demand (ADR 0272 D4, fork 3)", () => {
  const payload = (over: Record<string, unknown>) => ({
    params: {
      serviceLevel: 0.95,
      leadTimeDays: 7,
      demandWindowDays: 90,
      minDemandDays: 14,
    },
    basis: {},
    skuCount: 60,
    ...over,
  });
  const listed = [
    {
      id: "w1",
      name: "Yeni Raki",
      onHand: 0,
      daysOfCover: 0,
      reorderPoint: null,
      safetyStock: null,
      stockoutProbability: null,
    },
    {
      id: "w2",
      name: "Steady Syrah",
      onHand: 2,
      daysOfCover: 2,
      reorderPoint: 4,
      safetyStock: 2,
      stockoutProbability: 0.8,
    },
  ];

  it("lists soonest to run out first, and one line carries the wines with no demand (fails before)", () => {
    const doc = EXPORT_CUTTINGS.restock.write(
      payload({ reorderCount: 30, noDemandCount: 3, reorderList: listed }),
      { days: null },
    );
    expect(doc.tables[0].title).toBe(
      "Below the reorder point, soonest to run out first",
    );
    expect(doc.tables[0].note).toBe(
      "27 wines are below their reorder point; the 2 that run out soonest are listed, as the register returns them.",
    );
    expect(doc.notes).toContain(
      "3 more below their reorder point have no demand to judge.",
    );
  });

  it("does not say nothing is below its reorder point when only wines with no demand are (fails before)", () => {
    const doc = EXPORT_CUTTINGS.restock.write(
      payload({ reorderCount: 1, noDemandCount: 1, reorderList: [] }),
      { days: null },
    );
    expect(doc.say).not.toContain("Nothing is below its reorder point");
    expect(doc.say).toContain(
      "1 more below its reorder point has no demand to judge.",
    );
  });

  it("prints no count line when every wine below its reorder point has demand (control)", () => {
    const doc = EXPORT_CUTTINGS.restock.write(
      payload({ reorderCount: 2, noDemandCount: 0, reorderList: listed }),
      { days: null },
    );
    expect(doc.notes.join(" ")).not.toContain("no demand to judge");
    expect(doc.tables[0].note).toBeUndefined();
  });
});
