import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { MembersService } from "./members.service";
import { TeamService } from "../team/team.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * Leaving or being removed ends the membership, in that house and no other
 * (ADR 0162, answer A: "Only that house"; v3.0-TECH-DEBT 44.1j, 44.1n).
 *
 * Three doors take a person out of a house: `AuthService.leaveRestaurant`
 * (leave), `TeamService.deleteMember` (the Team page's remove) and
 * `MembersService.removeMember` (Settings' remove). The first two deleted the
 * access row and left `users.restaurant_id` naming the house, so the `users`-row
 * fallback still counted the leaver as a member there: an owner's role change
 * reached them, they could invite at `users.role`, and their token kept a role.
 * The third cleared `users.restaurant_id` whatever house it named, so a removal
 * from house B took house A away too.
 *
 * Also here: `updateMemberRole`'s UPDATE rewrote an inactive row; the Team
 * page let a manager remove an owner; and both removals proceeded past a read
 * that failed. Every case runs over the filter-honouring stub.
 */

const A = "house-a";
const B = "house-b";
const OWNER_B = "user-owner-b";
const OWNER2_B = "user-owner2-b";
const MANAGER_B = "user-manager-b";
const P = "user-p";

type Row = Record<string, any>;

function world(
  extra: { access?: Row[]; users?: Row[]; team?: Row[] } = {},
): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { user_id: OWNER_B, restaurant_id: B, role: "owner", is_active: true },
      {
        user_id: MANAGER_B,
        restaurant_id: B,
        role: "manager",
        is_active: true,
      },
      ...(extra.access ?? []),
    ],
    users: [
      { user_id: OWNER_B, restaurant_id: B, role: "owner", email: "o@b.test" },
      {
        user_id: MANAGER_B,
        restaurant_id: B,
        role: "manager",
        email: "m@b.test",
      },
      ...(extra.users ?? []),
    ],
    team_members: [...(extra.team ?? [])],
    restaurants: [{ id: B, organization_id: "org-1" }],
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
  // Bookkeeping after an invite's insert is not what this spec is about.
  (auth as any).ensureTeamMemberForInvite = jest
    .fn()
    .mockResolvedValue(undefined);
  return {
    auth,
    members: new MembersService(asDatabaseService(db)),
    team: new TeamService(asDatabaseService(db)),
  };
}

const usersRow = (db: StubDb, id: string) =>
  db.tables.users.find((u) => u.user_id === id)!;
const accessRows = (db: StubDb, id: string, house: string) =>
  db.tables.user_restaurant_access.filter(
    (r) => r.user_id === id && r.restaurant_id === house,
  );

/**
 * Make ONE kind of read fail, leaving every other read of the same table
 * working. `db.errors` fails a whole table, which would fail the actor's own
 * membership read first and pass these tests for the wrong reason.
 */
function failRead(
  db: StubDb,
  table: string,
  when: (q: {
    columns?: string;
    count: boolean;
    eqs: Record<string, any>;
  }) => boolean,
) {
  const from = db.supabase.from;
  db.supabase.from = (t: string) => {
    const b = from(t);
    if (t !== table) return b;
    const q = {
      columns: undefined as string | undefined,
      count: false,
      eqs: {} as Record<string, any>,
      write: false,
    };
    const select = b.select.bind(b);
    b.select = (c?: string, o?: any) => {
      q.columns = c;
      q.count = !!o?.count;
      return select(c, o);
    };
    const eq = b.eq.bind(b);
    b.eq = (c: string, v: any) => {
      q.eqs[c] = v;
      return eq(c, v);
    };
    for (const m of ["insert", "update", "delete", "upsert"]) {
      const orig = b[m].bind(b);
      b[m] = (...args: any[]) => {
        q.write = true;
        return orig(...args);
      };
    }
    const failed = () => !q.write && when(q);
    const answer = {
      data: null,
      error: { message: "read failed" },
      count: null,
    };
    const maybeSingle = b.maybeSingle.bind(b);
    b.maybeSingle = async () => (failed() ? answer : maybeSingle());
    const single = b.single.bind(b);
    b.single = async () => (failed() ? answer : single());
    const then = b.then.bind(b);
    b.then = (ok: any, ko: any) =>
      failed() ? Promise.resolve(answer).then(ok, ko) : then(ok, ko);
    return b;
  };
}

/** P: a manager of B by their access row, with a users row naming `home`. */
const managerOfB = (home: string, extraAccess: Row[] = []) => ({
  access: [
    { user_id: P, restaurant_id: B, role: "manager", is_active: true },
    ...extraAccess,
  ],
  users: [
    { user_id: P, restaurant_id: home, role: "manager", email: "p@b.test" },
  ],
  team: [{ id: "m-p", restaurant_id: B, user_id: P, display_name: "Pat" }],
});

/** After leaving B, P is not a member of B by any door. */
async function expectNotAMemberOfB(db: StubDb) {
  const { auth, members } = services(db);
  await expect(
    members.updateMemberRole(OWNER_B, B, P, "staff"),
  ).rejects.toBeInstanceOf(NotFoundException);
  await expect(
    auth.generateInvite(P, B, { restaurantId: B, role: "staff" } as any),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await expect(members.assertMembership(P, B)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
  expect(db.tables.organization_invites).toEqual([]);
}

describe("leaving ends the membership in that house (44.1j)", () => {
  it("after leaving, an owner's role change for them 404s and they cannot invite", async () => {
    const db = world(managerOfB(B));
    await services(db).auth.leaveRestaurant(P, B);

    expect(usersRow(db, P).restaurant_id).toBeNull();
    expect(accessRows(db, P, B)).toHaveLength(0);
    await expectNotAMemberOfB(db);
  });

  it("leaves a users row naming another house alone", async () => {
    const db = world(
      managerOfB(A, [
        { user_id: P, restaurant_id: A, role: "manager", is_active: true },
      ]),
    );
    await services(db).auth.leaveRestaurant(P, B);

    expect(usersRow(db, P).restaurant_id).toBe(A);
    expect(accessRows(db, P, A)).toHaveLength(1);
  });

  it("changes nothing when the users row cannot be cleared", async () => {
    const db = world(managerOfB(B));
    db.errors["users:update"] = { message: "write failed" };

    await expect(
      services(db).auth.leaveRestaurant(P, B),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(accessRows(db, P, B)).toHaveLength(1);
  });
});

describe("the Team page's remove ends the membership in that house (44.1j)", () => {
  it("after removal, an owner's role change for them 404s and they cannot invite", async () => {
    const db = world(managerOfB(B));
    await services(db).team.deleteMember(OWNER_B, B, "m-p");

    expect(usersRow(db, P).restaurant_id).toBeNull();
    expect(accessRows(db, P, B)).toHaveLength(0);
    await expectNotAMemberOfB(db);
  });

  it("leaves a users row naming another house alone", async () => {
    const db = world(managerOfB(A));
    await services(db).team.deleteMember(OWNER_B, B, "m-p");

    expect(usersRow(db, P).restaurant_id).toBe(A);
  });

  it("changes nothing when the users row cannot be cleared", async () => {
    const db = world(managerOfB(B));
    db.errors["users:update"] = { message: "write failed" };

    await expect(
      services(db).team.deleteMember(OWNER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(accessRows(db, P, B)).toHaveLength(1);
    expect(db.tables.team_members).toHaveLength(1);
  });
});

describe("Settings' remove takes the person out of that house only", () => {
  it("leaves a users row naming another house alone", async () => {
    const db = world(
      managerOfB(A, [
        { user_id: P, restaurant_id: A, role: "manager", is_active: true },
      ]),
    );
    await services(db).members.removeMember(OWNER_B, B, P);

    expect(usersRow(db, P).restaurant_id).toBe(A);
    expect(accessRows(db, P, B)).toHaveLength(0);
  });

  it("clears a users row naming this house, so the removed person is not a member by it", async () => {
    const db = world(managerOfB(B));
    await services(db).members.removeMember(OWNER_B, B, P);

    expect(usersRow(db, P).restaurant_id).toBeNull();
    await expectNotAMemberOfB(db);
  });

  it("answers 500 and removes nothing when the target's access row cannot be read", async () => {
    // P is an OWNER of B by their access row, while `users.role` says staff.
    // A swallowed read fell through to the users row, read "staff", and let a
    // manager take the owner out.
    const db = world({
      access: [
        { user_id: P, restaurant_id: B, role: "owner", is_active: true },
      ],
      users: [
        { user_id: P, restaurant_id: B, role: "staff", email: "p@b.test" },
      ],
    });
    failRead(db, "user_restaurant_access", (q) => q.eqs.user_id === P);

    await expect(
      services(db).members.removeMember(MANAGER_B, B, P),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(usersRow(db, P).restaurant_id).toBe(B);
    expect(accessRows(db, P, B)).toHaveLength(1);
  });

  it("answers 500 and removes nothing when the target's users row cannot be read", async () => {
    const db = world({
      users: [
        { user_id: P, restaurant_id: B, role: "staff", email: "p@b.test" },
      ],
    });
    failRead(db, "users", (q) => q.eqs.user_id === P);

    await expect(
      services(db).members.removeMember(MANAGER_B, B, P),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(usersRow(db, P).restaurant_id).toBe(B);
  });
});

describe("a role change rewrites the active row only", () => {
  it("leaves an inactive row's role alone when the member is admitted by their users row", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: B, role: "staff", is_active: false },
      ],
      users: [
        { user_id: P, restaurant_id: B, role: "staff", email: "p@b.test" },
      ],
    });
    await services(db).members.updateMemberRole(OWNER_B, B, P, "manager");

    expect(usersRow(db, P).role).toBe("manager");
    expect(accessRows(db, P, B)[0].role).toBe("staff");
  });
});

describe("the Team page's remove: owners manage owners (44.1n)", () => {
  const ownerP = {
    access: [{ user_id: P, restaurant_id: B, role: "owner", is_active: true }],
    users: [{ user_id: P, restaurant_id: B, role: "owner", email: "p@b.test" }],
    team: [{ id: "m-p", restaurant_id: B, user_id: P, display_name: "Pat" }],
  };

  it("refuses a manager who removes an owner, and removes nothing", async () => {
    const db = world(ownerP);
    await expect(
      services(db).team.deleteMember(MANAGER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(accessRows(db, P, B)).toHaveLength(1);
    expect(usersRow(db, P).restaurant_id).toBe(B);
    expect(db.tables.team_members).toHaveLength(1);
    expect(db.tables.system_audit_log).toHaveLength(0);
  });

  it("refuses a manager who removes an owner known only by the users row", async () => {
    const db = world({ users: ownerP.users, team: ownerP.team });
    await expect(
      services(db).team.deleteMember(MANAGER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersRow(db, P).restaurant_id).toBe(B);
    expect(db.tables.team_members).toHaveLength(1);
  });

  it("refuses a manager who removes a person whose inactive row here says owner", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: B, role: "owner", is_active: false },
      ],
      users: [
        { user_id: P, restaurant_id: A, role: "staff", email: "p@b.test" },
      ],
      team: ownerP.team,
    });
    await expect(
      services(db).team.deleteMember(MANAGER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(accessRows(db, P, B)).toHaveLength(1);
  });

  it("answers 500 and removes nothing when the roster row cannot be read", async () => {
    const db = world(ownerP);
    failRead(db, "team_members", (q) => q.eqs.id === "m-p");

    await expect(
      services(db).team.deleteMember(MANAGER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(accessRows(db, P, B)).toHaveLength(1);
    expect(db.tables.team_members).toHaveLength(1);
  });

  it("lets an owner remove a co-owner while another owner remains", async () => {
    const db = world(ownerP);
    await services(db).team.deleteMember(OWNER_B, B, "m-p");
    expect(accessRows(db, P, B)).toHaveLength(0);
    expect(db.tables.team_members).toHaveLength(0);
  });

  it("lets a manager remove a manager", async () => {
    const db = world(managerOfB(B));
    await services(db).team.deleteMember(MANAGER_B, B, "m-p");
    expect(accessRows(db, P, B)).toHaveLength(0);
  });

  it("counts active owners only: the last active owner cannot remove themself", async () => {
    const db = world({
      access: [
        {
          user_id: OWNER2_B,
          restaurant_id: B,
          role: "owner",
          is_active: false,
        },
      ],
      team: [
        { id: "m-o", restaurant_id: B, user_id: OWNER_B, display_name: "Olu" },
      ],
    });
    await expect(
      services(db).team.deleteMember(OWNER_B, B, "m-o"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(accessRows(db, OWNER_B, B)).toHaveLength(1);
  });

  it("lets the only active owner remove a person whose owner row here is inactive", async () => {
    // Removing them takes no active owner away, so the last-owner count does
    // not apply; only an owner may do it (the guard above).
    const db = world({
      access: [
        { user_id: P, restaurant_id: B, role: "owner", is_active: false },
      ],
      users: [
        { user_id: P, restaurant_id: A, role: "staff", email: "p@b.test" },
      ],
      team: ownerP.team,
    });
    await services(db).team.deleteMember(OWNER_B, B, "m-p");
    expect(accessRows(db, P, B)).toHaveLength(0);
  });

  it("refuses when the owner count cannot be read", async () => {
    const db = world({
      ...ownerP,
      access: [
        ...ownerP.access,
        { user_id: OWNER2_B, restaurant_id: B, role: "owner", is_active: true },
      ],
    });
    failRead(db, "user_restaurant_access", (q) => q.count);

    await expect(
      services(db).team.deleteMember(OWNER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(accessRows(db, P, B)).toHaveLength(1);
  });

  it("answers 500 and removes nothing when the target's access row cannot be read", async () => {
    const db = world(ownerP);
    failRead(db, "user_restaurant_access", (q) => q.eqs.user_id === P);

    await expect(
      services(db).team.deleteMember(MANAGER_B, B, "m-p"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(accessRows(db, P, B)).toHaveLength(1);
    expect(db.tables.team_members).toHaveLength(1);
  });
});
