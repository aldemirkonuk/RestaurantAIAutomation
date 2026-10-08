import {
  DayRecordService,
  CALENDAR_LEDGER_AGENT,
  PAIRING_TYPE,
  leadDaysFor,
  reconciliationLine,
  scoreForecast,
  toCelsius,
  withholdHouseMoney,
} from "./day-record.service";
import { CalendarController } from "./calendar.controller";
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

  it("says a refused register could not be read, never that there is none (ADR 0287 F4)", () => {
    // posConnected null is the register refusing (ADR 0292). The line must not
    // say "no register" over one that exists, nor "nothing recorded" over a
    // day whose checks could not be read.
    const line = reconciliationLine(null, true, null);
    expect(line).toBe(
      "The sales register could not be read, so this day's trading is not known.",
    );
    expect(line).not.toMatch(/No sales register is connected|Nothing was recorded/);
    // The weather half is still said: it does not depend on the register.
    expect(reconciliationLine(null, true, null, 1.11)).toContain("out by 1.1 °C");
    // and `false` still means no register at all
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

/** An owner's view (a manager's is the same): the house's money included (ADR 0287 F1). */
const OWNER = { seesHouseMoney: true } as const;

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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);

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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);

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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.pairsWritten).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("writes nothing rather than blind, when the outcome ledger cannot be read", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      outcomeReadError: { message: "connection reset" },
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.recordedRefusal).toContain("sales register");
    expect(out.weatherRefusal).toContain("No location is set");
    // The ledger double carried `posConnected: true` beside its refusal; the
    // window still says "not known", because a refusal answers nothing about
    // the register (ADR 0287 F4).
    expect(out.posConnected).toBeNull();
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

    const out = await service.windowFor("r1", today, today, OWNER);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);

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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);

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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    // The observation still makes it pairable, but the LINE leads with the
    // closure — a closed day must never read as a quiet one.
    expect(out.days[0].line).toContain("Closed — Closed for a private event");
    expect(inserted.length <= 1).toBe(true);
  });
});

/* ── the day's takings are NET, and travel with their currency (ADR 0287) ─── */

describe("RecordedDaysService — reads the net column, whole (ADR 0287 on ADR 0292)", () => {
  /**
   * A `pos_checks` double shaped like PostgREST: every response stops at the
   * server's `max_rows` (1,000) whatever was asked, `{ count: "exact" }` is the
   * size of the set past the `.gt("id", …)` cursor, `order` / `limit` are
   * honoured, and a row carries only the columns the select named.
   * `ignoreCursor` is a server that drops the cursor, so the read can never be
   * proved whole. `probeError` fails the `select("id")` probe that asks whether
   * the house has ever had a check. Filters other than the cursor are not applied:
   * every row handed in belongs to the window.
   */
  function pagedDb(
    checks: Array<Record<string, unknown>>,
    opts: { ignoreCursor?: boolean; probeError?: boolean } = {},
  ) {
    const CAP = 1000;
    const reads: Array<{
      table: string;
      columns: string;
      count?: string;
      order?: string;
      gt?: string;
      limit?: number;
    }> = [];
    const from = (table: string) => {
      const req: (typeof reads)[number] = { table, columns: "" };
      reads.push(req);
      const c: any = {
        select: (columns: string, o?: { count?: string }) => {
          req.columns = columns;
          req.count = o?.count;
          return c;
        },
        eq: () => c,
        gte: () => c,
        lt: () => c,
        lte: () => c,
        order: (col: string) => {
          req.order = col;
          return c;
        },
        gt: (col: string, val: string) => {
          if (col === "id") req.gt = val;
          return c;
        },
        limit: (n: number) => {
          req.limit = n;
          return c;
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table !== "pos_checks") {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
          // The `select("id")` probe: has this house EVER had a check land?
          if (opts.probeError && req.columns === "id") {
            return Promise.resolve({
              data: null,
              error: { message: "connection reset" },
            }).then(resolve);
          }
          const sorted = [...checks].sort((a, b) =>
            String(a.id).localeCompare(String(b.id)),
          );
          const past =
            req.gt !== undefined && !opts.ignoreCursor
              ? sorted.filter((r) => String(r.id) > String(req.gt))
              : sorted;
          // Only the columns asked for come back, as PostgREST projects them.
          const cols = req.columns.split(",").map((c) => c.trim());
          const pick = (r: Record<string, unknown>) =>
            Object.fromEntries(cols.map((c) => [c, r[c] ?? null]));
          return Promise.resolve({
            data: past.slice(0, Math.min(req.limit ?? Infinity, CAP)).map(pick),
            error: null,
            count: req.count === "exact" ? past.length : null,
          }).then(resolve);
        },
      };
      return c;
    };
    return { db: { supabase: { from } } as never, reads };
  }

  /** `n` checks spread over the 31 days from 2026-08-01, ids sortable. */
  function month(n: number, subtotal: string | null = "10.00") {
    return Array.from({ length: n }, (_, i) => {
      const day = String(1 + (i % 31)).padStart(2, "0");
      return {
        id: `chk-${String(i).padStart(5, "0")}`,
        opened_at: `2026-08-${day}T19:00:00Z`,
        closed_at: `2026-08-${day}T19:40:00Z`,
        subtotal,
        total: "11.26",
        covers: 2,
      };
    });
  }

  it("selects pos_checks.subtotal, not the gross total, and folds it as netSales", async () => {
    const { db, reads } = pagedDb([
      {
        id: "chk-1",
        opened_at: "2026-09-02T19:00:00Z",
        closed_at: null,
        subtotal: "100.00",
        total: "112.63",
        covers: 2,
      },
    ]);
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      "2026-09-02",
      "2026-09-02",
    );

    const checkRead = reads.find(
      (r) => r.table === "pos_checks" && r.columns !== "id",
    )!;
    const columns = checkRead.columns.split(",").map((c) => c.trim());
    expect(columns).toContain("subtotal");
    expect(columns).not.toContain("total");
    // The read is the counted, paged one (ADR 0292), not a bare select.
    expect(columns).toContain("id");
    expect(checkRead.count).toBe("exact");
    expect(checkRead.order).toBe("id");
    expect(out.refusal).toBeNull();
    expect(out.days[0].netSales).toBe(100);
    expect(out.days[0].netSalesCheckCount).toBe(1);
  });

  it("sums the net takings of every check in a month past the server's 1,000-row cap", async () => {
    // Tuzlu's August window held 2,121 checks (A-031). Cut at 1,000, every
    // day's figure would be short while its count said "all of them".
    const { db, reads } = pagedDb(month(2121));
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      "2026-08-01",
      "2026-08-31",
    );

    expect(out.refusal).toBeNull();
    expect(out.days).toHaveLength(31);
    const checks = out.days.reduce((n, d) => n + d.checkCount, 0);
    const carried = out.days.reduce((n, d) => n + d.netSalesCheckCount, 0);
    const net = out.days.reduce((n, d) => n + (d.netSales ?? 0), 0);
    expect(checks).toBe(2121);
    expect(carried).toBe(2121);
    expect(net).toBeCloseTo(21210, 2);
    expect(out.days.every((d) => d.netSalesCheckCount === d.checkCount)).toBe(
      true,
    );
    // Three pages: 1,000 + 1,000 + 121.
    expect(
      reads.filter((r) => r.table === "pos_checks" && r.columns !== "id"),
    ).toHaveLength(3);
  });

  it("a register read only in part refuses: no day, so no takings, is drawn from part of it", async () => {
    const { db } = pagedDb(month(2121), { ignoreCursor: true });
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      "2026-08-01",
      "2026-08-31",
    );

    expect(out.days).toEqual([]);
    expect(out.refusal).toBe(
      "The sales register could not be read whole, so no day is drawn from part of it.",
    );
    // Not known, never "no register" (ADR 0287 F4).
    expect(out.posConnected).toBeNull();
  });

  it("a probe that fails says the register could not be read, and posConnected is not known", async () => {
    // A window with no checks asks whether the house has EVER had one. When
    // that one read fails, the answer is neither yes nor no.
    const { db } = pagedDb([], { probeError: true });
    const out = await new RecordedDaysService(db).windowFor(
      "r1",
      "2026-08-01",
      "2026-08-31",
    );
    expect(out.days).toEqual([]);
    expect(out.refusal).toBe("The sales register could not be read.");
    expect(out.posConnected).toBeNull();
  });

  it("the refusal reaches the day record as a refusal, with no takings and no pair frozen", async () => {
    // The day is pairable on its weather half alone (a forecast before it, a
    // station's measurement after), so only the refusal keeps it unwritten.
    const { db } = pagedDb(month(2121), { ignoreCursor: true });
    const ledger = await new RecordedDaysService(db).windowFor(
      "r1",
      YESTERDAY,
      YESTERDAY,
    );
    const { service, inserted } = makeService({
      recorded: ledger,
      weather: WEATHER({
        observations: [
          {
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
          },
        ],
      }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);

    expect(out.recordedRefusal).toMatch(/could not be read whole/);
    expect(out.days).toHaveLength(1);
    expect(out.days[0].recorded).toBeNull();
    expect(out.pairsWritten).toBe(0);
    expect(inserted).toHaveLength(0);
    // The day's line says the register could not be read, not that the house
    // has none (ADR 0287 F4); the weather half is still scored.
    expect(out.posConnected).toBeNull();
    expect(out.days[0].line).toBe(
      "The sales register could not be read, so this day's trading is not known. " +
        "The forecast was out by 1.1 °C on the high.",
    );
    expect(out.days[0].line).not.toMatch(/No sales register is connected/);
    // A viewer the money is withheld from gets the same line and the same
    // null: neither carries a figure.
    const staff = await service.windowFor("r1", YESTERDAY, YESTERDAY, {
      seesHouseMoney: false,
    });
    expect(staff.posConnected).toBeNull();
    expect(staff.days[0].line).toBe(out.days[0].line);
  });

  it("the same day, read whole, is paired with its net takings", async () => {
    // The control for the case above: same weather, a register that answers.
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER({
        observations: [
          {
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
          },
        ],
      }),
    });

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.pairsWritten).toBe(1);
    expect(inserted[0][0].actual_value.netSales).toBe(3400);
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

    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.days[0].recorded).toMatchObject({
      netSales: 1234.5,
      netSalesCheckCount: 3,
      checkCount: 5,
    });
    expect(out.days[0].recorded).not.toHaveProperty("sales");
  });

  it("sends the house's currency with its money", async () => {
    const { service } = makeService({ recorded: LEDGER(), weather: WEATHER() });
    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.currency).toEqual({ code: "USD", readable: true });
  });

  it("says a house never recorded a currency -- null, never dollars", async () => {
    const { service } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      currency: null,
    });
    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.currency).toEqual({ code: null, readable: true });
  });

  it("keeps an unreadable currency apart from one never recorded", async () => {
    const { service } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
      currencyReadError: { message: "connection reset" },
    });
    const out = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    expect(out.currency).toEqual({ code: null, readable: false });
    // The day itself still comes back: a currency read is not the ledger.
    expect(out.days[0].recorded?.netSales).toBe(3400);
  });

  it("keeps the pair's takings under a key that names their basis", async () => {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
    });

    await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    const actual = inserted[0][0].actual_value;
    expect(actual.netSales).toBe(3400);
    expect(actual.netSalesCheckCount).toBe(12);
    expect(actual.netSalesCurrency).toEqual({ code: "USD", readable: true });
    // Rows written before ADR 0287 carry `sales`, which was GROSS. A new row
    // must never write that key, or the two bases would read as one series.
    expect(actual).not.toHaveProperty("sales");
  });
});

/* ── who sees the takings (ADR 0287 F1) ─────────────────────────────────────── */

/**
 * The founder, 2026-10-04 ~02:10Z: *"everyone owners and managers, authorized
 * ones see everything others only see actions, goals dedicated to them"*.
 * Owners and managers get the day's net takings and the currency; every other
 * role, and a session holding no role in the house, gets the days with those
 * keys LEFT OUT. The controller is driven over the real service, so the payload asserted
 * is the one the route returns, not a mock's.
 */
describe("GET /calendar/day-record — the takings are an owner's and a manager's", () => {
  function routeAs(role: string | null | undefined) {
    const { service, inserted } = makeService({
      recorded: LEDGER(),
      weather: WEATHER(),
    });
    const controller = new CalendarController(
      {} as never,
      {} as never,
      {} as never,
      service,
      {} as never,
      {} as never,
      {} as never,
    );
    const read = () =>
      controller.getDayRecord({ from: YESTERDAY, to: YESTERDAY } as never, {
        userId: "u1",
        restaurantId: "r1",
        role,
      });
    return { read, inserted };
  }

  it.each(["owner", "manager"])(
    "%s sees the net takings and the currency",
    async (role) => {
      const out = await routeAs(role).read();
      expect(out).not.toHaveProperty("takingsWithheld");
      expect(out).toHaveProperty("currency", { code: "USD", readable: true });
      expect(out.days[0].recorded).toMatchObject({
        netSales: 3400,
        netSalesCheckCount: 12,
        covers: 41,
      });
    },
  );

  it.each([["staff"], ["host"], [null], [undefined]])(
    "role %p gets the days with the money keys LEFT OUT, never zeroed",
    async (role) => {
      const out = await routeAs(role).read();
      expect(out).toHaveProperty("takingsWithheld", true);
      expect(out).not.toHaveProperty("currency");
      const recorded = out.days[0].recorded;
      expect(recorded).not.toHaveProperty("netSales");
      expect(recorded).not.toHaveProperty("netSalesCheckCount");
      expect(recorded).not.toHaveProperty("sales");
      // Covers are not money: the day still says what it held.
      expect(recorded).toMatchObject({ covers: 41, checkCount: 12 });
      expect(out.days[0].line).toEqual(expect.any(String));
    },
  );

  it("still writes the house's evidence pair in full when staff opened the page", async () => {
    const { read, inserted } = routeAs("staff");
    await read();
    const actual = inserted[0][0].actual_value;
    expect(actual.netSales).toBe(3400);
    expect(actual.netSalesCheckCount).toBe(12);
    expect(actual.netSalesCurrency).toEqual({ code: "USD", readable: true });
  });
});

describe("withholdHouseMoney", () => {
  it("keeps everything but the money, and says the money was withheld", async () => {
    const { service } = makeService({ recorded: LEDGER(), weather: WEATHER() });
    const full = await service.windowFor("r1", YESTERDAY, YESTERDAY, OWNER);
    const out = withholdHouseMoney(full);

    expect(Object.keys(out).sort()).toEqual(
      Object.keys(full)
        .filter((k) => k !== "currency")
        .concat("takingsWithheld")
        .sort(),
    );
    expect(Object.keys(out.days[0].recorded!).sort()).toEqual([
      "checkCount",
      "covers",
      "excluded",
      "exclusionReason",
    ]);
    const { recorded: _fullRecorded, ...fullRest } = full.days[0];
    const { recorded: _outRecorded, ...outRest } = out.days[0];
    expect(outRest).toEqual(fullRest);
    // No money anywhere in what staff receive, at any depth.
    expect(JSON.stringify(out)).not.toMatch(/netSales|"currency"|3400/);
  });
});
