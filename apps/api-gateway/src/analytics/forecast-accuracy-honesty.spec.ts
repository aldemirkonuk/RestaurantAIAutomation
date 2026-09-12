import { AnalyticsService } from "./analytics.service";

/**
 * Regression guard — `getDemandForecast().accuracy` must not certify a
 * forecast it cannot evidence (ADR 0064, ADR 0051, ADR 0020).
 *
 * `toDailySeries` zero-fills to exactly `sinceDays` points, so a restaurant
 * (or a `masterWineId`) with no consumption rows produces a 120-point series
 * of zeros rather than a short one. Holt-Winters therefore never returns null,
 * the milder fallbacks never run, and MAE/RMSE over the scored window both
 * evaluate to 0 — a *perfect forecast*, reported over a series containing no
 * observation at all. `mape` and `mase` already refused (division by zero);
 * `mae` and `rmse` answered.
 *
 * The trap this closes is subtler than the zeros themselves, which predate
 * ADR 0064: that ADR added `scoredPoints` and `basis`, which turn an
 * unqualified zero into a zero backed by a stated evidence count. The claim
 * got more confident while staying equally empty. An unknown is an em dash,
 * never a zero.
 */

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
const build = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

/** `n` consumption rows spread one per day, ending today. */
const consumptionRows = (n: number, qty: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({
    inventory_id: `inv-${i}`,
    quantity: qty(i),
    volume_ml: null,
    created_at: new Date(Date.now() - (n - 1 - i) * 86400000).toISOString(),
    restaurant_inventory: { master_wine_id: "mw-1" },
  }));

describe("forecast accuracy is refused when there is nothing to score", () => {
  it("reports null metrics, not zeros, for a restaurant with no consumption", async () => {
    const svc = build({ wine_consumption_log: [] });
    const out: any = await svc.getDemandForecast(RESTAURANT);

    // The model still runs — the series is 120 zero-filled points, not short.
    expect(out.model).toBe("holt_winters");

    // ...but nothing is claimed about its accuracy.
    expect(out.accuracy).toEqual({
      mae: null,
      rmse: null,
      mape: null,
      maseVsSeasonalNaive: null,
      basis: "no_observations_in_scored_window",
      scoredPoints: 0,
    });
  });

  it("does not dress an empty window as evidence", async () => {
    // The specific pre-fix failure: MAE 0 and RMSE 0 asserted over 106 points.
    const svc = build({ wine_consumption_log: [] });
    const out: any = await svc.getDemandForecast(RESTAURANT);
    expect(out.accuracy.mae).not.toBe(0);
    expect(out.accuracy.rmse).not.toBe(0);
    expect(out.accuracy.scoredPoints).not.toBe(106);
  });

  it("still scores a restaurant that does have consumption", async () => {
    // The refusal must be about absence of data, not a blanket mute.
    const svc = build({
      wine_consumption_log: consumptionRows(
        120,
        (i) => 5 + (i % 7) + (i % 3) * 2,
      ),
    });
    const out: any = await svc.getDemandForecast(RESTAURANT);

    expect(out.accuracy.basis).toBe("rolling_one_step_ahead");
    expect(out.accuracy.scoredPoints).toBeGreaterThan(0);
    expect(typeof out.accuracy.mae).toBe("number");
    expect(out.accuracy.mae).toBeGreaterThan(0);
    expect(typeof out.accuracy.rmse).toBe("number");
  });

  it("scores exactly the points past the model's own warmup", async () => {
    // 120-day window, Holt-Winters warmup = 2 * 7 → 106 scored points. The
    // boundary comes from the engine, never from a constant in this service.
    const svc = build({
      wine_consumption_log: consumptionRows(120, (i) => 5 + (i % 7)),
    });
    const out: any = await svc.getDemandForecast(RESTAURANT);
    expect(out.accuracy.scoredPoints).toBe(120 - 14);
  });
});
