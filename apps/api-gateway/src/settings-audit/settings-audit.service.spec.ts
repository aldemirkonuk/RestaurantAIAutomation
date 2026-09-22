import { Logger } from "@nestjs/common";
import {
  READ_BACK_ACTIONS,
  readBackActionsFor,
  SETTINGS_RECORDING_SINCE,
  STAFF_WITHHELD_ACTIONS,
  SettingsAuditService,
} from "./settings-audit.service";

/**
 * The trail, and the four ways it could quietly stop being one.
 *
 * 1. It writes the wrong actor id. `auth.users` and `public.users` are DISJOINT
 *    in this database and `system_audit_log.actor_id` has no FK, so a wrong id
 *    inserts cleanly and never resolves. CI cannot catch it against a fresh
 *    database — the only defence is that the value comes from the JWT, which is
 *    what the first test pins.
 * 2. It throws, and the settings write is rolled back or reported as failed
 *    when the setting itself did change.
 * 3. It swallows a failed write, so the register shows a short list rather than
 *    a broken one.
 * 4. An unreadable log renders as an empty log — the exact fault this page was
 *    built against.
 */

function makeDb(
  rows: Record<string, unknown[]>,
  errors: Record<string, { message: string; code?: string }> = {},
  opts: { throwOn?: string } = {},
) {
  const inserted: Array<{ table: string; row: any }> = [];
  const client = {
    from(table: string) {
      if (opts.throwOn === table) {
        throw new Error("the connection went away mid-statement");
      }
      const result = errors[table]
        ? { data: null, error: errors[table] }
        : { data: rows[table] ?? [], error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: async (row: any) => {
          inserted.push({ table, row });
          return errors[table] ? { error: errors[table] } : { error: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { inserted, databaseService: { client } as any };
}

/** Keep the expected error logs out of the test output. */
beforeAll(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

const CHANGE = {
  restaurantId: "rest-1",
  actorUserId: "public-users-id-1",
  action: "feature_flag_changed" as const,
  register: "features" as const,
  entityType: "restaurant_feature_flag",
  entityId: "rest-1",
  subject: "enable_ai_autonomous_send",
  fields: { enable_ai_autonomous_send: { from: false, to: true } },
};

describe("SettingsAuditService.record", () => {
  it("writes the actor id it was given, on the row, as actor_type user", async () => {
    const { databaseService, inserted } = makeDb({});
    const receipt = await new SettingsAuditService(databaseService).record(CHANGE);

    expect(receipt).toEqual({ recorded: true, reason: null });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe("system_audit_log");
    expect(inserted[0].row).toMatchObject({
      actor_type: "user",
      actor_id: "public-users-id-1",
      action: "feature_flag_changed",
      entity_type: "restaurant_feature_flag",
      restaurant_id: "rest-1",
    });
    expect(inserted[0].row.changes).toEqual({
      register: "features",
      subject: "enable_ai_autonomous_send",
      fields: { enable_ai_autonomous_send: { from: false, to: true } },
    });
  });

  it("REFUSES to write an anonymous row when the request carried no user", async () => {
    const { databaseService, inserted } = makeDb({});
    const receipt = await new SettingsAuditService(databaseService).record({
      ...CHANGE,
      actorUserId: "",
    });
    expect(receipt.recorded).toBe(false);
    expect(receipt.reason).toMatch(/no signed-in user/);
    // An audit row whose actor is null answers the question with a shrug and
    // still counts as a record. Better to have none and say so.
    expect(inserted).toHaveLength(0);
  });

  it("files nothing when nothing changed", async () => {
    const { databaseService, inserted } = makeDb({});
    const receipt = await new SettingsAuditService(databaseService).record({
      ...CHANGE,
      fields: {},
    });
    expect(receipt).toEqual({ recorded: false, reason: "nothing changed" });
    expect(inserted).toHaveLength(0);
  });

  it("never throws, and reports the failure back rather than swallowing it", async () => {
    const { databaseService } = makeDb({}, { system_audit_log: { message: "denied" } });
    const receipt = await new SettingsAuditService(databaseService).record(CHANGE);
    expect(receipt).toEqual({ recorded: false, reason: "denied" });
  });

  it("never throws even when the client itself blows up", async () => {
    const { databaseService } = makeDb({}, {}, { throwOn: "system_audit_log" });
    const receipt = await new SettingsAuditService(databaseService).record(CHANGE);
    expect(receipt.recorded).toBe(false);
    expect(receipt.reason).toMatch(/connection went away/);
  });
});

describe("SettingsAuditService.list", () => {
  const ROWS = [
    {
      id: "a1",
      actor_id: "u-1",
      action: "feature_flag_changed",
      entity_type: "restaurant_feature_flag",
      entity_id: "rest-1",
      changes: {
        register: "features",
        subject: "enable_ai_autonomous_send",
        fields: { enable_ai_autonomous_send: { from: false, to: true } },
      },
      created_at: "2026-09-02T18:42:00Z",
    },
    {
      // The pre-existing shape written by `team/access-audit.ts:87` — the field
      // map sits at the TOP level of `changes`, with no register and no subject.
      id: "a2",
      actor_id: "u-2",
      action: "member_role_changed",
      entity_type: "restaurant_member",
      entity_id: "m-9",
      changes: { role: { from: "manager", to: "staff" } },
      created_at: "2026-08-28T11:31:00Z",
    },
  ];

  it("reads both change shapes — its own and the one that predates it", async () => {
    const { databaseService } = makeDb({
      system_audit_log: ROWS,
      users: [
        { user_id: "u-1", name: "Deniz Aksoy", email: "d@example.com" },
        { user_id: "u-2", name: "Selin Kara", email: "s@example.com" },
      ],
    });
    const out = await new SettingsAuditService(databaseService).list("rest-1");

    expect(out.readable).toBe(true);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toMatchObject({
      register: "features",
      subject: "enable_ai_autonomous_send",
      actor: { name: "Deniz Aksoy" },
    });
    // The older shape still yields a readable {from, to}.
    expect(out.entries[1].fields).toEqual({
      role: { from: "manager", to: "staff" },
    });
    expect(out.entries[1].register).toBeNull();
    expect(out.oldestAt).toBe("2026-08-28T11:31:00Z");
    expect(out.recordingSince).toBe(SETTINGS_RECORDING_SINCE);
  });

  it("keeps a row whose actor cannot be named, rather than dropping the change", async () => {
    const { databaseService } = makeDb({ system_audit_log: ROWS, users: [] });
    const out = await new SettingsAuditService(databaseService).list("rest-1");
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].actor).toEqual({
      userId: "u-1",
      name: null,
      email: null,
    });
  });

  it("says the log could not be READ instead of returning an empty trail", async () => {
    const { databaseService } = makeDb({}, { system_audit_log: { message: "connection reset" } });
    const out = await new SettingsAuditService(databaseService).list("rest-1");
    expect(out.readable).toBe(false);
    expect(out.reason).toBe("connection reset");
    expect(out.entries).toEqual([]);
  });

  it("names a missing table as missing, not as silence", async () => {
    const { databaseService } = makeDb(
      {},
      { system_audit_log: { message: "relation does not exist", code: "42P01" } },
    );
    const out = await new SettingsAuditService(databaseService).list("rest-1");
    expect(out.readable).toBe(false);
    expect(out.reason).toContain("not present on this database");
  });

  it("filters to one register without hiding that it filtered", async () => {
    const { databaseService } = makeDb({
      system_audit_log: ROWS,
      users: [{ user_id: "u-1", name: "Deniz Aksoy", email: null }],
    });
    const out = await new SettingsAuditService(databaseService).list("rest-1", 50, "features");
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].register).toBe("features");
  });
});

/**
 * ADR 0218, round 3 answer 3 (2026-09-22, "Only once under way"): a
 * colleague's Away reaches staff only while it is happening, enforced in the
 * API response. `GET /settings-audit` has no role gate, so a manager setting
 * a colleague Away from next week would hand staff the dates — and who set
 * them — through this trail unless the query itself leaves those rows out.
 * The fake below honours `.in("action", …)` the way Postgres does, so the
 * test fails if the query ever asks for the withheld actions again.
 */
describe("SettingsAuditService.list — what a staff reader is never handed", () => {
  const AWAY_ROW = {
    id: "w1",
    actor_id: "u-mgr",
    action: "away_set_for_member",
    entity_type: "restaurant_member",
    entity_id: "u-colleague",
    changes: {
      subject: "Ece Demir",
      fields: { away: { from: null, to: "2026-10-03 to 2026-10-10" } },
    },
    created_at: "2026-09-22T09:00:00Z",
  };
  const ROWS = [
    AWAY_ROW,
    { ...AWAY_ROW, id: "w2", action: "away_ended_for_member" },
    { ...AWAY_ROW, id: "w3", action: "area_member_added", entity_type: "team_member" },
    { ...AWAY_ROW, id: "w4", action: "area_member_removed", entity_type: "team_member" },
    { ...AWAY_ROW, id: "w5", action: "area_lead_granted", entity_type: "team_member" },
    { ...AWAY_ROW, id: "w6", action: "area_lead_removed", entity_type: "team_member" },
    {
      id: "h1",
      actor_id: "u-mgr",
      action: "house_area_changed",
      entity_type: "house_area",
      entity_id: "bar",
      changes: { subject: "Bar", fields: { name: { from: "Bar", to: "Terrace bar" } } },
      created_at: "2026-09-21T09:00:00Z",
    },
    {
      id: "r1",
      actor_id: "u-mgr",
      action: "member_role_changed",
      entity_type: "restaurant_member",
      entity_id: "m-9",
      changes: { role: { from: "manager", to: "staff" } },
      created_at: "2026-09-20T09:00:00Z",
    },
  ];

  function honouringDb() {
    const asked: string[][] = [];
    const client = {
      from(table: string) {
        let allow: Set<string> | null = null;
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: (column: string, values: string[]) => {
            if (table === "system_audit_log" && column === "action") {
              asked.push([...values]);
              allow = new Set(values);
            }
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown) => unknown) => {
            const all = table === "system_audit_log" ? ROWS : [];
            const data = allow ? all.filter((r: any) => allow!.has(r.action)) : all;
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return chain;
      },
    };
    return { asked, databaseService: { client } as any };
  }

  it.each(["staff", "admin", "STAFF", null, undefined])(
    "a %p reader gets no row about a colleague's Away or area, and not even the query asks for one",
    async (role) => {
      const { asked, databaseService } = honouringDb();
      const out = await new SettingsAuditService(databaseService).list("rest-1", 50, undefined, role);
      const actions = out.entries.map((e) => e.action);
      for (const withheld of STAFF_WITHHELD_ACTIONS) {
        expect(actions).not.toContain(withheld);
        expect(asked[0]).not.toContain(withheld);
      }
      expect(JSON.stringify(out)).not.toContain("2026-10-03");
      // Everything that is not about a colleague is still read, as before.
      expect(actions).toEqual(["house_area_changed", "member_role_changed"]);
    },
  );

  it.each(["owner", "manager", "Manager"])(
    "a %p reader still reads the whole trail, the upcoming Away included",
    async (role) => {
      const { databaseService } = honouringDb();
      const out = await new SettingsAuditService(databaseService).list("rest-1", 50, undefined, role);
      expect(out.entries.map((e) => e.id)).toEqual(ROWS.map((r) => r.id));
      expect(out.entries[0].fields).toEqual({
        away: { from: null, to: "2026-10-03 to 2026-10-10" },
      });
    },
  );

  it("withholds exactly the six ADR 0218 person rows, all of which the trail still reads back", () => {
    expect([...STAFF_WITHHELD_ACTIONS].sort()).toEqual(
      [
        "area_lead_granted",
        "area_lead_removed",
        "area_member_added",
        "area_member_removed",
        "away_ended_for_member",
        "away_set_for_member",
      ].sort(),
    );
    for (const a of STAFF_WITHHELD_ACTIONS) expect(READ_BACK_ACTIONS).toContain(a);
    expect(readBackActionsFor("manager")).toEqual([...READ_BACK_ACTIONS]);
  });
});
