/**
 * The working line under the week's shape names which extreme the lens
 * withholds (walk r33 R-F2). With Monday and Tuesday tied as the quietest
 * day (the walk's seed-tie.sql), the lens named Saturday the busiest day and
 * its working said "bestDay/worstDay are null", contradicting it.
 */
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import {
  EXTREMES_BOTH_NAMED,
  EXTREMES_BOTH_SHARED,
  EXTREMES_BUSIEST_SHARED,
  EXTREMES_QUIETEST_SHARED,
  EXTREMES_TOO_FEW,
  extremesBasis,
} from "./engine/weekday-extremes-basis";

type Rows = Record<string, any[]>;

function makeClient(rowsByTable: Rows) {
  const passthrough = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "in",
  ];
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
}

const RESTAURANT = "33333333-3333-3333-3333-333333333333";
const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    { getClient: () => makeClient(rows) } as any,
    { getDemandForecast: async () => ({}) } as any,
    {} as any,
    {} as any,
  );

/** A priced, on-hand inventory row. */
const consumption = (n: number, qty: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({
    inventory_id: "inv-1",
    consumption_type: "bottle",
    quantity: qty(i),
    volume_ml: null,
    created_at: new Date(Date.now() - (n - 1 - i) * 86400000).toISOString(),
    restaurant_inventory: { master_wine_id: "mw-1" },
  }));

describe("the extremes working line", () => {
  const day = { weekday: 6 };

  it("names both when one weekday holds each extreme", () => {
    expect(extremesBasis({ best: day, worst: day }, 7)).toBe(EXTREMES_BOTH_NAMED);
  });

  it("names neither when both are shared", () => {
    expect(extremesBasis({ best: null, worst: null }, 7)).toBe(EXTREMES_BOTH_SHARED);
  });

  it("[REVERT-FAILS] says only the busiest is withheld when only the busiest is shared", () => {
    const line = extremesBasis({ best: null, worst: day }, 7);
    expect(line).toBe(EXTREMES_BUSIEST_SHARED);
    expect(line).toMatch(/^No busiest day is named/);
    expect(line).toMatch(/The quietest day is the single weekday/);
  });

  it("[REVERT-FAILS] says only the quietest is withheld when only the quietest is shared", () => {
    const line = extremesBasis({ best: day, worst: null }, 7);
    expect(line).toBe(EXTREMES_QUIETEST_SHARED);
    expect(line).toMatch(/^No quietest day is named/);
    expect(line).toMatch(/The busiest day is the single weekday/);
  });

  it("says there is nothing to rank with fewer than two weekdays, never 'the single weekdays'", () => {
    expect(extremesBasis({ best: null, worst: null }, 1)).toBe(EXTREMES_TOO_FEW);
    expect(extremesBasis({ best: null, worst: null }, 0)).toBe(EXTREMES_TOO_FEW);
    expect(extremesBasis({ best: day, worst: day }, 2)).toBe(EXTREMES_BOTH_NAMED);
  });

  it("writes the new lines in the house's words: no field name, no null", () => {
    for (const line of [EXTREMES_TOO_FEW, EXTREMES_BUSIEST_SHARED, EXTREMES_QUIETEST_SHARED]) {
      expect(line).not.toMatch(/bestDay|worstDay|\bnull\b|[a-z]+_[a-z]+/);
    }
  });
});

describe("seasonality names the extreme it withholds (seed-tie shape)", () => {
  it("[REVERT-FAILS] two weekdays tied quietest: the busiest is named and the line says only the quietest is withheld", async () => {
    // Every day of the window has a line, and each weekday always sells the
    // same: the two lowest weekdays share a mean, the highest is alone.
    const qty = [1, 1, 3, 4, 5, 6, 7];
    const out: any = await advanced({
      wine_consumption_log: consumption(91, (i) => qty[i % 7]),
    }).getSeasonality(RESTAURANT);
    expect(out.tie).toBe(true);
    expect(typeof out.bestDay).toBe("string");
    expect(out.worstDay).toBeNull();
    expect(out.basis.extremes).toBe(EXTREMES_QUIETEST_SHARED);
  });

  it("two weekdays tied busiest: the quietest is named and the line says only the busiest is withheld", async () => {
    const qty = [7, 7, 3, 4, 5, 6, 1];
    const out: any = await advanced({
      wine_consumption_log: consumption(91, (i) => qty[i % 7]),
    }).getSeasonality(RESTAURANT);
    expect(out.bestDay).toBeNull();
    expect(typeof out.worstDay).toBe("string");
    expect(out.basis.extremes).toBe(EXTREMES_BUSIEST_SHARED);
  });
});
