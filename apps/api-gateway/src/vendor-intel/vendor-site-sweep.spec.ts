/**
 * The scheduled sweep: the switch, the rate limit, and the isolation.
 *
 * The extractor is a stub throughout. This file proves what the SWEEP does —
 * whether it runs at all, how long it waits between requests to one host, and
 * what happens to the other twenty-two vendors when one of them throws. What
 * the extractor makes of a page is proven in `vendor-site-sighting.spec.ts`
 * and `vendor-page-extraction.spec.ts`.
 */

import {
  DEFAULT_HOST_INTERVAL_SECONDS,
  MIN_HOST_INTERVAL_SECONDS,
  SILENCE_SENTENCE,
  hostIntervalMs,
  hostOf,
  isSweepArmed,
  waitMsFor,
} from "./vendor-site-sweep";
import {
  VendorSiteSweepService,
  SWEEP_CRON,
} from "./vendor-site-sweep.service";
import {
  ExtractionRunResult,
  emptyRefusalCounts,
} from "./vendor-page-extractor.service";

const TENANT = "11111111-1111-1111-1111-111111111111";

function runResult(
  over: Partial<ExtractionRunResult> = {},
): ExtractionRunResult {
  return {
    url: "https://a.example/wines",
    fetched: true,
    httpStatus: 200,
    itemsFound: 1,
    observationsWritten: 1,
    rejected: 0,
    refusals: emptyRefusalCounts(),
    flaggedOutliers: 0,
    fetchedAt: "2026-09-04T10:00:00.000Z",
    pageStatedDate: null,
    crawlDelaySeconds: null,
    warnings: [],
    ...over,
  };
}

/**
 * A sweep with a controllable clock and a sleep that records instead of
 * waiting. The rate limit is then a fact about numbers, not about how long the
 * suite took.
 */
class TestSweep extends VendorSiteSweepService {
  public clock = 0;
  public slept: number[] = [];
  protected now(): number {
    return this.clock;
  }
  protected sleep(ms: number): Promise<void> {
    this.slept.push(ms);
    // A real sleep advances the clock; so does this one, or the second
    // vendor's wait would be computed against a clock that never moved.
    if (ms > 0) this.clock += ms;
    return Promise.resolve();
  }
}

function makeSweep(opts: {
  flag?: string;
  providers?: any[];
  extract?: (p: any) => Promise<ExtractionRunResult>;
  providerError?: string;
  intervalSeconds?: string;
}) {
  const providers = opts.providers ?? [];
  const config = {
    get: (k: string) =>
      k === "VENDOR_SITE_SWEEP_ENABLED"
        ? opts.flag
        : k === "VENDOR_SITE_SWEEP_INTERVAL_SECONDS"
          ? opts.intervalSeconds
          : undefined,
  } as any;

  const builder: any = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    not: () => builder,
    limit: async () =>
      opts.providerError
        ? { data: null, error: { message: opts.providerError } }
        : { data: providers, error: null },
  };
  const database = { supabase: { from: () => builder } } as any;

  const calls: any[] = [];
  const extractor = {
    extractFromUrl: async (p: any) => {
      calls.push(p);
      return opts.extract ? opts.extract(p) : runResult({ url: p.url });
    },
  } as any;

  return { sweep: new TestSweep(config, database, extractor), calls };
}

const provider = (over: Partial<any> = {}) => ({
  id: "p1",
  name: "Merchant",
  website: "https://a.example/wines",
  restaurant_id: TENANT,
  ...over,
});

describe("the switch", () => {
  it("is off unless explicitly armed", () => {
    for (const v of [undefined, null, "", " ", "false", "0", "no", "maybe"]) {
      expect(isSweepArmed(v as any)).toBe(false);
    }
    for (const v of ["true", "1", "YES", " on "]) {
      expect(isSweepArmed(v)).toBe(true);
    }
  });

  it("a disarmed sweep writes nothing and says why", async () => {
    const { sweep, calls } = makeSweep({
      flag: undefined,
      providers: [provider()],
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(calls).toHaveLength(0);
    expect(out.armed).toBe(false);
    expect(out.rowsWritten).toBe(0);
    expect(out.note).toBe(SILENCE_SENTENCE.disarmed);
    expect(out.note).toContain("VENDOR_SITE_SWEEP_ENABLED");
  });

  it("the cron entry point does nothing while disarmed", async () => {
    const { sweep, calls } = makeSweep({ providers: [provider()] });
    await sweep.scheduled();
    expect(calls).toHaveLength(0);
    expect(SWEEP_CRON).toBe("20 4 * * *");
  });

  it("an armed sweep fetches", async () => {
    const { sweep, calls } = makeSweep({
      flag: "true",
      providers: [provider()],
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(calls).toHaveLength(1);
    expect(calls[0].restaurantId).toBe(TENANT);
    expect(out.rowsWritten).toBe(1);
  });
});

describe("the rate limit", () => {
  it("computes a per-host floor, and a host's own delay wins when larger", () => {
    expect(hostIntervalMs({})).toBe(DEFAULT_HOST_INTERVAL_SECONDS * 1000);
    expect(hostIntervalMs({ configuredSeconds: 30 })).toBe(30_000);
    // Configuration may raise it, never take it below the hard floor.
    expect(hostIntervalMs({ configuredSeconds: 0 })).toBe(
      MIN_HOST_INTERVAL_SECONDS * 1000,
    );
    expect(hostIntervalMs({ configuredSeconds: -5 })).toBe(
      MIN_HOST_INTERVAL_SECONDS * 1000,
    );
    // The publisher's stated number beats ours when it is larger.
    expect(
      hostIntervalMs({ configuredSeconds: 10, crawlDelaySeconds: 30 }),
    ).toBe(30_000);
    expect(
      hostIntervalMs({ configuredSeconds: 10, crawlDelaySeconds: 1 }),
    ).toBe(10_000);
  });

  it("waits the remainder, and nothing once the interval has passed", () => {
    expect(
      waitMsFor({ lastRequestAtMs: null, nowMs: 0, intervalMs: 10_000 }),
    ).toBe(0);
    expect(
      waitMsFor({ lastRequestAtMs: 0, nowMs: 3_000, intervalMs: 10_000 }),
    ).toBe(7_000);
    expect(
      waitMsFor({ lastRequestAtMs: 0, nowMs: 10_000, intervalMs: 10_000 }),
    ).toBe(0);
  });

  it("pauses between two vendors on the SAME host and not between hosts", async () => {
    const { sweep, calls } = makeSweep({
      flag: "true",
      providers: [
        provider({ id: "p1", website: "https://a.example/one" }),
        provider({ id: "p2", website: "https://a.example/two" }),
        provider({ id: "p3", website: "https://b.example/three" }),
      ],
      extract: async (p) => runResult({ url: p.url }),
    });
    await sweep.sweep({ restaurantId: TENANT });
    expect(calls).toHaveLength(3);
    // One wait, for the second page on a.example, at the documented default.
    expect(sweep.slept.filter((ms) => ms > 0)).toEqual([
      DEFAULT_HOST_INTERVAL_SECONDS * 1000,
    ]);
  });

  it("honours a host's Crawl-delay on the next visit to it", async () => {
    const { sweep } = makeSweep({
      flag: "true",
      providers: [
        provider({ id: "p1", website: "https://a.example/one" }),
        provider({ id: "p2", website: "https://a.example/two" }),
      ],
      extract: async (p) => runResult({ url: p.url, crawlDelaySeconds: 45 }),
    });
    await sweep.sweep({ restaurantId: TENANT });
    expect(sweep.slept.filter((ms) => ms > 0)).toEqual([45_000]);
  });
});

describe("one failure never ends the sweep", () => {
  it("continues past a vendor that throws, and records why", async () => {
    const { sweep, calls } = makeSweep({
      flag: "true",
      providers: [
        provider({ id: "p1", website: "https://bad.example/x" }),
        provider({ id: "p2", website: "https://ok.example/y" }),
        provider({ id: "p3", website: "https://ok2.example/z" }),
      ],
      extract: async (p) => {
        if (p.url.includes("bad.example")) {
          throw new Error("unable to verify the first certificate");
        }
        return runResult({ url: p.url });
      },
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(calls).toHaveLength(3);
    expect(out.rowsWritten).toBe(2);
    const failed = out.vendors.find((v) => v.providerId === "p1")!;
    expect(failed.silence?.reason).toBe("fetch_failed");
    expect(failed.detail).toContain("certificate");
    expect(out.vendors.filter((v) => v.silence === null)).toHaveLength(2);
  });

  it("names a robots refusal as a refusal, not as an empty vendor", async () => {
    const { sweep } = makeSweep({
      flag: "true",
      providers: [provider()],
      extract: async (p) =>
        runResult({
          url: p.url,
          fetched: false,
          httpStatus: null,
          itemsFound: 0,
          observationsWritten: 0,
          skippedReason: "Disallowed by robots.txt",
        }),
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(out.rowsWritten).toBe(0);
    expect(out.vendors[0].silence?.reason).toBe("robots_forbids");
    expect(out.vendors[0].silence?.sentence).toBe(
      SILENCE_SENTENCE.robots_forbids,
    );
    expect(out.vendors[0].lastFetchAt).toBeNull();
  });

  it("tells 'every price refused' from 'no prices on the page'", async () => {
    const refused = { ...emptyRefusalCounts(), no_bottle_volume: 6 };
    const { sweep } = makeSweep({
      flag: "true",
      providers: [
        provider({ id: "p1", website: "https://a.example/x" }),
        provider({ id: "p2", website: "https://b.example/y" }),
      ],
      extract: async (p) =>
        p.url.includes("a.example")
          ? runResult({
              url: p.url,
              itemsFound: 6,
              observationsWritten: 0,
              refusals: refused,
            })
          : runResult({ url: p.url, itemsFound: 0, observationsWritten: 0 }),
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(out.vendors[0].silence?.reason).toBe("all_refused");
    expect(out.vendors[0].refusals.no_bottle_volume).toBe(6);
    expect(out.vendors[1].silence?.reason).toBe("nothing_priced");
    expect(out.refusals.no_bottle_volume).toBe(6);
  });

  it("names a vendor with an unusable website without fetching it", async () => {
    const { sweep, calls } = makeSweep({
      flag: "true",
      providers: [provider({ website: "not a url" })],
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(calls).toHaveLength(0);
    expect(out.vendors[0].silence?.reason).toBe("no_website");
  });

  it("carries the undated flag onto the status row", async () => {
    const { sweep } = makeSweep({
      flag: "true",
      providers: [provider()],
      extract: async (p) => runResult({ url: p.url, pageStatedDate: null }),
    });
    const out = await sweep.sweep({ restaurantId: TENANT });
    expect(out.vendors[0].undated).toBe(true);
    expect(out.vendors[0].pageStatedDate).toBeNull();
  });
});

describe("status", () => {
  it("lists every vendor, including the ones never swept, with a reason", async () => {
    const { sweep } = makeSweep({
      flag: undefined,
      providers: [provider({ id: "p1" }), provider({ id: "p2" })],
    });
    const s = await sweep.status(TENANT);
    expect(s.armed).toBe(false);
    expect(s.flag).toBe("VENDOR_SITE_SWEEP_ENABLED");
    expect(s.cron).toBe(SWEEP_CRON);
    expect(s.hostIntervalSeconds).toBe(DEFAULT_HOST_INTERVAL_SECONDS);
    expect(s.lastRun).toBeNull();
    expect(s.inMemoryOnly).toBe(true);
    expect(s.vendors).toHaveLength(2);
    for (const v of s.vendors) {
      expect(v.silence?.reason).toBe("disarmed");
      expect(v.lastFetchAt).toBeNull();
    }
  });

  it("says 'not yet swept' rather than 'no website' when armed and untouched", async () => {
    const { sweep } = makeSweep({ flag: "true", providers: [provider()] });
    const s = await sweep.status(TENANT);
    expect(s.vendors[0].silence?.reason).toBe("not_yet_swept");
  });

  it("reports what the last run did, per vendor", async () => {
    const { sweep } = makeSweep({ flag: "true", providers: [provider()] });
    await sweep.sweep({ restaurantId: TENANT });
    const s = await sweep.status(TENANT);
    expect(s.vendors[0].rowsWritten).toBe(1);
    expect(s.vendors[0].silence).toBeNull();
    expect(s.lastRun?.rowsWritten).toBe(1);
  });

  it("THROWS when the provider table cannot be read", async () => {
    // "No vendors have a website" and "the table could not be read" must not
    // both render as a sweep that did nothing.
    const { sweep } = makeSweep({
      flag: "true",
      providerError: "permission denied for table providers",
    });
    await expect(sweep.status(TENANT)).rejects.toThrow(/permission denied/);
  });
});

describe("hostOf", () => {
  it("lowercases the host and refuses a non-URL", () => {
    expect(hostOf("https://A.Example/x")).toBe("a.example");
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf(null)).toBeNull();
    expect(hostOf("  ")).toBeNull();
  });
});
