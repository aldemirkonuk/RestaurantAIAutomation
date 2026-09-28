import { NwsWeatherProvider, foldPeriodsToDays, localDateOf } from "./nws.provider";
import { WeatherUnavailableError } from "./weather-provider";
import paloAltoPoints from "./__fixtures__/nws-points-palo-alto.json";
import paloAltoForecast from "./__fixtures__/nws-forecast-palo-alto.json";
import newOrleansForecast from "./__fixtures__/nws-forecast-new-orleans.json";

/**
 * The NWS provider, against two payloads recorded from the live service on
 * 2026-09-03.
 *
 *  - `nws-points-palo-alto.json` / `nws-forecast-palo-alto.json` — the founder's
 *    own house, grid MTR/91,89, recorded at 13:0x UTC.
 *  - `nws-forecast-new-orleans.json` — grid LIX/68,88, a different office, a
 *    different local offset (-05:00) and a different day boundary.
 *
 * The second fixture is not decoration. Every date-handling bug in this file
 * class is a bug about offsets, and a single US-Pacific fixture cannot see one:
 * the folding reads the LOCAL date off the issuer's own offset string, and the
 * two fixtures disagree about what "today" is for four hours of every day.
 *
 * The refusal branches are exercised with a stubbed `fetch` rather than by
 * calling the service, because the point of each is what happens when NWS does
 * something we cannot arrange on demand.
 */

const PALO_ALTO: [number, number] = [37.4419, -122.143];

function stubFetch(
  handler: (url: string) => { status: number; body?: unknown; throws?: Error },
) {
  return jest.fn(async (url: string | URL, init?: RequestInit) => {
    void init;
    const result = handler(String(url));
    if (result.throws) throw result.throws;
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => {
        if (result.body === undefined) throw new Error("Unexpected end of JSON input");
        return result.body;
      },
    } as unknown as Response;
  });
}

describe("localDateOf", () => {
  it("reads the local date off the issuer's own offset, not through a Date", () => {
    // 2026-09-03T18:00:00-07:00 is 2026-09-04T01:00Z. Parsing it into a Date
    // and formatting it back in the gateway's zone would file this period
    // under the wrong day for every deployment east of the forecast point.
    expect(localDateOf("2026-09-03T18:00:00-07:00")).toBe("2026-09-03");
    expect(localDateOf("2026-09-03T23:00:00-05:00")).toBe("2026-09-03");
    expect(localDateOf("not a timestamp")).toBeNull();
  });
});

describe("foldPeriodsToDays — Palo Alto, MTR/91,89", () => {
  const days = foldPeriodsToDays(paloAltoForecast.properties.periods as never);

  it("produces one row per calendar date the issuer published", () => {
    expect(days.map((d) => d.businessDate)).toEqual([
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });

  it("takes the high from the issuer's own daytime period and the low from its night one", () => {
    const today = days[0];
    // Recorded values: "Today" 75 F daytime, "Tonight" 58 F night.
    expect(today.temperatureHigh).toBe(75);
    expect(today.temperatureLow).toBe(58);
    expect(today.temperatureUnit).toBe("F");
  });

  it("keeps the issuer's unit rather than converting it", () => {
    // NWS publishes Fahrenheit for US locations. Converting on the way in would
    // put OUR number in the column instead of the meteorologist's.
    expect(days.every((d) => d.temperatureUnit === "F")).toBe(true);
  });

  it("takes the day's chance of rain as the maximum the issuer published", () => {
    // Recorded: 27% by day, 24% overnight. A mean would produce 25.5 — a number
    // nobody published and nobody can act on.
    expect(days[0].precipitationProbability).toBe(27);
  });

  it("leaves precipitation amount null, because NWS publishes none", () => {
    expect(days.every((d) => d.precipitationAmountMm === null)).toBe(true);
  });

  it("carries the issuer's own words and wind phrasing verbatim", () => {
    expect(days[0].shortForecast).toBe("Mostly Sunny then Chance Light Rain");
    expect(days[0].windSummary).toBe("2 to 12 mph");
  });

  it("hashes the raw periods, so an unchanged re-issue is detectable", () => {
    expect(days[0].rawHash).toMatch(/^[0-9a-f]{64}$/);
    const again = foldPeriodsToDays(paloAltoForecast.properties.periods as never);
    expect(again[0].rawHash).toBe(days[0].rawHash);
  });
});

describe("foldPeriodsToDays — New Orleans, LIX/68,88 (a different offset)", () => {
  const days = foldPeriodsToDays(newOrleansForecast.properties.periods as never);

  it("files each period under the date the ISSUER's offset names", () => {
    // The first period starts 2026-09-03T11:00:00-05:00 — 16:00 UTC. Reading
    // it through a UTC Date would still say the 3rd; the period that starts at
    // 19:00-05:00 (00:00Z the next day) is the one that separates the two, and
    // it must stay on the 3rd.
    expect(days[0].businessDate).toBe("2026-09-03");
    expect(days.map((d) => d.businessDate)).toEqual([...days.map((d) => d.businessDate)].sort());
  });

  it("reads this office's own numbers, not the other fixture's", () => {
    expect(days[0].temperatureHigh).toBe(91);
    expect(days[0].precipitationProbability).toBe(35);
  });
});

describe("foldPeriodsToDays — what it refuses to invent", () => {
  it("gives a date with no daytime period a null high rather than borrowing the low", () => {
    const days = foldPeriodsToDays([
      {
        startTime: "2026-09-03T18:00:00-07:00",
        endTime: "2026-09-04T06:00:00-07:00",
        isDaytime: false,
        temperature: 58,
        temperatureUnit: "F",
      },
    ] as never);

    expect(days[0].temperatureHigh).toBeNull();
    expect(days[0].temperatureLow).toBe(58);
  });

  it("leaves the chance of rain null when the issuer published none", () => {
    // Not 0. "The issuer said nothing" and "no rain expected" must not draw as
    // the same flat bar — the ADR 0020 fault in one numeric field.
    const days = foldPeriodsToDays([
      {
        startTime: "2026-09-03T06:00:00-07:00",
        endTime: "2026-09-03T18:00:00-07:00",
        isDaytime: true,
        temperature: 75,
        temperatureUnit: "F",
        probabilityOfPrecipitation: { value: null },
      },
    ] as never);

    expect(days[0].precipitationProbability).toBeNull();
  });

  it("ignores a period the issuer did not classify as day or night", () => {
    const days = foldPeriodsToDays([
      {
        startTime: "2026-09-03T06:00:00-07:00",
        temperature: 999,
        temperatureUnit: "F",
      },
    ] as never);

    expect(days[0].temperatureHigh).toBeNull();
    expect(days[0].temperatureLow).toBeNull();
  });
});

describe("NwsWeatherProvider — the network, and every refusal", () => {
  const realFetch = global.fetch;
  let provider: NwsWeatherProvider;

  beforeEach(() => {
    provider = new NwsWeatherProvider();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("resolves the point, then reads the forecast it names", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("/points/")) return { status: 200, body: paloAltoPoints };
      if (url.includes("/forecast")) return { status: 200, body: paloAltoForecast };
      return { status: 200, body: { features: [] } };
    });
    global.fetch = fetchMock as never;

    const out = await provider.forecast(...PALO_ALTO);

    expect(out.issuer).toBe("NOAA/NWS");
    expect(out.issuerDetail).toBe("MTR/91,89");
    // `updateTime` (12:26Z), not `generatedAt` (13:01Z) — the forecaster's own
    // time, so a poll cannot make an old forecast look new.
    expect(out.issuedAt).toBe("2026-09-03T12:26:50.000Z");
    expect(out.horizonDays).toBe(7);
    expect(out.days).toHaveLength(7);
    expect(out.advisoriesReadable).toBe(true);
  });

  it("sends a descriptive User-Agent, which NWS's terms require", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("/points/")
        ? { status: 200, body: paloAltoPoints }
        : url.includes("/forecast")
          ? { status: 200, body: paloAltoForecast }
          : { status: 200, body: { features: [] } },
    );
    global.fetch = fetchMock as never;

    await provider.forecast(...PALO_ALTO);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers["User-Agent"]).toContain("Mudavym");
    expect(headers.Accept).toBe("application/geo+json");
  });

  it("caches the point resolution, because NWS asks callers to", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("/points/")
        ? { status: 200, body: paloAltoPoints }
        : url.includes("/forecast")
          ? { status: 200, body: paloAltoForecast }
          : { status: 200, body: { features: [] } },
    );
    global.fetch = fetchMock as never;

    await provider.forecast(...PALO_ALTO);
    await provider.forecast(...PALO_ALTO);

    const pointCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/points/"),
    );
    expect(pointCalls).toHaveLength(1);
  });

  it("says the location is outside coverage on a 404, in words", async () => {
    // Measured live on 2026-09-03: /points/41.0082,28.9784 (Istanbul) answers
    // 404 "Unable to provide data for requested point". This is the sentence a
    // non-US house has to be shown, and it is the reason the provider is behind
    // an interface at all.
    global.fetch = stubFetch(() => ({ status: 404 })) as never;

    await expect(provider.forecast(41.0082, 28.9784)).rejects.toMatchObject({
      reason: "outside-coverage",
      message: expect.stringContaining("United States only"),
    });
  });

  it("reports an issuer error as a refusal, never as an empty forecast", async () => {
    global.fetch = stubFetch(() => ({ status: 503 })) as never;

    await expect(provider.forecast(...PALO_ALTO)).rejects.toMatchObject({
      reason: "issuer-refused",
      message: expect.stringContaining("503"),
    });
  });

  it("reports an unreachable issuer as a refusal", async () => {
    global.fetch = stubFetch(() => ({
      status: 0,
      throws: new Error("ECONNREFUSED"),
    })) as never;

    await expect(provider.forecast(...PALO_ALTO)).rejects.toMatchObject({
      reason: "issuer-unreachable",
    });
  });

  it("refuses a forecast with no periods rather than returning zero days", async () => {
    global.fetch = stubFetch((url) =>
      url.includes("/points/")
        ? { status: 200, body: paloAltoPoints }
        : { status: 200, body: { properties: { updateTime: "2026-09-03T12:00:00Z" } } },
    ) as never;

    await expect(provider.forecast(...PALO_ALTO)).rejects.toBeInstanceOf(
      WeatherUnavailableError,
    );
  });

  it("refuses a forecast with no issue time, rather than stamping it now", async () => {
    // The whole design rests on being able to say how old a reading is.
    global.fetch = stubFetch((url) =>
      url.includes("/points/")
        ? { status: 200, body: paloAltoPoints }
        : { status: 200, body: { properties: { periods: [] } } },
    ) as never;

    await expect(provider.forecast(...PALO_ALTO)).rejects.toMatchObject({
      reason: "issuer-malformed",
      message: expect.stringContaining("how old it is cannot be stated"),
    });
  });

  it("keeps the forecast when only the advisory feed fails, and says so", async () => {
    global.fetch = stubFetch((url) => {
      if (url.includes("/points/")) return { status: 200, body: paloAltoPoints };
      if (url.includes("/alerts/")) return { status: 500 };
      return { status: 200, body: paloAltoForecast };
    }) as never;

    const out = await provider.forecast(...PALO_ALTO);

    expect(out.days).toHaveLength(7);
    expect(out.advisories).toEqual([]);
    // The load-bearing bit: a failed advisory read must not render as "no
    // advisories in force".
    expect(out.advisoriesReadable).toBe(false);
  });
});
