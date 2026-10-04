import {
  DayRecordService,
  CALENDAR_LEDGER_AGENT,
  PAIRING_TYPE,
  leadDaysFor,
  reconciliationLine,
  scoreForecast,
  toCelsius,
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
 *  2. A `prediction_outcomes` row carries a score ONLY when something was
 *     actually observed to score against. When a station observed the day, the
 *     row carries the absolute forecast error in °C (see the "writing the first
 *     real accuracy_score" block below); when no station did, `accuracy_score`
 *     is NULL and `context.withheld` says which half was missing. A number in
 *     the second case would be invented arithmetic wearing a metric's clothes.
 *     (Point 2 said "every row carries null, always" until 2026-09-04; that was
 *     written before the scoring half landed and had been false since.)
 */

describe("checkBusinessDate", () => {
  it("prefers closed_at, the same rule goal progress applies", () => {
    expect(
      checkBusinessDate({
        opened_at: "2026-09-02T23:40:00Z",
        closed_at: "2026-09-03T00:20:00Z",
        subtotal: 10,
        covers: 2,
      }),
    ).toBe("2026-09-03");
  });

  it("falls back to opened_at for a check that never closed", () => {
    expect(
      checkBusinessDate({
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: 10,
        covers: 2,
      }),
    ).toBe("2026-09-02");
  });
});

describe("foldChecksToDays", () => {
  it("sums net takings and covers per day", () => {
    const days = foldChecksToDays([
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "40.50",
        covers: 2,
      },
      {
        opened_at: "2026-09-02T20:00:00Z",
        closed_at: null,
        subtotal: "59.50",
        covers: 4,
      },
    ]);
    const day = days.get("2026-09-02")!;
    expect(day.checkCount).toBe(2);
    expect(day.netSales).toBe(100);
    expect(day.netSalesCheckCount).toBe(2);
    expect(day.covers).toBe(6);
  });

  it("sums the NET subtotal and never the gross total (ADR 0287)", () => {
    // Two checks shaped like the walk's: total = net + 8.63% tax + 4%
    // surcharge. The day took 200 net; 225.26 is what it took with the tax
    // the house hands on, which is not the house's money.
    const rows = [
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "100.00",
        total: "112.63",
        covers: 2,
      },
      {
        opened_at: "2026-09-02T20:00:00Z",
        closed_at: null,
        subtotal: "100.00",
        total: "112.63",
        covers: 2,
      },
    ];
    const day = foldChecksToDays(rows).get("2026-09-02")!;
    expect(day.netSales).toBe(200);
    expect(day.netSales).not.toBeCloseTo(225.26, 2);
    expect(day).not.toHaveProperty("sales");
  });

  it("leaves net takings NULL, never 0 and never the gross, when no check carried a subtotal", () => {
    const rows = [
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: null,
        total: "112.63",
        covers: 2,
      },
      {
        opened_at: "2026-09-02T20:00:00Z",
        closed_at: null,
        subtotal: null,
        total: "56.31",
        covers: 1,
      },
    ];
    const day = foldChecksToDays(rows).get("2026-09-02")!;
    expect(day.checkCount).toBe(2);
    expect(day.netSales).toBeNull();
    expect(day.netSalesCheckCount).toBe(0);
  });

  it("counts the checks a partial net figure came from", () => {
    // One check carried a subtotal, one did not. The figure is that one
    // subtotal -- not topped up with the other's total -- and the count says
    // it is one of two, so the page can say the day took more than this.
    const rows = [
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "80.00",
        total: "90.10",
        covers: 2,
      },
      {
        opened_at: "2026-09-02T20:00:00Z",
        closed_at: null,
        subtotal: null,
        total: "45.05",
        covers: 1,
      },
    ];
    const day = foldChecksToDays(rows).get("2026-09-02")!;
    expect(day.checkCount).toBe(2);
    expect(day.netSalesCheckCount).toBe(1);
    expect(day.netSales).toBe(80);
  });

  it("leaves covers NULL when no check on the day carried one", () => {
    // The load-bearing case. A POS that does not send cover counts must not
    // produce a day reading "0 covers" beside a day of real trading — that is
    // the absence-reported-as-health fault in the column the covers model will
    // one day be built on.
    const days = foldChecksToDays([
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "40.50",
        covers: null,
      },
    ]);
    const day = days.get("2026-09-02")!;
    expect(day.checkCount).toBe(1);
    expect(day.netSales).toBe(40.5);
    expect(day.covers).toBeNull();
  });

  it("counts a check that carried covers even when a sibling did not", () => {
    const days = foldChecksToDays([
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "10",
        covers: null,
      },
      {
        opened_at: "2026-09-02T20:00:00Z",
        closed_at: null,
        subtotal: "10",
        covers: 3,
      },
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
    netSales: 300,
    netSalesCheckCount: 3,
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
  /** `restaurants.currency` as stored; `undefined` means the row says USD. */
  currency?: string | null;
  currencyReadError?: { message: string };
}) {
  const inserted: any[][] = [];

  // `restaurants` answers the one-row currency read; every other table is the
  // outcome ledger, as before.
  const restaurantsChain = (): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      maybeSingle: () =>
        Promise.resolve(
          opts.currencyReadError
            ? { data: null, error: opts.currencyReadError }
            : {
                data: {
                  currency: opts.currency === undefined ? "USD" : opts.currency,
                },
                error: null,
              },
        ),
    };
    return c;
  };

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

  const db = {
    supabase: {
      from: (table: string) =>
        table === "restaurants" ? restaurantsChain() : outcomesChain(),
    },
  } as never;
  const recorded = { windowFor: async () => opts.recorded } as never;
  const weather = { windowFor: async () => opts.weather } as never;

  return { service: new DayRecordService(db, recorded, weather), inserted };
}

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const WEATHER = (over = {}) => ({
  refusal: null,
  observationRefusal: null,
  observations: [],
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
      netSales: 3400,
      netSalesCheckCount: 12,
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

  it("withholds the score when nothing observed the day — NULL, never a guess", async () => {
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
    // NULL because nothing observed, and the row SAYS which half was missing —
    // a null with no reason beside it is the absence-as-health shape again.
    expect(row.context.withheld).toBe("no station observed a high for this day");
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
            netSales: null,
            netSalesCheckCount: 0,
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
            netSales: 100,
            netSalesCheckCount: 3,
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

/* ── the score itself (ADR 0111, observations added 2026-09-04) ───────────── */

describe("toCelsius", () => {
  it("converts Fahrenheit and leaves Celsius alone", () => {
    expect(toCelsius(75, "F")).toBeCloseTo(23.889, 3);
    expect(toCelsius(32, "F")).toBe(0);
    expect(toCelsius(20, "C")).toBe(20);
  });
});

describe("scoreForecast", () => {
  it("scores a real pair in Celsius — the observation's own unit", () => {
    // NWS forecast 75 °F = 23.89 °C; KPAO observed 25 °C. Error 1.11.
    const { errorC, withheld } = scoreForecast(75, "F", 25, "C");
    expect(withheld).toBeNull();
    expect(errorC).toBeCloseTo(1.11, 2);
  });

  it("is an ABSOLUTE error, so an over- and under-forecast score alike", () => {
    expect(scoreForecast(20, "C", 25, "C").errorC).toBe(5);
    expect(scoreForecast(30, "C", 25, "C").errorC).toBe(5);
  });

  it("gives a perfect forecast a zero, which is a real score not a missing one", () => {
    const { errorC, withheld } = scoreForecast(25, "C", 25, "C");
    expect(errorC).toBe(0);
    expect(withheld).toBeNull();
  });

  it("withholds, and says WHICH side is missing, when the forecast is absent", () => {
    expect(scoreForecast(null, "F", 25, "C")).toEqual({
      errorC: null,
      withheld: "no forecast high stood before this day",
    });
  });

  it("withholds, and says which side, when no station observed the day", () => {
    expect(scoreForecast(75, "F", null, "C")).toEqual({
      errorC: null,
      withheld: "no station observed a high for this day",
    });
    expect(scoreForecast(75, "F", 25, undefined)).toEqual({
      errorC: null,
      withheld: "no station observed a high for this day",
    });
  });
});

describe("reconciliationLine — the weather half", () => {
  const day = {
    businessDate: "2026-09-02",
    checkCount: 3,
    netSales: 300,
    netSalesCheckCount: 3,
    covers: 12,
    excluded: false,
    exclusionReason: null,
  };

  it("states the error in words when there is one", () => {
    expect(reconciliationLine(day, true, true, 1.11)).toContain("out by 1.1 °C");
  });

  it("says a forecast that landed exactly, landed exactly", () => {
    expect(reconciliationLine(day, true, true, 0)).toContain("called the high exactly");
  });

  it("says nothing about the weather when the score was withheld", () => {
    const line = reconciliationLine(day, true, true, null);
    expect(line).not.toMatch(/°C/);
    expect(line).toContain("no covers model exists yet");
  });

  it("still reports the weather error on a day with no covers", () => {
    // The two halves are scored independently: a POS that sends no cover counts
    // does not make the meteorologist's error unknowable.
    const line = reconciliationLine({ ...day, covers: null }, true, true, 2.5);
    expect(line).toContain("Covers were not recorded");
    expect(line).toContain("out by 2.5 °C");
  });
});

describe("DayRecordService — writing the first real accuracy_score", () => {
  const OBSERVED = {
    businessDate: YESTERDAY,
    issuer: "NOAA/NWS",
    stationId: "KPAO",
    stationName: "Palo Alto Airport",
    timeZone: "America/Los_Angeles",
    firstObservedAt: `${YESTERDAY}T14:47:00Z`,
    lastObservedAt: `${YESTERDAY}T23:47:00Z`,
    observationCount: 18,
    fetchedAt: new Date().toISOString(),
    temperatureHigh: 25,
    temperatureLow: 13,
    temperatureUnit: "C" as const,
    precipitationTotalMm: null,
  };

  it("writes the error in accuracy_score, with the metric stated in words", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER({ observations: [OBSERVED] }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);

    expect(out.pairsWritten).toBe(1);
    const row = inserted[0][0];
    // forecast 75 °F = 23.89 °C against an observed 25 °C.
    expect(row.accuracy_score).toBeCloseTo(1.11, 2);
    expect(row.context.metric).toContain("LOWER IS BETTER");
    expect(row.context.metric).toContain("degrees Celsius");
    expect(row.context.withheld).toBeNull();
    // Both raw sides are kept, so the score can be recomputed rather than trusted.
    expect(row.predicted_value.temperatureHigh).toBe(75);
    expect(row.actual_value.observedTemperatureHigh).toBe(25);
    expect(row.actual_value.observationStation).toBe("KPAO");
    expect(row.actual_value.observationCount).toBe(18);
  });

  it("surfaces the error on the day and in its line", async () => {
    const { service } = makeService({
      recorded: LEDGER(),
      weather: WEATHER({ observations: [OBSERVED] }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.days[0].forecastErrorC).toBeCloseTo(1.11, 2);
    expect(out.days[0].scoreWithheld).toBeNull();
    expect(out.days[0].observed?.stationId).toBe("KPAO");
    expect(out.days[0].line).toContain("out by 1.1 °C");
  });

  it("withholds the score when no station observed the day", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);

    expect(out.days[0].forecastErrorC).toBeNull();
    expect(out.days[0].scoreWithheld).toBe("no station observed a high for this day");
    expect(inserted[0][0].accuracy_score).toBeNull();
    expect(inserted[0][0].context.withheld).toBe(
      "no station observed a high for this day",
    );
    expect(inserted[0][0].context.note).toContain("No score:");
  });

  it("withholds the score when no forecast stood before the day", async () => {
    const { service } = makeService({
      recorded: LEDGER(),
      weather: WEATHER({ forecastInAdvance: [], observations: [OBSERVED] }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.days[0].forecastErrorC).toBeNull();
    expect(out.days[0].scoreWithheld).toBe("no forecast high stood before this day");
    // and nothing is written: a forecast is the thing being scored.
    expect(out.pairsWritten).toBe(0);
  });

  it("keeps a day that has a forecast and an observation but no trading", async () => {
    // The weather half is scoreable on a day the house was closed to the public
    // or the POS was silent; that evidence is worth keeping.
    const { service, inserted } = makeService({
      recorded: LEDGER({ days: [] }),
      weather: WEATHER({ observations: [OBSERVED] }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.pairsWritten).toBe(1);
    expect(inserted[0][0].actual_value.covers).toBeNull();
    expect(inserted[0][0].actual_value.checkCount).toBe(0);
    expect(inserted[0][0].accuracy_score).toBeCloseTo(1.11, 2);
  });

  it("never scores a day the house was ruled out of the baselines", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER({
        days: [
          {
            businessDate: YESTERDAY,
            checkCount: 0,
            netSales: null,
            netSalesCheckCount: 0,
            covers: null,
            excluded: true,
            exclusionReason: "Closed for a private event",
          },
        ],
      }),
      weather: WEATHER({ observations: [OBSERVED] }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    // The observation still makes it pairable, but the LINE leads with the
    // closure — a closed day must never read as a quiet one.
    expect(out.days[0].line).toContain("Closed — Closed for a private event");
    expect(inserted.length <= 1).toBe(true);
  });
});

/* ── the day's takings are NET, and travel with their currency (ADR 0287) ─── */

describe("RecordedDaysService — reads the net column", () => {
  function fakeDb(checks: any[]) {
    const selects: Array<{ table: string; columns: string }> = [];
    const from = (table: string) => {
      const c: any = {
        select: (columns: string) => {
          selects.push({ table, columns });
          return c;
        },
        eq: () => c,
        gte: () => c,
        lt: () => c,
        lte: () => c,
        limit: () => c,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === "pos_checks" ? checks : [],
            error: null,
          }).then(resolve),
      };
      return c;
    };
    return { db: { supabase: { from } } as never, selects };
  }

  it("selects pos_checks.subtotal, not the gross total, and folds it as netSales", async () => {
    const { db, selects } = fakeDb([
      {
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "100.00",
        covers: 2,
      },
    ]);
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      "2026-09-02",
      "2026-09-02",
    );

    const checkRead = selects.find(
      (s) => s.table === "pos_checks" && s.columns !== "id",
    )!;
    const columns = checkRead.columns.split(",").map((c) => c.trim());
    expect(columns).toContain("subtotal");
    expect(columns).not.toContain("total");
    expect(out.days[0].netSales).toBe(100);
    expect(out.days[0].netSalesCheckCount).toBe(1);
  });
});

describe("DayRecordService — net takings and the house currency", () => {
  it("passes the day's net takings through, with the count they came from", async () => {
    const { service } = makeService({
      recorded: LEDGER({
        days: [
          {
            businessDate: YESTERDAY,
            checkCount: 5,
            netSales: 1234.5,
            netSalesCheckCount: 3,
            covers: 20,
            excluded: false,
            exclusionReason: null,
          },
        ],
      }),
      weather: WEATHER(),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.days[0].recorded).toMatchObject({
      netSales: 1234.5,
      netSalesCheckCount: 3,
      checkCount: 5,
    });
    expect(out.days[0].recorded).not.toHaveProperty("sales");
  });

  it("sends the house's currency with its money", async () => {
    const { service } = makeService({ recorded: LEDGER(), weather: WEATHER() });
    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.currency).toEqual({ code: "USD", readable: true });
  });

  it("says a house never recorded a currency -- null, never dollars", async () => {
    const { service } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      currency: null,
    });
    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.currency).toEqual({ code: null, readable: true });
  });

  it("keeps an unreadable currency apart from one never recorded", async () => {
    const { service } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      currencyReadError: { message: "connection reset" },
    });
    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY);
    expect(out.currency).toEqual({ code: null, readable: false });
    // The day itself still comes back: a currency read is not the ledger.
    expect(out.days[0].recorded?.netSales).toBe(3400);
  });

  it("keeps the pair's takings under a key that names their basis", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
    });

    await service.windowFor("r1", YESTERDAY, YESTERDAY);
    const actual = inserted[0][0].actual_value;
    expect(actual.netSales).toBe(3400);
    expect(actual.netSalesCheckCount).toBe(12);
    expect(actual.netSalesCurrency).toEqual({ code: "USD", readable: true });
    // Rows written before ADR 0287 carry `sales`, which was GROSS. A new row
    // must never write that key, or the two bases would read as one series.
    expect(actual).not.toHaveProperty("sales");
  });
});
