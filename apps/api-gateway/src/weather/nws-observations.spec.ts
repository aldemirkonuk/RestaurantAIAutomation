import {
  NwsWeatherProvider,
  foldObservationsToDays,
  localDateInZone,
  usableQuantity,
} from "./nws.provider";
import { WeatherUnavailableError } from "./weather-provider";
import points from "./__fixtures__/nws-points-palo-alto.json";
import stations from "./__fixtures__/nws-stations-palo-alto.json";
import observations from "./__fixtures__/nws-observations-kpao.json";

/**
 * The observation half — what the weather actually WAS.
 *
 * `nws-observations-kpao.json` is 42 real observations recorded live from
 * station KPAO (Palo Alto Airport) on 2026-09-04, spanning four local days.
 * Two facts in it drive most of this file, and neither was guessed:
 *
 *   * every temperature is `wmoUnit:degC`, while the FORECAST fixture beside it
 *     is Fahrenheit — the two sides of the scoring comparison really do
 *     disagree about units;
 *   * all 42 carry `precipitationLastHour.value === null`. That station does
 *     not report rainfall at all, which is exactly the case a `DEFAULT 0` would
 *     turn into "a dry week".
 */

const PALO_ALTO: [number, number] = [37.4419, -122.143];
const ZONE = "America/Los_Angeles";

function stubFetch(
  handler: (url: string) => { status: number; body?: unknown; throws?: Error },
) {
  return jest.fn(async (url: string | URL, init?: RequestInit) => {
    void init;
    const r = handler(String(url));
    if (r.throws) throw r.throws;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.body === undefined) throw new Error("Unexpected end of JSON input");
        return r.body;
      },
    } as unknown as Response;
  });
}

describe("localDateInZone", () => {
  it("files a UTC-stamped observation under the LOCAL day", () => {
    // The whole reason this differs from `localDateOf`. 2026-09-05T01:00Z is
    // 18:00 on the 4th in Palo Alto; reading the date off the string would file
    // an evening service under the following morning.
    expect(localDateInZone("2026-09-05T01:00:00+00:00", ZONE)).toBe("2026-09-04");
    expect(localDateInZone("2026-09-04T18:47:00+00:00", ZONE)).toBe("2026-09-04");
  });

  it("returns null rather than guessing for an unparseable input", () => {
    expect(localDateInZone("not a time", ZONE)).toBeNull();
    expect(localDateInZone("2026-09-04T18:47:00+00:00", "Pacific Time")).toBeNull();
  });
});

describe("usableQuantity", () => {
  it("takes a number the station stands behind", () => {
    expect(usableQuantity({ value: 20, qualityControl: "V" })).toBe(20);
    expect(usableQuantity({ value: 0, qualityControl: "V" })).toBe(0);
  });

  it("drops the two flags the issuer itself is rejecting", () => {
    expect(usableQuantity({ value: 999, qualityControl: "X" })).toBeNull();
    expect(usableQuantity({ value: 999, qualityControl: "Q" })).toBeNull();
  });

  it("treats a null value as absent whatever the flag says", () => {
    expect(usableQuantity({ value: null, qualityControl: "Z" })).toBeNull();
    expect(usableQuantity(null)).toBeNull();
    expect(usableQuantity(undefined)).toBeNull();
  });
});

describe("foldObservationsToDays — KPAO, recorded live", () => {
  const days = foldObservationsToDays(
    observations.features.map((f) => f.properties) as never,
    ZONE,
    "KPAO",
    "Palo Alto Airport",
  );

  it("produces one row per local day the station reported", () => {
    expect(days.length).toBeGreaterThanOrEqual(3);
    expect(days.map((d) => d.businessDate)).toEqual(
      [...days.map((d) => d.businessDate)].sort(),
    );
  });

  it("keeps the station's own Celsius, unconverted", () => {
    expect(days.every((d) => d.temperatureUnit === "C")).toBe(true);
  });

  it("takes the day's high and low from the readings themselves", () => {
    const day = days.find((d) => d.temperatureHigh !== null)!;
    expect(day.temperatureHigh).toBeGreaterThanOrEqual(day.temperatureLow!);
    // The recorded window spans 13-25 degC across all four days.
    expect(day.temperatureHigh!).toBeLessThanOrEqual(25);
    expect(day.temperatureLow!).toBeGreaterThanOrEqual(13);
  });

  it("counts the readings behind each day", () => {
    // A day backed by two readings and one backed by twenty-four are different
    // evidence, and the row has to say which it is.
    expect(days.every((d) => d.observationCount > 0)).toBe(true);
    expect(days.reduce((n, d) => n + d.observationCount, 0)).toBe(42);
  });

  it("leaves precipitation NULL — this station reports none — never 0", () => {
    expect(days.every((d) => d.precipitationTotalMm === null)).toBe(true);
  });

  it("carries the station's identity and the span of readings used", () => {
    expect(days[0].stationId).toBe("KPAO");
    expect(days[0].stationName).toBe("Palo Alto Airport");
    expect(days[0].firstObservedAt <= days[0].lastObservedAt).toBe(true);
    expect(days[0].rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sums only the hours that published a number", () => {
    const days2 = foldObservationsToDays(
      [
        {
          timestamp: "2026-09-04T18:00:00+00:00",
          temperature: { value: 20, unitCode: "wmoUnit:degC", qualityControl: "V" },
          precipitationLastHour: { value: 1.5, qualityControl: "V" },
        },
        {
          timestamp: "2026-09-04T19:00:00+00:00",
          temperature: { value: 21, unitCode: "wmoUnit:degC", qualityControl: "V" },
          precipitationLastHour: { value: null, qualityControl: "Z" },
        },
      ] as never,
      ZONE,
      "KPAO",
      null,
    );
    // 1.5, not 1.5 + 0 — the silent hour contributes nothing, not zero.
    expect(days2[0].precipitationTotalMm).toBe(1.5);
    expect(days2[0].temperatureHigh).toBe(21);
  });

  it("gives a day with no usable temperature a null high and low", () => {
    const days3 = foldObservationsToDays(
      [
        {
          timestamp: "2026-09-04T18:00:00+00:00",
          temperature: { value: null, qualityControl: "Z" },
        },
      ] as never,
      ZONE,
      "KPAO",
      null,
    );
    expect(days3[0].temperatureHigh).toBeNull();
    expect(days3[0].temperatureLow).toBeNull();
    expect(days3[0].observationCount).toBe(1);
  });
});

describe("NwsWeatherProvider.observations", () => {
  const realFetch = global.fetch;
  let provider: NwsWeatherProvider;

  beforeEach(() => {
    provider = new NwsWeatherProvider();
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const happy = (over: Record<string, unknown> = {}) =>
    stubFetch((url) => {
      if (url.includes("/points/")) return { status: 200, body: points };
      if (url.includes("/stations") && !url.includes("/observations"))
        return { status: 200, body: stations };
      if (url.includes("/observations"))
        return { status: 200, body: over.observations ?? observations };
      return { status: 200, body: { features: [] } };
    });

  it("walks points to the station list to the station's observations", async () => {
    const f = happy();
    global.fetch = f as never;

    const out = await provider.observations(...PALO_ALTO, "2026-09-01", "2026-09-04");

    expect(out.issuer).toBe("NOAA/NWS");
    expect(out.stationId).toBe("KPAO");
    expect(out.stationName).toBe("Palo Alto Airport");
    expect(out.timeZone).toBe("America/Los_Angeles");
    expect(out.days.length).toBeGreaterThan(0);
  });

  it("sends the descriptive User-Agent NWS's terms require", async () => {
    const f = happy();
    global.fetch = f as never;
    await provider.observations(...PALO_ALTO, "2026-09-01", "2026-09-04");
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Mudavym");
  });

  it("never asks for the future — a station cannot observe tomorrow", async () => {
    const f = happy();
    global.fetch = f as never;
    await provider.observations(...PALO_ALTO, "2026-09-01", "2026-09-04");
    const obsCall = f.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/observations"));
    expect(obsCall).toContain("start=2026-09-01");
  });

  it("walks past a station that reports nothing, to the next one down", async () => {
    // A grid square's nearest station can be an amateur unit that is silent for
    // days. Giving up on it would report "no observations" for a point with a
    // staffed airport two miles away.
    let obsCalls = 0;
    global.fetch = stubFetch((url) => {
      if (url.includes("/points/")) return { status: 200, body: points };
      if (url.includes("/stations") && !url.includes("/observations"))
        return { status: 200, body: stations };
      obsCalls += 1;
      return obsCalls === 1
        ? { status: 200, body: { features: [] } }
        : { status: 200, body: observations };
    }) as never;

    const out = await provider.observations(...PALO_ALTO, "2026-09-01", "2026-09-04");
    expect(obsCalls).toBe(2);
    expect(out.days.length).toBeGreaterThan(0);
  });

  it("refuses in words when no station near the point reported", async () => {
    global.fetch = stubFetch((url) => {
      if (url.includes("/points/")) return { status: 200, body: points };
      if (url.includes("/stations") && !url.includes("/observations"))
        return { status: 200, body: stations };
      return { status: 200, body: { features: [] } };
    }) as never;

    await expect(
      provider.observations(...PALO_ALTO, "2026-09-01", "2026-09-04"),
    ).rejects.toMatchObject({
      reason: "issuer-refused",
      message: expect.stringContaining("No station near this location reported"),
    });
  });

  it("refuses rather than misfile a day when the point names no zone", async () => {
    global.fetch = stubFetch((url) =>
      url.includes("/points/")
        ? {
            status: 200,
            body: {
              properties: {
                forecast: "https://api.weather.gov/gridpoints/MTR/91,89/forecast",
                observationStations: "https://api.weather.gov/gridpoints/MTR/91,89/stations",
              },
            },
          }
        : { status: 200, body: stations },
    ) as never;

    await expect(
      provider.observations(...PALO_ALTO, "2026-09-01", "2026-09-04"),
    ).rejects.toMatchObject({ reason: "issuer-malformed" });
  });

  it("passes the out-of-coverage refusal through from the point lookup", async () => {
    global.fetch = stubFetch(() => ({ status: 404 })) as never;
    await expect(
      provider.observations(41.0082, 28.9784, "2026-09-01", "2026-09-04"),
    ).rejects.toBeInstanceOf(WeatherUnavailableError);
  });
});
