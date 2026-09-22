import {
  FORGET_OLD_CREATORS_RPC,
  FORGET_OLD_NAMES_RPC,
  RECOMMENDATION_HISTORY_RETENTION_CRON,
  RecommendationHistoryRetention,
} from "./recommendation-history-retention";

/**
 * ADR 0191 round 4, answer 6 (the founder, 2026-09-21 — one of the seven
 * options he took with "Take all seven"): names in the recommendation
 * history are kept two years; then the name goes and the act stays.
 *
 * ROUND 5 (the founder, 2026-09-22, "History + created_by"): the same daily
 * run also clears `recommendation_actions.created_by` past two years —
 * `system_audit_log` keeps its own retention instead.
 *
 * The RULE is SQL — migrations 20260921171100 and 20260922010001, proven by
 * their self-asserting SQL tests on a database built from every migration.
 * The unit here is the gateway's daily runner: that it calls BOTH functions,
 * every day, independently, and never reports a run it did not make as one
 * that removed nothing. The database client is the stub; the runner is real.
 */

function client(byFn: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const db = {
    getClient: () => ({
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ fn, args });
        const answer = byFn[fn] ?? {};
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    }),
  } as any;
  return { db, calls };
}

/** Both RPCs answer the same count, for a test that does not care which. */
function sameAnswerClient(answer: { data?: unknown; error?: { message: string } | null }) {
  return client({ [FORGET_OLD_NAMES_RPC]: answer, [FORGET_OLD_CREATORS_RPC]: answer });
}

describe("the recommendation history's two-year rule, run daily", () => {
  it("calls the migration's own function, with nothing the caller could widen", async () => {
    const { db, calls } = client({ [FORGET_OLD_NAMES_RPC]: { data: 3 } });
    const n = await new RecommendationHistoryRetention(db).forgetOldNames();
    expect(n).toBe(3);
    expect(calls).toEqual([
      { fn: "recommendation_action_history_forget_old_names", args: undefined },
    ]);
    expect(FORGET_OLD_NAMES_RPC).toBe("recommendation_action_history_forget_old_names");
  });

  it("round 5: created_by is its own function, called on its own", async () => {
    const { db, calls } = client({ [FORGET_OLD_CREATORS_RPC]: { data: 5 } });
    const n = await new RecommendationHistoryRetention(db).forgetOldCreators();
    expect(n).toBe(5);
    expect(calls).toEqual([
      { fn: "recommendation_actions_forget_old_creators", args: undefined },
    ]);
    expect(FORGET_OLD_CREATORS_RPC).toBe(
      "recommendation_actions_forget_old_creators",
    );
  });

  it("runs every day, not once a year — a name's two years end on its own date", () => {
    // minute hour day-of-month month day-of-week: every day at 03:45 UTC.
    expect(RECOMMENDATION_HISTORY_RETENTION_CRON).toBe("45 3 * * *");
  });

  it("a sweep calls both functions, every time", async () => {
    const { db, calls } = sameAnswerClient({ data: 0 });
    await new RecommendationHistoryRetention(db).sweep();
    expect(calls.map((c) => c.fn).sort()).toEqual(
      [FORGET_OLD_CREATORS_RPC, FORGET_OLD_NAMES_RPC].sort(),
    );
  });

  it("zero removed is a real answer, and is said, for both", async () => {
    const { db } = sameAnswerClient({ data: 0 });
    const svc = new RecommendationHistoryRetention(db);
    expect(svc.lastRun()).toBeNull(); // has not run: not "removed none"
    const tick = await svc.sweep();
    expect(tick).toMatchObject({
      forgotten: 0,
      error: null,
      creatorsForgotten: 0,
      creatorsError: null,
    });
    expect(svc.lastRun()).toEqual(tick);
  });

  it("a failed call is a failed run — never 'removed none'", async () => {
    const { db } = sameAnswerClient({
      error: { message: "permission denied for function" },
    });
    const svc = new RecommendationHistoryRetention(db);
    await expect(svc.forgetOldNames()).rejects.toThrow(/permission denied/);
    const tick = await svc.sweep();
    expect(tick.forgotten).toBeNull();
    expect(tick.error).toMatch(/permission denied/);
    expect(tick.creatorsForgotten).toBeNull();
    expect(tick.creatorsError).toMatch(/permission denied/);
  });

  it("one function failing never reads as the other's answer, and does not stop it running", async () => {
    const { db } = client({
      [FORGET_OLD_NAMES_RPC]: { error: { message: "history sweep timed out" } },
      [FORGET_OLD_CREATORS_RPC]: { data: 7 },
    });
    const tick = await new RecommendationHistoryRetention(db).sweep();
    expect(tick.forgotten).toBeNull();
    expect(tick.error).toMatch(/history sweep timed out/);
    expect(tick.creatorsForgotten).toBe(7);
    expect(tick.creatorsError).toBeNull();
  });

  it("an answer that is not a count is refused, not read as one", async () => {
    for (const data of [null, "many", -1, 1.5, { n: 2 }]) {
      const { db } = sameAnswerClient({ data });
      await expect(
        new RecommendationHistoryRetention(db).forgetOldNames(),
      ).rejects.toThrow(/not a count/);
      await expect(
        new RecommendationHistoryRetention(db).forgetOldCreators(),
      ).rejects.toThrow(/not a count/);
      const tick = await new RecommendationHistoryRetention(db).sweep();
      expect(tick.forgotten).toBeNull();
      expect(tick.creatorsForgotten).toBeNull();
    }
  });
});
