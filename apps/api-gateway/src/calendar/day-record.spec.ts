import {
  DayRecordService,
  CALENDAR_LEDGER_AGENT,
  PAIRING_TYPE,
  leadDaysFor,
  reconciliationLine,
} from "./day-record.service";
import {
  RecordedDaysService,
  checkBusinessDate,
  foldChecksToDays,
} from "./recorded-days.service";

/**
 * Slice 3 — a passed day holds both halves, and claims nothing it cannot.
 *
 * The two assertions this whole file exists for:
 *  1. A day with no covers recorded says so; it never renders 0.
 *  2. Every `prediction_outcomes` row written carries `accuracy_score: null`,
 *     because there is no covers model to score against and no temperature
 *     observation to score with. A number there would be invented arithmetic
 *     wearing a metric's clothes.
 */

describe("checkBusinessDate", () => {
  it("prefers closed_at, the same rule goal progress applies", () => {
    expect(
      checkBusinessDate({
        opened_at: "2026-09-02T23:40:00Z",
        closed_at: "2026-09-03T00:20:00Z",
        total: 10,
        covers: 2,
      }),
    ).toBe("2026-09-03");
  });

  it("falls back to opened_at for a check that never closed", () => {
    expect(
      checkBusinessDate({
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        total: 10,
        covers: 2,
      }),
    ).toBe("2026-09-02");
  });
});

describe("foldChecksToDays", () => {
  it("sums totals and covers per day", () => {
    const days = foldChecksToDays([
      { opened_at: "2026-09-02T19:00:00Z", closed_at: null, total: "40.50", covers: 2 },
      { opened_at: "2026-09-02T20:00:00Z", closed_at: null, total: "59.50", covers: 4 },
    ]);
    const day = days.get("2026-09-02")!;
    expect(day.checkCount).toBe(2);
    expect(day.sales).toBe(100);
    expect(day.covers).toBe(6);
  });

  it("leaves covers NULL when no check on the day carried one", () => {
    // The load-bearing case. A POS that does not send cover counts must not
    // produce a day reading "0 covers" beside a day of real trading — that is
    // the absence-reported-as-health fault in the column the covers model will
    // one day be built on.
    const days = foldChecksToDays([
      { opened_at: "2026-09-02T19:00:00Z", closed_at: null, total: "40.50", covers: null },
    ]);
    const day = days.get("2026-09-02")!;
    expect(day.checkCount).toBe(1);
    expect(day.sales).toBe(40.5);
    expect(day.covers).toBeNull();
  });

  it("counts a check that carried covers even when a sibling did not", () => {
    const days = foldChecksToDays([
      { opened_at: "2026-09-02T19:00:00Z", closed_at: null, total: "10", covers: null },
      { opened_at: "2026-09-02T20:00:00Z", closed_at: null, total: "10", covers: 3 },
    ]);
    expect(days.get("2026-09-02")!.covers).toBe(3);
  });
});

describe("leadDaysFor", () => {
  it("counts whole days from the issue time to the start of the day", () => {
    expect(leadDaysFor("2026-09-01T12:00:00Z", "2026-09-05")).toBe(3);
    expect(leadDaysFor("2026-09-04T23:00:00Z", "2026-09-05")).toBe(0);
  });
});

describe("reconciliationLine", () => {
  const day = (over = {}) => ({
    businessDate: "2026-09-02",
    checkCount: 3,
    sales: 300,
    covers: 12,
    excluded: false,
    exclusionReason: null,
    ...over,
  });

  it("says a closed day was closed, before anything else", () => {
    // A closure that reads as a quiet day is the single most damaging input a
    // demand model can be given.
    expect(
      reconciliationLine(day({ excluded: true, exclusionReason: "Labor Day" }), true, true),
    ).toContain("Closed — Labor Day");
  });

  it("says there is no register rather than reporting an empty day", () => {
    expect(reconciliationLine(null, false, false)).toContain(
      "No sales register is connected",
    );
  });

  it("distinguishes a day with no checks from a day with no covers", () => {
    expect(reconciliationLine(null, false, true)).toBe(
      "Nothing was recorded on this day.",
    );
    expect(reconciliationLine(day({ covers: null }), true, true)).toContain(
      "Covers were not recorded",
    );
  });

  it("never claims an error against a forecast it cannot score", () => {
    const line = reconciliationLine(day(), true, true);
    expect(line).toContain("no covers model exists yet");
    expect(line).not.toMatch(/out by/);
  });
});

/* ── the service ───────────────────────────────────────────────────────────── */

function makeService(opts: {
  recorded: Awaited<ReturnType<RecordedDaysService["windowFor"]>>;
  weather: any;
  existingOutcomes?: any[];
  outcomeReadError?: { message: string };
}) {
  const inserted: any[][] = [];

  const outcomesChain = (): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      insert: (rows: any[]) => {
        inserted.push(rows);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: opts.outcomeReadError ? null : (opts.existingOutcomes ?? []),
          error: opts.outcomeReadError ?? null,
        }).then(resolve),
    };
    return c;
  };

  const db = { supabase: { from: () => outcomesChain() } } as never;
  const recorded = { windowFor: async () => opts.recorded } as never;
  const weather = { windowFor: async () => opts.weather } as never;

  return { service: new DayRecordService(db, recorded, weather), inserted };
}

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const WEATHER = (over = {}) => ({
  refusal: null,
  forecastInAdvance: [
    {
      businessDate: YESTERDAY,
      issuer: "NOAA/NWS",
      issuerDetail: "MTR/91,89",
      issuedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      fetchedAt: new Date().toISOString(),
      validFrom: "",
      validTo: "",
      temperatureHigh: 75,
      temperatureLow: 58,
      temperatureUnit: "F" as const,
      precipitationProbability: 27,
      precipitationAmountMm: null,
      windSummary: "2 to 12 mph",
      shortForecast: "Mostly Sunny",
    },
  ],
  ...over,
});

const LEDGER = (over = {}) => ({
  from: YESTERDAY,
  to: YESTERDAY,
  posConnected: true,
  refusal: null,
  days: [
    {
      businessDate: YESTERDAY,
      checkCount: 12,
      sales: 3400,
      covers: 41,
      excluded: false,
      exclusionReason: null,
    },
  ],
  ...over,
});

describe("DayRecordService", () => {
  it("pairs the record with the forecast that stood before the day", async () => {
    const { service } = makeService({ recorded: LEDGER(), weather: WEATHER() });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);

    expect(out.days).toHaveLength(1);
    expect(out.days[0].recorded?.covers).toBe(41);
    expect(out.days[0].forecastInAdvance?.issuer).toBe("NOAA/NWS");
    // Issued three days before "now", scored against YESTERDAY's UTC midnight —
    // so the whole-day lead is 1 or 2 depending on the hour the suite runs.
    expect(out.days[0].forecastInAdvance?.leadDays).toBeGreaterThanOrEqual(1);
  });

  it("writes the pair with accuracy_score NULL, never a score", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);

    expect(out.pairsWritten).toBe(1);
    const row = inserted[0][0];
    expect(row.agent_name).toBe(CALENDAR_LEDGER_AGENT);
    expect(row.prediction_type).toBe(PAIRING_TYPE);
    expect(row.accuracy_score).toBeNull();
    expect(row.actual_value.covers).toBe(41);
    expect(row.predicted_value.temperatureHigh).toBe(75);
    expect(row.context.businessDate).toBe(YESTERDAY);
  });

  it("does not write the same day twice", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      existingOutcomes: [{ context: { businessDate: YESTERDAY } }],
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.pairsWritten).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("writes nothing rather than blind, when the outcome ledger cannot be read", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      outcomeReadError: { message: "connection reset" },
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.pairsWritten).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("never pairs a day the house was shut", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER({
        days: [
          {
            businessDate: YESTERDAY,
            checkCount: 0,
            sales: null,
            covers: null,
            excluded: true,
            exclusionReason: "Closed for a private event",
          },
        ],
      }),
      weather: WEATHER(),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(inserted).toHaveLength(0);
    expect(out.days[0].line).toContain("Closed — Closed for a private event");
  });

  it("keeps the two registers' refusals apart", async () => {
    const { service } = makeService({
      recorded: LEDGER({ refusal: "The sales register could not be read.", days: [] }),
      weather: WEATHER({
        refusal: "No location is set for this house",
        forecastInAdvance: [],
      }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.recordedRefusal).toContain("sales register");
    expect(out.weatherRefusal).toContain("No location is set");
  });

  it("leaves today and the future out — a day still running has no record", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { service } = makeService({
      recorded: LEDGER({
        days: [
          {
            businessDate: today,
            checkCount: 3,
            sales: 100,
            covers: 6,
            excluded: false,
            exclusionReason: null,
          },
        ],
      }),
      weather: WEATHER({ forecastInAdvance: [] }),
    });

    const out = await service.windowFor("r1", today, today);
    expect(out.days).toHaveLength(0);
  });
});
