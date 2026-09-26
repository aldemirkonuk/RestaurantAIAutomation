import {
  ActRefused,
  RecommendationActionsService,
} from "./recommendation-actions.service";
import {
  PLATFORM_ADMIN_REFUSAL,
  notesTouchedBy,
  touchesNotes,
} from "./insights/item-state";

/**
 * Sketch 122 Q2 — the founder, 2026-09-25, round 5, "Add all three
 * (Recommended)": snooze, pin and mark-as-briefed are one tap with Undo and
 * no seal (ADR 0112 F10, amended). Snooze and pin already had their write
 * paths; "Mark as briefed" is the self-contained act — the tap stamps
 * `acted_at` — so its Undo must take the stamp back (`acted: false`), and
 * taking back SOMEONE ELSE's stamp is gated like clearing their pin (ADR 0191
 * round 5, "Gate like acts"). `acted_by` (migration 20260927100000) is what
 * lets the gate tell whose stamp it is.
 *
 * The table stub is `recommendation-round5.spec.ts`'s own, copied — it
 * merges an upsert onto the existing row, so a second write sees the first.
 */

const RID = "r-1";
const RULE = "sales_below_weekday_baseline#Tuesday#fire:day:2026-09-22";

const STAFF_A = { userId: "u-staff-a", role: "staff", leadsAreas: [] };
const STAFF_B = { userId: "u-staff-b", role: "staff", leadsAreas: [] };
const MANAGER = { userId: "u-manager", role: "manager", leadsAreas: [] };
const OWNER = { userId: "u-owner", role: "owner", leadsAreas: [] };
const ADMIN = { userId: "u-admin", role: "admin", leadsAreas: [] };

type Row = Record<string, any>;

function tables(seed: { actions?: Row[] } = {}) {
  const store: Record<string, Row[]> = {
    recommendation_actions: (seed.actions ?? []).map((r) => ({ ...r })),
    recommendation_action_history: [],
    recommendation_personal_snoozes: [],
    system_audit_log: [],
  };
  const writes: Array<{ table: string; op: string; payload: Row }> = [];
  const client = {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let single = false;
      let op: "read" | "upsert" | "delete" = "read";
      let payload: Row | null = null;
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => {
        filters.push((r) => r[c] === v);
        return b;
      };
      b.in = (c: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[c]));
        return b;
      };
      b.upsert = (p: Row) => {
        op = "upsert";
        payload = p;
        writes.push({ table, op, payload: p });
        // Merge onto any existing row so a second write in the same test
        // sees the first's note-author columns, the way upsert(onConflict)
        // does in Postgres.
        const key = (r: Row) =>
          r.restaurant_id === p.restaurant_id && r.rule_key === p.rule_key;
        const existing = (store[table] ?? []).find(key);
        const merged = { ...(existing ?? {}), ...p };
        if (existing) Object.assign(existing, merged);
        else store[table] = [...(store[table] ?? []), merged];
        return b;
      };
      b.maybeSingle = async () => {
        single = true;
        const hit = (store[table] ?? []).filter((r) =>
          filters.every((f) => f(r)),
        );
        return { data: hit[0] ?? null, error: null };
      };
      b.single = async () => {
        single = true;
        return {
          data: { ...payload, updated_at: "2026-09-22T12:00:00.000Z" },
          error: null,
        };
      };
      b.insert = async (p: Row) => {
        writes.push({ table, op: "insert", payload: p });
        store[table]?.push({ ...p });
        return { error: null };
      };
      b.then = (resolve: any, reject: any) => {
        if (single) return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        const hit = (store[table] ?? []).filter((r) =>
          filters.every((f) => f(r)),
        );
        return Promise.resolve({ data: hit, error: null }).then(
          resolve,
          reject,
        );
      };
      return b;
    },
  };
  return { db: { getClient: () => client } as any, store, writes };
}

const row = (rule_key: string, over: Row = {}): Row => ({
  restaurant_id: RID,
  rule_key,
  status: "active",
  reason: null,
  snooze_until: null,
  pinned: false,
  pinned_by: null,
  feedback: null,
  rated_by: null,
  assigned_to: null,
  assigned_by: null,
  updated_at: "2026-09-20T10:00:00.000Z",
  ...over,
});

type Write = { table: string; op: string; payload: Row };
const stateWrites = (w: Write[]) =>
  w.filter((x) => x.table === "recommendation_actions" && x.op === "upsert");
const auditWrites = (w: Write[]) =>
  w.filter((x) => x.table === "system_audit_log" && x.op === "insert");

async function refusalOf(p: Promise<unknown>): Promise<ActRefused> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActRefused) return e;
    throw e;
  }
  throw new Error("the write was not refused");
}


describe("which patches are a note change", () => {
  it("stamping a briefing and taking it back are both one, like a pin", () => {
    expect(notesTouchedBy({ acted: false })).toEqual(["acted"]);
    expect(notesTouchedBy({ acted: true })).toEqual(["acted"]);
    expect(touchesNotes({ acted: false })).toBe(true);
    expect(touchesNotes({ acted: true })).toBe(true);
    expect(notesTouchedBy({})).toEqual([]);
  });
});

describe("mark as briefed: the tap is the act, and its Undo is gated like a pin", () => {
  it("staff mark an unstamped card briefed: acted_at is stamped, names them, and is audited as a note", async () => {
    const t = tables({ actions: [row(RULE)] });
    const out = await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { acted: true },
      undefined,
      STAFF_A,
    );
    const w = stateWrites(t.writes);
    expect(w).toHaveLength(1);
    expect(typeof w[0].payload.acted_at).toBe("string");
    expect(w[0].payload.acted_by).toBe("u-staff-a");
    expect(out.noteAudit).toEqual({ recorded: true, reason: null });
    expect(auditWrites(t.writes)[0].payload.changes).toEqual({
      rule_key: RULE,
      acted: { from: false, to: true, from_by: null },
    });
  });

  it("staff RE-stamping over someone else's briefing are refused (403, not_your_note): acted_by is not overwritten", async () => {
    const t = tables({
      actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { acted: true },
        undefined,
        STAFF_B,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(e.code).toBe("not_your_note");
    expect(t.writes).toEqual([]);
    expect(t.store.recommendation_actions[0].acted_by).toBe("u-staff-a");
  });

  it("the same refusal holds in bulk: one someone-else's stamp refuses the whole selection", async () => {
    const OTHER = "sales_below_weekday_baseline#Wednesday#fire:day:2026-09-23";
    const t = tables({
      actions: [
        row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" }),
        row(OTHER),
      ],
    });
    await expect(
      new RecommendationActionsService(t.db).bulkSetActionAs(
        RID,
        [{ ruleKey: RULE }, { ruleKey: OTHER }],
        { acted: true },
        STAFF_B,
      ),
    ).rejects.toMatchObject({ code: "not_your_note" });
    expect(t.writes).toEqual([]);
  });

  it("staff re-stamp their own briefing, and a manager re-stamps anyone's — audited with whose it was", async () => {
    const seed = () =>
      tables({
        actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
      });
    const own = seed();
    await new RecommendationActionsService(own.db).setActionAs(
      RID,
      RULE,
      { acted: true },
      undefined,
      STAFF_A,
    );
    expect(stateWrites(own.writes)[0].payload.acted_by).toBe("u-staff-a");

    const mgr = seed();
    await new RecommendationActionsService(mgr.db).setActionAs(
      RID,
      RULE,
      { acted: true },
      undefined,
      MANAGER,
    );
    expect(stateWrites(mgr.writes)[0].payload.acted_by).toBe("u-manager");
    expect(auditWrites(mgr.writes)[0].payload).toMatchObject({ actor_id: "u-manager" });
    expect(auditWrites(mgr.writes)[0].payload.changes.acted).toEqual({
      from: true,
      to: true,
      from_by: "u-staff-a",
    });
  });

  it("the platform admin cannot stamp a briefing either — not on an unstamped card, not over one", async () => {
    for (const seedRow of [
      row(RULE),
      row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" }),
    ]) {
      const t = tables({ actions: [seedRow] });
      const e = await refusalOf(
        new RecommendationActionsService(t.db).setActionAs(
          RID,
          RULE,
          { acted: true },
          undefined,
          ADMIN,
        ),
      );
      expect(e.message).toBe(PLATFORM_ADMIN_REFUSAL);
      expect(t.writes).toEqual([]);
    }
  });

  it("an anonymous caller cannot stamp a briefing: every stamp names who made it", async () => {
    const t = tables({ actions: [row(RULE)] });
    await expect(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { acted: true },
        undefined,
        { userId: null, role: "owner", leadsAreas: [] } as any,
      ),
    ).rejects.toThrow(/signed-in user is required/);
    expect(t.writes).toEqual([]);
  });

  it("staff take back their own briefing: the stamp and its author clear together, and the change is audited", async () => {
    const t = tables({
      actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
    });
    const out = await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { acted: false },
      undefined,
      STAFF_A,
    );
    expect(stateWrites(t.writes)[0].payload).toMatchObject({
      acted_at: null,
      acted_by: null,
    });
    expect(out.noteAudit).toEqual({ recorded: true, reason: null });
    expect(auditWrites(t.writes)[0].payload.changes).toEqual({
      rule_key: RULE,
      acted: { from: true, to: false, from_by: "u-staff-a" },
    });
  });

  it("staff taking back SOMEONE ELSE's briefing are refused (403, not_your_note), and nothing is written", async () => {
    const t = tables({
      actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { acted: false },
        undefined,
        STAFF_B,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(e.code).toBe("not_your_note");
    expect(t.writes).toEqual([]);
  });

  it("a stamp with no recorded author (made before acted_by existed) fails closed: owner/manager only", async () => {
    const seed = () =>
      tables({ actions: [row(RULE, { acted_at: "2026-09-01T18:00:00.000Z", acted_by: null })] });
    const asStaff = seed();
    const e = await refusalOf(
      new RecommendationActionsService(asStaff.db).setActionAs(
        RID,
        RULE,
        { acted: false },
        undefined,
        STAFF_A,
      ),
    );
    expect(e.code).toBe("not_your_note");
    expect(asStaff.writes).toEqual([]);

    for (const who of [OWNER, MANAGER]) {
      const t = seed();
      await new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { acted: false },
        undefined,
        who,
      );
      expect(stateWrites(t.writes)[0].payload).toMatchObject({ acted_at: null, acted_by: null });
    }
  });

  it("a manager takes back a staff member's briefing, and the audit says whose it was", async () => {
    const t = tables({
      actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
    });
    await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { acted: false },
      undefined,
      MANAGER,
    );
    expect(auditWrites(t.writes)[0].payload).toMatchObject({ actor_id: "u-manager" });
    expect(auditWrites(t.writes)[0].payload.changes.acted).toEqual({
      from: true,
      to: false,
      from_by: "u-staff-a",
    });
  });

  it("the platform admin cannot take a briefing back", async () => {
    const t = tables({
      actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { acted: false },
        undefined,
        ADMIN,
      ),
    );
    expect(e.message).toBe(PLATFORM_ADMIN_REFUSAL);
    expect(t.writes).toEqual([]);
  });

  it("an anonymous caller cannot take a briefing back: every take-back names who made it", async () => {
    const t = tables({
      actions: [row(RULE, { acted_at: "2026-09-25T18:00:00.000Z", acted_by: "u-staff-a" })],
    });
    await expect(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { acted: false },
        undefined,
        { userId: null, role: "owner", leadsAreas: [] } as any,
      ),
    ).rejects.toThrow(/signed-in user is required/);
    expect(t.writes).toEqual([]);
  });
});
