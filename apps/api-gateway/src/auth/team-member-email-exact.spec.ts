import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * An invite's team_members row is found by the address itself, not a pattern
 * (F-189 follow-up).
 *
 * `ensureTeamMemberForInvite` and `claimTeamMemberFromInvite` read the house's
 * row with `.ilike("email", email)`. In ILIKE `%` and `_` are wildcards and
 * PostgREST reads `*` as `%`; @IsEmail accepts all three. So inviting
 * `ana_x@…` re-pointed the pending row of `ana.x@…` at the new invite, and a
 * person signed up as `%@tuzlu.com` who accepted an invite took over the first
 * row in the house. The stub runs ILIKE as Postgres does, so these fail on the
 * old lookup.
 */

type Row = Record<string, any>;

const HOUSE = "house-1";

function makeService(
  teamMembers: Row[],
  errors: Record<string, { message: string }> = {},
) {
  const db = makeStubDb({ team_members: teamMembers }, errors);
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  return { svc: svc as any, db };
}

const ana = (): Row => ({
  id: "tm-ana",
  restaurant_id: HOUSE,
  email: "ana.x@tuzlu.com",
  invite_id: "invite-ana",
  user_id: null,
});

describe("ensureTeamMemberForInvite matches the exact address", () => {
  it("an underscore does not stand for another person's dot", async () => {
    const { svc, db } = makeService([ana()]);
    await svc.ensureTeamMemberForInvite({
      restaurantId: HOUSE,
      inviteId: "invite-new",
      email: "ana_x@tuzlu.com",
      role: "staff",
    });
    const rows = db.tables.team_members;
    expect(rows.find((r) => r.id === "tm-ana")?.invite_id).toBe("invite-ana");
    expect(rows.map((r) => r.email)).toEqual([
      "ana.x@tuzlu.com",
      "ana_x@tuzlu.com",
    ]);
  });

  it("a percent sign does not stand for anyone", async () => {
    const { svc, db } = makeService([ana()]);
    await svc.ensureTeamMemberForInvite({
      restaurantId: HOUSE,
      inviteId: "invite-new",
      email: "%@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members[0].invite_id).toBe("invite-ana");
    expect(db.tables.team_members).toHaveLength(2);
  });

  it("an asterisk does not stand for anyone either", async () => {
    const { svc, db } = makeService([ana()]);
    await svc.ensureTeamMemberForInvite({
      restaurantId: HOUSE,
      inviteId: "invite-new",
      email: "*@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members[0].invite_id).toBe("invite-ana");
    expect(db.tables.team_members).toHaveLength(2);
  });

  it("still finds the same address written in a different case", async () => {
    const { svc, db } = makeService([
      { ...ana(), email: "Ana.X@Tuzlu.com" },
    ]);
    await svc.ensureTeamMemberForInvite({
      restaurantId: HOUSE,
      inviteId: "invite-new",
      email: "ana.x@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members).toHaveLength(1);
    expect(db.tables.team_members[0].invite_id).toBe("invite-new");
  });

  it("still finds an address that really has an underscore or asterisk", async () => {
    const { svc, db } = makeService([
      { ...ana(), id: "tm-u", email: "ana_x@tuzlu.com" },
      { ...ana(), id: "tm-s", email: "a*b@tuzlu.com" },
    ]);
    for (const email of ["ana_x@tuzlu.com", "a*b@tuzlu.com"]) {
      await svc.ensureTeamMemberForInvite({
        restaurantId: HOUSE,
        inviteId: `invite-${email}`,
        email,
        role: "staff",
      });
    }
    expect(db.tables.team_members).toHaveLength(2);
    expect(db.tables.team_members.map((r) => r.invite_id)).toEqual([
      "invite-ana_x@tuzlu.com",
      "invite-a*b@tuzlu.com",
    ]);
  });
});

describe("claimTeamMemberFromInvite matches the exact address", () => {
  it("a person signed up as %@… does not take over someone's row", async () => {
    const { svc, db } = makeService([ana()]);
    await svc.claimTeamMemberFromInvite({
      restaurantId: HOUSE,
      inviteId: "invite-other",
      userId: "user-intruder",
      email: "%@tuzlu.com",
      role: "staff",
    });
    const rows = db.tables.team_members;
    expect(rows.find((r) => r.id === "tm-ana")?.user_id).toBeNull();
    expect(rows.find((r) => r.id === "tm-ana")?.email).toBe("ana.x@tuzlu.com");
    expect(rows.filter((r) => r.user_id === "user-intruder")).toHaveLength(1);
  });

  it("an underscore does not claim the row of a dotted address", async () => {
    const { svc, db } = makeService([ana()]);
    await svc.claimTeamMemberFromInvite({
      restaurantId: HOUSE,
      inviteId: "invite-other",
      userId: "user-2",
      email: "ana_x@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members[0].user_id).toBeNull();
    expect(db.tables.team_members).toHaveLength(2);
  });

  it("still claims the row of the same address in a different case", async () => {
    const { svc, db } = makeService([
      { ...ana(), email: "ANA.X@tuzlu.com", invite_id: null },
    ]);
    await svc.claimTeamMemberFromInvite({
      restaurantId: HOUSE,
      inviteId: "invite-other",
      userId: "user-ana",
      email: "ana.x@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members).toHaveLength(1);
    expect(db.tables.team_members[0].user_id).toBe("user-ana");
  });
});

describe("a team-member read that fails is not read as nobody", () => {
  const failing = { "team_members:select": { message: "timeout" } };

  it("an invite does not add a second row for someone already on the team", async () => {
    const { svc, db } = makeService([ana()], failing);
    await svc.ensureTeamMemberForInvite({
      restaurantId: HOUSE,
      inviteId: "invite-new",
      email: "ana.x@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members).toHaveLength(1);
  });

  it("an accepted invite does not add a second row either", async () => {
    const { svc, db } = makeService([{ ...ana(), invite_id: null }], failing);
    await svc.claimTeamMemberFromInvite({
      restaurantId: HOUSE,
      inviteId: "invite-other",
      userId: "user-ana",
      email: "ana.x@tuzlu.com",
      role: "staff",
    });
    expect(db.tables.team_members).toHaveLength(1);
  });
});
