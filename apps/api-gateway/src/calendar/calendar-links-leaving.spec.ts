import {
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { MembersService } from "../restaurants/members.service";
import { TeamService } from "../team/team.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";
import { CalendarLinksService, hashSecret } from "./calendar-links.service";
import { expiredNoticeFeed } from "./ical-render";

/**
 * A person who leaves a house loses their calendar link there, for good
 * (ADR 0111, review trail 2026-09-21, round 6t).
 *
 * The founder, verbatim: "Yes, revoke on leaving (Recommended)" — both removal
 * flows, and any other path that ends membership, revoke that person's link
 * for that house at once with a system_audit_log row; a returning person
 * connects again; no dormant revival.
 *
 * Every door that ends a membership is driven here for real — the services,
 * not doubles of them — over the filter-honouring stub, with the calendar
 * service reading the same rows:
 *   - `MembersService.removeMember` (both branches, and a self-leave),
 *   - `TeamService.deleteMember`,
 *   - `AuthService.leaveRestaurant`,
 *   - `AuthService.deleteAccount` (every house at once).
 * For each: the leaver's link in that house is stopped (`left_house`, by the
 * actor), one audit row names the door, nobody else's link and no other
 * house's link is touched, the stop comes BEFORE the first membership write,
 * and letting the person back in does not bring the old address back.
 */

const A = "house-a";
const B = "house-b";
const OWNER_B = "user-owner-b";
const OWNER2_B = "user-owner2-b";
const MANAGER_B = "user-manager-b";
const P = "user-p";

const NOW = new Date("2026-09-21T12:00:00.000Z");

type Row = Record<string, any>;

/** A secret per (person, house), so each link's address is known. */
function secretOf(user: string, house: string): string {
  const hex = Buffer.from(`${user}@${house}`).toString("hex");
  return (hex + "0".repeat(64)).slice(0, 64);
}

function link(user: string, house: string): Row {
  return {
    id: `link-${user}-${house}`,
    restaurant_id: house,
    user_id: user,
    token_hash: hashSecret(secretOf(user, house)),
    categories: null,
    created_at: "2026-09-01T00:00:00.000Z",
    issued_at: "2026-09-01T00:00:00.000Z",
    last_fetched_at: null,
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
  };
}

/**
 * House B: two owners, a manager, and P. P is staff of B by an access row and
 * also a member of house A. Everyone in B, and P in A, has a live link.
 */
function world(opts: { pByUsersRowOnly?: boolean } = {}): StubDb {
  const access: Row[] = [
    { user_id: OWNER_B, restaurant_id: B, role: "owner", is_active: true },
    { user_id: OWNER2_B, restaurant_id: B, role: "owner", is_active: true },
    { user_id: MANAGER_B, restaurant_id: B, role: "manager", is_active: true },
    { user_id: P, restaurant_id: A, role: "staff", is_active: true },
  ];
  if (!opts.pByUsersRowOnly) {
    access.push({
      user_id: P,
      restaurant_id: B,
      role: "staff",
      is_active: true,
    });
  }
  return makeStubDb({
    user_restaurant_access: access,
    users: [
      { user_id: OWNER_B, restaurant_id: B, role: "owner", email: "o@b.test" },
      {
        user_id: OWNER2_B,
        restaurant_id: B,
        role: "owner",
        email: "o2@b.test",
      },
      {
        user_id: MANAGER_B,
        restaurant_id: B,
        role: "manager",
        email: "m@b.test",
      },
      // P's users row names B (for the users-row-only branch, it is the ONLY
      // thing making P a member of B).
      { user_id: P, restaurant_id: B, role: "staff", email: "p@b.test" },
    ],
    team_members: [
      { id: "m-p", restaurant_id: B, user_id: P, display_name: "Pat" },
      { id: "m-o", restaurant_id: B, user_id: OWNER_B, display_name: "Olga" },
    ],
    restaurants: [
      { id: A, name: "House A", timezone: "UTC", organization_id: "org-1" },
      { id: B, name: "House B", timezone: "UTC", organization_id: "org-1" },
    ],
    calendar_feed_links: [
      link(OWNER_B, B),
      link(MANAGER_B, B),
      link(P, B),
      link(P, A),
    ],
    calendar_events: [],
    calendar_recurrence_rules: [],
    shifts: [],
    schedules: [],
    organization_invites: [],
    organization_members: [],
    user_oauth_accounts: [],
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
  const links = new CalendarLinksService(asDatabaseService(db));
  links.clock = () => NOW;
  return {
    auth,
    members: new MembersService(asDatabaseService(db)),
    team: new TeamService(asDatabaseService(db)),
    links,
  };
}

const row = (db: StubDb, user: string, house: string) =>
  db.tables.calendar_feed_links.find(
    (r) => r.user_id === user && r.restaurant_id === house,
  )!;

const stopAudits = (db: StubDb) =>
  db.tables.system_audit_log.filter(
    (r) => r.action === "calendar_link_revoked",
  );

/** The index of the first op of `op` on `table` in the recorded order. */
function firstOp(db: StubDb, table: string, op: string): number {
  return db.ops.findIndex((o) => o.table === table && o.op === op);
}

/** What every door must leave behind for P in B. */
function expectStoppedForGood(
  db: StubDb,
  actor: string,
  via: string,
  house: string = B,
) {
  expect(row(db, P, house)).toMatchObject({
    revoke_reason: "left_house",
    revoked_by: actor,
  });
  expect(row(db, P, house).revoked_at).toEqual(expect.any(String));
  const audit = stopAudits(db).find(
    (r) => r.entity_id === row(db, P, house).id,
  );
  expect(audit).toMatchObject({
    actor_type: "user",
    actor_id: actor,
    entity_type: "calendar_link",
    restaurant_id: house,
    reason: "left_house",
    changes: { for_user_id: P, by: "leaving_house", via },
  });
  // Never the secret or its hash on the audit row.
  expect(JSON.stringify(audit)).not.toContain(row(db, P, house).token_hash);
  expect(JSON.stringify(audit)).not.toContain(secretOf(P, house));
}

/** Nobody else's link in B moved, and P's link in A still serves. */
async function expectNobodyElseTouched(db: StubDb) {
  expect(row(db, OWNER_B, B).revoked_at).toBeNull();
  expect(row(db, MANAGER_B, B).revoked_at).toBeNull();
  expect(row(db, P, A).revoked_at).toBeNull();
  const { links } = services(db);
  expect(await links.renderFor(secretOf(P, A))).not.toBe(
    expiredNoticeFeed(NOW),
  );
  expect(await links.renderFor(secretOf(OWNER_B, B))).not.toBe(
    expiredNoticeFeed(NOW),
  );
}

/** Let P back into B, and the OLD address must stay dead. */
async function expectNoRevival(db: StubDb) {
  db.tables.user_restaurant_access.push({
    user_id: P,
    restaurant_id: B,
    role: "staff",
    is_active: true,
  });
  const { links } = services(db);
  expect(await links.renderFor(secretOf(P, B))).toBe(expiredNoticeFeed(NOW));
  expect((await links.getMine(B, P)).connected).toBe(false);
  // A returning person connects again: a new address, and it serves.
  const again = await links.create(B, P);
  expect(again.secret).toMatch(/^[0-9a-f]{64}$/);
  expect(again.secret).not.toBe(secretOf(P, B));
  expect(await links.renderFor(again.secret as string)).not.toBe(
    expiredNoticeFeed(NOW),
  );
}

describe("every door that ends a membership stops that person's link there, for good", () => {
  it("Settings' remove (MembersService.removeMember), by a manager", async () => {
    const db = world();
    await services(db).members.removeMember(MANAGER_B, B, P);
    expectStoppedForGood(db, MANAGER_B, "MembersService.removeMember");
    await expectNobodyElseTouched(db);
    await expectNoRevival(db);
  });

  it("Settings' remove of a member known only by their users row", async () => {
    const db = world({ pByUsersRowOnly: true });
    await services(db).members.removeMember(OWNER_B, B, P);
    expectStoppedForGood(db, OWNER_B, "MembersService.removeMember");
    await expectNobodyElseTouched(db);
    await expectNoRevival(db);
  });

  it("leaving through Settings' remove of yourself", async () => {
    const db = world();
    await services(db).members.removeMember(P, B, P);
    expectStoppedForGood(db, P, "MembersService.removeMember");
    await expectNobodyElseTouched(db);
  });

  it("the Team page's remove (TeamService.deleteMember)", async () => {
    const db = world();
    await services(db).team.deleteMember(MANAGER_B, B, "m-p");
    expectStoppedForGood(db, MANAGER_B, "TeamService.deleteMember");
    await expectNobodyElseTouched(db);
    await expectNoRevival(db);
  });

  it("leaving on your own (AuthService.leaveRestaurant)", async () => {
    const db = world();
    await services(db).auth.leaveRestaurant(P, B);
    expectStoppedForGood(db, P, "AuthService.leaveRestaurant");
    await expectNobodyElseTouched(db);
    await expectNoRevival(db);
  });

  it("deleting your account (AuthService.deleteAccount) stops your link in every house, one audit row each", async () => {
    const db = world();
    await services(db).auth.deleteAccount(P);
    expectStoppedForGood(db, P, "AuthService.deleteAccount", B);
    expectStoppedForGood(db, P, "AuthService.deleteAccount", A);
    expect(stopAudits(db)).toHaveLength(2);
    expect(row(db, OWNER_B, B).revoked_at).toBeNull();
    expect(row(db, MANAGER_B, B).revoked_at).toBeNull();
  });
});

describe("a leaving stop touches only LIVE links: an earlier stop keeps its record", () => {
  // Found by the lane's last call (a mutation dropping `revoked_at IS NULL`
  // from the stop survived every suite): without the filter, leaving would
  // rewrite who stopped an old link, when and why, and file an audit row for
  // a link that was already dead.
  const earlier = {
    id: "link-p-b-earlier",
    restaurant_id: B,
    user_id: P,
    token_hash: hashSecret("e".repeat(64)),
    categories: null,
    created_at: "2026-08-01T00:00:00.000Z",
    issued_at: "2026-08-01T00:00:00.000Z",
    last_fetched_at: null,
    revoked_at: "2026-08-15T00:00:00.000Z",
    revoked_by: P,
    revoke_reason: "revoked_by_self",
  };

  it.each([
    [
      "removeMember",
      (s: ReturnType<typeof services>) =>
        s.members.removeMember(MANAGER_B, B, P),
      1,
    ],
    [
      "deleteAccount (every house)",
      (s: ReturnType<typeof services>) => s.auth.deleteAccount(P),
      2,
    ],
  ])(
    "%s leaves a link P stopped earlier exactly as it was",
    async (_n, door, liveLinksOfP) => {
      const db = world();
      db.tables.calendar_feed_links.push({ ...earlier });
      await door(services(db));
      expect(
        db.tables.calendar_feed_links.find((r) => r.id === earlier.id),
      ).toEqual(earlier);
      expect(stopAudits(db)).toHaveLength(liveLinksOfP);
      expect(stopAudits(db).some((r) => r.entity_id === earlier.id)).toBe(
        false,
      );
    },
  );
});

describe("the stop comes first, so a leaver can never keep a live link", () => {
  it.each([
    [
      "removeMember",
      (s: ReturnType<typeof services>) => s.members.removeMember(OWNER_B, B, P),
    ],
    [
      "deleteMember",
      (s: ReturnType<typeof services>) =>
        s.team.deleteMember(OWNER_B, B, "m-p"),
    ],
    [
      "leaveRestaurant",
      (s: ReturnType<typeof services>) => s.auth.leaveRestaurant(P, B),
    ],
    [
      "deleteAccount",
      (s: ReturnType<typeof services>) => s.auth.deleteAccount(P),
    ],
  ])(
    "%s stops the link before its first membership write",
    async (_n, door) => {
      const db = world();
      await door(services(db));
      const stop = firstOp(db, "calendar_feed_links", "update");
      expect(stop).toBeGreaterThanOrEqual(0);
      const firstMembershipWrite = Math.min(
        ...[
          firstOp(db, "users", "update"),
          firstOp(db, "users", "delete"),
          firstOp(db, "user_restaurant_access", "delete"),
        ].filter((i) => i >= 0),
      );
      expect(stop).toBeLessThan(firstMembershipWrite);
    },
  );

  it.each([
    [
      "removeMember",
      (s: ReturnType<typeof services>) => s.members.removeMember(OWNER_B, B, P),
    ],
    [
      "deleteMember",
      (s: ReturnType<typeof services>) =>
        s.team.deleteMember(OWNER_B, B, "m-p"),
    ],
    [
      "leaveRestaurant",
      (s: ReturnType<typeof services>) => s.auth.leaveRestaurant(P, B),
    ],
    [
      "deleteAccount",
      (s: ReturnType<typeof services>) => s.auth.deleteAccount(P),
    ],
  ])(
    "%s: a stop that fails refuses the whole removal, and nothing about the membership changed",
    async (_n, door) => {
      const db = world();
      db.errors["calendar_feed_links:update"] = { message: "write refused" };
      await expect(door(services(db))).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(
        db.tables.user_restaurant_access.filter(
          (r) => r.user_id === P && r.restaurant_id === B,
        ),
      ).toHaveLength(1);
      expect(db.tables.users.find((u) => u.user_id === P)?.restaurant_id).toBe(
        B,
      );
      expect(row(db, P, B).revoked_at).toBeNull();
      expect(stopAudits(db)).toHaveLength(0);
    },
  );
});

describe("a refused removal stops nobody's link", () => {
  it("a manager removing an owner is refused on both doors, and the owner's link still serves", async () => {
    const db = world();
    const s = services(db);
    await expect(
      s.members.removeMember(MANAGER_B, B, OWNER_B),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      s.team.deleteMember(MANAGER_B, B, "m-o"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(row(db, OWNER_B, B).revoked_at).toBeNull();
    expect(firstOp(db, "calendar_feed_links", "update")).toBe(-1);
    expect(stopAudits(db)).toHaveLength(0);
  });
});
