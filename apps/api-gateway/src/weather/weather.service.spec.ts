import {
  WeatherService,
  earliestPriorIssuancePerDay,
  newestPerDay,
} from "./weather.service";
import { WeatherUnavailableError } from "./weather-provider";

/**
 * The weather window: what the calendar is allowed to claim, and what it must
 * say instead.
 *
 * Every branch here is a sentence the page prints. The rule the whole file
 * exists to hold: an empty `readings` list NEVER means a failure. Either
 * `refusal` carries the reason the overlay is dark, or `staleReason` carries
 * the reason the readings shown are old — and a blank column with neither is
 * the absence-reported-as-health fault this table was built to avoid.
 */

const R = "rest-1";

type Row = Record<string, unknown>;

function makeService(opts: {
  restaurant?: Row | null;
  restaurantError?: { message: string } | null;
  stored?: Row[];
  storedError?: { message: string } | null;
  forecast?: unknown;
  forecastError?: Error;
}) {
  const upserts: Row[][] = [];
  let readCount = 0;

  const readingsChain = (): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      gte: () => c,
      lte: () => c,
      order: () => c,
      upsert: (payload: Row[]) => {
        upserts.push(payload);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        readCount += 1;
        return Promise.resolve({
          data: opts.storedError ? null : (opts.stored ?? []),
          error: opts.storedError ?? null,
        }).then(resolve);
      },
    };
    return c;
  };

  const restaurantChain = (): any => {
    const c: any = {
      select: () => c,
      eq: () => c,
      single: async () => ({
        data: opts.restaurantError ? null : (opts.restaurant ?? null),
        error: opts.restaurantError ?? null,
      }),
    };
    return c;
  };

  const db = {
    supabase: {
      from: (table: string) =>
        table === "restaurants" ? restaurantChain() : readingsChain(),
    },
  } as never;

  const provider = {
    issuer: "NOAA/NWS",
    forecast: jest.fn(async () => {
      if (opts.forecastError) throw opts.forecastError;
      return (
        opts.forecast ?? {
          issuer: "NOAA/NWS",
          issuerDetail: "MTR/91,89",
          issuedAt: "2026-09-03T12:26:50.000Z",
          days: [],
          horizonDays: 7,
          advisories: [],
          advisoriesReadable: true,
        }
      );
    }),
  } as never;

  return {
    service: new WeatherService(db, provider),
    provider: provider as unknown as { forecast: jest.Mock },
    upserts,
    reads: () => readCount,
  };
}

const HOUSE = { id: R, name: "Sim Meyhouse", latitude: 37.4419, longitude: -122.143 };

const storedRow = (over: Row = {}): Row => ({
  business_date: "2026-09-03",
  issuer: "NOAA/NWS",
  issuer_detail: "MTR/91,89",
  issued_at: "2026-09-03T12:26:50.000Z",
  fetched_at: new Date().toISOString(),
  valid_from: "2026-09-03T06:00:00-07:00",
  valid_to: "2026-09-04T06:00:00-07:00",
  temperature_high: "75.00",
  temperature_low: "58.00",
  temperature_unit: "F",
  precipitation_probability: 27,
  precipitation_amount_mm: null,
  wind_summary: "2 to 12 mph",
  short_forecast: "Mostly Sunny then Chance Light Rain",
  ...over,
});

describe("WeatherService.windowFor — the refusals, each in words", () => {
  it("says there is no location when the house has no coordinate", async () => {
    // The state ALL FOURTEEN production rows were in on 2026-09-03. It has to
    // be a sentence with an action in it, not a blank column.
    const { service, provider } = makeService({
      restaurant: { id: R, name: "N", latitude: null, longitude: null },
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");

    expect(out.refusalReason).toBe("no-coordinate");
    expect(out.refusal).toContain("No location is set for this house");
    expect(out.readings).toEqual([]);
    // And it does not call the issuer at all — there is nothing to ask about.
    expect(provider.forecast).not.toHaveBeenCalled();
  });

  it("refuses a half-pair rather than pointing at a meridian", async () => {
    const { service } = makeService({
      restaurant: { id: R, name: "N", latitude: 37.4419, longitude: null },
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(out.refusalReason).toBe("no-coordinate");
  });

  it("separates an unreadable restaurant record from an absent coordinate", async () => {
    const { service } = makeService({
      restaurantError: { message: "connection reset" },
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(out.refusalReason).toBe("store-unreadable");
    expect(out.refusal).toContain("could not be read");
  });

  it("separates an unreadable weather register from an empty one", async () => {
    // supabase-js RESOLVES with { data, error }; a caller reading only `data`
    // sees [] for both. The service returns null internally so these two
    // cannot collapse.
    const { service } = makeService({
      restaurant: HOUSE,
      storedError: { message: "42P01 relation does not exist" },
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(out.refusalReason).toBe("store-unreadable");
  });

  it("passes the issuer's own out-of-coverage sentence through when nothing is stored", async () => {
    const { service } = makeService({
      restaurant: { ...HOUSE, latitude: 41.0082, longitude: 28.9784 },
      stored: [],
      forecastError: new WeatherUnavailableError(
        "The National Weather Service does not cover this location — it serves the United States only.",
        "outside-coverage",
      ),
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");

    expect(out.refusalReason).toBe("outside-coverage");
    expect(out.refusal).toContain("United States only");
  });

  it("keeps stale readings and says how old they are, rather than blanking the grid", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const { service } = makeService({
      restaurant: HOUSE,
      stored: [storedRow({ fetched_at: twoHoursAgo })],
      forecastError: new WeatherUnavailableError(
        "The weather service answered 503.",
        "issuer-refused",
      ),
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");

    expect(out.refusal).toBeNull();
    expect(out.staleReason).toContain("503");
    expect(out.readings).toHaveLength(1);
    expect(out.ageMinutes).toBeGreaterThanOrEqual(119);
  });

  it("reports a non-provider failure without pretending the forecast is clear", async () => {
    const { service } = makeService({
      restaurant: HOUSE,
      stored: [],
      forecastError: new TypeError("undefined is not a function"),
    });

    const out = await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(out.refusalReason).toBe("issuer-unreachable");
    expect(out.readings).toEqual([]);
  });
});

describe("WeatherService.windowFor — the refresh policy", () => {
  it("does not call the issuer when the newest reading is inside the max age", async () => {
    const { service, provider } = makeService({
      restaurant: HOUSE,
      stored: [storedRow({ fetched_at: new Date(Date.now() - 60_000).toISOString() })],
    });

    await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(provider.forecast).not.toHaveBeenCalled();
  });

  it("calls the issuer when the newest reading is older than an hour", async () => {
    const { service, provider } = makeService({
      restaurant: HOUSE,
      stored: [
        storedRow({ fetched_at: new Date(Date.now() - 90 * 60_000).toISOString() }),
      ],
    });

    await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(provider.forecast).toHaveBeenCalledWith(37.4419, -122.143);
  });

  it("keeps every day of the issuance, with the issuer and its issue time", async () => {
    const { service, upserts } = makeService({
      restaurant: HOUSE,
      stored: [],
      forecast: {
        issuer: "NOAA/NWS",
        issuerDetail: "MTR/91,89",
        issuedAt: "2026-09-03T12:26:50.000Z",
        horizonDays: 7,
        advisories: [],
        advisoriesReadable: true,
        days: [
          {
            businessDate: "2026-09-03",
            validFrom: "2026-09-03T06:00:00-07:00",
            validTo: "2026-09-04T06:00:00-07:00",
            temperatureHigh: 75,
            temperatureLow: 58,
            temperatureUnit: "F",
            precipitationProbability: 27,
            precipitationAmountMm: null,
            windSummary: "2 to 12 mph",
            shortForecast: "Mostly Sunny then Chance Light Rain",
            rawHash: "a".repeat(64),
          },
        ],
      },
    });

    await service.windowFor(R, "2026-09-01", "2026-09-30");

    expect(upserts).toHaveLength(1);
    const row = upserts[0][0];
    expect(row.restaurant_id).toBe(R);
    expect(row.issuer).toBe("NOAA/NWS");
    expect(row.issued_at).toBe("2026-09-03T12:26:50.000Z");
    // The point the reading was ASKED FOR travels with it, so a corrected
    // address cannot silently re-attribute old forecasts.
    expect(row.latitude).toBe(37.4419);
    expect(row.longitude).toBe(-122.143);
    expect(row.temperature_unit).toBe("F");
    expect(row.precipitation_amount_mm).toBeNull();
    expect(row.raw_hash).toBe("a".repeat(64));
  });

  it("writes nothing when the issuer published no days", async () => {
    const { service, upserts } = makeService({ restaurant: HOUSE, stored: [] });
    await service.windowFor(R, "2026-09-01", "2026-09-30");
    expect(upserts).toHaveLength(0);
  });
});

describe("newestPerDay", () => {
  it("keeps the last issuance for each day", () => {
    const rows = [
      { business_date: "2026-09-03", issued_at: "A", fetched_at: "A" },
      { business_date: "2026-09-03", issued_at: "B", fetched_at: "B" },
      { business_date: "2026-09-04", issued_at: "C", fetched_at: "C" },
    ] as never;

    expect(newestPerDay(rows).map((r) => r.issued_at)).toEqual(["B", "C"]);
  });
});

describe("earliestPriorIssuancePerDay", () => {
  it("takes the earliest issuance made before the day began", () => {
    const rows = [
      { business_date: "2026-09-05", issued_at: "2026-09-01T12:00:00Z" },
      { business_date: "2026-09-05", issued_at: "2026-09-03T12:00:00Z" },
    ] as never;

    expect(earliestPriorIssuancePerDay(rows)).toHaveLength(1);
    expect(earliestPriorIssuancePerDay(rows)[0].issued_at).toBe(
      "2026-09-01T12:00:00Z",
    );
  });

  it("refuses to score a day against a forecast made during or after it", () => {
    // This is the assertion that stops the reconciliation line manufacturing
    // perfect accuracy: a "forecast" issued at noon on the day it describes is
    // not a forecast.
    const rows = [
      { business_date: "2026-09-05", issued_at: "2026-09-05T12:00:00Z" },
      { business_date: "2026-09-05", issued_at: "2026-09-06T12:00:00Z" },
    ] as never;

    expect(earliestPriorIssuancePerDay(rows)).toEqual([]);
  });
});
