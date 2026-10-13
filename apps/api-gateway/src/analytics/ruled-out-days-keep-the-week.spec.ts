import { AnalyticsService } from "./analytics.service";

/**
 * F-1579 (sim 52, integ29-w102-regress): F-1575 cut a ruled-out day out of
 * the forecast's history, but Holt-Winters reads index mod 7 as the weekday,
 * so every day after the gap slid into the wrong seasonal slot. A house that
 * rules out its closed Monday lost its weekly shape altogether.
 *
 * The clock is 2026-10-10 12:00 in Istanbul (a Saturday). Every weekday sells
 * the same count each week, from 2026-05-01 to 2026-10-09, so a model that
 * keeps the week projects that count back exactly.
 */

const NOW = new Date("2026-10-10T09:00:00.000Z");
// Bottles by getUTCDay(): Sun, Mon, Tue, Wed, Thu, Fri, Sat.
const SHAPE = [6, 2, 2, 3, 4, 10, 14];
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

function pours(ruledOut: (day: string) => boolean) {
  const out: any[] = [];
  for (
    let t = Date.parse("2026-05-01T17:00:00Z"), n = 0;
    t <= Date.parse("2026-10-09T17:00:00Z");
    t += 86400000, n++
  ) {
    const at = new Date(t).toISOString();
    const day = at.substring(0, 10);
    if (ruledOut(day)) continue;
    out.push({
      id: `c${n}`,
      inventory_id: "inv-1",
      consumption_type: "bottle",
      quantity: SHAPE[dow(day)],
      volume_ml: 750 * SHAPE[dow(day)],
      created_at: at,
      restaurant_inventory: { master_wine_id: "m-1", bottle_size_ml: 750 },
    });
  }
  return out;
}

function analytics(ruledOut: (day: string) => boolean, days: string[]) {
  const rows = pours(ruledOut);
  const db = {
    from: (table: string) => {
      const b: any = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "maybeSingle")
              return async () => ({
                data:
                  table === "restaurants"
                    ? {
                        timezone: "Europe/Istanbul",
                        country: "TR",
                        created_at: "2025-01-01T09:00:00Z",
                      }
                    : null,
                error: null,
              });
            if (prop === "then")
              return (resolve: any, reject: any) =>
                Promise.resolve(
                  table === "analytics_day_exclusions"
                    ? {
                        data: days.map((d) => ({ business_date: d })),
                        error: null,
                      }
                    : {
                        data: table === "wine_consumption_log" ? rows : [],
                        error: null,
                      },
                ).then(resolve, reject);
            return () => b;
          },
        },
      );
      return b;
    },
  };
  return new AnalyticsService({ getClient: () => db } as any);
}

/** Every Monday in the 120 days the forecast reads. */
function mondays(): string[] {
  const out: string[] = [];
  for (let d = 1; d <= 120; d++) {
    const day = new Date(NOW.getTime() - d * 86400000)
      .toISOString()
      .substring(0, 10);
    if (dow(day) === 1) out.push(day);
  }
  return out;
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "queueMicrotask",
    ],
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a ruled-out day keeps its place in the week (F-1579)", () => {
  it("with nothing ruled out the forecast is the week itself (control)", async () => {
    const out: any = await analytics(() => false, []).getDemandForecast("r1", {
      horizon: 7,
    });
    for (const f of out.forecast)
      expect(f.value).toBeCloseTo(SHAPE[dow(f.date)], 6);
  });

  it("one outage forty days back does not shift the weekdays after it", async () => {
    const outage = "2026-08-31";
    const out: any = await analytics(
      (d) => d === outage,
      [outage],
    ).getDemandForecast("r1", { horizon: 7 });
    expect(out.forecast).toHaveLength(7);
    for (const f of out.forecast)
      expect(f.value).toBeCloseTo(SHAPE[dow(f.date)], 6);
    // History shows only counted days; accuracy is scored only on them.
    expect(out.history.dates).not.toContain(outage);
    expect(out.history.dates).toHaveLength(119);
    expect(out.accuracy.scoredPoints).toBe(120 - 14 - 1);
    expect(out.accuracy.mae).toBeCloseTo(0, 6);
    expect(out.basis.demand).not.toMatch(/zero-filled/);
    expect(out.basis.demand).toMatch(
      /the forecast holds its place with the same weekday in the weeks around it/,
    );
    expect(out.basis.model).toMatch(
      /fitted on 120 days of history, 1 of them ruled out/,
    );
  });

  it("a house that rules out its closed Monday keeps the other six days' shape", async () => {
    const closed = mondays();
    const out: any = await analytics(
      (d) => dow(d) === 1,
      closed,
    ).getDemandForecast("r1", { horizon: 7 });
    const open = out.forecast.filter((f: any) => dow(f.date) !== 1);
    expect(open).toHaveLength(6);
    for (const f of open) expect(f.value).toBeCloseTo(SHAPE[dow(f.date)], 6);
    expect(out.history.dates.some((d: string) => dow(d) === 1)).toBe(false);
    // The 120 days start 2026-06-12; the first 14 seed the model.
    const scoredMondays = closed.filter((d) => d >= "2026-06-26").length;
    expect(out.accuracy.scoredPoints).toBe(120 - 14 - scoredMondays);
    expect(out.accuracy.mae).toBeCloseTo(0, 6);
  });
});
