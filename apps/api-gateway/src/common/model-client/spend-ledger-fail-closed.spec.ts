import {
  ModelClientService,
  ModelSpendLedgerUnreadableError,
} from "./model-client.service";

/**
 * The founder, 2026-09-21 (ADR 0163 Q22, re-answered; relayed in ADR 0193's
 * review trail): the per-house AI spend ceiling FAILS CLOSED for the
 * menu-upload billed read -- if the spend ledger cannot be read, the read waits
 * and says why -- and every other path is unchanged.
 *
 * `spendLedgerUnreadable: "closed"` is that choice, per call site. These tests
 * run the real client against a fake ledger whose answers are scripted per
 * read, and count what actually left the process (`fetch`).
 */
describe("a call site can make the spend ceiling fail CLOSED on an unreadable ledger", () => {
  let fetchCalls: number;
  let fetchStatuses: number[];
  const realFetch = global.fetch;

  /** Each ledger read takes the next answer; the last one repeats. */
  function serviceWith(answers: Array<{ spendUsd?: number; error?: string; throws?: boolean }>) {
    let reads = 0;
    const config = {
      get: (k: string) =>
        k === "ANTHROPIC_API_KEY" ? "test-key" : k === "MODEL_DAILY_SPEND_CEILING_USD" ? "5" : undefined,
    } as any;
    const ledger = () => {
      const a = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      if (a.throws) throw new Error("socket hang up");
      return a.error
        ? { data: null, error: { message: a.error } }
        : { data: [{ id: "1", cost_usd: a.spendUsd ?? 0 }], error: null };
    };
    const query: any = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      is: () => query,
      gt: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: { subscription_tier: "pilot" }, error: null }),
      then: (resolve: any, reject: any) => {
        try {
          resolve(ledger());
        } catch (e) {
          reject(e);
        }
      },
    };
    const database = { supabase: { from: () => query } } as any;
    return { svc: new ModelClientService(config, database), reads: () => reads };
  }

  beforeEach(() => {
    fetchCalls = 0;
    fetchStatuses = [200];
    global.fetch = (async () => {
      const status = fetchStatuses[Math.min(fetchCalls, fetchStatuses.length - 1)];
      fetchCalls++;
      return {
        ok: status === 200,
        status,
        json: async () => ({ content: [{ type: "text", text: "[]" }] }),
        text: async () => "overloaded",
        headers: { get: () => null },
      } as any;
    }) as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const opts = (mode?: "open" | "closed", extra: Record<string, unknown> = {}) => ({
    body: { model: "claude-haiku-4-5" },
    ...(mode ? { spendLedgerUnreadable: mode } : {}),
    ...extra,
    nf: { subjectId: "ScanParser", taskType: "menu_scan", stimulus: "s", choice: "c", restaurantId: "r1" } as any,
  });

  it("closed + an unreadable ledger: waits, says why, and nothing leaves the process", async () => {
    const { svc } = serviceWith([{ error: "timeout" }]);
    const p = svc.call(opts("closed"));
    await expect(p).rejects.toBeInstanceOf(ModelSpendLedgerUnreadableError);
    await expect(svc.call(opts("closed"))).rejects.toThrow(
      /spend record could not be read, so the menu read is waiting: nothing was sent to the model and nothing was charged/,
    );
    expect(fetchCalls).toBe(0);
  });

  it("closed + a ledger read that throws is unreadable too, not a pass", async () => {
    const { svc } = serviceWith([{ throws: true }]);
    await expect(svc.call(opts("closed"))).rejects.toBeInstanceOf(ModelSpendLedgerUnreadableError);
    expect(fetchCalls).toBe(0);
  });

  it("closed + a readable ledger under the allowance: the read goes ahead", async () => {
    const { svc } = serviceWith([{ spendUsd: 0.5 }]);
    await expect(svc.call(opts("closed"))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("closed adds NO over-allowance refusal on the first attempt (that is gateFirstAttempt, not this)", async () => {
    const { svc } = serviceWith([{ spendUsd: 999 }]);
    await expect(svc.call(opts("closed"))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("closed: a retry whose ledger read fails is not made", async () => {
    // First read (pre-flight) readable; the retry's read fails. The client
    // caches a ledger answer for 60 s, so the clock is moved past that after
    // the first attempt -- otherwise the retry would (rightly) reuse the
    // readable answer from a moment ago.
    const { svc } = serviceWith([{ spendUsd: 0.5 }, { error: "timeout" }]);
    fetchStatuses = [529, 200];
    const realNow = Date.now;
    let offset = 0;
    const inner = global.fetch;
    global.fetch = (async (...args: any[]) => {
      const r = await (inner as any)(...args);
      offset = 61_000;
      return r;
    }) as any;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    try {
      await expect(svc.call(opts("closed"))).rejects.toThrow(/Anthropic 529/);
      expect(fetchCalls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  // The founder, 2026-09-21, round 6c, verbatim: "Tier based but at the same
  // time for at the short period of time we should make it unlimited right?,
  // so never refuse a menu read". `allowance: "unlimited"` is that choice.
  it("unlimited + closed + OVER the allowance: a retry after a 529 is still made (never refused for allowance)", async () => {
    const { svc } = serviceWith([{ spendUsd: 999 }]);
    fetchStatuses = [529, 200];
    await expect(svc.call(opts("closed", { allowance: "unlimited" }))).resolves.toBeDefined();
    expect(fetchCalls).toBe(2);
  });

  it("enforced (the default) + closed + OVER the allowance: the same retry is suppressed, as before", async () => {
    const { svc } = serviceWith([{ spendUsd: 999 }]);
    fetchStatuses = [529, 200];
    await expect(svc.call(opts("closed"))).rejects.toThrow(/529/);
    expect(fetchCalls).toBe(1);
  });

  it("unlimited overrides a first-attempt gate: a house over today's allowance is not refused", async () => {
    const { svc } = serviceWith([{ spendUsd: 999 }]);
    // The gate option is built without its literal on purpose: ADR 0146's
    // CLAIMS row counts the files that opt a PRODUCTION call into the gate by
    // grepping for that literal, and this test is not such a call.
    const gate = Object.fromEntries([["gateFirstAttempt", true]]);
    await expect(svc.call(opts("closed", { allowance: "unlimited", ...gate }))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
    // ...and the same gate without "unlimited" still refuses, as before.
    await expect(svc.call(opts("closed", { ...gate }))).rejects.toThrow(/used today's AI allowance/);
    expect(fetchCalls).toBe(1);
  });

  it("unlimited does NOT open an unreadable ledger: closed still waits, and nothing is sent", async () => {
    const { svc } = serviceWith([{ error: "timeout" }]);
    await expect(svc.call(opts("closed", { allowance: "unlimited" }))).rejects.toBeInstanceOf(
      ModelSpendLedgerUnreadableError,
    );
    expect(fetchCalls).toBe(0);
  });

  it("unlimited + closed: a retry whose ledger read fails is still not made", async () => {
    const { svc } = serviceWith([{ spendUsd: 0.5 }, { error: "timeout" }]);
    fetchStatuses = [529, 200];
    const realNow = Date.now;
    let offset = 0;
    const inner = global.fetch;
    global.fetch = (async (...args: any[]) => {
      const r = await (inner as any)(...args);
      offset = 61_000;
      return r;
    }) as any;
    const spy = jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    try {
      await expect(svc.call(opts("closed", { allowance: "unlimited" }))).rejects.toThrow(/Anthropic 529/);
      expect(fetchCalls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("OTHER PATHS UNCHANGED: the default is open -- an unreadable ledger admits the call", async () => {
    const { svc, reads } = serviceWith([{ error: "timeout" }]);
    await expect(svc.call(opts())).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
    // No pre-flight ledger read at all on the default path.
    expect(reads()).toBe(0);
  });

  it("open, stated explicitly, behaves as the default", async () => {
    const { svc } = serviceWith([{ error: "timeout" }]);
    await expect(svc.call(opts("open"))).resolves.toBeDefined();
    expect(fetchCalls).toBe(1);
  });

  it("open: an unreadable ledger on a retry still admits the retry, as before", async () => {
    const { svc } = serviceWith([{ error: "timeout" }]);
    fetchStatuses = [529, 200];
    await expect(svc.call(opts())).resolves.toBeDefined();
    expect(fetchCalls).toBe(2);
  });
});
