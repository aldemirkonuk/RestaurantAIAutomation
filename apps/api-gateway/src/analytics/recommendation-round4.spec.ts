import {
  ActRefused,
  HISTORY_READ_ROWS,
  RecommendationActionsService,
  RuleWideActForbidden,
} from "./recommendation-actions.service";
import { firingPeriodOf } from "./recommendations.service";
import { AnalyticsController } from "./analytics.controller";
import {
  NOT_NOW_DEFAULT_MS,
  PLATFORM_ADMIN_REFUSAL,
  authorOf,
  holdsAnAct,
  isPlatformAdminRole,
  mayActForTheHouse,
  mayActRuleWide,
  mayUndo,
  maySnoozeForEveryone,
  planAct,
  undoRefusal,
} from "./insights/item-state";

/**
 * ADR 0191 round 4 — the founder took all seven options on 2026-09-21
 * ("Take all seven"). The seven, as the options he picked:
 *
 *   1. a card's firing lasts the rule's own period (now = a day, this_week =
 *      a week, this_month = a month, catalogue types = a week) — confirmed;
 *   2. "Not now" hides a card for one day unless a time is picked — confirmed;
 *   3. the legacy page's quick Dismiss, `d` key and bulk Dismiss are that
 *      personal one-day "Not now" — confirmed (web, `Recommendations.test.tsx`);
 *   4. the legacy page's Done and "Already handled" act on the card's own key,
 *      not the whole rule (web, `Recommendations.test.tsx`);
 *   5. staff undo only their own acts; owners and managers undo anyone's;
 *   6. the history keeps names two years, then the name goes and the act
 *      stays (`recommendation-history-retention.spec.ts`, and the SQL test
 *      `supabase/tests/20260925120300_…_test.sql`);
 *   7. the platform `admin` role never acts for a house's cards unless also
 *      an owner or manager there.
 */

const RID = "r-1";
const OTHER_HOUSE = "r-2";
const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();
const EARLIER = new Date(Date.now() - 86_400_000).toISOString();
const RULE = "vendor_concentration";
const FIRING = `${RULE}#*#fire:month:2026-09`;
const FINDING =
  "insight:overall.revenue.vs_same_weekday#wednesday#d:2026-09-16";

const STAFF = { userId: "u-staff", role: "staff", leadsAreas: [] };
const OTHER_STAFF = { userId: "u-other", role: "staff", leadsAreas: [] };
const MANAGER = { userId: "u-manager", role: "manager", leadsAreas: [] };
const OWNER = { userId: "u-owner", role: "owner", leadsAreas: [] };
const ADMIN = { userId: "u-admin", role: "admin", leadsAreas: [] };

// ---------------------------------------------------------------------------
// 1 and 2 — confirmed as built in round 3; the numbers pinned, not the names
// ---------------------------------------------------------------------------

describe("answer 1, confirmed: a firing lasts the rule's own period", () => {
  it("now is a day, this_week a week, this_month a month", () => {
    expect(firingPeriodOf("now")).toBe("day");
    expect(firingPeriodOf("this_week")).toBe("week");
    expect(firingPeriodOf("this_month")).toBe("month");
  });
  // Catalogue types keyed by their week: recommendation-round3.spec.ts,
  // "the generator keys a subject-less, period-less type by its firing week".
});

describe("answer 2, confirmed: 'Not now' hides a card for one day unless a time is picked", () => {
  it("one day is 24 hours, as a number — not whatever the constant says", () => {
    expect(NOT_NOW_DEFAULT_MS).toBe(24 * 60 * 60 * 1000);
    expect(
      planAct({ status: "dismissed", reason: "not_now" }, STAFF, [], NOW),
    ).toEqual({
      to: "personal",
      snoozeUntil: "2026-09-22T12:00:00.000Z",
      recordedAs: "snoozed_for_you",
    });
  });

  it("a picked time is kept; a time already past is not a pick, so a day", () => {
    const picked = "2026-09-28T09:00:00.000Z";
    expect(
      planAct(
        { status: "dismissed", reason: "not_now", snoozeUntil: picked },
        STAFF,
        [],
        NOW,
      ),
    ).toMatchObject({ to: "personal", snoozeUntil: picked });
    expect(
      planAct(
        {
          status: "dismissed",
          reason: "not_now",
          snoozeUntil: "2026-09-20T09:00:00.000Z",
        },
        STAFF,
        [],
        NOW,
      ),
    ).toMatchObject({
      to: "personal",
      snoozeUntil: "2026-09-22T12:00:00.000Z",
    });
  });
});

// ---------------------------------------------------------------------------
// 7 — the platform admin, pure
// ---------------------------------------------------------------------------

describe("answer 7: the platform admin never acts for a house's cards", () => {
  it("owners and managers act for the house; the platform admin, staff and no role do not", () => {
    for (const r of ["owner", "manager", "Owner", "MANAGER"])
      expect(mayActForTheHouse(r)).toBe(true);
    for (const r of ["admin", "Admin", "staff", "", null, undefined])
      expect(mayActForTheHouse(r)).toBe(false);
    expect(mayActRuleWide("admin")).toBe(false);
    expect(maySnoozeForEveryone("admin")).toBe(false);
    expect(isPlatformAdminRole("ADMIN")).toBe(true);
    expect(isPlatformAdminRole("owner")).toBe(false);
  });

  it("a dismiss, a done, a restore or a snooze for everyone from the admin is refused (403)", () => {
    const refused = {
      to: "refused",
      why: PLATFORM_ADMIN_REFUSAL,
      forbidden: true,
    };
    for (const patch of [
      { status: "dismissed", reason: "not_relevant" },
      { status: "dismissed", reason: "already_handled" },
      { status: "done" },
      { status: "active" },
    ])
      expect(planAct(patch, ADMIN, [], NOW)).toEqual(refused);
    // A snooze for everyone is not theirs either — refused as staff's is.
    expect(
      planAct(
        { status: "snoozed", snoozeUntil: LATER, snoozeFor: "house" },
        ADMIN,
        [],
        NOW,
      ),
    ).toMatchObject({ to: "refused", forbidden: true });
  });

  it("their own snooze and 'Not now' hide a card from them alone; a note is not an act", () => {
    expect(
      planAct({ status: "snoozed", snoozeUntil: LATER }, ADMIN, [], NOW),
    ).toMatchObject({ to: "personal", recordedAs: "snoozed_for_you" });
    expect(
      planAct({ status: "dismissed", reason: "not_now" }, ADMIN, [], NOW),
    ).toMatchObject({ to: "personal" });
    expect(planAct({ status: undefined }, ADMIN, [], NOW)).toMatchObject({
      to: "house",
      recordedAs: "note",
    });
  });

  it("an owner or manager of the house is never caught by the admin rule", () => {
    for (const actor of [OWNER, MANAGER])
      expect(
        planAct({ status: "dismissed", reason: "disagree" }, actor, [], NOW),
      ).toMatchObject({ to: "house", status: "dismissed" });
  });
});

// ---------------------------------------------------------------------------
// 5 — whose act it is, pure
// ---------------------------------------------------------------------------

describe("answer 5: whose act a row holds, and who may undo it", () => {
  const now = Date.parse("2026-09-21T12:00:00.000Z");

  it("a dismissal, a done and a house snooze in force hold an act; nothing else does", () => {
    expect(holdsAnAct({ status: "dismissed", snoozeUntil: null }, now)).toBe(
      true,
    );
    expect(holdsAnAct({ status: "done", snoozeUntil: null }, now)).toBe(true);
    expect(
      holdsAnAct(
        { status: "snoozed", snoozeUntil: "2026-09-22T00:00:00Z" },
        now,
      ),
    ).toBe(true);
    expect(
      holdsAnAct(
        { status: "snoozed", snoozeUntil: "2026-09-20T00:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(holdsAnAct({ status: "active", snoozeUntil: null }, now)).toBe(
      false,
    );
    expect(holdsAnAct(null, now)).toBe(false);
  });

  it("the newest history row names the person only when it wrote what the row holds", () => {
    const row = { status: "dismissed", snoozeUntil: null };
    expect(authorOf(row, { actorId: "u-staff", statusTo: "dismissed" })).toBe(
      "u-staff",
    );
    expect(authorOf(row, { actorId: "u-staff", statusTo: "done" })).toBeNull();
    expect(authorOf(row, { actorId: null, statusTo: "dismissed" })).toBeNull();
    expect(authorOf(row, null)).toBeNull();
  });

  it("staff undo their own; owners and managers anyone's; nobody undoes an unnamed act but them", () => {
    expect(mayUndo(STAFF, "u-staff")).toBe(true);
    expect(mayUndo(STAFF, "u-other")).toBe(false);
    expect(mayUndo(STAFF, null)).toBe(false);
    expect(mayUndo({ userId: null, role: "staff" }, null)).toBe(false);
    for (const who of [OWNER, MANAGER]) {
      expect(mayUndo(who, "u-other")).toBe(true);
      expect(mayUndo(who, null)).toBe(true);
    }
    expect(mayUndo(ADMIN, "u-other")).toBe(false);
  });

  it("says which refusal it is", () => {
    expect(undoRefusal(false, 1)).toBe(
      "Only the person who did this, or an owner or manager, can undo it.",
    );
    expect(undoRefusal(true, 1)).toBe(
      "It is not recorded who did this, so only an owner or manager can undo it.",
    );
    expect(undoRefusal(false, 3)).toMatch(/\(3 in this selection\)/);
  });
});

// ---------------------------------------------------------------------------
// The write path over a table stub that APPLIES eq / in / order, so a
// dropped house filter or a reversed order changes whose act a row is
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function tables(
  seed: {
    actions?: Row[];
    history?: Row[];
    historyReadError?: string;
  } = {},
) {
  const store: Record<string, Row[]> = {
    recommendation_actions: (seed.actions ?? []).map((r) => ({ ...r })),
    recommendation_action_history: (seed.history ?? []).map((r) => ({ ...r })),
    recommendation_personal_snoozes: [],
    system_audit_log: [],
  };
  const reads: string[] = [];
  const writes: Array<{ table: string; op: string; payload: Row }> = [];
  const client = {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let order: { col: string; asc: boolean } | null = null;
      let limit: number | null = null;
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
      b.gt = (c: string, v: string) => {
        filters.push((r) => Date.parse(r[c]) > Date.parse(v));
        return b;
      };
      b.lte = (c: string, v: string) => {
        filters.push((r) => Date.parse(r[c]) <= Date.parse(v));
        return b;
      };
      b.order = (col: string, o?: { ascending?: boolean }) => {
        order = { col, asc: o?.ascending !== false };
        return b;
      };
      b.limit = (n: number) => {
        limit = n;
        return b;
      };
      b.upsert = (p: Row) => {
        op = "upsert";
        payload = p;
        writes.push({ table, op, payload: p });
        return b;
      };
      b.delete = () => {
        op = "delete";
        return b;
      };
      b.single = async () => ({
        data: { ...payload, updated_at: "2026-09-21T12:00:00.000Z" },
        error: null,
      });
      b.insert = async (p: Row) => {
        writes.push({ table, op: "insert", payload: p });
        store[table]?.push({ ...p, acted_at: new Date().toISOString() });
        return { error: null };
      };
      b.then = (resolve: any, reject: any) => {
        if (op === "read") reads.push(table);
        if (
          table === "recommendation_action_history" &&
          op === "read" &&
          seed.historyReadError
        )
          return Promise.resolve({
            data: null,
            error: { message: seed.historyReadError },
          }).then(resolve, reject);
        let hit = (store[table] ?? []).filter((r) =>
          filters.every((f) => f(r)),
        );
        if (order) {
          const { col, asc } = order;
          hit = [...hit].sort((x, y) =>
            asc
              ? String(x[col]).localeCompare(String(y[col]))
              : String(y[col]).localeCompare(String(x[col])),
          );
        }
        // PostgREST answers at most `limit` rows, and says nothing when it stops.
        if (limit !== null) hit = hit.slice(0, limit);
        if (op === "delete")
          store[table] = (store[table] ?? []).filter((r) => !hit.includes(r));
        return Promise.resolve({ data: hit, error: null }).then(
          resolve,
          reject,
        );
      };
      return b;
    },
  };
  return { db: { getClient: () => client } as any, store, reads, writes };
}

const actionRow = (rule_key: string, status: string, over: Row = {}): Row => ({
  restaurant_id: RID,
  rule_key,
  status,
  reason: status === "dismissed" ? "not_relevant" : null,
  snooze_until: null,
  updated_at: "2026-09-20T10:00:00.000Z",
  ...over,
});

const act = (
  rule_key: string,
  actor_id: string | null,
  status_to: string,
  acted_at: string,
  restaurant_id = RID,
): Row => ({ restaurant_id, rule_key, actor_id, status_to, acted_at });

type Write = { table: string; op: string; payload: Row };
const stateWrites = (w: Write[]) =>
  w.filter((x) => x.table === "recommendation_actions" && x.op === "upsert");
const historyWrites = (w: Write[]) =>
  w.filter((x) => x.table === "recommendation_action_history");

async function refusalOf(p: Promise<unknown>): Promise<ActRefused> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActRefused) return e;
    throw e;
  }
  throw new Error("the write was not refused");
}

describe("answer 5 at the door: staff undo only their own acts", () => {
  it("staff return their own dismissal to the book — kept in the history as a restore", async () => {
    const t = tables({
      actions: [actionRow(FIRING, "dismissed")],
      history: [
        act(FIRING, "u-staff", "dismissed", "2026-09-20T10:00:00.000Z"),
      ],
    });
    const out = await new RecommendationActionsService(t.db).setActionAs(
      RID,
      FIRING,
      { status: "active" },
      undefined,
      STAFF,
    );
    expect(out.recordedAs).toBe("restored");
    expect(stateWrites(t.writes)[0].payload).toMatchObject({
      rule_key: FIRING,
      status: "active",
    });
    expect(historyWrites(t.writes)[0].payload).toMatchObject({
      act: "restore",
      status_from: "dismissed",
      actor_id: "u-staff",
    });
  });

  it("staff returning someone else's dismissal are refused (403, not_your_act), and nothing is written", async () => {
    const t = tables({
      actions: [actionRow(FIRING, "dismissed")],
      history: [
        act(FIRING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "active" },
        undefined,
        STAFF,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(e.code).toBe("not_your_act");
    expect(e.message).toBe(
      "Only the person who did this, or an owner or manager, can undo it.",
    );
    expect(t.writes).toEqual([]);
  });

  it("a different act laid over someone else's lifts it just the same — a done over their dismissal is refused", async () => {
    const t = tables({
      actions: [actionRow(FINDING, "dismissed")],
      history: [
        act(FINDING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        FINDING,
        { status: "done" },
        undefined,
        STAFF,
      ),
    );
    expect(e.code).toBe("not_your_act");
    expect(t.writes).toEqual([]);
  });

  it("someone else's house snooze still in force is theirs too; one that has ended holds nothing", async () => {
    const running = tables({
      actions: [actionRow(FIRING, "snoozed", { snooze_until: LATER })],
      history: [
        act(FIRING, "u-manager", "snoozed", "2026-09-20T10:00:00.000Z"),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(running.db).setActionAs(
        RID,
        FIRING,
        { status: "done" },
        undefined,
        STAFF,
      ),
    );
    expect(e.code).toBe("not_your_act");

    const ended = tables({
      actions: [actionRow(FIRING, "snoozed", { snooze_until: EARLIER })],
      history: [
        act(FIRING, "u-manager", "snoozed", "2026-09-10T10:00:00.000Z"),
      ],
    });
    await new RecommendationActionsService(ended.db).setActionAs(
      RID,
      FIRING,
      { status: "done" },
      undefined,
      STAFF,
    );
    expect(stateWrites(ended.writes)).toHaveLength(1);
    // Nothing held, so whose it was is never asked.
    expect(ended.reads).not.toContain("recommendation_action_history");
  });

  it("an act nobody can name is an owner's or manager's to undo — said as its own sentence", async () => {
    for (const history of [
      [], // written before the history existed, or its row missed
      [act(FIRING, null, "dismissed", "2026-09-20T10:00:00.000Z")], // a name removed
    ]) {
      const t = tables({ actions: [actionRow(FIRING, "dismissed")], history });
      const e = await refusalOf(
        new RecommendationActionsService(t.db).setActionAs(
          RID,
          FIRING,
          { status: "active" },
          undefined,
          STAFF,
        ),
      );
      expect(e.message).toBe(
        "It is not recorded who did this, so only an owner or manager can undo it.",
      );
      expect(t.writes).toEqual([]);
    }
  });

  it("the NEWEST history row decides: their older dismissal does not make the newer one theirs", async () => {
    const t = tables({
      actions: [actionRow(FIRING, "dismissed")],
      history: [
        act(FIRING, "u-staff", "dismissed", "2026-09-18T10:00:00.000Z"),
        act(FIRING, "u-staff", "active", "2026-09-19T10:00:00.000Z"),
        act(FIRING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "active" },
        undefined,
        STAFF,
      ),
    );
    expect(e.code).toBe("not_your_act");
  });

  it("a newest row for another act does not name who made this one", async () => {
    // They finished it; someone's later dismissal never reached the history.
    const t = tables({
      actions: [actionRow(FIRING, "dismissed")],
      history: [act(FIRING, "u-staff", "done", "2026-09-20T10:00:00.000Z")],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "active" },
        undefined,
        STAFF,
      ),
    );
    expect(e.message).toMatch(/not recorded who did this/);
  });

  it("another house's history never names the person here", async () => {
    const t = tables({
      actions: [actionRow(FIRING, "dismissed")],
      history: [
        act(FIRING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
        // Same key, newer, the staff member's own — in ANOTHER house.
        act(
          FIRING,
          "u-staff",
          "dismissed",
          "2026-09-21T10:00:00.000Z",
          OTHER_HOUSE,
        ),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "active" },
        undefined,
        STAFF,
      ),
    );
    expect(e.code).toBe("not_your_act");
  });

  it("owners and managers undo anyone's — and the history is not even read", async () => {
    for (const who of [OWNER, MANAGER]) {
      const t = tables({
        actions: [actionRow(FIRING, "dismissed")],
        history: [
          act(FIRING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
        ],
      });
      await new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "active" },
        undefined,
        who,
      );
      expect(stateWrites(t.writes)).toHaveLength(1);
      expect(t.reads).not.toContain("recommendation_action_history");
    }
  });

  it("staff acting on a card that holds nothing undo nobody", async () => {
    for (const actions of [[], [actionRow(FIRING, "active")]]) {
      const t = tables({ actions });
      await new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "done" },
        undefined,
        STAFF,
      );
      expect(stateWrites(t.writes)).toHaveLength(1);
      expect(t.reads).not.toContain("recommendation_action_history");
    }
  });

  it("a history that cannot be read refuses the write — never waved through", async () => {
    const t = tables({
      actions: [actionRow(FIRING, "dismissed")],
      historyReadError: "connection reset",
    });
    await expect(
      new RecommendationActionsService(t.db).setActionAs(
        RID,
        FIRING,
        { status: "active" },
        undefined,
        STAFF,
      ),
    ).rejects.toThrow(/Could not read who made this act.*connection reset/);
    expect(t.writes).toEqual([]);
  });

  it("a full answer that never reached a key is refused — not read as 'nobody recorded it'", async () => {
    // 1000 newer rows for one card (the most one read returns) push the
    // other card's only row, the staff member's own dismissal, off the page.
    const busy = Array.from({ length: HISTORY_READ_ROWS }, (_, i) =>
      act(
        FINDING,
        "u-staff",
        "dismissed",
        new Date(
          Date.parse("2026-09-21T00:00:00.000Z") + i * 1000,
        ).toISOString(),
      ),
    );
    const seed = () => ({
      actions: [
        actionRow(FIRING, "dismissed"),
        actionRow(FINDING, "dismissed"),
      ],
      history: [
        act(FIRING, "u-staff", "dismissed", "2026-09-01T10:00:00.000Z"),
        ...busy,
      ],
    });
    const t = tables(seed());
    await expect(
      new RecommendationActionsService(t.db).bulkSetActionAs(
        RID,
        [{ ruleKey: FIRING }, { ruleKey: FINDING }],
        { status: "active" },
        STAFF,
      ),
    ).rejects.toThrow(
      /Could not read who made this act.*1000 rows.*1 of the 2/,
    );
    expect(t.writes).toEqual([]);
    // The tabs say "could not tell" for it — never "not yours".
    const rows = await new RecommendationActionsService(
      tables(seed()).db,
    ).listByStatus(RID, "all", STAFF);
    expect(rows.find((r) => r.ruleKey === FIRING)?.undoableByYou).toBeNull();
    // Asked alone, the same card is read whole and is theirs.
    const alone = tables(seed());
    await new RecommendationActionsService(alone.db).setActionAs(
      RID,
      FIRING,
      { status: "active" },
      undefined,
      STAFF,
    );
    expect(stateWrites(alone.writes)).toHaveLength(1);
  });

  it("a bulk selection holding someone else's act is refused whole, before anything is written", async () => {
    const t = tables({
      actions: [
        actionRow(FIRING, "dismissed"),
        actionRow(FINDING, "dismissed"),
        actionRow("stockout_imminent#*#fire:day:2026-09-21", "dismissed"),
      ],
      history: [
        act(FIRING, "u-staff", "dismissed", "2026-09-20T10:00:00.000Z"),
        act(FINDING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
        act(
          "stockout_imminent#*#fire:day:2026-09-21",
          "u-manager",
          "dismissed",
          "2026-09-21T09:00:00.000Z",
        ),
      ],
    });
    const e = await refusalOf(
      new RecommendationActionsService(t.db).bulkSetActionAs(
        RID,
        [
          { ruleKey: FIRING },
          { ruleKey: FINDING },
          { ruleKey: "stockout_imminent#*#fire:day:2026-09-21" },
        ],
        { status: "active" },
        STAFF,
      ),
    );
    expect(e.code).toBe("not_your_act");
    expect(e.message).toMatch(/\(2 in this selection\)/);
    expect(t.writes).toEqual([]);
  });

  it("a bulk selection of their own acts goes through", async () => {
    const t = tables({
      actions: [actionRow(FIRING, "dismissed"), actionRow(FINDING, "done")],
      history: [
        act(FIRING, "u-staff", "dismissed", "2026-09-20T10:00:00.000Z"),
        act(FINDING, "u-staff", "done", "2026-09-20T10:00:00.000Z"),
      ],
    });
    const out = await new RecommendationActionsService(t.db).bulkSetActionAs(
      RID,
      [{ ruleKey: FIRING }, { ruleKey: FINDING }],
      { status: "active" },
      STAFF,
    );
    expect(out.updated).toBe(2);
    expect(out.history).toEqual({ recorded: 2, missed: 0 });
  });
});

describe("answer 7 at the door: the platform admin makes no house act", () => {
  it("a dismiss, done or restore is refused (403) before anything is read or written", async () => {
    for (const patch of [
      { status: "dismissed" as const, reason: "not_relevant" },
      { status: "done" as const },
      { status: "active" as const },
    ]) {
      const t = tables({ actions: [actionRow(FIRING, "dismissed")] });
      const e = await refusalOf(
        new RecommendationActionsService(t.db).setActionAs(
          RID,
          FIRING,
          patch,
          undefined,
          ADMIN,
        ),
      );
      expect(e.forbidden).toBe(true);
      expect(e.message).toBe(PLATFORM_ADMIN_REFUSAL);
      expect(t.writes).toEqual([]);
      expect(t.reads).toEqual([]);
    }
  });

  it("a rule-wide dismissal is refused too — by the admin rule, before the rule-wide gate", async () => {
    const t = tables();
    const threw = await new RecommendationActionsService(t.db)
      .setActionAs(
        RID,
        RULE,
        { status: "dismissed", reason: "disagree" },
        undefined,
        ADMIN,
      )
      .then(
        () => null,
        (e) => e,
      );
    expect(threw).toBeInstanceOf(ActRefused);
    expect(threw).not.toBeInstanceOf(RuleWideActForbidden);
    expect(threw.message).toBe(PLATFORM_ADMIN_REFUSAL);
    expect(t.writes).toEqual([]);
  });

  it("a bulk act is refused whole", async () => {
    const t = tables();
    const e = await refusalOf(
      new RecommendationActionsService(t.db).bulkSetActionAs(
        RID,
        [{ ruleKey: FIRING }, { ruleKey: FINDING }],
        { status: "done" },
        ADMIN,
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(t.writes).toEqual([]);
  });

  it("the catalogue toggle refuses them, and writes nothing", async () => {
    const t = tables();
    const svc = new RecommendationActionsService(t.db);
    const e = await refusalOf(
      svc.setTypeEnabled(
        RID,
        "overall.revenue.vs_same_weekday",
        false,
        "u-admin",
        "disagree",
        "admin",
      ),
    );
    expect(e.forbidden).toBe(true);
    expect(e.message).toBe(
      "Only an owner or manager of this house can turn a type on or off.",
    );
    // Nor staff, nor a token with no role, though RolesGuard stops them first.
    for (const role of ["staff", null]) {
      const again = await refusalOf(
        svc.setTypeEnabled(
          RID,
          "overall.revenue.vs_same_weekday",
          false,
          "u-x",
          "disagree",
          role,
        ),
      );
      expect(again.forbidden).toBe(true);
    }
    expect(t.writes).toEqual([]);
    // An owner of the house passes.
    await svc.setTypeEnabled(
      RID,
      "overall.revenue.vs_same_weekday",
      false,
      "u-owner",
      "disagree",
      "owner",
    );
    expect(stateWrites(t.writes)).toHaveLength(1);
  });
});

describe("the tabs say whether each row is yours to return (undoableByYou)", () => {
  const seed = () => ({
    actions: [
      actionRow(FIRING, "dismissed"),
      actionRow(FINDING, "dismissed"),
      actionRow("stockout_imminent#*#fire:day:2026-09-21", "done"),
      actionRow("low_stock#*#fire:week:2026-W39", "active"),
    ],
    history: [
      act(FIRING, "u-staff", "dismissed", "2026-09-20T10:00:00.000Z"),
      act(FINDING, "u-other", "dismissed", "2026-09-20T10:00:00.000Z"),
      // the done has no history row: nobody can name it
    ],
  });
  const byKey = (
    rows: Array<{ ruleKey: string; undoableByYou?: boolean | null }>,
  ) => Object.fromEntries(rows.map((r) => [r.ruleKey, r.undoableByYou]));

  it("staff: their own yes, someone else's no, an unnamed act no, a row holding nothing yes", async () => {
    const t = tables(seed());
    const rows = await new RecommendationActionsService(t.db).listByStatus(
      RID,
      "all",
      STAFF,
    );
    expect(byKey(rows)).toEqual({
      [FIRING]: true,
      [FINDING]: false,
      "stockout_imminent#*#fire:day:2026-09-21": false,
      "low_stock#*#fire:week:2026-W39": true,
    });
  });

  it("another member of staff sees the same rows the other way round", async () => {
    const t = tables(seed());
    const rows = await new RecommendationActionsService(t.db).listByStatus(
      RID,
      "all",
      OTHER_STAFF,
    );
    expect(byKey(rows)[FIRING]).toBe(false);
    expect(byKey(rows)[FINDING]).toBe(true);
  });

  it("owners and managers: every row, without reading the history", async () => {
    for (const who of [OWNER, MANAGER]) {
      const t = tables(seed());
      const rows = await new RecommendationActionsService(t.db).listByStatus(
        RID,
        "all",
        who,
      );
      expect(Object.values(byKey(rows)).every((v) => v === true)).toBe(true);
      expect(t.reads).not.toContain("recommendation_action_history");
    }
  });

  it("the platform admin: none", async () => {
    const t = tables(seed());
    const rows = await new RecommendationActionsService(t.db).listByStatus(
      RID,
      "all",
      ADMIN,
    );
    expect(Object.values(byKey(rows)).every((v) => v === false)).toBe(true);
  });

  it("an unreadable history is said as null on the rows it decides — never a guess", async () => {
    const t = tables({ ...seed(), historyReadError: "timeout" });
    const rows = await new RecommendationActionsService(t.db).listByStatus(
      RID,
      "all",
      STAFF,
    );
    expect(byKey(rows)).toEqual({
      [FIRING]: null,
      [FINDING]: null,
      "stockout_imminent#*#fire:day:2026-09-21": null,
      "low_stock#*#fire:week:2026-W39": true,
    });
  });
});

// ---------------------------------------------------------------------------
// the controller's doors, round 4
// ---------------------------------------------------------------------------

describe("the controller's doors, round 4", () => {
  const proto = AnalyticsController.prototype as unknown as Record<string, any>;
  async function thrown(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (e) {
      return e;
    }
    return null;
  }

  it("a refused undo is a 403 whose body carries not_your_act beside the sentence", async () => {
    const self = {
      recommendationActions: {
        setActionAs: async () => {
          throw new ActRefused(undoRefusal(false, 1), true, "not_your_act");
        },
      },
    };
    const e = await thrown(
      proto.setRecommendationAction.call(
        self,
        RID,
        { ruleKey: FIRING, status: "active" },
        { userId: "u-staff", role: "staff" },
      ),
    );
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      statusCode: 403,
      message:
        "Only the person who did this, or an owner or manager, can undo it.",
      code: "not_your_act",
    });
  });

  it("the bulk door says the same", async () => {
    const self = {
      recommendationActions: {
        bulkSetActionAs: async () => {
          throw new ActRefused(undoRefusal(false, 2), true, "not_your_act");
        },
      },
    };
    const e = await thrown(
      proto.bulkRecommendationAction.call(
        self,
        RID,
        {
          items: [{ ruleKey: FIRING }, { ruleKey: FINDING }],
          status: "active",
        },
        { userId: "u-staff", role: "staff" },
      ),
    );
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toMatchObject({ code: "not_your_act" });
  });

  it("the toggle hands the service the token's house role, and a refusal is a 403", async () => {
    const seen: unknown[][] = [];
    const self = {
      recommendationActions: {
        setTypeEnabled: async (...args: unknown[]) => {
          seen.push(args);
          throw new ActRefused("no", true);
        },
      },
    };
    const e = await thrown(
      proto.toggleCatalogType.call(
        self,
        RID,
        "overall.revenue.vs_same_weekday",
        { enabled: false, reason: "disagree" },
        { userId: "u-admin", role: "admin" },
      ),
    );
    expect(seen[0][5]).toBe("admin");
    expect(e.getStatus()).toBe(403);
  });

  it("the tabs are listed for the token's user", async () => {
    const seen: unknown[][] = [];
    const self = {
      recommendationActions: {
        listByStatus: async (...args: unknown[]) => {
          seen.push(args);
          return [];
        },
      },
    };
    await proto.listRecommendationActions.call(self, RID, "dismissed", {
      userId: "u-staff",
      role: "staff",
    });
    expect(seen[0]).toEqual([
      RID,
      "dismissed",
      { userId: "u-staff", role: "staff", leadsAreas: [] },
    ]);
  });
});
