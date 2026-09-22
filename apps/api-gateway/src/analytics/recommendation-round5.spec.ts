import {
  ActRefused,
  RecommendationActionsService,
} from "./recommendation-actions.service";
import { AnalyticsController } from "./analytics.controller";
import { PLATFORM_ADMIN_REFUSAL } from "./insights/item-state";

/**
 * ADR 0191 round 5 — the founder's three round-6w answers (2026-09-22):
 *
 *   1. acts made before the history existed name nobody — "Owner/manager
 *      only (Recommended)": kept as built (round 4). No code here; see the
 *      ADR's "Consequences of round 5".
 *   2. notes (pin, rating, assignment) — "Gate like acts (Recommended)": the
 *      platform admin is refused; staff change or clear only their own;
 *      owners and managers any; every note change is audited. THIS FILE.
 *   3. the two-year name rule reaches "History + created_by (Recommended)":
 *      `recommendation-history-retention.spec.ts` and the SQL tests
 *      (`supabase/tests/20260922010001_…_test.sql`) cover this half.
 */

const RID = "r-1";
const RULE = "vendor_concentration#*#fire:month:2026-09";

const STAFF_A = { userId: "u-staff-a", role: "staff", leadsAreas: [] };
const STAFF_B = { userId: "u-staff-b", role: "staff", leadsAreas: [] };
const MANAGER = { userId: "u-manager", role: "manager", leadsAreas: [] };
const OWNER = { userId: "u-owner", role: "owner", leadsAreas: [] };
const ADMIN = { userId: "u-admin", role: "admin", leadsAreas: [] };

// ---------------------------------------------------------------------------
// A table stub in the style of `recommendation-round4.spec.ts`'s own — it
// applies eq/in and merges an upsert onto any existing row (so a second
// write in the same test sees the first's note-author columns), so a
// dropped restaurant or rule_key filter changes whose note a row is.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Answer 2: "Gate like acts"
// ---------------------------------------------------------------------------

describe("answer 2: a note is gated like an act", () => {
  it("staff make a first pin freely — nothing was there to protect", async () => {
    const t = tables({ actions: [row(RULE)] });
    const out = await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { pinned: true },
      undefined,
      STAFF_A,
    );
    expect(stateWrites(t.writes)[0].payload).toMatchObject({
      pinned: true,
      pinned_by: "u-staff-a",
    });
    expect(out.recordedAs).toBe("note");
  });

  it("staff clear their own pin", async () => {
    const t = tables({
      actions: [row(RULE, { pinned: true, pinned_by: "u-staff-a" })],
    });
    await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { pinned: false },
      undefined,
      STAFF_A,
    );
    expect(stateWrites(t.writes)[0].payload).toMatchObject({
      pinned: false,
      pinned_by: "u-staff-a",
    });
  });

  it("staff changing or clearing SOMEONE ELSE'S pin are refused (403, not_your_note), and nothing is written", async () => {
    const t = tables({
      actions: [row(RULE, { pinned: true, pinned_by: "u-staff-a" })],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { pinned: false },
        undefined,
        STAFF_B,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(e.code).toBe("not_your_note");
    expect(e.message).toBe(
      "Only the person who made this note, or an owner or manager, can change or clear it.",
    );
    expect(t.writes).toEqual([]);
  });

  it("a note with no recorded author (pre-round-5, or an author cleared) fails closed — owner/manager only", async () => {
    const t = tables({ actions: [row(RULE, { pinned: true, pinned_by: null })] });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { pinned: false },
        undefined,
        STAFF_A,
      ),
    );
    expect(e.code).toBe("not_your_note");
    expect(t.writes).toEqual([]);

    const asOwner = tables({ actions: [row(RULE, { pinned: true, pinned_by: null })] });
    await new RecommendationActionsService(asOwner.db).setActionAs(
      RID,
      RULE,
      { pinned: false },
      undefined,
      OWNER,
    );
    expect(stateWrites(asOwner.writes)).toHaveLength(1);
  });

  it("owners and managers change or clear anyone's note", async () => {
    for (const who of [OWNER, MANAGER]) {
      const t = tables({
        actions: [row(RULE, { pinned: true, pinned_by: "u-staff-a" })],
      });
      await new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { pinned: false },
        undefined,
        who,
      );
      expect(stateWrites(t.writes)).toHaveLength(1);
    }
  });

  it("each note field has its own author — a rating from an owner does not make staff's own pin someone else's", async () => {
    const t = tables({
      actions: [row(RULE, { pinned: true, pinned_by: "u-staff-a" })],
    });
    // The owner rates it — this must not touch pinned_by.
    await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { feedback: "helpful" },
      undefined,
      OWNER,
    );
    expect(stateWrites(t.writes)[0].payload).toMatchObject({
      feedback: "helpful",
      rated_by: "u-owner",
    });
    // Staff A can still unpin their own pin — pinned_by was never overwritten.
    await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { pinned: false },
      undefined,
      STAFF_A,
    );
    expect(stateWrites(t.writes)[1].payload).toMatchObject({
      pinned: false,
      pinned_by: "u-staff-a",
    });
  });

  it("the platform admin makes no note at all — refused before anything is read or written", async () => {
    for (const patch of [
      { pinned: true },
      { feedback: "helpful" as const },
      { assignedTo: "u-x", assignedName: "X" },
    ]) {
      const t = tables({ actions: [row(RULE)] });
      const e = await refusalOf(
        new RecommendationActionsService(t.db).setActionAs(
          RID,
          RULE,
          patch,
          undefined,
          ADMIN,
        ),
      );
      expect(e.forbidden).toBe(true);
      expect(e.message).toBe(PLATFORM_ADMIN_REFUSAL);
      expect(t.writes).toEqual([]);
    }
  });

  it("the admin is refused even for a FIRST note on a card nobody has touched", async () => {
    const t = tables({ actions: [row(RULE)] });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { pinned: true },
        undefined,
        ADMIN,
      ),
    );
    expect(e.message).toBe(PLATFORM_ADMIN_REFUSAL);
    expect(t.writes).toEqual([]);
  });

  it("a signed-in actor is required for a note — no anonymous pin", async () => {
    const t = tables({ actions: [row(RULE)] });
    const noUser = { userId: null, role: "staff", leadsAreas: [] };
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { pinned: true },
        undefined,
        noUser,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(e.message).toMatch(/note \(pin, rating, assignment\)/);
    expect(t.writes).toEqual([]);
  });

  it("touching two note fields in one write is refused whole when either is someone else's", async () => {
    const t = tables({
      actions: [
        row(RULE, {
          pinned: true,
          pinned_by: "u-staff-a",
          feedback: "helpful",
          rated_by: "u-staff-b",
        }),
      ],
    });
    // Staff A owns the pin but not the rating — the whole write is refused.
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        RULE,
        { pinned: false, feedback: "not_helpful" },
        undefined,
        STAFF_A,
      ),
    );
    expect(e.code).toBe("not_your_note");
    expect(t.writes).toEqual([]);
  });

  it("every note change files its own system_audit_log row (receipt noteAudit)", async () => {
    const t = tables({ actions: [row(RULE)] });
    const out = await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { pinned: true },
      undefined,
      STAFF_A,
    );
    expect(out.noteAudit).toEqual({ recorded: true, reason: null });
    expect(auditWrites(t.writes)[0].payload).toMatchObject({
      actor_id: "u-staff-a",
      action: "recommendation_note_changed",
      entity_type: "recommendation_note",
      restaurant_id: RID,
    });
    expect(auditWrites(t.writes)[0].payload.changes).toEqual({
      rule_key: RULE,
      pinned: { from: false, to: true, from_by: null },
    });
  });

  it("like an act's row, a note's audit says what it replaced and whose it was — an owner clearing staff's pin reads as that", async () => {
    const t = tables({
      actions: [
        row(RULE, {
          pinned: true,
          pinned_by: "u-staff-a",
          feedback: "helpful",
          rated_by: "u-staff-b",
          assigned_to: "u-cook",
          assigned_name: "Cook",
          assigned_by: "u-manager",
        }),
      ],
    });
    await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { pinned: false, feedback: null, assignedTo: null },
      undefined,
      OWNER,
    );
    expect(auditWrites(t.writes)[0].payload.actor_id).toBe("u-owner");
    expect(auditWrites(t.writes)[0].payload.changes).toEqual({
      rule_key: RULE,
      pinned: { from: true, to: false, from_by: "u-staff-a" },
      feedback: { from: "helpful", to: null, from_by: "u-staff-b" },
      assignment: {
        from: { assigned_to: "u-cook", assigned_name: "Cook" },
        to: { assigned_to: null, assigned_name: null },
        from_by: "u-manager",
      },
    });
  });

  it("an assignment written as a name alone is a note too — staff cannot change or clear someone else's", async () => {
    // The gateway takes `assignedName` without `assignedTo`, and the pages
    // show `assignedName` as the assignment: that half alone is SET.
    const t = tables({
      actions: [
        row(RULE, {
          assigned_to: null,
          assigned_name: "Front of house",
          assigned_by: "u-staff-a",
        }),
      ],
    });
    for (const patch of [
      { assignedName: "Kitchen" },
      { assignedTo: null },
      { assignedTo: "u-staff-b", assignedName: "B" },
    ]) {
      const e = await refusalOf(
        new RecommendationActionsService(t.db).setActionAs(
          RID,
          RULE,
          patch,
          undefined,
          STAFF_B,
        ),
      );
      expect(e.code).toBe("not_your_note");
    }
    expect(t.writes).toEqual([]);
    // Its author still may.
    await new RecommendationActionsService(t.db).setActionAs(
      RID,
      RULE,
      { assignedName: "Kitchen" },
      undefined,
      STAFF_A,
    );
    expect(stateWrites(t.writes)[0].payload).toMatchObject({
      assigned_name: "Kitchen",
      assigned_by: "u-staff-a",
    });
    expect(auditWrites(t.writes)[0].payload.changes.assignment).toEqual({
      from: { assigned_to: null, assigned_name: "Front of house" },
      to: { assigned_to: null, assigned_name: "Kitchen" },
      from_by: "u-staff-a",
    });
  });

  it("a status write alone files no note audit; a note-only write files no rule-wide audit", async () => {
    const statusOnly = tables({ actions: [row(RULE)] });
    const out1 = await new RecommendationActionsService(statusOnly.db).setActionAs(
      RID,
      RULE,
      { status: "done" },
      undefined,
      STAFF_A,
    );
    expect(out1.noteAudit).toBeNull();

    const noteOnly = tables({ actions: [row(RULE)] });
    const out2 = await new RecommendationActionsService(noteOnly.db).setActionAs(
      RID,
      RULE,
      { pinned: true },
      undefined,
      STAFF_A,
    );
    expect(out2.audit).toBeNull();
    expect(out2.noteAudit).not.toBeNull();
  });

  it("bulk: refused whole when any item's note belongs to someone else — nothing written", async () => {
    const t = tables({
      actions: [
        row(RULE, { pinned: true, pinned_by: "u-staff-a" }),
        row("stockout_imminent#*#fire:day:2026-09-21", {
          pinned: true,
          pinned_by: "u-staff-b",
        }),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).bulkSetActionAs(
        RID,
        [
          { ruleKey: RULE },
          { ruleKey: "stockout_imminent#*#fire:day:2026-09-21" },
        ],
        { pinned: false },
        STAFF_A,
      ),
    );
    expect(e.code).toBe("not_your_note");
    expect(t.writes).toEqual([]);
  });

  it("bulk: an owner clears everyone's pins in one call, and every one is audited", async () => {
    const t = tables({
      actions: [
        row(RULE, { pinned: true, pinned_by: "u-staff-a" }),
        row("stockout_imminent#*#fire:day:2026-09-21", {
          pinned: true,
          pinned_by: "u-staff-b",
        }),
      ],
    });
    const out = await new RecommendationActionsService(t.db).bulkSetActionAs(
      RID,
      [
        { ruleKey: RULE },
        { ruleKey: "stockout_imminent#*#fire:day:2026-09-21" },
      ],
      { pinned: false },
      OWNER,
    );
    expect(out.updated).toBe(2);
    expect(out.noteAudit).toEqual({ recorded: 2, missed: 0 });
    expect(stateWrites(t.writes)).toHaveLength(2);
    // Each row names whose pin that key's was — not one author for all.
    expect(auditWrites(t.writes).map((a) => a.payload.changes)).toEqual([
      { rule_key: RULE, pinned: { from: true, to: false, from_by: "u-staff-a" } },
      {
        rule_key: "stockout_imminent#*#fire:day:2026-09-21",
        pinned: { from: true, to: false, from_by: "u-staff-b" },
      },
    ]);
  });

  it("bulk: the platform admin is refused whole, before anything is read", async () => {
    const t = tables();
    const e = await refusalOf(
      new RecommendationActionsService(t.db).bulkSetActionAs(
        RID,
        [{ ruleKey: RULE }],
        { pinned: true },
        ADMIN,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(t.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The controller's doors, round 5
// ---------------------------------------------------------------------------

describe("the controller's doors, round 5", () => {
  const proto = AnalyticsController.prototype as unknown as Record<string, any>;
  async function thrown(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (e) {
      return e;
    }
    return null;
  }

  it("a refused note change is a 403 whose body carries not_your_note beside the sentence", async () => {
    const self = {
      recommendationActions: {
        setActionAs: async () => {
          throw new ActRefused(
            "Only the person who made this note, or an owner or manager, can change or clear it.",
            true,
            "not_your_note",
          );
        },
      },
    };
    const e = await thrown(
      proto.setRecommendationAction.call(
        self,
        RID,
        { ruleKey: RULE, pinned: false },
        { userId: "u-staff-b", role: "staff" },
      ),
    );
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toMatchObject({ code: "not_your_note" });
  });

  it("the single-write response carries the noteAudit receipt", async () => {
    const self = {
      recommendationActions: {
        setActionAs: async () => ({
          row: { ruleKey: RULE },
          audit: null,
          history: null,
          noteAudit: { recorded: true, reason: null },
          recordedAs: "note",
          personal: null,
        }),
      },
    };
    const out = await proto.setRecommendationAction.call(
      self,
      RID,
      { ruleKey: RULE, pinned: true },
      { userId: "u-staff-a", role: "staff" },
    );
    expect(out.noteAudit).toEqual({ recorded: true, reason: null });
  });
});
