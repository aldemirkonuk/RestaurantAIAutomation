import {
  RecommendationActionsService,
  RuleWideActForbidden,
  actorOf,
} from "./recommendation-actions.service";
import { AnalyticsController } from "./analytics.controller";

/**
 * The founder's two answers of 2026-09-21 (ADR 0191), at the one write path
 * every door uses — the feed, the Dismissed leaf, the bulk bar, the rails,
 * Reports and the catalogue's live items all post to
 * `POST /analytics/recommendations/:id/action` or its bulk twin.
 *
 *   1. "rule-wide dismiss and restore … are owner/manager only and audited
 *      EVERYWHERE; staff keep dismissing a single finding or subject".
 *   2. One shared per-item state: a dismissal carries a labelled reason, a
 *      snooze an instant it returns at, and done no negative signal.
 */

const RID = "r-1";
const RULE = "insight:overall.revenue.vs_same_weekday";
const FINDING = `${RULE}#wednesday#d:2026-09-16`;
const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();

const STAFF = { userId: "u-staff", role: "staff" };
const MANAGER = { userId: "u-manager", role: "manager" };

function gateDb(
  opts: {
    current?: Record<string, string>;
    readError?: string;
    auditError?: string;
  } = {},
) {
  const calls: Array<{ table: string; op: string; payload: any }> = [];
  const client = {
    from: (table: string) => {
      const b: any = {};
      let reading = false;
      b.select = () => {
        reading = true;
        return b;
      };
      b.eq = () => b;
      b.in = (_col: string, keys: string[]) => {
        calls.push({ table, op: "read", payload: keys });
        return b;
      };
      b.then = (resolve: any, reject: any) =>
        Promise.resolve(
          opts.readError
            ? { data: null, error: { message: opts.readError } }
            : {
                data: Object.entries(opts.current ?? {}).map(
                  ([rule_key, status]) => ({ rule_key, status }),
                ),
                error: null,
              },
        ).then(resolve, reject);
      b.upsert = (payload: any) => {
        calls.push({ table, op: "upsert", payload });
        reading = false;
        return b;
      };
      b.single = async () => {
        const last = [...calls].reverse().find((c) => c.op === "upsert");
        return {
          data: { ...last?.payload, updated_at: "2026-09-21T12:00:00.000Z" },
          error: null,
        };
      };
      b.insert = async (payload: any) => {
        calls.push({ table, op: "insert", payload });
        return {
          error: opts.auditError ? { message: opts.auditError } : null,
        };
      };
      void reading;
      return b;
    },
  };
  return { db: { getClient: () => client } as any, calls };
}

type Call = { table: string; op: string; payload: any };
const writes = (calls: Call[]) =>
  calls.filter(
    (c) => c.table === "recommendation_actions" && c.op === "upsert",
  );
const audits = (calls: Call[]) =>
  calls.filter((c) => c.table === "system_audit_log");

describe("rule-wide dismiss and restore are owner/manager only, and audited", () => {
  it("staff dismissing a whole rule is refused before anything is written", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setActionAs(
        RID,
        RULE,
        { status: "dismissed", reason: "not_relevant" },
        undefined,
        STAFF,
      ),
    ).rejects.toBeInstanceOf(RuleWideActForbidden);
    expect(writes(calls)).toEqual([]);
    expect(audits(calls)).toEqual([]);
  });

  it("staff returning a whole-rule dismissal to the book is refused", async () => {
    const { db, calls } = gateDb({ current: { [RULE]: "dismissed" } });
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setActionAs(RID, RULE, { status: "active" }, undefined, STAFF),
    ).rejects.toBeInstanceOf(RuleWideActForbidden);
    expect(writes(calls)).toEqual([]);
  });

  it("staff keep dismissing a single finding — written, not audited", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    const out = await svc.setActionAs(
      RID,
      FINDING,
      { status: "dismissed", reason: "not_now" },
      undefined,
      STAFF,
    );
    expect(out.audit).toBeNull();
    expect(writes(calls)[0].payload).toMatchObject({
      rule_key: FINDING,
      status: "dismissed",
      reason: "not_now",
      created_by: "u-staff",
    });
    expect(audits(calls)).toEqual([]);
  });

  it("staff keep dismissing a subject", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await svc.setActionAs(
      RID,
      `${RULE}#wednesday#*`,
      { status: "dismissed", reason: "disagree" },
      undefined,
      STAFF,
    );
    expect(writes(calls)).toHaveLength(1);
  });

  it("staff may still snooze a live rule and pin it — neither is a dismiss or a restore", async () => {
    const { db, calls } = gateDb({ current: { [RULE]: "active" } });
    const svc = new RecommendationActionsService(db);
    await svc.setActionAs(
      RID,
      RULE,
      { status: "snoozed", snoozeUntil: LATER },
      undefined,
      STAFF,
    );
    await svc.setActionAs(RID, RULE, { pinned: true }, undefined, STAFF);
    expect(writes(calls)).toHaveLength(2);
    expect(audits(calls)).toEqual([]);
  });

  it("a manager's whole-rule dismissal is written AND filed in the house log", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    const out = await svc.setActionAs(
      RID,
      RULE,
      { status: "dismissed", reason: "not_relevant" },
      undefined,
      MANAGER,
    );
    expect(writes(calls)).toHaveLength(1);
    expect(audits(calls)[0].payload).toMatchObject({
      actor_type: "user",
      actor_id: "u-manager",
      action: "recommendation_rule_dismissed",
      entity_type: "recommendation_rule",
      restaurant_id: RID,
      changes: {
        rule_key: RULE,
        status: { from: null, to: "dismissed" },
        reason: "not_relevant",
      },
    });
    expect(out.audit).toEqual({ recorded: true, reason: null });
  });

  it("a manager's return of a whole rule is its own audit row", async () => {
    const { db, calls } = gateDb({ current: { [RULE]: "dismissed" } });
    const svc = new RecommendationActionsService(db);
    await svc.setActionAs(RID, RULE, { status: "active" }, undefined, MANAGER);
    expect(audits(calls)[0].payload).toMatchObject({
      action: "recommendation_rule_restored",
      changes: { rule_key: RULE, status: { from: "dismissed", to: "active" } },
    });
  });

  it("a lost audit row comes back in the receipt, never as recorded", async () => {
    const { db } = gateDb({ auditError: "permission denied" });
    const svc = new RecommendationActionsService(db);
    const out = await svc.setActionAs(
      RID,
      RULE,
      { status: "dismissed", reason: "not_now" },
      undefined,
      MANAGER,
    );
    expect(out.audit).toEqual({ recorded: false, reason: "permission denied" });
  });

  it("when the rule's current state cannot be read, a status write over it is refused", async () => {
    const { db, calls } = gateDb({ readError: "timeout" });
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setActionAs(RID, RULE, { status: "active" }, undefined, MANAGER),
    ).rejects.toThrow(/Could not read the rule's current state/);
    expect(writes(calls)).toEqual([]);
  });

  it("a whole-rule act with no signed-in person is refused — nobody to file", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setActionAs(
        RID,
        RULE,
        { status: "dismissed", reason: "not_now" },
        undefined,
        { userId: null, role: "owner" },
      ),
    ).rejects.toBeInstanceOf(RuleWideActForbidden);
    expect(writes(calls)).toEqual([]);
  });

  it("a bulk selection holding one whole rule is refused WHOLE for staff", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.bulkSetActionAs(
        RID,
        [{ ruleKey: FINDING }, { ruleKey: "stockout_imminent" }],
        { status: "dismissed", reason: "not_now" },
        STAFF,
      ),
    ).rejects.toBeInstanceOf(RuleWideActForbidden);
    expect(writes(calls)).toEqual([]);
  });

  it("a manager's bulk dismissal files one audit row per whole rule", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    const out = await svc.bulkSetActionAs(
      RID,
      [{ ruleKey: FINDING }, { ruleKey: "stockout_imminent" }],
      { status: "dismissed", reason: "not_now" },
      MANAGER,
    );
    expect(out).toEqual({ updated: 2, audit: { recorded: 1, missed: 0 } });
    expect(audits(calls).map((a: any) => a.payload.changes.rule_key)).toEqual([
      "stockout_imminent",
    ]);
  });
});

describe("the shared state's own rules, at the write", () => {
  it("a dismissal without a reason label is refused", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setActionAs(RID, FINDING, { status: "dismissed" }, undefined, STAFF),
    ).rejects.toThrow(/needs a reason/);
    await expect(
      svc.setActionAs(
        RID,
        FINDING,
        { status: "dismissed", reason: "meh" },
        undefined,
        STAFF,
      ),
    ).rejects.toThrow(/needs a reason/);
    expect(writes(calls)).toEqual([]);
  });

  it("a snooze without a future instant is refused", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.setActionAs(RID, FINDING, { status: "snoozed" }, undefined, STAFF),
    ).rejects.toThrow(/snoozeUntil/);
    await expect(
      svc.setActionAs(
        RID,
        FINDING,
        { status: "snoozed", snoozeUntil: "2020-01-01T00:00:00.000Z" },
        undefined,
        STAFF,
      ),
    ).rejects.toThrow(/snoozeUntil/);
    expect(writes(calls)).toEqual([]);
  });

  it("done writes no reason, even when one is sent — completion is no negative signal", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await svc.setActionAs(
      RID,
      FINDING,
      { status: "done", reason: "not_relevant" },
      undefined,
      STAFF,
    );
    expect(writes(calls)[0].payload).toMatchObject({
      status: "done",
      reason: null,
      snooze_until: null,
    });
  });

  it("a snooze keeps its instant and drops any reason sent with it", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await svc.setActionAs(
      RID,
      FINDING,
      { status: "snoozed", snoozeUntil: LATER, reason: "until next week" },
      undefined,
      STAFF,
    );
    expect(writes(calls)[0].payload).toMatchObject({
      status: "snoozed",
      snooze_until: LATER,
      reason: null,
    });
  });

  it("a bulk write with an invalid patch is refused before any item is written", async () => {
    const { db, calls } = gateDb();
    const svc = new RecommendationActionsService(db);
    await expect(
      svc.bulkSetActionAs(
        RID,
        [{ ruleKey: FINDING }],
        { status: "dismissed" },
        MANAGER,
      ),
    ).rejects.toThrow(/needs a reason/);
    expect(writes(calls)).toEqual([]);
  });
});

describe("the actor comes from the token, never the body", () => {
  it("reads the JWT's user id and house role", () => {
    expect(actorOf({ userId: "u-1", role: "staff" })).toEqual({
      userId: "u-1",
      role: "staff",
    });
    expect(actorOf(undefined)).toEqual({ userId: null, role: null });
  });
});

describe("the controller's door", () => {
  const handler = (name: string) =>
    (AnalyticsController.prototype as unknown as Record<string, any>)[name];

  async function statusOf(p: Promise<unknown>): Promise<number | null> {
    try {
      await p;
      return null;
    } catch (e: any) {
      return typeof e?.getStatus === "function" ? e.getStatus() : -1;
    }
  }

  it("a refused rule-wide act is a 403, and the actor is the token's, not the body's", async () => {
    const seen: unknown[][] = [];
    const self = {
      recommendationActions: {
        setActionAs: async (...args: unknown[]) => {
          seen.push(args);
          throw new RuleWideActForbidden("Only an owner or manager");
        },
      },
    };
    const status = await statusOf(
      handler("setRecommendationAction").call(
        self,
        RID,
        {
          ruleKey: RULE,
          status: "dismissed",
          reason: "not_now",
          createdBy: "u-forged",
        },
        { userId: "u-staff", role: "staff" },
      ),
    );
    expect(status).toBe(403);
    expect(seen[0][4]).toEqual({ userId: "u-staff", role: "staff" });
  });

  it("any other refusal stays a 400", async () => {
    const self = {
      recommendationActions: {
        setActionAs: async () => {
          throw new Error("A dismissal needs a reason");
        },
      },
    };
    const status = await statusOf(
      handler("setRecommendationAction").call(
        self,
        RID,
        { ruleKey: FINDING, status: "dismissed" },
        { userId: "u-staff", role: "staff" },
      ),
    );
    expect(status).toBe(400);
  });

  it("the bulk door refuses a staff selection of whole rules with a 403", async () => {
    const self = {
      recommendationActions: {
        bulkSetActionAs: async () => {
          throw new RuleWideActForbidden("Only an owner or manager");
        },
      },
    };
    const status = await statusOf(
      handler("bulkRecommendationAction").call(
        self,
        RID,
        { items: [{ ruleKey: RULE }], status: "dismissed", reason: "not_now" },
        { userId: "u-staff", role: "staff" },
      ),
    );
    expect(status).toBe(403);
  });
});
