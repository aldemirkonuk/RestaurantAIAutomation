import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * `POST /auth/invite` — an owner invites any role, a manager a manager or
 * staff, staff nobody (ADR 0162).
 *
 * Until 2026-09-18 `generateInvite` checked only that the caller had SOME
 * active access row for the house the body named, and wrote `dto.role`
 * unchanged. `RolesGuard` gates on `users.role`, a GLOBAL column
 * (`JwtStrategy.validate`: `role: user.role ?? payload.role`), so it said
 * nothing about the house being invited to. A manager could mint an owner's
 * invite, and a manager in one house who is staff in another could mint any
 * invite for the second. Whoever redeemed it became that role (`/auth/join`
 * takes the role from the invite).
 *
 * The role is read the way `MembersService.assertMembership` reads it: the
 * inviter's active access row in the house being invited to decides when it
 * exists (a NULL role grants nothing); with no row, a `users` row whose
 * `restaurant_id` names this house is read at `users.role || "staff"`; any
 * other `users` row grants nothing. The ceiling applies to both. A failed
 * read of either is a 503, not a guess in either direction.
 */

type Row = Record<string, any>;

const ME = "user-1";
const HOUSE = "house-1";
const OTHER_HOUSE = "house-2";
const SOMEONE_ELSE = "user-2";

/**
 * Over the filter-honouring stub (`team/testing/supabase-stub.ts`), not a
 * chain that answers every read with one canned row. A stub that ignores
 * `.eq(...)` cannot fail a test about which row is read: with it, dropping
 * `.eq("restaurant_id", restaurantId)` or `.eq("is_active", true)` from the
 * inviter's access read passed every test here (PR #393's round-3 verifier).
 */
function makeService(
  seed: {
    access?: Row[];
    users?: Row[];
    errors?: Record<string, { message: string }>;
  } = {},
) {
  const db = makeStubDb(
    {
      user_restaurant_access: seed.access ?? [],
      users: seed.users ?? [],
      restaurants: [{ id: HOUSE, organization_id: "org-1" }],
      organization_invites: [],
      user_onboarding_progress: [],
    },
    seed.errors ?? {},
  );

  // Order matters: (jwtService, configService, databaseService,
  // tokenBlacklistService, gmailService).
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
  // Bookkeeping after the insert is not what this spec is about.
  (svc as any).ensureTeamMemberForInvite = jest
    .fn()
    .mockResolvedValue(undefined);

  const invite = (role?: string) =>
    svc.generateInvite(ME, HOUSE, {
      restaurantId: HOUSE,
      role,
    } as any);

  const invitesWritten = () => db.tables.organization_invites;
  const invitedRoles = () => invitesWritten().map((i) => i.role);

  return { invite, invitesWritten, invitedRoles };
}

/** An active access row for the inviter in the house being invited to. */
const asRole = (role: string | null) => ({
  access: [
    { user_id: ME, restaurant_id: HOUSE, role, is_active: true },
  ] as Row[],
});

/** No access row anywhere; a `users` row naming `house` at `role`. */
const legacy = (house: string, role: string | null) => ({
  users: [{ user_id: ME, restaurant_id: house, role }] as Row[],
});

describe("POST /auth/invite grants no role above the inviter's own", () => {
  it("refuses a manager who asks for an owner's invite, and writes nothing", async () => {
    const { invite, invitesWritten } = makeService(asRole("manager"));
    await expect(invite("owner")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("lets a manager invite a manager or staff", async () => {
    const { invite, invitedRoles } = makeService(asRole("manager"));
    await invite("manager");
    await invite("staff");
    expect(invitedRoles()).toEqual(["manager", "staff"]);
  });

  it("lets an owner invite an owner", async () => {
    const { invite, invitedRoles } = makeService(asRole("owner"));
    await invite("owner");
    expect(invitedRoles()).toEqual(["owner"]);
  });

  it("refuses staff in THIS house, whatever role the token carries elsewhere", async () => {
    const { invite, invitesWritten } = makeService(asRole("staff"));
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("writes the default role only when the inviter may grant it", async () => {
    const { invite, invitedRoles } = makeService(asRole("manager"));
    await invite(undefined);
    expect(invitedRoles()).toEqual(["manager"]);
  });

  it("refuses a role the rank table does not know", async () => {
    const { invite, invitesWritten } = makeService(asRole("owner"));
    await expect(invite("superuser")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(invitesWritten()).toEqual([]);
  });

  it("reads a legacy member from a users row naming this house, capped by the ceiling", async () => {
    // Production 2026-09-18: a manager created 2026-05-09 whose
    // `users.restaurant_id` is a house they have never had an access row for.
    // `assertMembership` admits them there; so does this door, at their
    // `users.role`, and no higher.
    const { invite, invitedRoles } = makeService(legacy(HOUSE, "manager"));
    await invite("manager");
    await invite("staff");
    await expect(invite("owner")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitedRoles()).toEqual(["manager", "staff"]);
  });

  it("refuses when there is no access row and the users row names another house", async () => {
    const { invite, invitesWritten } = makeService(
      legacy(OTHER_HOUSE, "owner"),
    );
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("reads a legacy users row with no role as staff, which grants nothing", async () => {
    const { invite, invitesWritten } = makeService(legacy(HOUSE, null));
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it('refuses a legacy users row whose role is an inherited key, such as "constructor"', async () => {
    const { invite, invitesWritten } = makeService(
      legacy(HOUSE, "constructor"),
    );
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("lets an access row decide even when the users row names this house higher", async () => {
    // Staff here by their access row; `users.role` says owner. The row wins,
    // as it does in `assertMembership`: the users row is read only when there
    // is no access row at all.
    const { invite, invitesWritten } = makeService({
      ...asRole("staff"),
      ...legacy(HOUSE, "owner"),
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("answers 503, not a refusal, when the users row cannot be read", async () => {
    const { invite, invitesWritten } = makeService({
      ...legacy(HOUSE, "manager"),
      errors: { "users:select": { message: "connection reset" } },
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(invitesWritten()).toEqual([]);
  });

  it("refuses an access row whose role is NULL, whatever the users row says", async () => {
    const { invite, invitesWritten } = makeService({
      ...asRole(null),
      ...legacy(HOUSE, "manager"),
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it('refuses an access role that is an inherited key, such as "constructor"', async () => {
    const { invite, invitesWritten } = makeService(asRole("constructor"));
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(invite("owner")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("answers 503, not a guess, when the role cannot be read", async () => {
    const { invite, invitesWritten } = makeService({
      ...asRole("owner"),
      errors: {
        "user_restaurant_access:select": { message: "connection reset" },
      },
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(invitesWritten()).toEqual([]);
  });
});

/**
 * Which row is read. Each test holds a row that WOULD grant the invite if the
 * read dropped one of its filters, and no row that grants it with every filter
 * in place. Added 2026-09-18 (PR #393's fourth round): over the old canned
 * stub, a read with `.eq("restaurant_id", …)` or `.eq("is_active", true)`
 * deleted passed this whole file.
 */
describe("POST /auth/invite reads the inviter's own row in this house, and no other", () => {
  it("gives an owner's access row in another house nothing to grant here", async () => {
    const { invite, invitesWritten } = makeService({
      access: [
        {
          user_id: ME,
          restaurant_id: OTHER_HOUSE,
          role: "owner",
          is_active: true,
        },
      ],
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("gives an inactive owner's access row here nothing to grant", async () => {
    const { invite, invitesWritten } = makeService({
      access: [
        { user_id: ME, restaurant_id: HOUSE, role: "owner", is_active: false },
      ],
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("gives another person's owner row here nothing to grant the inviter", async () => {
    const { invite, invitesWritten } = makeService({
      access: [
        {
          user_id: SOMEONE_ELSE,
          restaurant_id: HOUSE,
          role: "owner",
          is_active: true,
        },
      ],
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("gives another person's users row naming this house nothing to grant the inviter", async () => {
    const { invite, invitesWritten } = makeService({
      users: [
        { user_id: SOMEONE_ELSE, restaurant_id: HOUSE, role: "owner" },
        { user_id: ME, restaurant_id: OTHER_HOUSE, role: "owner" },
      ],
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });
});
