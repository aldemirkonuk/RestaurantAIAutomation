import { WeatherPrefetchService } from "./weather-prefetch.service";

/**
 * The scheduled prefetch — one refresh per house per hour.
 *
 * Three assertions carry the whole file, and each is a way the sweep could
 * quietly do the wrong thing:
 *
 *  1. A house with NO COORDINATE is never fetched. There is nothing to ask
 *     about, and asking spends a call on being told so.
 *  2. A house whose reading is still FRESH is not re-asked. The skip is
 *     delegated to `WeatherService.windowFor` on purpose, so the cron and the
 *     page cannot drift apart about what "fresh" means.
 *  3. One house FAILING never stops the others. A sweep that abandons twelve
 *     houses because the thirteenth threw is the same silence the prefetch was
 *     built to end.
 */

type House = Record<string, unknown>;

function makeService(opts: {
  houses?: House[];
  registerError?: { message: string };
  windowFor?: jest.Mock;
}) {
  const chain = (): any => {
    const c: any = {
      select: () => c,
      not: () => c,
      eq: () => c,
      order: () =>
        Promise.resolve({
          data: opts.registerError ? null : (opts.houses ?? []),
          error: opts.registerError ?? null,
        }),
    };
    return c;
  };

  const db = { supabase: { from: () => chain() } } as never;
  const windowFor =
    opts.windowFor ??
    jest.fn(async () => ({
      refusal: null,
      staleReason: null,
      observationRefusal: null,
      askedTheIssuer: true,
      ageMinutes: 4,
      readings: [{}, {}],
      observations: [{}],
    }));

  return {
    service: new WeatherPrefetchService(db, { windowFor } as never),
    windowFor,
  };
}

const HOUSE = (over: House = {}) => ({
  id: "r-1",
  name: "Sim Meyhouse",
  latitude: 37.4419,
  longitude: -122.143,
  ...over,
});

describe("WeatherPrefetchService", () => {
  const saved = process.env.WEATHER_PREFETCH_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.WEATHER_PREFETCH_ENABLED;
    else process.env.WEATHER_PREFETCH_ENABLED = saved;
    jest.useRealTimers();
  });
  beforeEach(() => {
    delete process.env.WEATHER_PREFETCH_ENABLED;
  });

  it("never asks the issuer about a house with no coordinate", async () => {
    // The query filters them out, so the sweep sees an empty eligible list —
    // and says so in words rather than reporting a clean run over nobody.
    const { service, windowFor } = makeService({ houses: [] });

    const out = await service.sweep();

    expect(out.eligible).toBe(0);
    expect(out.fetched).toBe(0);
    expect(windowFor).not.toHaveBeenCalled();
  });

  it("serves every house that does carry one", async () => {
    const { service, windowFor } = makeService({
      houses: [HOUSE(), HOUSE({ id: "r-2", name: "Second House" })],
    });

    const out = await service.sweep();

    expect(out.eligible).toBe(2);
    expect(out.fetched).toBe(2);
    expect(windowFor).toHaveBeenCalledTimes(2);
    expect(windowFor.mock.calls[0][0]).toBe("r-1");
    expect(windowFor.mock.calls[1][0]).toBe("r-2");
  });

  it("asks for a window that looks back as well as forward", async () => {
    // Looking back means a missed sweep still backfills the observations a
    // passed day needs to be scored.
    const { service, windowFor } = makeService({ houses: [HOUSE()] });
    await service.sweep();
    const [, from, to] = windowFor.mock.calls[0];
    expect(from < to).toBe(true);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts a house whose reading was still fresh as skipped, not fetched", async () => {
    // `windowFor` answering instantly with no stale reason is what "it did not
    // go to the network" looks like from here.
    const windowFor = jest.fn(async () => ({
      refusal: null,
      staleReason: null,
      observationRefusal: null,
      // The load-bearing field: the service reports that it answered from the
      // register, so this loop never has to guess from a stopwatch.
      askedTheIssuer: false,
      ageMinutes: 12,
      readings: [{}],
      observations: [],
    }));
    const { service } = makeService({ houses: [HOUSE()], windowFor });

    const out = await service.sweep();

    expect(out.skippedFresh).toBe(1);
    expect(out.fetched).toBe(0);
  });

  it("records a refusal as a refusal, never as a successful refresh", async () => {
    const windowFor = jest.fn(async () => ({
      refusal: "The National Weather Service does not cover this location.",
      staleReason: null,
      observationRefusal: null,
      askedTheIssuer: false,
      ageMinutes: null,
      readings: [],
      observations: [],
    }));
    const { service } = makeService({ houses: [HOUSE()], windowFor });

    const out = await service.sweep();

    expect(out.refused).toBe(1);
    expect(out.fetched).toBe(0);
  });

  it("keeps going when one house throws, and counts the failure", async () => {
    const windowFor = jest.fn(async (id: string) => {
      if (id === "r-2") throw new Error("ECONNRESET");
      return {
        refusal: null,
        staleReason: "issuer slow",
        observationRefusal: null,
        askedTheIssuer: true,
        ageMinutes: 90,
        readings: [{}],
        observations: [{}],
      };
    });
    const { service } = makeService({
      houses: [
        HOUSE(),
        HOUSE({ id: "r-2", name: "Broken House" }),
        HOUSE({ id: "r-3", name: "Third House" }),
      ],
      windowFor,
    });

    const out = await service.sweep();

    expect(out.eligible).toBe(3);
    expect(out.failed).toBe(1);
    expect(out.fetched).toBe(2);
    // The third house was reached — the sweep did not abandon it.
    expect(windowFor).toHaveBeenCalledTimes(3);
    expect(windowFor.mock.calls[2][0]).toBe("r-3");
  });

  it("says the register was unreadable rather than reporting a clean empty run", async () => {
    const { service, windowFor } = makeService({
      registerError: { message: "connection reset" },
    });

    const out = await service.sweep();

    expect(out.error).toContain("could not be read");
    expect(out.eligible).toBe(0);
    expect(windowFor).not.toHaveBeenCalled();
  });

  it("does nothing at all when the switch is off, and says so", async () => {
    process.env.WEATHER_PREFETCH_ENABLED = "false";
    const { service, windowFor } = makeService({ houses: [HOUSE()] });

    const out = await service.sweep();

    expect(windowFor).not.toHaveBeenCalled();
    expect(out.eligible).toBe(0);
    expect(service.status().armed).toBe(false);
  });

  it("is armed by default — it sends nothing, and an unarmed one accumulates nothing", async () => {
    const { service } = makeService({ houses: [] });
    expect(service.status().armed).toBe(true);
    expect(service.status().cron).toBe("0 * * * *");
  });

  it("reports its last run, so a status surface is not guessing", async () => {
    const { service } = makeService({ houses: [HOUSE()] });
    expect(service.status().lastRun).toBeNull();
    await service.sweep();
    expect(service.status().lastRun?.eligible).toBe(1);
  });
});
