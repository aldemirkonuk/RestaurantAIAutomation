import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { TeamService } from "./team.service";
import { HISTORY_COLUMNS } from "./invite-placeholders";
import { MembersService } from "../restaurants/members.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * F-580 — a revoked or expired invite left a person on /team who will never
 * arrive. Minting an invite writes a `team_members` stand-in (`invite_id` set,
 * no `user_id`); revoking deleted only the invite, and an expired one changed
 * nothing, so the roster kept counting them and let them be scheduled.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const PAST = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:00:01.000Z";
const BEFORE = "2025-12-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

function seed(over: Record<string, any[]> = {}): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true },
    ],
    users: [
      { user_id: OWNER, restaurant_id: RID, role: "owner", name: "Ada", email: "ada@example.test" },
    ],
    team_members: [
      { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
    ],
    team_settings: [],
    organization_invites: [],
    shifts: [],
    ...over,
  });
}

const standIn = (id: string, inviteId: string, createdAt = LATER) => ({
  id,
  restaurant_id: RID,
  user_id: null,
  invite_id: inviteId,
  display_name: "Pending staff",
  created_at: createdAt,
});
const invite = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: RID,
  code: id.toUpperCase(),
  created_at: PAST,
  expires_at: FUTURE,
  used_at: null,
  ...over,
});
const ids = (db: StubDb) => db.tables.team_members.map((m: any) => m.id).sort();

describe("TeamService.listMembers — an expired invite's stand-in leaves the roster", () => {
  it("drops and deletes the stand-in of an invite that expired unused", async () => {
    const db = seed({
      organization_invites: [invite("inv-1", { expires_at: PAST })],
      team_members: [
        { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
        standIn("m-ghost", "inv-1"),
      ],
    });
    const roster = await new TeamService(asDatabaseService(db)).listMembers(OWNER, RID);

    expect(roster.map((m: any) => m.id)).toEqual(["m-owner"]);
    expect(ids(db)).toEqual(["m-owner"]);
  });

  it("keeps the stand-in of an invite that can still be used", async () => {
    const db = seed({
      organization_invites: [invite("inv-1")],
      team_members: [
        { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
        standIn("m-coming", "inv-1"),
      ],
    });
    const roster = await new TeamService(asDatabaseService(db)).listMembers(OWNER, RID);

    expect(roster.map((m: any) => m.id).sort()).toEqual(["m-coming", "m-owner"]);
    expect(db.opsOn("team_members", "delete")).toEqual([]);
  });

  it("keeps a stand-in with shifts on it, and only unlinks the dead invite", async () => {
    const db = seed({
      organization_invites: [invite("inv-1", { expires_at: PAST })],
      team_members: [
        { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
        standIn("m-booked", "inv-1"),
      ],
      shifts: [{ id: "s1", restaurant_id: RID, member_id: "m-booked" }],
    });
    const roster = await new TeamService(asDatabaseService(db)).listMembers(OWNER, RID);

    expect(roster.map((m: any) => m.id).sort()).toEqual(["m-booked", "m-owner"]);
    const row = db.tables.team_members.find((m: any) => m.id === "m-booked");
    expect(row?.invite_id).toBeNull();
    expect(db.opsOn("team_members", "delete")).toEqual([]);
  });

  it("keeps an owner's own roster row that the invite was only attached to", async () => {
    const db = seed({
      organization_invites: [invite("inv-1", { expires_at: PAST })],
      team_members: [
        { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
        standIn("m-typed", "inv-1", BEFORE),
      ],
    });
    await new TeamService(asDatabaseService(db)).listMembers(OWNER, RID);

    expect(ids(db)).toEqual(["m-owner", "m-typed"]);
  });
});

describe("MembersService.revokeInvite — the revoked invite's stand-in goes with it", () => {
  it("deletes the invite and the person it put on the roster", async () => {
    const db = seed({
      organization_invites: [invite("inv-1")],
      team_members: [
        { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
        standIn("m-ghost", "inv-1"),
      ],
    });
    await new MembersService(asDatabaseService(db)).revokeInvite(OWNER, RID, "inv-1");

    expect(db.tables.organization_invites).toEqual([]);
    expect(ids(db)).toEqual(["m-owner"]);
  });

  it("leaves a roster row an acceptance already claimed", async () => {
    const db = seed({
      organization_invites: [invite("inv-1")],
      team_members: [
        { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
        { ...standIn("m-arrived", "inv-1"), user_id: "user-new" },
      ],
    });
    await new MembersService(asDatabaseService(db)).revokeInvite(OWNER, RID, "inv-1");

    expect(ids(db)).toEqual(["m-arrived", "m-owner"]);
  });
});

describe("a stand-in with any record on it is kept, never deleted", () => {
  const recordOn = (table: string, column: string, memberId: string) => ({
    [table]: [{ id: "r1", restaurant_id: RID, [column]: memberId }],
  });

  it.each(HISTORY_COLUMNS.map(([t, c]) => [t, c]))(
    "an expired invite keeps a stand-in held by %s.%s",
    async (table, column) => {
      const db = seed({
        organization_invites: [invite("inv-1", { expires_at: PAST })],
        team_members: [
          { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
          standIn("m-held", "inv-1"),
        ],
        ...recordOn(table, column, "m-held"),
      });
      await new TeamService(asDatabaseService(db)).listMembers(OWNER, RID);

      expect(ids(db)).toEqual(["m-held", "m-owner"]);
      expect(db.tables[table]).toHaveLength(1);
      const row = db.tables.team_members.find((m: any) => m.id === "m-held");
      expect(row?.invite_id).toBeNull();
    },
  );

  it.each(HISTORY_COLUMNS.map(([t, c]) => [t, c]))(
    "a revoke keeps a stand-in held by %s.%s",
    async (table, column) => {
      const db = seed({
        organization_invites: [invite("inv-1")],
        team_members: [
          { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", created_at: BEFORE },
          standIn("m-held", "inv-1"),
        ],
        ...recordOn(table, column, "m-held"),
      });
      await new MembersService(asDatabaseService(db)).revokeInvite(OWNER, RID, "inv-1");

      expect(ids(db)).toEqual(["m-held", "m-owner"]);
      expect(db.opsOn("team_members", "delete")).toEqual([]);
    },
  );
});

/**
 * Every foreign key to `team_members` in the migrations, as `table.column`.
 * A new table that points at a person is history the moment it exists; this
 * fails until it is named in HISTORY_COLUMNS, so a stand-in carrying a row of
 * it is never deleted with that row cascading away unseen.
 */
function foreignKeysToTeamMembers(): string[] {
  const dir = join(__dirname, "../../../../supabase/migrations");
  const found = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const stmt of sql.split(";")) {
      if (!/references\s+(?:public\.)?"?team_members"?\s*\(/i.test(stmt)) continue;
      const table = /(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+only)?(?:\s+if\s+exists)?)\s+(?:public\.)?"?(\w+)/i.exec(stmt)?.[1];
      const ref = /references\s+(?:public\.)?"?team_members"?\s*\(/gi;
      let m: RegExpExecArray | null;
      while ((m = ref.exec(stmt))) {
        const before = stmt.slice(0, m.index);
        const column =
          /foreign\s+key\s*\(\s*"?(\w+)"?[^)]*\)\s*$/i.exec(before)?.[1] ??
          /(?:^|[,(])\s*"?(\w+)"?\s+uuid(?:\s+not\s+null)?\s*$/i.exec(before)?.[1];
        expect([file, table, column]).toEqual([file, expect.any(String), expect.any(String)]);
        found.add(`${table}.${column}`);
      }
    }
  }
  return [...found].sort();
}

describe("HISTORY_COLUMNS covers every table that points at a roster row", () => {
  it("names every foreign key to team_members in the migrations", () => {
    const named = new Set(HISTORY_COLUMNS.map(([t, c]) => `${t}.${c}`));
    const fks = foreignKeysToTeamMembers();
    expect(fks.length).toBeGreaterThanOrEqual(10);
    expect(fks.filter((fk) => !named.has(fk))).toEqual([]);
  });
});
