import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as Fc from "./forecasting";

/**
 * Backtest: the demand-forecast chain against a PINNED expected output (ADR 0135).
 *
 * `forecasting.spec.ts` next door proves properties (warmup is exact, fitted is
 * one-step-ahead, MASE < 1 when the model beats naive). This file proves
 * something narrower and more brittle on purpose: that today's engine returns
 * the SAME numbers it returned when the fixture was pinned, for seven
 * deterministic series shaped like real consumption. A change to any model,
 * the fallback order, the accuracy scoring window or the seasonal-naive
 * benchmark moves a number here and fails this suite — which is the point:
 * a forecast that silently changes is a claim nobody re-checked.
 *
 * The chain and its parameters are the ones `AnalyticsService.getDemandForecast`
 * runs (analytics.service.ts): Holt-Winters additive, period 7, α .3 β .05 γ .3,
 * horizon 14 → Holt linear .4/.1 → SES .4; accuracy scored on
 * `fitted.slice(warmup)` vs `values.slice(warmup)` with MASE's naive window
 * held to the same `from = warmup` (ADR 0064); an all-zero scored window yields
 * null metrics, never zero (ADR 0051). A lockstep test below greps the service
 * for those literals, so the two cannot drift apart unnoticed.
 *
 * Fixture: datasets/sim/fixtures/forecast-backtest.json — generated, never
 * hand-edited (the content hash catches that). Re-pin on purpose with:
 *
 *     FORECAST_BACKTEST_WRITE=1 npx jest src/analytics/engine/forecasting.backtest.spec.ts
 */

const FIXTURE_PATH = path.join(
  __dirname,
  "../../../../../datasets/sim/fixtures/forecast-backtest.json",
);
const SERVICE_PATH = path.join(__dirname, "../analytics.service.ts");

const PERIOD = 7;
const HORIZON = 14;
const HW = { alpha: 0.3, beta: 0.05, gamma: 0.3 };
const HOLT = { alpha: 0.4, beta: 0.1 };
const SES_ALPHA = 0.4;

/** Deterministic LCG (Numerical Recipes constants) — no Math.random anywhere. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

interface SeriesSpec {
  name: string;
  story: string;
  values: number[];
}

function series(): SeriesSpec[] {
  const n = 120;
  const flat = lcg(11);
  const trend = lcg(23);
  const weekly = lcg(37);
  const sparse = lcg(41);
  const spike = lcg(53);
  const short = lcg(67);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return [
    { name: "flat", story: "steady house pours, small noise", values: Array.from({ length: n }, () => r2(10 + (flat() - 0.5) * 2)) },
    { name: "trend", story: "a list growing slowly through the season", values: Array.from({ length: n }, (_, t) => r2(5 + 0.1 * t + (trend() - 0.5) * 2)) },
    { name: "weekly", story: "a strong Friday/Saturday shape", values: Array.from({ length: n }, (_, t) => r2(Math.max(0, 12 + 6 * Math.sin((2 * Math.PI * t) / 7) + (weekly() - 0.5) * 3))) },
    { name: "sparse", story: "bottle sales: most days zero, some days one or two", values: Array.from({ length: n }, () => (sparse() < 0.7 ? 0 : sparse() < 0.8 ? 2 : 1)) },
    { name: "spike", story: "flat with one private-event spike", values: Array.from({ length: n }, (_, t) => r2(t === 80 ? 60 : 8 + (spike() - 0.5) * 2)) },
    { name: "short", story: "ten days of history — below two seasons, so Holt-Winters cannot fit", values: Array.from({ length: 10 }, (_, t) => r2(4 + 0.3 * t + (short() - 0.5))) },
    { name: "all_zero", story: "a wine never sold: the scored window holds no observation", values: Array.from({ length: n }, () => 0) },
  ];
}

interface Outcome {
  model: "holt_winters" | "holt_linear" | "ses";
  warmup: number;
  scoredPoints: number;
  hasSignal: boolean;
  mae: number | null;
  rmse: number | null;
  mape: number | null;
  maseVsSeasonalNaive: number | null;
  forecastHead: number[];
  forecastTail: number[];
  totalForecastDemand: number;
}

/** The service's chain, reproduced on the pure engine. */
function run(values: number[]): Outcome {
  let model: Outcome["model"] = "holt_winters";
  let result = Fc.holtWintersAdditive(values, PERIOD, HW, HORIZON) as
    | { fitted: number[]; forecast: number[]; warmup: number }
    | null;
  if (!result) {
    model = "holt_linear";
    result = Fc.holtLinear(values, HOLT.alpha, HOLT.beta, HORIZON);
  }
  if (!result) {
    model = "ses";
    result = Fc.simpleExponentialSmoothing(values, SES_ALPHA, HORIZON);
  }
  if (!result) throw new Error("no model fitted — the chain must always end in SES for a non-empty series");
  const w = Math.min(result.warmup, values.length);
  const actual = values.slice(w);
  const predicted = result.fitted.slice(w);
  const hasSignal = actual.some((v) => v !== 0);
  const forecast = result.forecast.map((v) => Math.max(0, v));
  return {
    model,
    warmup: result.warmup,
    scoredPoints: actual.length,
    hasSignal,
    mae: hasSignal ? Fc.mae(actual, predicted) : null,
    rmse: hasSignal ? Fc.rmse(actual, predicted) : null,
    mape: hasSignal ? Fc.mape(actual, predicted) : null,
    maseVsSeasonalNaive: hasSignal ? Fc.mase(actual, predicted, values, PERIOD, w) : null,
    forecastHead: forecast.slice(0, 3),
    forecastTail: forecast.slice(-3),
    totalForecastDemand: forecast.reduce((a, b) => a + b, 0),
  };
}

interface FixtureRow extends SeriesSpec {
  expect: Outcome;
}
interface Fixture {
  fixture_version: string;
  generated_by: string;
  engine_contract: { period: number; horizon: number; holt_winters: typeof HW; holt_linear: typeof HOLT; ses_alpha: number };
  row_count: number;
  content_hash: string;
  rows: FixtureRow[];
}

function canonical(rows: FixtureRow[]): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sortKeys(rows));
}

function hashRows(rows: FixtureRow[]): string {
  return crypto.createHash("sha256").update(canonical(rows)).digest("hex");
}

function currentFixture(): Fixture {
  const rows = series().map((s) => ({ ...s, expect: run(s.values) }));
  return {
    fixture_version: "1.0.0",
    generated_by: "FORECAST_BACKTEST_WRITE=1 npx jest src/analytics/engine/forecasting.backtest.spec.ts",
    engine_contract: { period: PERIOD, horizon: HORIZON, holt_winters: HW, holt_linear: HOLT, ses_alpha: SES_ALPHA },
    row_count: rows.length,
    content_hash: hashRows(rows),
    rows,
  };
}

describe("forecasting backtest — pinned expected output", () => {
  const current = currentFixture();

  beforeAll(() => {
    if (process.env.FORECAST_BACKTEST_WRITE === "1") {
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(current, null, 2) + "\n");
    }
    if (!fs.existsSync(FIXTURE_PATH)) {
      throw new Error(`Fixture missing at ${FIXTURE_PATH}. Generate it once with: ${current.generated_by}`);
    }
  });

  const pinned = (): Fixture => JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

  it("the fixture is generated, populated and unedited", () => {
    const f = pinned();
    expect(f.fixture_version).toBe("1.0.0");
    expect(f.rows.length).toBe(f.row_count);
    expect(f.rows.length).toBeGreaterThanOrEqual(7);
    expect(hashRows(f.rows)).toBe(f.content_hash);
  });

  it("the engine contract pinned is the one this spec runs", () => {
    expect(pinned().engine_contract).toEqual(current.engine_contract);
  });

  it("every series still produces the pinned outcome (drift assertion)", () => {
    const f = pinned();
    const byName = new Map(f.rows.map((r) => [r.name, r]));
    for (const row of current.rows) {
      const p = byName.get(row.name);
      if (!p) throw new Error(`series ${row.name} is not in the fixture — re-pin: ${current.generated_by}`);
      expect(row.values).toEqual(p.values);
      const want = p.expect;
      const got = row.expect;
      expect({ series: row.name, model: got.model, warmup: got.warmup, scoredPoints: got.scoredPoints, hasSignal: got.hasSignal }).toEqual({
        series: row.name,
        model: want.model,
        warmup: want.warmup,
        scoredPoints: want.scoredPoints,
        hasSignal: want.hasSignal,
      });
      for (const k of ["mae", "rmse", "mape", "maseVsSeasonalNaive", "totalForecastDemand"] as const) {
        if (want[k] === null || got[k] === null) expect({ series: row.name, k, v: got[k] }).toEqual({ series: row.name, k, v: want[k] });
        else expect(got[k] as number).toBeCloseTo(want[k] as number, 9);
      }
      got.forecastHead.forEach((v, i) => expect(v).toBeCloseTo(want.forecastHead[i], 9));
      got.forecastTail.forEach((v, i) => expect(v).toBeCloseTo(want.forecastTail[i], 9));
    }
    // Nothing above interprets a count over an empty set.
    expect(current.rows.filter((r) => r.expect.hasSignal).length).toBeGreaterThanOrEqual(5);
  });

  it("an all-zero scored window yields null metrics, never zero (ADR 0051)", () => {
    const zero = current.rows.find((r) => r.name === "all_zero")!.expect;
    expect(zero.hasSignal).toBe(false);
    expect([zero.mae, zero.rmse, zero.mape, zero.maseVsSeasonalNaive]).toEqual([null, null, null, null]);
  });

  it("the short series falls past Holt-Winters to a model that can fit", () => {
    const short = current.rows.find((r) => r.name === "short")!.expect;
    expect(short.model).not.toBe("holt_winters");
    expect(short.scoredPoints).toBeGreaterThan(0);
  });

  it("lockstep: AnalyticsService.getDemandForecast still runs this exact chain", () => {
    const src = fs.readFileSync(SERVICE_PATH, "utf8");
    expect(src).toContain("const period = 7;");
    expect(src).toContain("{ alpha: 0.3, beta: 0.05, gamma: 0.3 }");
    expect(src).toContain("E.forecast.holtLinear(values, 0.4, 0.1, horizon)");
    expect(src).toContain("E.forecast.simpleExponentialSmoothing(values, 0.4, horizon)");
    expect(src).toContain("const hasSignal = actual.some((v) => v !== 0);");
    expect(src).toContain('basis: "no_observations_in_scored_window"');
  });
});
