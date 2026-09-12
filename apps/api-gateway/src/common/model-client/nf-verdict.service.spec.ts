import { NfVerdictService } from "./nf-verdict.service";
import { NfEventRef } from "./model-client.service";

/**
 * The verdict writer inherits the emitter's failure posture: the instrument
 * must never break the thing it measures. These tests pin that, plus the two
 * properties that keep verdict coverage honest — no orphan rows, and re-grading
 * on the same basis is idempotent rather than duplicative.
 */

const dbWith = (upsert: jest.Mock) => ({
  supabase: { from: jest.fn(() => ({ upsert })) },
});

const flush = () => new Promise((r) => setImmediate(r));

describe("NfVerdictService", () => {
  it("upserts on (event_id, basis) so a re-grade replaces rather than doubles", async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const svc = new NfVerdictService(dbWith(upsert) as any);

    const ref = new NfEventRef();
    ref.settle("evt-1");
    svc.record(ref, "reconciliation_v1", {
      outcome: "success",
      evidence: { tie_out_delta: 0 },
    });
    await flush();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({
      event_id: "evt-1",
      basis: "reconciliation_v1",
      outcome: "success",
    });
    expect(opts).toEqual({ onConflict: "event_id,basis" });
  });

  it("writes nothing when the emit was dropped", async () => {
    // No event row exists, so a verdict would grade nothing while still
    // counting as coverage — inflating the very number it should qualify.
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const svc = new NfVerdictService(dbWith(upsert) as any);

    const ref = new NfEventRef();
    ref.settle(null);
    svc.record(ref, "reconciliation_v1", { outcome: "success" });
    await flush();

    expect(upsert).not.toHaveBeenCalled();
  });

  it("preserves a null outcome instead of coercing it", async () => {
    // NULL means the grader ran and could not judge. Defaulting it to anything
    // — success or failure — invents a claim the grader never made.
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const svc = new NfVerdictService(dbWith(upsert) as any);

    const ref = new NfEventRef();
    ref.settle("evt-2");
    svc.record(ref, "reconciliation_v1", {
      outcome: null,
      evidence: { untestable: "no_total" },
    });
    await flush();

    expect(upsert.mock.calls[0][0].outcome).toBeNull();
  });

  it("never throws on a write failure, and counts the drop", async () => {
    const upsert = jest.fn().mockResolvedValue({ error: { message: "boom" } });
    const svc = new NfVerdictService(dbWith(upsert) as any);

    const ref = new NfEventRef();
    ref.settle("evt-3");
    expect(() =>
      svc.record(ref, "reconciliation_v1", { outcome: "success" }),
    ).not.toThrow();
    await flush();

    // Silent gaps must be countable, or "never re-raise" decays into
    // "never notice".
    expect(svc.droppedVerdicts).toBe(1);
  });
});

describe("NfEventRef", () => {
  it("settles once and ignores a second settle", async () => {
    // persistNfEvent settles with the real id, then emit's .finally settles
    // null. The first answer must win or every verdict would see null.
    const ref = new NfEventRef();
    ref.settle("evt-1");
    ref.settle(null);
    await expect(ref.id).resolves.toBe("evt-1");
  });

  it("resolves rather than rejects, so no caller needs a catch", async () => {
    const ref = new NfEventRef();
    ref.settle(null);
    await expect(ref.id).resolves.toBeNull();
  });
});
