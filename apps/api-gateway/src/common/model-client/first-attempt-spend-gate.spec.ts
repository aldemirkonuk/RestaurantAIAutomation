import {
  ModelClientService,
  ModelSpendCeilingError,
  untilUtcMidnight,
} from "./model-client.service";

/**
 * The spend ceiling was written to suppress retry STORMS, and it was consulted
 * in exactly the two retry branches. That is correct for a background job that
 * fires on a schedule and wrong for a route a person can trigger at will: a
 * caller who never retries was never metered, so looping a request that calls
 * the model once each time reached the model every time, whatever the ledger
 * said.
 *
 * `gateFirstAttempt` closes that, per call site. These tests pin both halves:
 * that it refuses when it is on and over, and — just as important — that it
 * changes nothing at all when it is off, because seven production paths that
 * predate this client depend on that and none of them was written to handle a
 * new failure mode on a ledger read.
 */
describe("the spend ceiling can gate a FIRST attempt, but only where asked", () => {
  let fetchCalls: number;
  const realFetch = global.fetch;

  function serviceWith(spendUsd: number, limitUsd: string | undefined) {
    const config = {
      get: (k: string) =>
        k === "ANTHROPIC_API_KEY"
          ? "test-key"
          : k === "MODEL_DAILY_SPEND_CEILING_USD"
            ? limitUsd
            : undefined,
    } as any;

    // The ledger read the ceiling performs, answered with one row whose
    // cost_usd is the whole of today's spend.
    const query: any = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      is: () => query,
      gt: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: any) =>
        resolve({ data: [{ cost_usd: spendUsd }], error: null }),
    };
    const database = { supabase: { from: () => query } } as any;
    return new ModelClientService(config, database);
  }

  beforeEach(() => {
    fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "{}" }] }),
        headers: { get: () => null },
      } as any;
    }) as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const opts = (gate: boolean) => ({
    body: { model: "claude-haiku-4-5" },
    gateFirstAttempt: gate,
    nf: {
      subjectId: "Test",
      taskType: "t",
      stimulus: "s",
      choice: "c",
      restaurantId: "r1",
    } as any,
  });

  it("refuses before reaching the API when the house is over its allowance", async () => {
    const svc = serviceWith(999, "5");
    await expect(svc.call(opts(true))).rejects.toBeInstanceOf(
      ModelSpendCeilingError,
    );
    // The point of gating the FIRST attempt: nothing left the process.
    expect(fetchCalls).toBe(0);
  });

  it("says nothing was charged, because nothing was", async () => {
    const svc = serviceWith(999, "5");
    await expect(svc.call(opts(true))).rejects.toThrow(/nothing was charged/i);
  });

  it("admits the call when the house is under its allowance", async () => {
    const svc = serviceWith(0.01, "5");
    await expect(svc.call(opts(true))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("does NOTHING when the call site has not opted in — the default", async () => {
    // The regression this guards: turning the gate on globally would give the
    // seven pre-existing production paths a failure mode they have never had.
    const svc = serviceWith(999, "5");
    await expect(svc.call(opts(false))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("and does nothing when the option is simply absent", async () => {
    const svc = serviceWith(999, "5");
    const { gateFirstAttempt, ...withoutTheFlag } = opts(true);
    await expect(svc.call(withoutTheFlag as any)).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("a limit of zero disables the gate rather than refusing everything", async () => {
    // The existing escape hatch for an incident, preserved: the env override
    // changes the NUMBER, never the mode, and zero means off.
    const svc = serviceWith(999, "0");
    await expect(svc.call(opts(true))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("FAILS OPEN on an unreadable ledger, and that is deliberate", async () => {
    // The instrument must never break the thing it measures. A database
    // outage must not take Ask AI down with it -- which is precisely why the
    // rate limit is a separate defence and not a nicety: when this degrades,
    // that one is still standing.
    const config = {
      get: (k: string) =>
        k === "ANTHROPIC_API_KEY"
          ? "test-key"
          : k === "MODEL_DAILY_SPEND_CEILING_USD"
            ? "5"
            : undefined,
    } as any;
    const query: any = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      is: () => query,
      gt: () => query,
      order: () => query,
      limit: () => query,
      then: (resolve: any) =>
        resolve({ data: null, error: { message: "ledger unreachable" } }),
    };
    const svc = new ModelClientService(config, {
      supabase: { from: () => query },
    } as any);
    await expect(svc.call(opts(true))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  // ---- ADR 0146, second pass: the cap resets daily, and the sum is whole ----

  function midnightIso(): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function ledger(
    pages: Array<Array<{ id: string; cost_usd: number }>>,
    seen: { gte: string[]; gt: string[]; reads: number },
  ) {
    const query: any = {
      select: () => query,
      eq: () => query,
      is: () => query,
      order: () => query,
      limit: () => query,
      gte: (_c: string, v: string) => {
        seen.gte.push(v);
        return query;
      },
      gt: (_c: string, v: string) => {
        seen.gt.push(v);
        return query;
      },
      then: (resolve: any) => {
        const data = pages[seen.reads] ?? [];
        seen.reads++;
        resolve({ data, error: null });
      },
    };
    return { supabase: { from: () => query } } as any;
  }

  const fiveDollars = {
    get: (k: string) =>
      k === "ANTHROPIC_API_KEY"
        ? "test-key"
        : k === "MODEL_DAILY_SPEND_CEILING_USD"
          ? "5"
          : undefined,
  } as any;

  it("reads only TODAY on a lifetime-credit tier, so the refusal can pass", async () => {
    // Every production house is on pilot, which resolves to a LIFETIME credit.
    // Read lifetime here and a refusal never lifts while its message says it will.
    const seen = { gte: [] as string[], gt: [] as string[], reads: 0 };
    const svc = new ModelClientService(
      fiveDollars,
      ledger([[{ id: "a", cost_usd: 0.01 }]], seen),
    );
    const before = midnightIso();
    await svc.call(opts(true));
    const after = midnightIso();
    expect(seen.gte).toHaveLength(1);
    expect([before, after]).toContain(seen.gte[0]);
  });

  it("the refusal says midnight UTC, and never 'resets on its own'", async () => {
    const svc = serviceWith(999, "5");
    const err = await svc.call(opts(true)).catch((e) => e);
    expect(err).toBeInstanceOf(ModelSpendCeilingError);
    expect(err.message).toMatch(/midnight UTC/);
    expect(err.message).not.toMatch(/resets on its own/i);
  });

  it("names the time left until midnight UTC truthfully", () => {
    expect(untilUtcMidnight(new Date("2026-09-12T22:30:00Z"))).toBe("about 2 hours");
    expect(untilUtcMidnight(new Date("2026-09-12T23:50:00Z"))).toBe("10 minutes");
    expect(untilUtcMidnight(new Date("2026-09-12T23:59:30Z"))).toBe("1 minute");
    expect(untilUtcMidnight(new Date("2026-09-12T00:00:00Z"))).toBe("about 24 hours");
  });

  it("reads past PostgREST's 1000-row page, so a busy house cannot hide its spend", async () => {
    // Two full pages at $0.003 a row is $6 against a $5 allowance. The first
    // page alone is $3, which a single capped read would have admitted.
    const rows = (prefix: string) =>
      Array.from({ length: 1000 }, (_, i) => ({
        id: `${prefix}-${String(i).padStart(4, "0")}`,
        cost_usd: 0.003,
      }));
    const seen = { gte: [] as string[], gt: [] as string[], reads: 0 };
    const svc = new ModelClientService(
      fiveDollars,
      ledger([rows("a"), rows("b"), []], seen),
    );
    await expect(svc.call(opts(true))).rejects.toBeInstanceOf(
      ModelSpendCeilingError,
    );
    expect(fetchCalls).toBe(0);
    expect(seen.gt).toEqual(["a-0999", "b-0999"]);
  });

  it("keeps today's sum and the lifetime sum in separate cache entries", async () => {
    // A lifetime total cached under today's key would answer the wrong question.
    const seen = { gte: [] as string[], gt: [] as string[], reads: 0 };
    const svc = new ModelClientService(
      fiveDollars,
      ledger([[{ id: "a", cost_usd: 0.01 }], [{ id: "a", cost_usd: 0.01 }]], seen),
    );
    await svc.call(opts(true)); // the daily question
    await (svc as any).retryAllowedBySpendCeiling("r1"); // the tier's question
    expect(seen.reads).toBe(2);
  });
});
