import { AuthService } from "../auth/auth.service";
import { MembersService } from "../restaurants/members.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * The roster's job title is not the access role (sim wave 35, integ6-team-auth;
 * coordinator call, wave 68).
 *
 *   F-931  every seed wrote "Owner" / "Manager" / "Staff" into
 *          `team_members.position`, and a role change never touched it, so
 *          the roster printed "Staff · manager" for a promoted invitee.
 *   F-932  the role a founder tapped on arrival (`job_role`) was kept and
 *          never read; their roster row said "Owner · owner".
 */

const RID = "house-1";
const OTHER = "house-2";
const OWNER = "user-owner";
const P = "user-p";

type Row = Record<string, any>;

function world(extra: { access?: Row[]; team?: Row[] } = {}): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        user_id: OWNER,
        restaurant_id: RID,
        role: "owner",
        job_role: "chef",
        is_active: true,
      },
      ...(extra.access ?? []),
    ],
    users: [
      {
        user_id: OWNER,
        restaurant_id: RID,
        role: "owner",
        name: "Deniz",
        email: "d@x.test",
      },
      {
        user_id: P,
        restaurant_id: RID,
        role: "staff",
        name: "Ayla",
        email: "a@x.test",
      },
    ],
    team_members: [...(extra.team ?? [])],
    team_settings: [],
    restaurants: [{ id: RID, organization_id: "org-1" }],
    organization_invites: [],
    system_audit_log: [],
    notifications: [],
  });
}

function services(db: StubDb) {
  const auth = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  const team = new TeamService(asDatabaseService(db));
  const members = new MembersService(asDatabaseService(db), undefined, team);
  return { auth, team, members };
}

const titleOf = (db: StubDb, userId: string, house = RID) =>
  db.tables.team_members.find(
    (m) => m.user_id === userId && m.restaurant_id === house,
  )?.position;

describe("F-932: the roster backfill takes the title from the role tapped on arrival", () => {
  it("gives the founder who tapped Chef the title Chef, not Owner", async () => {
    const db = world();
    await services(db).team.listMembers(OWNER, RID);
    expect(titleOf(db, OWNER)).toBe("Chef");
  });

  it("gives no title to someone who tapped nothing, never the access role", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: RID, role: "staff", is_active: true },
      ],
    });
    await services(db).team.listMembers(OWNER, RID);
    expect(titleOf(db, P)).toBeNull();
  });
});

describe("F-931: invite seeds leave the title empty", () => {
  it("names a no-email placeholder by its role, with no title", async () => {
    const db = world();
    await (services(db).auth as any).ensureTeamMemberForInvite({
      restaurantId: RID,
      inviteId: "inv-1",
      email: null,
      role: "manager",
    });
    const row = db.tables.team_members.find((m) => m.invite_id === "inv-1");
    expect(row).toMatchObject({
      display_name: "Pending manager",
      position: null,
    });
  });

  it("writes no title on an emailed invite's placeholder", async () => {
    const db = world();
    await (services(db).auth as any).ensureTeamMemberForInvite({
      restaurantId: RID,
      inviteId: "inv-2",
      email: "new@x.test",
      role: "staff",
    });
    const row = db.tables.team_members.find((m) => m.invite_id === "inv-2");
    expect(row?.position).toBeNull();
  });

  it("writes no title when the claim creates the roster row", async () => {
    const db = world();
    await (services(db).auth as any).claimTeamMemberFromInvite({
      restaurantId: RID,
      inviteId: "inv-3",
      userId: P,
      email: "a@x.test",
      name: "Ayla",
      role: "staff",
    });
    expect(titleOf(db, P)).toBeNull();
  });
});

describe("F-931: a role change clears a title that was only a copy of the old role", () => {
  const promoted = (position: string | null) =>
    world({
      access: [
        { user_id: P, restaurant_id: RID, role: "staff", is_active: true },
      ],
      team: [
        {
          id: "tm-p",
          restaurant_id: RID,
          user_id: P,
          display_name: "Ayla",
          position,
        },
        {
          id: "tm-p2",
          restaurant_id: OTHER,
          user_id: P,
          display_name: "Ayla",
          position: "Staff",
        },
      ],
    });

  it("clears 'Staff' when staff is made a manager", async () => {
    const db = promoted("Staff");
    await services(db).members.updateMemberRole(OWNER, RID, P, "manager");
    expect(titleOf(db, P)).toBeNull();
  });

  it("keeps a title someone chose", async () => {
    const db = promoted("Sous chef");
    await services(db).members.updateMemberRole(OWNER, RID, P, "manager");
    expect(titleOf(db, P)).toBe("Sous chef");
  });

  it("leaves the person's row in another house alone", async () => {
    const db = promoted("Staff");
    await services(db).members.updateMemberRole(OWNER, RID, P, "manager");
    expect(titleOf(db, P, OTHER)).toBe("Staff");
  });

  it("still changes the role when the title cannot be cleared", async () => {
    const db = promoted("Staff");
    db.errors["team_members:update"] = { message: "connection reset" };
    await services(db).members.updateMemberRole(OWNER, RID, P, "manager");
    expect(
      db.tables.user_restaurant_access.find((a) => a.user_id === P)?.role,
    ).toBe("manager");
  });
});
