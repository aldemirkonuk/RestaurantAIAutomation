import {
  ActRefused,
  RecommendationActionRow,
  RecommendationActionsService,
} from "./recommendation-actions.service";
import { RecommendationsService, firingPeriodOf } from "./recommendations.service";
import { AnalyticsController } from "./analytics.controller";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import {
  buildSuppressionKey,
  dateOfGrain,
  firingGrain,
  isFiringGrain,
  isoWeekOf,
  withFiring,
} from "./insights/suppression";
import {
  DISMISS_REASONS,
  NOT_NOW_DEFAULT_MS,
  historyActOf,
  insightRowTarget,
  isRuleWideKey,
  maySnoozeForEveryone,
  personalBookFrom,
  personalView,
  planAct,
  resolveItemState,
  stateBookFrom,
} from "./insights/item-state";

/**
 * ADR 0191 round 3 — the founder's six answers of 2026-09-21, each pinned:
 *
 *   1. a subject-less rule's card: "Each firing is one card" — keyed by the
 *      rule plus its own firing period, so dismiss/done hides this firing;
 *   2. "Keep every label" — an append-only history of every dismiss,
 *      restore, done and snooze, with its label, who and when;
 *   3. "Already handled" is recorded as DONE, not as a dismissal;
 *   4. a staff snooze is "Only them" — personal, not in the house history;
 *      "Not now" becomes that snooze; snooze for everyone is owners and
 *      managers (area leads: a typed hook only);
 *   5. the legacy page's message (web, `Recommendations.test.tsx`);
 *   6. "Restore all" is the per-card Restore as built (nothing to build).
 */

const RID = "r-1";
const NOW = Date.parse("2026-09-21T12:00:00.000Z"); // a Monday, ISO 2026-W39
const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();
const RULE = "vendor_concentration";
const FIRING = `${RULE}#*#fire:month:2026-09`;
const FINDING = "insight:overall.revenue.vs_same_weekday#wednesday#d:2026-09-16";

const STAFF = { userId: "u-staff", role: "staff", leadsAreas: [] };
const MANAGER = { userId: "u-manager", role: "manager", leadsAreas: [] };

// ---------------------------------------------------------------------------
// 1 — each firing is one card
// ---------------------------------------------------------------------------

describe("answer 1: each firing is one card", () => {
  it("names the firing by the rule's own period, in UTC", () => {
    const at = new Date(NOW);
    expect(firingGrain("day", at)).toBe("fire:day:2026-09-21");
    expect(firingGrain("week", at)).toBe("fire:week:2026-W39");
    expect(firingGrain("month", at)).toBe("fire:month:2026-09");
  });

  it("uses ISO weeks — Monday first, the year's first Thursday in week 1", () => {
    const w = (iso: string) => isoWeekOf(new Date(iso));
    expect(w("2026-09-27T23:59:00Z")).toEqual({ year: 2026, week: 39 }); // Sunday
    expect(w("2026-09-28T00:00:00Z")).toEqual({ year: 2026, week: 40 }); // Monday
    expect(w("2025-12-29T00:00:00Z")).toEqual({ year: 2026, week: 1 });
    expect(w("2027-01-01T00:00:00Z")).toEqual({ year: 2026, week: 53 });
    expect(firingGrain("week", new Date("2027-01-01T00:00:00Z"))).toBe(
      "fire:week:2026-W53",
    );
  });

  it("a firing is never a day the analysis could be told to exclude", () => {
    expect(isFiringGrain("fire:day:2026-09-21")).toBe(true);
    expect(dateOfGrain("fire:day:2026-09-21")).toBeNull();
    expect(isFiringGrain("d:2026-09-21")).toBe(false);
  });

  it("keys only a card that names no subject and no period", () => {
    const at = new Date(NOW);
    expect(withFiring({ ruleId: RULE }, "month", at)).toEqual({
      ruleId: RULE,
      periodKey: "fire:month:2026-09",
    });
    const named = { ruleId: RULE, subject: "Wednesday", periodKey: null };
    expect(withFiring(named, "week", at)).toBe(named);
    const dated = { ruleId: RULE, subject: null, periodKey: "d:2026-09-16" };
    expect(withFiring(dated, "week", at)).toBe(dated);
  });

  it("the firing's key is one card, not the whole rule — staff may dismiss it", () => {
    const key = buildSuppressionKey(
      withFiring({ ruleId: RULE }, "month", new Date(NOW)),
      "insight",
    );
    expect(key).toBe(FIRING);
    expect(isRuleWideKey(key)).toBe(false);
  });

  it("dismissed this month, it is back when the rule fires next month", () => {
    const book = stateBookFrom(
      [{ ruleKey: FIRING, status: "dismissed", reason: "disagree", snoozeUntil: null }],
      NOW,
    );
    const september = withFiring({ ruleId: RULE }, "month", new Date(NOW));
    const october = withFiring(
      { ruleId: RULE },
      "month",
      new Date("2026-10-02T09:00:00Z"),
    );
    expect(resolveItemState(september, book).state).toBe("dismissed");
    expect(resolveItemState(october, book).state).toBe("active");
  });

  it("the rule's own period is the horizon it declares", () => {
    expect(firingPeriodOf("now")).toBe("day");
    expect(firingPeriodOf("this_week")).toBe("week");
    expect(firingPeriodOf("this_month")).toBe("month");
  });
});

describe("the generator keys a subject-less, period-less type by its firing week", () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(NOW);
  });
  afterAll(() => jest.useRealTimers());

  const gen = () =>
    new InsightGeneratorService({} as any, {} as any, {} as any) as unknown as {
      record: (...a: unknown[]) => any;
    };
  const trend = {
    measureLabel: "sales",
    unit: "currency",
    trendPctPerWeek: 0.12,
    n: 28,
  };

  it("a type naming nothing is this week's item — a one-item key, not the type", () => {
    const rec = gen().record("overall.revenue.trend_direction", "sales", "trend", trend, {
      effectPct: 0.12,
      n: 28,
    });
    expect(rec.periodKey).toBe("fire:week:2026-W39");
    expect(rec.suppression.key).toBe(
      "insight:overall.revenue.trend_direction#*#fire:week:2026-W39",
    );
    expect(rec.suppression.scope).toBe("insight");
    expect(rec.suppression.keys.rule).toBe("insight:overall.revenue.trend_direction");
  });

  it("a type with its own period keeps it", () => {
    const rec = gen().record("overall.revenue.trend_direction", "sales", "trend", trend, {
      effectPct: 0.12,
      n: 28,
      periodKey: "t28:2026-09-20",
    });
    expect(rec.periodKey).toBe("t28:2026-09-20");
  });
});

// ---------------------------------------------------------------------------
// 3 + 4 — routing, pure
// ---------------------------------------------------------------------------

describe("answers 3 and 4: where one write goes", () => {
  it("'Already handled' is recorded as done, with no label", () => {
    expect(
      planAct({ status: "dismissed", reason: "already_handled" }, STAFF, [], NOW),
    ).toEqual({
      to: "house",
      status: "done",
      reason: null,
      snoozeUntil: null,
      recordedAs: "done",
    });
  });

  it("'Not now' is the person's own snooze — a day when no instant is sent", () => {
    for (const actor of [STAFF, MANAGER])
      expect(
        planAct({ status: "dismissed", reason: "not_now" }, actor, [], NOW),
      ).toEqual({
        to: "personal",
        snoozeUntil: new Date(NOW + NOT_NOW_DEFAULT_MS).toISOString(),
        recordedAs: "snoozed_for_you",
      });
    const at = "2026-09-28T12:00:00.000Z";
    expect(
      planAct(
        { status: "dismissed", reason: "not_now", snoozeUntil: at },
        STAFF,
        [],
        NOW,
      ),
    ).toMatchObject({ to: "personal", snoozeUntil: at });
  });

  it("a staff snooze is theirs alone; an owner's or manager's is the house's", () => {
    const snooze = { status: "snoozed", snoozeUntil: "2026-09-28T12:00:00.000Z" };
    expect(planAct(snooze, STAFF, [], NOW).to).toBe("personal");
    expect(planAct(snooze, MANAGER, [], NOW)).toMatchObject({
      to: "house",
      status: "snoozed",
      recordedAs: "snoozed_for_everyone",
    });
    expect(
      planAct({ ...snooze, snoozeFor: "me" }, MANAGER, [], NOW).to,
    ).toBe("personal");
  });

  it("staff asking to snooze for everyone is refused, not quietly narrowed", () => {
    expect(
      planAct(
        { status: "snoozed", snoozeUntil: LATER, snoozeFor: "house" },
        STAFF,
        [],
        NOW,
      ),
    ).toMatchObject({ to: "refused", forbidden: true });
  });

  it("a malformed audience or a snooze for me with no future instant is a 400", () => {
    expect(
      planAct({ status: "snoozed", snoozeUntil: LATER, snoozeFor: "all" }, STAFF, [], NOW),
    ).toMatchObject({ to: "refused", forbidden: false });
    expect(
      planAct({ status: "snoozed", snoozeUntil: "2020-01-01T00:00:00Z" }, STAFF, [], NOW),
    ).toMatchObject({ to: "refused", forbidden: false });
  });

  it("a real dismissal, a restore and a pin go to the house unchanged", () => {
    expect(
      planAct({ status: "dismissed", reason: "disagree" }, STAFF, [], NOW),
    ).toMatchObject({ to: "house", status: "dismissed", reason: "disagree" });
    expect(planAct({ status: "active" }, STAFF, [], NOW)).toMatchObject({
      to: "house",
      recordedAs: "restored",
    });
    expect(planAct({}, STAFF, [], NOW)).toMatchObject({
      to: "house",
      status: undefined,
      recordedAs: "note",
    });
  });

  it("the dismissal labels are the two that mean 'not for this house'", () => {
    expect([...DISMISS_REASONS]).toEqual(["not_relevant", "disagree"]);
  });

  it("snooze for everyone: owners and managers; area leads only through the typed hook", () => {
    expect(maySnoozeForEveryone("owner")).toBe(true);
    expect(maySnoozeForEveryone("manager")).toBe(true);
    // Round 4, answer 7: the platform admin is not an owner or manager.
    expect(maySnoozeForEveryone("admin")).toBe(false);
    expect(maySnoozeForEveryone("staff")).toBe(false);
    expect(maySnoozeForEveryone(null)).toBe(false);
    // The hook the areas lane will fill: a lead, for a card in their area.
    expect(maySnoozeForEveryone("staff", ["bar"], ["bar"])).toBe(true);
    expect(maySnoozeForEveryone("staff", ["bar"], ["kitchen"])).toBe(false);
    expect(maySnoozeForEveryone("staff", ["bar"], [])).toBe(false);
    expect(
      planAct(
        { status: "snoozed", snoozeUntil: LATER },
        { role: "staff", leadsAreas: ["bar"] },
        ["bar"],
        NOW,
      ).to,
    ).toBe("house");
  });

  it("the history's four acts are the founder's four words", () => {
    expect(historyActOf("dismissed")).toBe("dismiss");
    expect(historyActOf("active")).toBe("restore");
    expect(historyActOf("done")).toBe("done");
    expect(historyActOf("snoozed")).toBe("snooze");
    expect(historyActOf("pinned")).toBeNull();
  });
});

describe("answer 4: the personal view hides a card from its one person", () => {
  const items = [
    { candidateKey: "overall.revenue.vs_same_weekday", subject: "Wednesday", periodKey: "d:2026-09-16" },
    { candidate_key: "vendor.purchase_spend.concentration", subject: null, period_key: "fire:week:2026-W39" },
  ];

  it("drops what the person snoozed, counts it, and keeps the rest", () => {
    const book = personalBookFrom(
      [{ ruleKey: FINDING, snoozeUntil: "2026-09-22T12:00:00Z" }],
      NOW,
    );
    const view = personalView(items, insightRowTarget, book);
    expect(view.hiddenForYou).toBe(1);
    expect(view.kept).toEqual([items[1]]);
  });

  it("an ended snooze hides nothing", () => {
    const book = personalBookFrom(
      [{ ruleKey: FINDING, snoozeUntil: "2026-09-20T12:00:00Z" }],
      NOW,
    );
    expect(personalView(items, insightRowTarget, book).hiddenForYou).toBe(0);
  });

  it("reads a live row and a stored row as the same item", () => {
    expect(
      insightRowTarget({
        candidateKey: "a.b.c",
        subject: "X",
        periodKey: "d:2026-09-16",
      }),
    ).toEqual(
      insightRowTarget({
        candidate_key: "a.b.c",
        subject: "X",
        period_key: "d:2026-09-16",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 2, 3, 4 — the write path, over a database stub (the unit is the service)
// ---------------------------------------------------------------------------

type Call = { table: string; op: string; payload: any };

function db(
  opts: {
    current?: Record<string, string>;
    historyError?: string;
    personal?: Array<{ rule_key: string; snooze_until: string }>;
    personalReadError?: string;
    /** Rows a read of the history answers (round 4: who made the act). */
    history?: Array<{ rule_key: string; actor_id: string | null; status_to: string }>;
  } = {},
) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const b: any = {};
      let op = "read";
      let payload: any = null;
      for (const m of ["eq", "in", "gt", "lte", "order", "limit"]) b[m] = () => b;
      b.select = () => b;
      b.delete = () => {
        op = "delete";
        calls.push({ table, op, payload: null });
        return b;
      };
      b.upsert = (p: any) => {
        op = "upsert";
        payload = p;
        calls.push({ table, op, payload: p });
        return b;
      };
      b.single = async () => ({
        data: { ...payload, updated_at: "2026-09-21T12:00:00.000Z" },
        error: null,
      });
      // Round 5: no fixture here carries a note-author column, so every key
      // reads as unowned (NO_NOTES) — correct for every round-3 case, none
      // of which exercises a note someone else already made.
      b.maybeSingle = async () => ({ data: null, error: null });
      b.insert = async (p: any) => {
        calls.push({ table, op: "insert", payload: p });
        return {
          error:
            table === "recommendation_action_history" && opts.historyError
              ? { message: opts.historyError }
              : null,
        };
      };
      b.then = (resolve: any, reject: any) => {
        if (table === "recommendation_personal_snoozes" && op === "delete")
          return Promise.resolve({
            data: [{ rule_key: FINDING }],
            error: null,
          }).then(resolve, reject);
        if (table === "recommendation_personal_snoozes")
          return Promise.resolve(
            opts.personalReadError
              ? { data: null, error: { message: opts.personalReadError } }
              : { data: opts.personal ?? [], error: null },
          ).then(resolve, reject);
        if (table === "recommendation_action_history")
          return Promise.resolve({ data: opts.history ?? [], error: null }).then(
            resolve,
            reject,
          );
        return Promise.resolve({
          data: Object.entries(opts.current ?? {}).map(([rule_key, status]) => ({
            rule_key,
            status,
          })),
          error: null,
        }).then(resolve, reject);
      };
      return b;
    },
  };
  return { db: { getClient: () => client } as any, calls };
}

const house = (calls: Call[]) =>
  calls.filter((c) => c.table === "recommendation_actions" && c.op === "upsert");
const kept = (calls: Call[]) =>
  calls.filter((c) => c.table === "recommendation_action_history");
const mine = (calls: Call[]) =>
  calls.filter(
    (c) => c.table === "recommendation_personal_snoozes" && c.op === "upsert",
  );

describe("answer 3 at the door: 'Already handled' is done", () => {
  it("writes done with no label, keeps it in the history as done, and says so", async () => {
    const { db: d, calls } = db();
    const out = await new RecommendationActionsService(d).setActionAs(
      RID,
      FIRING,
      { status: "dismissed", reason: "already_handled" },
      undefined,
      STAFF,
    );
    expect(house(calls)[0].payload).toMatchObject({
      rule_key: FIRING,
      status: "done",
      reason: null,
    });
    expect(kept(calls)[0].payload).toMatchObject({
      act: "done",
      status_to: "done",
      reason: null,
      actor_id: "u-staff",
    });
    expect(out.recordedAs).toBe("done");
  });
});

describe("answer 4 at the door: a staff snooze is 'Only them'", () => {
  it("'Not now' writes the person's own snooze — nothing to the house or its history", async () => {
    for (const actor of [STAFF, MANAGER]) {
      const { db: d, calls } = db();
      const out = await new RecommendationActionsService(d).setActionAs(
        RID,
        FIRING,
        { status: "dismissed", reason: "not_now" },
        { observation: "Purchasing is highly concentrated." },
        actor,
      );
      expect(house(calls)).toEqual([]);
      expect(kept(calls)).toEqual([]);
      expect(mine(calls)[0].payload).toMatchObject({
        restaurant_id: RID,
        user_id: actor.userId,
        rule_key: FIRING,
        observation: "Purchasing is highly concentrated.",
      });
      expect(mine(calls)[0].payload).not.toHaveProperty("reason");
      expect(out).toMatchObject({ row: null, recordedAs: "snoozed_for_you" });
    }
  });

  it("a staff snooze is personal; a manager's is the house's and is kept in the history", async () => {
    const staff = db();
    await new RecommendationActionsService(staff.db).setActionAs(
      RID,
      FIRING,
      { status: "snoozed", snoozeUntil: LATER },
      undefined,
      STAFF,
    );
    expect(house(staff.calls)).toEqual([]);
    expect(mine(staff.calls)).toHaveLength(1);

    const mgr = db();
    await new RecommendationActionsService(mgr.db).setActionAs(
      RID,
      FIRING,
      { status: "snoozed", snoozeUntil: LATER },
      undefined,
      MANAGER,
    );
    expect(house(mgr.calls)[0].payload).toMatchObject({ status: "snoozed" });
    expect(kept(mgr.calls)[0].payload).toMatchObject({
      act: "snooze",
      snooze_until: LATER,
      actor_id: "u-manager",
    });
    expect(mine(mgr.calls)).toEqual([]);
  });

  it("staff asking to snooze for everyone get a 403-shaped refusal, and nothing is written", async () => {
    const { db: d, calls } = db();
    await expect(
      new RecommendationActionsService(d).setActionAs(
        RID,
        FIRING,
        { status: "snoozed", snoozeUntil: LATER, snoozeFor: "house" },
        undefined,
        STAFF,
      ),
    ).rejects.toMatchObject({ forbidden: true });
    expect(calls.filter((c) => c.op !== "read")).toEqual([]);
  });

  it("a bulk staff snooze is theirs alone, item by item", async () => {
    const { db: d, calls } = db();
    const out = await new RecommendationActionsService(d).bulkSetActionAs(
      RID,
      [{ ruleKey: FIRING }, { ruleKey: FINDING }],
      { status: "snoozed", snoozeUntil: LATER },
      STAFF,
    );
    expect(out).toEqual({
      updated: 2,
      audit: { recorded: 0, missed: 0 },
      history: { recorded: 0, missed: 0 },
      noteAudit: { recorded: 0, missed: 0 },
      snoozedForYou: 2,
    });
    expect(house(calls)).toEqual([]);
    expect(mine(calls).map((c) => c.payload.rule_key)).toEqual([FIRING, FINDING]);
  });

  it("a bulk snooze for everyone by staff is refused whole", async () => {
    const { db: d, calls } = db();
    await expect(
      new RecommendationActionsService(d).bulkSetActionAs(
        RID,
        [{ ruleKey: FIRING }],
        { status: "snoozed", snoozeUntil: LATER, snoozeFor: "house" },
        STAFF,
      ),
    ).rejects.toBeInstanceOf(ActRefused);
    expect(calls.filter((c) => c.op !== "read")).toEqual([]);
  });

  it("waking a card deletes the person's own snooze and says whether there was one", async () => {
    const { db: d, calls } = db();
    const out = await new RecommendationActionsService(d).wakeForMe(
      RID,
      "u-staff",
      FINDING,
    );
    expect(out).toEqual({ woke: true });
    expect(
      calls.filter((c) => c.table === "recommendation_personal_snoozes" && c.op === "delete"),
    ).toHaveLength(1);
  });

  it("a person's snoozes that cannot be read are said, never shown as none", async () => {
    const { db: d } = db({ personalReadError: "timeout" });
    const svc = new RecommendationActionsService(d);
    await expect(svc.listForMe(RID, "u-staff")).rejects.toThrow(/timeout/);
    const view = await svc.viewFor(RID, "u-staff", [1, 2], () => ({ ruleId: "x" }));
    expect(view).toEqual({ kept: [1, 2], hiddenForYou: 0, personalSnoozesReadable: false });
  });

  it("the personal view hides what this person snoozed, and only for them", async () => {
    const { db: d } = db({
      personal: [{ rule_key: FIRING, snooze_until: LATER }],
    });
    const view = await new RecommendationActionsService(d).viewFor(
      RID,
      "u-staff",
      [
        { ruleId: RULE, periodKey: "fire:month:2026-09" },
        { ruleId: "stockout_imminent", periodKey: "fire:day:2026-09-21" },
      ],
      (x) => x,
    );
    expect(view.hiddenForYou).toBe(1);
    expect(view.kept).toHaveLength(1);
    expect(view.personalSnoozesReadable).toBe(true);
  });
});

/**
 * "Only them", proven against rows that belong to more than one person. The
 * stub above ignores every filter, so it cannot tell a read of MY snoozes
 * from a read of the whole house's — and a read of the whole house's is a
 * staff member hiding a card from everyone. This table applies `eq`, `gt`
 * and `lte` the way PostgREST does, so a dropped `user_id` or
 * `restaurant_id` filter shows up as someone else's card going missing.
 */
function personalTable(
  rows: Array<{
    restaurant_id: string;
    user_id: string;
    rule_key: string;
    snooze_until: string;
  }>,
) {
  const table = rows.map((r) => ({ ...r }));
  const client = {
    from: (name: string) => {
      if (name !== "recommendation_personal_snoozes")
        throw new Error(`unexpected table ${name}`);
      const filters: Array<(r: Record<string, string>) => boolean> = [];
      let op: "read" | "delete" = "read";
      const b: any = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (col: string, v: string) => {
        filters.push((r) => r[col] === v);
        return b;
      };
      b.gt = (col: string, v: string) => {
        filters.push((r) => Date.parse(r[col]) > Date.parse(v));
        return b;
      };
      b.lte = (col: string, v: string) => {
        filters.push((r) => Date.parse(r[col]) <= Date.parse(v));
        return b;
      };
      b.delete = () => {
        op = "delete";
        return b;
      };
      b.then = (resolve: any, reject: any) => {
        const hit = table.filter((r) => filters.every((f) => f(r)));
        if (op === "delete")
          for (const h of hit) table.splice(table.indexOf(h), 1);
        return Promise.resolve({ data: hit, error: null }).then(resolve, reject);
      };
      return b;
    },
  };
  return { db: { getClient: () => client } as any, table };
}

describe("answer 4: a snooze for me is read, applied and woken for me alone", () => {
  const A = "u-staff-a";
  const B = "u-staff-b";
  const OTHER_HOUSE = "r-2";
  const cardA = { ruleId: RULE, periodKey: "fire:month:2026-09" };
  const cardB = { ruleId: "stockout_imminent", periodKey: "fire:day:2026-09-21" };
  const rows = () => [
    { restaurant_id: RID, user_id: A, rule_key: FIRING, snooze_until: LATER },
    {
      restaurant_id: RID,
      user_id: B,
      rule_key: "stockout_imminent#*#fire:day:2026-09-21",
      snooze_until: LATER,
    },
    // A's own snooze in ANOTHER house: never read in this one.
    {
      restaurant_id: OTHER_HOUSE,
      user_id: A,
      rule_key: "stockout_imminent#*#fire:day:2026-09-21",
      snooze_until: LATER,
    },
  ];

  it("lists only this person's snoozes, in this house", async () => {
    const { db: d } = personalTable(rows());
    const mineA = await new RecommendationActionsService(d).listForMe(RID, A);
    expect(mineA.map((r) => r.ruleKey)).toEqual([FIRING]);
  });

  it("hides a card from the person who snoozed it and from nobody else", async () => {
    const { db: d } = personalTable(rows());
    const svc = new RecommendationActionsService(d);
    const forA = await svc.viewFor(RID, A, [cardA, cardB], (x) => x);
    const forB = await svc.viewFor(RID, B, [cardA, cardB], (x) => x);
    const forManager = await svc.viewFor(RID, "u-manager", [cardA, cardB], (x) => x);
    expect(forA.kept).toEqual([cardB]);
    expect(forB.kept).toEqual([cardA]);
    expect(forManager.kept).toEqual([cardA, cardB]);
    expect(forManager.hiddenForYou).toBe(0);
  });

  it("waking ends this person's snooze and leaves everyone else's standing", async () => {
    const { db: d, table } = personalTable([
      ...rows(),
      { restaurant_id: RID, user_id: B, rule_key: FIRING, snooze_until: LATER },
    ]);
    const out = await new RecommendationActionsService(d).wakeForMe(RID, A, FIRING);
    expect(out).toEqual({ woke: true });
    expect(
      table.filter((r) => r.rule_key === FIRING).map((r) => r.user_id),
    ).toEqual([B]);
    expect(table).toHaveLength(3);
  });
});

describe("answer 2: every house act is kept — who, when, what it lifted, its label", () => {
  it("a staff one-card dismiss is kept with its label and their name", async () => {
    const { db: d, calls } = db({ current: { [FIRING]: "active" } });
    const out = await new RecommendationActionsService(d).setActionAs(
      RID,
      FIRING,
      { status: "dismissed", reason: "not_relevant" },
      undefined,
      STAFF,
    );
    expect(kept(calls)[0].payload).toEqual({
      restaurant_id: RID,
      rule_key: FIRING,
      act: "dismiss",
      status_from: "active",
      status_to: "dismissed",
      reason: "not_relevant",
      snooze_until: null,
      rule_wide: false,
      actor_id: "u-staff",
    });
    expect(out.history).toEqual({ recorded: true, reason: null });
    expect(out.audit).toBeNull();
  });

  it("the undo is its own row: a restore names the dismissal it lifted — nothing is overwritten", async () => {
    // Their own dismissal, as the history names it: round 4, answer 5 —
    // staff undo only their own acts.
    const { db: d, calls } = db({
      current: { [FIRING]: "dismissed" },
      history: [{ rule_key: FIRING, actor_id: "u-staff", status_to: "dismissed" }],
    });
    await new RecommendationActionsService(d).setActionAs(
      RID,
      FIRING,
      { status: "active" },
      undefined,
      STAFF,
    );
    expect(kept(calls)[0].payload).toMatchObject({
      act: "restore",
      status_from: "dismissed",
      status_to: "active",
      reason: null,
    });
  });

  it("a whole-rule dismissal by a manager is kept AND filed in the house log", async () => {
    const { db: d, calls } = db();
    await new RecommendationActionsService(d).setActionAs(
      RID,
      RULE,
      { status: "dismissed", reason: "disagree" },
      undefined,
      MANAGER,
    );
    expect(kept(calls)[0].payload).toMatchObject({
      act: "dismiss",
      rule_wide: true,
      actor_id: "u-manager",
    });
    expect(calls.filter((c) => c.table === "system_audit_log")).toHaveLength(1);
  });

  it("a lost history row comes back in the receipt; the state still changed", async () => {
    const { db: d, calls } = db({ historyError: "permission denied" });
    const out = await new RecommendationActionsService(d).setActionAs(
      RID,
      FIRING,
      { status: "done" },
      undefined,
      STAFF,
    );
    expect(house(calls)).toHaveLength(1);
    expect(out.history).toEqual({ recorded: false, reason: "permission denied" });
  });

  it("a pin, a rating or an assignment is a note, not an act — nothing kept", async () => {
    const { db: d, calls } = db();
    const out = await new RecommendationActionsService(d).setActionAs(
      RID,
      FIRING,
      { pinned: true },
      undefined,
      STAFF,
    );
    expect(kept(calls)).toEqual([]);
    expect(out.history).toBeNull();
  });

  it("a bulk dismissal keeps one row per item", async () => {
    const { db: d, calls } = db();
    const out = await new RecommendationActionsService(d).bulkSetActionAs(
      RID,
      [{ ruleKey: FIRING }, { ruleKey: FINDING }],
      { status: "dismissed", reason: "already_handled" },
      STAFF,
    );
    expect(out.history).toEqual({ recorded: 2, missed: 0 });
    expect(kept(calls).map((c) => c.payload.act)).toEqual(["done", "done"]);
  });
});

// ---------------------------------------------------------------------------
// the feed: firing keys, and the viewer's own snoozes
// ---------------------------------------------------------------------------

function feed(opts: {
  dismissed?: string[];
  personal?: string[];
  personalReadable?: boolean;
}) {
  const map = new Map<string, RecommendationActionRow>();
  for (const key of opts.dismissed ?? [])
    map.set(key, {
      ruleKey: key,
      ruleWide: false,
      status: "dismissed",
      reason: "disagree",
      snoozeUntil: null,
      pinned: false,
      actedAt: null,
      feedback: null,
      assignedTo: null,
      assignedName: null,
      assignedAt: null,
      observation: null,
      recommendation: null,
      category: null,
      urgency: null,
      updatedAt: "2026-09-21T10:00:00.000Z",
    });
  const viewers: Array<string | null> = [];
  const supabase = {
    from: () => {
      const b: any = {};
      for (const m of ["select", "order", "limit", "insert", "eq"]) b[m] = () => b;
      b.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return b;
    },
  };
  const actions = {
    readDispositions: async () => ({ map, readable: true, problem: null }),
    viewFor: async (_rid: string, viewer: string | null, items: any[], targetOf: any) => {
      viewers.push(viewer);
      const book = personalBookFrom(
        (opts.personal ?? []).map((k) => ({ ruleKey: k, snoozeUntil: LATER })),
      );
      return {
        ...personalView(items, targetOf, book),
        personalSnoozesReadable: opts.personalReadable ?? true,
      };
    },
  };
  const svc = new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: async () => ({
        vendorConcentration: { hhi: 0.5, effectiveVendors: 2 },
      }),
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    { generate: async () => ({ insights: [] }) } as any,
    { listGoals: async () => [] } as any,
    actions as any,
    { supabase, getClient: () => supabase } as any,
  );
  return { svc, viewers };
}

describe("the feed keys a subject-less rule by its firing", () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(NOW);
  });
  afterAll(() => jest.useRealTimers());

  it("vendor_concentration (this_month) is this month's card — a one-card key", async () => {
    const { svc } = feed({});
    const out = await svc.getRecommendations(RID);
    const card = out.recommendations.find((r) => r.ruleKey === RULE)!;
    expect(card.periodKey).toBe("fire:month:2026-09");
    expect(card.suppression).toMatchObject({
      key: FIRING,
      scope: "insight",
      keys: { rule: RULE },
    });
  });

  it("dismissing this firing hides it now and never touches the whole rule", async () => {
    const { svc } = feed({ dismissed: [FIRING] });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(RULE);
    expect(out.suppressed).toBe(1);
  });

  it("a dismissal of last month's firing does not hide this month's", async () => {
    const { svc } = feed({ dismissed: [`${RULE}#*#fire:month:2026-08`] });
    const out = await svc.getRecommendations(RID);
    expect(out.recommendations.map((r) => r.ruleKey)).toContain(RULE);
  });

  it("the viewer's own snooze hides the card from them, counted, and the digest (no viewer) still sees it", async () => {
    const mineFeed = feed({ personal: [FIRING] });
    const out = await mineFeed.svc.getRecommendations(RID, { viewerId: "u-staff" });
    expect(out.recommendations.map((r) => r.ruleKey)).not.toContain(RULE);
    expect(out.hiddenForYou).toBe(1);
    expect(out.personalSnoozesReadable).toBe(true);
    expect(mineFeed.viewers).toEqual(["u-staff"]);
    // A personal snooze is not the house's: it is not in the state counts.
    expect(out.stateCounts.snoozed).toBe(0);

    const digest = feed({ personal: [FIRING] });
    const house = await digest.svc.getRecommendations(RID);
    expect(house.recommendations.map((r) => r.ruleKey)).toContain(RULE);
    expect(house.hiddenForYou).toBe(0);
    expect(digest.viewers).toEqual([]);
  });

  it("an unreadable personal book is said", async () => {
    const { svc } = feed({ personalReadable: false });
    const out = await svc.getRecommendations(RID, { viewerId: "u-staff" });
    expect(out.personalSnoozesReadable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the controller's doors
// ---------------------------------------------------------------------------

describe("the controller's doors, round 3", () => {
  const proto = AnalyticsController.prototype as unknown as Record<string, any>;
  async function statusOf(p: Promise<unknown>): Promise<number | null> {
    try {
      await p;
      return null;
    } catch (e: any) {
      return typeof e?.getStatus === "function" ? e.getStatus() : -1;
    }
  }

  it("a forbidden routed act is a 403, a malformed one a 400", async () => {
    for (const [forbidden, code] of [
      [true, 403],
      [false, 400],
    ] as const) {
      const self = {
        recommendationActions: {
          setActionAs: async () => {
            throw new ActRefused("no", forbidden);
          },
        },
      };
      expect(
        await statusOf(
          proto.setRecommendationAction.call(
            self,
            RID,
            { ruleKey: FIRING, status: "snoozed", snoozeFor: "house" },
            { userId: "u-staff", role: "staff" },
          ),
        ),
      ).toBe(code);
    }
  });

  it("passes snoozeFor through, and says what the write became", async () => {
    const seen: any[] = [];
    const self = {
      recommendationActions: {
        setActionAs: async (...args: any[]) => {
          seen.push(args);
          return {
            row: null,
            audit: null,
            history: null,
            recordedAs: "snoozed_for_you",
            personal: { ruleKey: FIRING },
          };
        },
      },
    };
    const out = await proto.setRecommendationAction.call(
      self,
      RID,
      { ruleKey: FIRING, status: "snoozed", snoozeUntil: LATER, snoozeFor: "me" },
      { userId: "u-staff", role: "staff" },
    );
    expect(seen[0][2]).toMatchObject({ snoozeFor: "me" });
    expect(out).toMatchObject({
      ruleKey: FIRING,
      recordedAs: "snoozed_for_you",
      personal: { ruleKey: FIRING },
    });
  });

  it("the insights route applies the caller's own snoozes, from the token", async () => {
    const self = Object.create(AnalyticsController.prototype);
    self.insightGenerator = {
      readStored: async () => ({
        rows: [
          { candidate_key: "overall.revenue.vs_same_weekday", subject: "Wednesday", period_key: "d:2026-09-16" },
          { candidate_key: "vendor.purchase_spend.concentration", subject: null, period_key: "fire:week:2026-W39" },
        ],
        read: 2,
        withheld: { dismissed: 0, snoozed: 0, done: 0 },
        suppressionsReadable: true,
      }),
    };
    const asked: Array<string | null> = [];
    self.recommendationActions = {
      viewFor: async (_r: string, viewer: string | null, items: any[], targetOf: any) => {
        asked.push(viewer);
        const book = personalBookFrom([{ ruleKey: FINDING, snoozeUntil: LATER }]);
        return { ...personalView(items, targetOf, book), personalSnoozesReadable: true };
      },
    };
    const out = await self.getInsights(RID, undefined, undefined, undefined, undefined, {
      userId: "u-staff",
    });
    expect(asked).toEqual(["u-staff"]);
    expect(out.insights).toHaveLength(1);
    expect(out.hiddenForYou).toBe(1);
    expect(out.personalSnoozesReadable).toBe(true);
    expect(out.source).toBe("stored");
  });

  it("the feed route hands the token's user to the service as the viewer", async () => {
    const seen: any[] = [];
    const self = {
      recommendationsService: {
        getRecommendations: async (...args: any[]) => {
          seen.push(args);
          return {};
        },
      },
    };
    await proto.getRecommendations.call(self, RID, undefined, { userId: "u-staff" });
    expect(seen[0][1]).toMatchObject({ viewerId: "u-staff" });
  });
});
