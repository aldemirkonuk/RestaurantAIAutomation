import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { MembersService } from "../restaurants/members.service";
import { OrganizationsService } from "./organizations.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * A house grant never changes who owns the organisation (ADR 0164; see
 * organizations/org-role.ts).
 *
 * Once "Organisation owners only" made `organization_members.role` decide who
 * may open a location, the three grant doors that upserted it with the HOUSE
 * role became a hole in both directions: an organisation owner who accepted a
 * staff invite to another of their own houses lost the right to open one, and
 * a person invited as the owner of one house gained it for the whole
 * organisation. Each case below runs the real service over the filter- and
 * conflict-honouring stub, then asks the real `createLocation`.
 */

const ORG = "org-1";
const A = "house-a";
const B = "house-b";
const FOUNDER = "user-founder";
const NEWCOMER = "user-new";

function world(): StubDb {
  return makeStubDb({
    organizations: [{ id: ORG, owner_id: FOUNDER }],
    organization_members: [
      { organization_id: ORG, user_id: FOUNDER, role: "owner" },
    ],
    restaurants: [
      { id: A, organization_id: ORG, name: "Moda" },
      { id: B, organization_id: ORG, name: "Kadikoy" },
    ],
    user_restaurant_access: [
      { user_id: FOUNDER, restaurant_id: A, role: "owner", is_active: true },
      // A co-owner of B who may add people there.
      {
        user_id: "user-b-owner",
        restaurant_id: B,
        role: "owner",
        is_active: true,
      },
    ],
    users: [
      {
        user_id: FOUNDER,
        email: "founder@a.test",
        restaurant_id: A,
        role: "owner",
      },
      {
        user_id: "user-b-owner",
        email: "b@a.test",
        restaurant_id: B,
        role: "owner",
      },
      {
        user_id: NEWCOMER,
        email: "new@a.test",
        restaurant_id: null,
        role: "staff",
      },
    ],
    organization_invites: [],
    team_members: [],
    system_audit_log: [],
    notifications: [],
  });
}

const members = (db: StubDb) => new MembersService(asDatabaseService(db));
const orgs = (db: StubDb) => new OrganizationsService(asDatabaseService(db));
function auth(db: StubDb): AuthService {
  return new AuthService(
    { sign: () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => undefined } as any,
  );
}
const orgRole = (db: StubDb, userId: string) =>
  db.tables.organization_members
    .filter((r) => r.user_id === userId)
    .map((r) => r.role);

const future = () => new Date(Date.now() + 86_400_000).toISOString();

describe("a house grant never changes who owns the organisation (ADR 0164)", () => {
  it("addMember: an organisation owner added as staff to another house stays its owner, and can still open a location", async () => {
    const db = world();

    await members(db).addMember("user-b-owner", B, "founder@a.test", "staff");

    expect(orgRole(db, FOUNDER)).toEqual(["owner"]);
    await expect(
      orgs(db).createLocation(FOUNDER, {
        name: "Cihangir",
        address: "1",
        city: "Istanbul",
      }),
    ).resolves.toMatchObject({ name: "Cihangir" });
  });

  it("addMember: a person added as the owner of one house is a manager of the organisation, and cannot open a location", async () => {
    const db = world();

    await members(db).addMember("user-b-owner", B, "new@a.test", "owner");

    expect(orgRole(db, NEWCOMER)).toEqual(["manager"]);
    await expect(
      orgs(db).createLocation(NEWCOMER, {
        name: "X",
        address: "1",
        city: "Istanbul",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("an invite accepted: an organisation owner accepting a staff invite stays its owner", async () => {
    const db = world();
    db.tables.organization_invites.push({
      id: "inv-1",
      code: "ABCDEFGH",
      organization_id: ORG,
      restaurant_id: B,
      role: "staff",
      // B's owner, who has standing to grant staff there (item 5, 2026-09-19
      // added the issuer-standing re-check at accept time; every real invite
      // row has invited_by NOT NULL).
      invited_by: "user-b-owner",
      used_at: null,
      expires_at: future(),
    });

    const result = await auth(db).acceptInviteAsExistingUser(
      FOUNDER,
      "abcdefgh",
    );

    expect(result).toMatchObject({ restaurantId: B, role: "staff" });
    expect(orgRole(db, FOUNDER)).toEqual(["owner"]);
  });

  it("an invite accepted: a newcomer invited as a house owner becomes a manager of the organisation, never its owner", async () => {
    const db = world();
    db.tables.organization_invites.push({
      id: "inv-2",
      code: "HGFEDCBA",
      organization_id: ORG,
      restaurant_id: B,
      role: "owner",
      // B's owner, who has standing to grant owner there (item 5, 2026-09-19).
      invited_by: "user-b-owner",
      used_at: null,
      expires_at: future(),
    });

    await auth(db).acceptInviteAsExistingUser(NEWCOMER, "HGFEDCBA");

    expect(orgRole(db, NEWCOMER)).toEqual(["manager"]);
    await expect(
      orgs(db).createLocation(NEWCOMER, {
        name: "X",
        address: "1",
        city: "Istanbul",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
