import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { cancelPendingInvitesFrom } from "./cancel-house-invites";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * Item 5, 2026-09-19 (v3.0-TECH-DEBT probe P8): ADR 0162's ceiling — "an
 * invite cannot grant a role above the inviter's own" — held only at the
 * moment an invite was minted. Once made, it kept whatever it said even
 * after its issuer was removed from the house or demoted, because nothing
 * ever revisited a pending invite. This closes both sides: acceptance
 * re-checks the issuer's CURRENT standing, and every removal path cancels
 * the pending invites its target issued for that house so most of them never
 * reach acceptance in the first place.
 */

const ISSUER = "user-issuer";
const JOINER = "user-joiner";
const HOUSE = "house-1";
const OTHER_HOUSE = "house-2";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function makeService(seed: {
  access?: Record<string, any>[];
  invites?: Record<string, any>[];
  users?: Record<string, any>[];
  errors?: Record<string, { message: string }>;
}) {
  const db = makeStubDb(
    {
      user_restaurant_access: seed.access ?? [],
      organization_invites: seed.invites ?? [],
      users: seed.users ?? [{ user_id: JOINER, email: "joiner@example.com" }],
      restaurants: [{ id: HOUSE, name: "House One" }],
      team_members: [],
      organization_members: [],
    },
    seed.errors ?? {},
  );
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

function invite(overrides: Record<string, any> = {}) {
  return {
    id: "invite-1",
    organization_id: "org-1",
    restaurant_id: HOUSE,
    code: "ABCD1234",
    invited_by: ISSUER,
    role: "manager",
    expires_at: FUTURE,
    used_at: null,
    used_by_email: null,
    ...overrides,
  };
}

describe("acceptInviteAsExistingUser — the issuer's standing is checked again at acceptance", () => {
  it("grants the invite when the issuer is still an active member able to grant that role", async () => {
    const { svc } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true }],
      invites: [invite({ role: "manager" })],
    });

    const result = await svc.acceptInviteAsExistingUser(JOINER, "abcd1234");
    expect(result.role).toBe("manager");
  });

  it("refuses when the issuer has been removed from the house since minting the invite", async () => {
    const { svc, db } = makeService({
      access: [], // ISSUER has no active row in HOUSE any more
      invites: [invite({ role: "manager" })],
    });

    await expect(
      svc.acceptInviteAsExistingUser(JOINER, "abcd1234"),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nobody was granted access by a refused accept.
    expect(db.tables.user_restaurant_access).toEqual([]);
  });

  it("refuses when the issuer is still a member but was demoted below the role they granted", async () => {
    const { svc } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: HOUSE, role: "staff", is_active: true }],
      invites: [invite({ role: "manager" })],
    });

    await expect(
      svc.acceptInviteAsExistingUser(JOINER, "abcd1234"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses when the issuer is only an active member of a DIFFERENT house", async () => {
    const { svc } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: OTHER_HOUSE, role: "owner", is_active: true }],
      invites: [invite({ role: "manager" })],
    });

    await expect(
      svc.acceptInviteAsExistingUser(JOINER, "abcd1234"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("answers 503, and grants nothing, when the issuer's standing cannot be read", async () => {
    const { svc, db } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true }],
      invites: [invite({ role: "manager" })],
      errors: { "user_restaurant_access:select": { message: "connection reset" } },
    });

    await expect(
      svc.acceptInviteAsExistingUser(JOINER, "abcd1234"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.tables.user_restaurant_access).toEqual([
      { user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true },
    ]);
  });
});

describe("cancelPendingInvitesFrom — removal expires what the removed person issued for that house", () => {
  it("expires a pending invite issued for the house the person was removed from", async () => {
    const db = makeStubDb({
      organization_invites: [invite({ id: "inv-a", restaurant_id: HOUSE })],
    });

    await cancelPendingInvitesFrom(db.supabase as any, ISSUER, HOUSE);

    const row = db.tables.organization_invites[0];
    expect(new Date(row.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("leaves invites for a DIFFERENT house, and invites from a different issuer, alone", async () => {
    const untouchedHouse = invite({ id: "inv-b", restaurant_id: OTHER_HOUSE, expires_at: FUTURE });
    const untouchedIssuer = invite({
      id: "inv-c",
      invited_by: "someone-else",
      restaurant_id: HOUSE,
      expires_at: FUTURE,
    });
    const db = makeStubDb({
      organization_invites: [untouchedHouse, untouchedIssuer],
    });

    await cancelPendingInvitesFrom(db.supabase as any, ISSUER, HOUSE);

    expect(db.tables.organization_invites[0].expires_at).toBe(FUTURE);
    expect(db.tables.organization_invites[1].expires_at).toBe(FUTURE);
  });

  it("leaves an already-used or already-expired invite as it was", async () => {
    const used = invite({
      id: "inv-d",
      used_at: PAST,
      used_by_email: "someone@example.com",
      expires_at: FUTURE,
    });
    const alreadyExpired = invite({ id: "inv-e", expires_at: PAST });
    const db = makeStubDb({ organization_invites: [used, alreadyExpired] });

    await cancelPendingInvitesFrom(db.supabase as any, ISSUER, HOUSE);

    expect(db.tables.organization_invites[0].expires_at).toBe(FUTURE);
    expect(db.tables.organization_invites[1].expires_at).toBe(PAST);
  });

  it("does not throw when the update itself fails — a removal must still finish", async () => {
    const db = makeStubDb(
      { organization_invites: [invite()] },
      { "organization_invites:update": { message: "connection reset" } },
    );
    const logger = { error: jest.fn() };

    await expect(
      cancelPendingInvitesFrom(db.supabase as any, ISSUER, HOUSE, logger),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

/**
 * Path A — `joinViaInvite`, `POST /auth/join`, `@Public()` — is the OTHER
 * door an invite is accepted through, and it never got this ceiling: it
 * selected `id, organization_id, restaurant_id, role` (no `invited_by`) and
 * minted `user_restaurant_access` from the invite's stored role alone. Round
 * 2, 2026-09-19. A joiner has no session yet, so there is no JWT to hold this
 * check inside a guard — it has to live in the service, same as the
 * existing-user door.
 */
describe("joinViaInvite (Path A) — the issuer's standing is checked again at acceptance", () => {
  const JOIN_PASSWORD = "correct-horse-battery";

  it("grants the invite (new account) when the issuer is still an active member able to grant that role", async () => {
    const { svc, db } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true }],
      invites: [invite({ role: "manager" })],
      users: [], // no existing account for this email — new-user branch
    });

    const result = await svc.joinViaInvite({
      code: "abcd1234",
      name: "New Joiner",
      email: "new-joiner@example.com",
      password: JOIN_PASSWORD,
    } as any);

    expect(result.restaurantId).toBe(HOUSE);
    // The issuer's own seeded row, plus the new joiner's grant.
    expect(db.tables.user_restaurant_access).toHaveLength(2);
    const granted = db.tables.user_restaurant_access.find(
      (r: any) => r.role === "manager",
    );
    expect(granted).toBeDefined();
    expect(granted!.restaurant_id).toBe(HOUSE);
  });

  it("refuses (new account) when the issuer has been removed from the house since minting the invite, and creates no account", async () => {
    const { svc, db } = makeService({
      access: [], // ISSUER has no active row in HOUSE any more
      invites: [invite({ role: "manager" })],
      users: [],
    });

    await expect(
      svc.joinViaInvite({
        code: "abcd1234",
        name: "New Joiner",
        email: "new-joiner@example.com",
        password: JOIN_PASSWORD,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nobody was granted access, and — unlike the existing-user door, where
    // the account already exists — no orphan account was created either.
    expect(db.tables.user_restaurant_access).toEqual([]);
    expect(db.tables.users).toEqual([]);
    // Left consumed, not given back, same as the existing-user door.
    expect(db.tables.organization_invites[0].used_at).not.toBeNull();
  });

  it("refuses (existing account) when the issuer was demoted below the role they granted", async () => {
    const passwordHash = bcrypt.hashSync(JOIN_PASSWORD, 4);
    const { svc, db } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: HOUSE, role: "staff", is_active: true }],
      invites: [invite({ role: "manager" })],
      users: [
        {
          user_id: JOINER,
          email: "existing@example.com",
          password_hash: passwordHash,
        },
      ],
    });

    await expect(
      svc.joinViaInvite({
        code: "abcd1234",
        name: "Existing Joiner",
        email: "existing@example.com",
        password: JOIN_PASSWORD,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The issuer's own (demoted) row is untouched; no row for the joiner.
    expect(db.tables.user_restaurant_access).toEqual([
      { user_id: ISSUER, restaurant_id: HOUSE, role: "staff", is_active: true },
    ]);
  });

  it("answers 503, and grants nothing, when the issuer's standing cannot be read", async () => {
    const { svc, db } = makeService({
      access: [{ user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true }],
      invites: [invite({ role: "manager" })],
      users: [],
      errors: { "user_restaurant_access:select": { message: "connection reset" } },
    });

    await expect(
      svc.joinViaInvite({
        code: "abcd1234",
        name: "New Joiner",
        email: "new-joiner@example.com",
        password: JOIN_PASSWORD,
      } as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    // Unchanged: still just the issuer's own row, and no account was created.
    expect(db.tables.user_restaurant_access).toEqual([
      { user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true },
    ]);
    expect(db.tables.users).toEqual([]);
  });
});
