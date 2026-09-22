import {
  FORGET_OLD_NAMES_RPC,
  RECOMMENDATION_HISTORY_RETENTION_CRON,
  RecommendationHistoryRetention,
} from "./recommendation-history-retention";

/**
 * ADR 0191 round 4, answer 6 (the founder, 2026-09-21 — one of the seven
 * options he took with "Take all seven"): names in the recommendation
 * history are kept two years; then the name goes and the act stays.
 *
 * The RULE is SQL — migration 20260921171100, proven by the self-asserting
 * `supabase/tests/20260921171100_…_test.sql` on a database built from every
 * migration. The unit here is the gateway's daily runner: that it calls that
 * one function, every day, and never reports a run it did not make as one
 * that removed nothing. The database client is the stub; the runner is real.
 */

function client(answer: { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const db = {
    getClient: () => ({
      rpc: async (fn: string, args?: unknown) => {
        calls.push({ fn, args });
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    }),
  } as any;
  return { db, calls };
}

describe("the recommendation history's two-year rule, run daily", () => {
  it("calls the migration's own function, with nothing the caller could widen", async () => {
    const { db, calls } = client({ data: 3 });
    const n = await new RecommendationHistoryRetention(db).forgetOldNames();
    expect(n).toBe(3);
    expect(calls).toEqual([
      { fn: "recommendation_action_history_forget_old_names", args: undefined },
    ]);
    expect(FORGET_OLD_NAMES_RPC).toBe("recommendation_action_history_forget_old_names");
  });

  it("runs every day, not once a year — a name's two years end on its own date", () => {
    // minute hour day-of-month month day-of-week: every day at 03:45 UTC.
    expect(RECOMMENDATION_HISTORY_RETENTION_CRON).toBe("45 3 * * *");
  });

  it("zero removed is a real answer, and is said", async () => {
    const { db } = client({ data: 0 });
    const svc = new RecommendationHistoryRetention(db);
    expect(svc.lastRun()).toBeNull(); // has not run: not "removed none"
    const tick = await svc.sweep();
    expect(tick).toMatchObject({ forgotten: 0, error: null });
    expect(svc.lastRun()).toEqual(tick);
  });

  it("a failed call is a failed run — never 'removed none'", async () => {
    const { db } = client({ error: { message: "permission denied for function" } });
    const svc = new RecommendationHistoryRetention(db);
    await expect(svc.forgetOldNames()).rejects.toThrow(/permission denied/);
    const tick = await svc.sweep();
    expect(tick.forgotten).toBeNull();
    expect(tick.error).toMatch(/permission denied/);
  });

  it("an answer that is not a count is refused, not read as one", async () => {
    for (const data of [null, "many", -1, 1.5, { n: 2 }]) {
      const { db } = client({ data });
      await expect(
        new RecommendationHistoryRetention(db).forgetOldNames(),
      ).rejects.toThrow(/not a count/);
      const tick = await new RecommendationHistoryRetention(db).sweep();
      expect(tick.forgotten).toBeNull();
    }
  });
});
