import { RecommendationActionsService } from "./recommendation-actions.service";

/**
 * `getDigestPref`'s `set` field is the one honesty guarantee the UI has for
 * "this house never touched the digest": DigestPost.tsx:63/218/371 all read
 * it to decide between "Not yet set for this house" and showing the actual
 * values. Nothing pinned that contract before this — see recommendations.md's
 * "Sketch 120 (round 4)" note (item 2, the house's post).
 *
 * `getDigestPref` was un-exercised: no row and a real row both fell through
 * to the SAME defaulted shape unless `set` is asserted separately from the
 * other fields, which is exactly the bug this guards (mutation-tested below:
 * forcing `set: true` unconditionally fails the "no row" case).
 */

interface FakeRow {
  digest_enabled?: boolean;
  digest_hour?: number;
  digest_min_urgency?: string;
  recipient_email?: string | null;
  last_sent_at?: string | null;
}

/** A `DatabaseService` stand-in exposing only what `getDigestPref` calls:
 * `.from(...).select(...).eq(...).maybeSingle()`. */
function fakeDb(row: FakeRow | null) {
  const builder: any = {};
  for (const m of ["select", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = async () => ({ data: row, error: null });
  return { getClient: () => ({ from: (_table: string) => builder }) } as any;
}

describe("RecommendationActionsService.getDigestPref", () => {
  it("with no row: set is false, and the defaults are not reported as a choice", async () => {
    const svc = new RecommendationActionsService(fakeDb(null));
    const pref = await svc.getDigestPref("r-1");
    expect(pref.set).toBe(false);
    // The defaults themselves still come back (the UI needs SOME value to
    // show while disabled), but `set: false` is what tells the caller not to
    // read them as "the house chose 7am".
    expect(pref.digestEnabled).toBe(false);
    expect(pref.digestHour).toBe(7);
    expect(pref.digestMinUrgency).toBe("this_week");
    expect(pref.recipientEmail).toBeNull();
    expect(pref.lastSentAt).toBeNull();
  });

  it("with a row: set is true, and the row's own values come back", async () => {
    const svc = new RecommendationActionsService(
      fakeDb({
        digest_enabled: true,
        digest_hour: 9,
        digest_min_urgency: "now",
        recipient_email: "owner@example.com",
        last_sent_at: "2026-09-18T09:00:00.000Z",
      }),
    );
    const pref = await svc.getDigestPref("r-1");
    expect(pref.set).toBe(true);
    expect(pref.digestEnabled).toBe(true);
    expect(pref.digestHour).toBe(9);
    expect(pref.digestMinUrgency).toBe("now");
    expect(pref.recipientEmail).toBe("owner@example.com");
    expect(pref.lastSentAt).toBe("2026-09-18T09:00:00.000Z");
  });

  it("with a row that has every optional column null: set is STILL true", async () => {
    // A house can have a row that only ever set `digest_enabled=false` and
    // touched nothing else — `set` reads row EXISTENCE, not whether any
    // field happens to differ from the default.
    const svc = new RecommendationActionsService(
      fakeDb({ digest_enabled: false }),
    );
    const pref = await svc.getDigestPref("r-1");
    expect(pref.set).toBe(true);
    expect(pref.digestEnabled).toBe(false);
  });
});

/**
 * ADR 0191 — a catalogue type on/off is "owner/manager only, audited" (the
 * founder, 2026-09-21). The role gate lives on the route; what this unit owns
 * is the write, the refusal of anything that is not a catalogue type, and the
 * audit row in `system_audit_log` — the house's trail, which /logs reads.
 * `recommendation_actions` alone is not an audit: one upserted row per key,
 * so turning a type back on overwrites who turned it off.
 */
describe("RecommendationActionsService.setTypeEnabled (ADR 0191)", () => {
  const TYPE = "overall.revenue.vs_same_weekday";

  function recordingDb(opts: { auditError?: string } = {}) {
    const calls: Array<{ table: string; op: string; payload: any }> = [];
    const client = {
      from: (table: string) => {
        const builder: any = {};
        builder.upsert = (payload: any) => {
          calls.push({ table, op: "upsert", payload });
          return builder;
        };
        builder.select = () => builder;
        builder.single = async () => ({
          data: {
            rule_key: calls[calls.length - 1]?.payload?.rule_key,
            status: calls[calls.length - 1]?.payload?.status,
            updated_at: "2026-09-21T12:00:00.000Z",
          },
          error: null,
        });
        builder.insert = async (payload: any) => {
          calls.push({ table, op: "insert", payload });
          return {
            error: opts.auditError ? { message: opts.auditError } : null,
          };
        };
        return builder;
      },
    };
    return { db: { getClient: () => client } as any, calls };
  }

  it("turning a type off writes the bare rule-scope key AND files an audit row naming the actor", async () => {
    const { db, calls } = recordingDb();
    const svc = new RecommendationActionsService(db);
    const out = await svc.setTypeEnabled(
      "r-1",
      TYPE,
      false,
      "u-actor",
      "not_relevant",
    );

    const write = calls.find((c) => c.table === "recommendation_actions");
    expect(write?.payload).toMatchObject({
      restaurant_id: "r-1",
      rule_key: `insight:${TYPE}`,
      status: "dismissed",
      reason: "not_relevant",
      created_by: "u-actor",
    });

    const audit = calls.find((c) => c.table === "system_audit_log");
    expect(audit?.op).toBe("insert");
    expect(audit?.payload).toMatchObject({
      actor_type: "user",
      actor_id: "u-actor",
      action: "recommendation_type_turned_off",
      entity_type: "recommendation_type",
      entity_id: "r-1",
      restaurant_id: "r-1",
      changes: {
        candidate_key: TYPE,
        rule_key: `insight:${TYPE}`,
        enabled: { to: false },
        reason: "not_relevant",
      },
    });
    expect(out.audit).toEqual({ recorded: true, reason: null });
  });

  it("turning it back on is its own audit row, so the trail keeps who turned it off", async () => {
    const { db, calls } = recordingDb();
    const svc = new RecommendationActionsService(db);
    await svc.setTypeEnabled("r-1", TYPE, false, "u-first", "disagree");
    await svc.setTypeEnabled("r-1", TYPE, true, "u-second");
    const rows = calls.filter((c) => c.table === "system_audit_log");
    expect(rows.map((r) => [r.payload.action, r.payload.actor_id])).toEqual([
      ["recommendation_type_turned_off", "u-first"],
      ["recommendation_type_turned_on", "u-second"],
    ]);
  });

  it("a failed audit row is reported in the receipt, never swallowed as recorded", async () => {
    const { db } = recordingDb({ auditError: "permission denied" });
    const svc = new RecommendationActionsService(db);
    const out = await svc.setTypeEnabled(
      "r-1",
      TYPE,
      false,
      "u-actor",
      "not_now",
    );
    expect(out.audit).toEqual({ recorded: false, reason: "permission denied" });
  });

  it("refuses a key the catalogue does not list, and writes nothing", async () => {
    const { db, calls } = recordingDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setTypeEnabled("r-1", `${TYPE}#tuesday#d:2026-09-16`, false, "u-actor"),
    ).rejects.toThrow(/Unknown catalogue type/);
    expect(calls).toEqual([]);
  });

  it("refuses to turn a type off without a reason label, and writes nothing", async () => {
    const { db, calls } = recordingDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setTypeEnabled("r-1", TYPE, false, "u-actor"),
    ).rejects.toThrow(/needs a reason/);
    await expect(
      svc.setTypeEnabled("r-1", TYPE, false, "u-actor", "because I said so"),
    ).rejects.toThrow(/needs a reason/);
    expect(calls).toEqual([]);
  });

  it("refuses without an actor, and writes nothing", async () => {
    const { db, calls } = recordingDb();
    const svc = new RecommendationActionsService(db);
    await expect(svc.setTypeEnabled("r-1", TYPE, false, "")).rejects.toThrow(
      /actor/,
    );
    expect(calls).toEqual([]);
  });
});
