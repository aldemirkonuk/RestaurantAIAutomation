import { ConflictException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * F-635: a fresh invite must reach someone whose access row in the house is
 * not CURRENT — held, switched off, or past its `valid_until`. Each used to
 * answer 409 "already a member", so the house could never bring them back.
 * Only a live membership is "already a member"; any other row is made live
 * again, in the role the new invite grants.
 */

const ISSUER = "user-issuer";
const JOINER = "user-joiner";
const HOUSE = "house-1";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

function makeService(joinerRow: Record<string, any> | null) {
  const access: Record<string, any>[] = [
    { id: "ura-issuer", user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true },
  ];
  if (joinerRow)
    access.push({ id: "ura-joiner", user_id: JOINER, restaurant_id: HOUSE, ...joinerRow });
  const db = makeStubDb({
    user_restaurant_access: access,
    organization_invites: [
      {
        id: "invite-2",
        organization_id: "org-1",
        restaurant_id: HOUSE,
        code: "ABCD1234",
        invited_by: ISSUER,
        role: "manager",
        expires_at: FUTURE,
        used_at: null,
        used_by_email: null,
      },
    ],
    users: [{ user_id: JOINER, email: "joiner@example.com" }],
    restaurants: [{ id: HOUSE, name: "House One" }],
    team_members: [],
    organization_members: [],
  });
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
    { sendEmail: async () => undefined } as any,
  );
  (svc as any).claimTeamMemberFromInvite = jest.fn().mockResolvedValue(undefined);
  return { svc, db };
}

const joinerRows = (db: ReturnType<typeof makeStubDb>) =>
  db.tables.user_restaurant_access.filter((r) => r.user_id === JOINER);

describe("acceptInviteAsExistingUser — only a current membership is 'already a member' (F-635)", () => {
  it.each([
    ["held while they verified", { role: "staff", is_active: false, held_since: PAST }],
    ["switched off", { role: "staff", is_active: false, deactivated_at: PAST, deactivated_by: ISSUER }],
    ["past its end date", { role: "staff", is_active: true, valid_until: PAST }],
  ])("brings back a row %s, in the new invite's role", async (_label, row) => {
    const { svc, db } = makeService(row);

    const result = await svc.acceptInviteAsExistingUser(JOINER, "abcd1234");

    expect(result).toMatchObject({ role: "manager", restaurantId: HOUSE });
    const rows = joinerRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ura-joiner",
      role: "manager",
      is_active: true,
      held_since: null,
      valid_until: null,
      deactivated_at: null,
      deactivated_by: null,
      invited_via: "invite-2",
    });
    expect(db.tables.organization_invites[0].used_at).not.toBeNull();
  });

  it("still refuses a person who is a current member, and gives the invite back", async () => {
    const { svc, db } = makeService({ role: "staff", is_active: true, valid_until: FUTURE });

    await expect(svc.acceptInviteAsExistingUser(JOINER, "abcd1234")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(joinerRows(db)[0]).toMatchObject({ role: "staff", is_active: true });
    expect(db.tables.organization_invites[0].used_at).toBeNull();
  });

  it("still adds a new row for someone with no row in the house", async () => {
    const { svc, db } = makeService(null);

    await svc.acceptInviteAsExistingUser(JOINER, "abcd1234");

    expect(joinerRows(db)).toEqual([
      expect.objectContaining({ role: "manager", is_active: true, invited_via: "invite-2" }),
    ]);
  });
});
