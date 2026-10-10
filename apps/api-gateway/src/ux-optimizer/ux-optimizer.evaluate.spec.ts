import { UxOptimizerService, riseIsBeyondNoise } from "./ux-optimizer.service";

/**
 * The nightly override score (F-650). Three rules, each of which used to fail
 * quietly:
 *
 *   * one extra rage click (1 -> 2, +100%) is noise, not a reason to pull a
 *     change the house has lived with;
 *   * the learnings ledger gets a row when the verdict moves, not every night;
 *   * a failed count is not zero friction.
 */

const HOUSE = "550e8400-e29b-41d4-a716-446655440000";

interface Stub {
  /** [before, after] weekly counts. */
  counts: [number, number];
  countError?: string;
  /** Newest learning already on file for this override, if any. */
  lastLearning?: { outcome: string; verdict: string } | null;
}

function makeService(stub: Stub) {
  const inserts: Array<{ table: string; payload: any }> = [];
  const updates: Array<{ table: string; payload: any }> = [];
  let signalReads = 0;

  const client: any = {
    from(table: string) {
      let op = "select";
      let payload: any;
      let signalIndex = -1;
      if (table === "ux_signals") signalIndex = signalReads++;
      const result = () => {
        if (op === "insert") {
          inserts.push({ table, payload });
          return { data: null, error: null };
        }
        if (op === "update") {
          updates.push({ table, payload });
          return { data: null, error: null };
        }
        if (table === "ux_overrides")
          return {
            data: {
              id: "ov-1",
              restaurant_id: HOUSE,
              page: "/orders",
              target_key: "save-button",
              proposal_id: "prop-1",
            },
            error: null,
          };
        if (table === "ux_signals")
          return stub.countError
            ? { data: null, count: null, error: { message: stub.countError } }
            : { data: null, count: stub.counts[signalIndex], error: null };
        if (table === "ux_learnings")
          return {
            data: stub.lastLearning ? [stub.lastLearning] : [],
            error: null,
          };
        if (table === "ux_proposals")
          return { data: { id: "prop-1", status: "applied" }, error: null };
        return { data: null, error: null };
      };
      const b: any = {
        select: () => b,
        insert: (p: any) => ((op = "insert"), (payload = p), b),
        update: (p: any) => ((op = "update"), (payload = p), b),
        eq: () => b,
        is: () => b,
        gte: () => b,
        lt: () => b,
        order: () => b,
        limit: () => b,
        single: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  };
  const svc = new UxOptimizerService(
    { getClient: () => client } as any,
    { get: () => undefined } as any,
    {} as any,
    {} as any,
  );
  const rollback = jest
    .spyOn(svc, "rollback")
    .mockResolvedValue(undefined as any);
  return { svc, inserts, updates, rollback };
}

describe("riseIsBeyondNoise", () => {
  it("calls one extra click noise and a clear jump real", () => {
    expect(riseIsBeyondNoise(1, 2)).toBe(false);
    expect(riseIsBeyondNoise(20, 23)).toBe(false);
    expect(riseIsBeyondNoise(20, 35)).toBe(true);
    expect(riseIsBeyondNoise(5, 3)).toBe(false);
  });
});

describe("UxOptimizerService.evaluateOverride", () => {
  it("does not revert on 1 -> 2 rage clicks", async () => {
    const { svc, rollback } = makeService({ counts: [1, 2] });
    const res = await svc.evaluateOverride("ov-1");
    expect(res.verdict).toBe("keep");
    expect(res.outcome).toBe("too_few_events");
    expect(rollback).not.toHaveBeenCalled();
  });

  it("still reverts a rise well beyond noise", async () => {
    const { svc, rollback } = makeService({ counts: [20, 40] });
    const res = await svc.evaluateOverride("ov-1");
    expect(res.verdict).toBe("revert");
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("writes no learning when the verdict has not moved", async () => {
    const { svc, inserts } = makeService({
      counts: [10, 10],
      lastLearning: { outcome: "neutral", verdict: "keep" },
    });
    await svc.evaluateOverride("ov-1");
    expect(inserts.filter((i) => i.table === "ux_learnings")).toHaveLength(0);
  });

  it("writes a learning when the verdict moved", async () => {
    const { svc, inserts } = makeService({
      counts: [10, 5],
      lastLearning: { outcome: "neutral", verdict: "keep" },
    });
    await svc.evaluateOverride("ov-1");
    const rows = inserts.filter((i) => i.table === "ux_learnings");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.outcome).toBe("improved");
  });

  it("treats a failed count as a failure, not as zero friction", async () => {
    const { svc, inserts, rollback } = makeService({
      counts: [0, 0],
      countError: "timeout",
    });
    await expect(svc.evaluateOverride("ov-1")).rejects.toThrow(/timeout/);
    expect(inserts).toHaveLength(0);
    expect(rollback).not.toHaveBeenCalled();
  });
});
