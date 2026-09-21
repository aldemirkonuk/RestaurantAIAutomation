import "reflect-metadata";
import { ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService, JwtPayload } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { RolesGuard } from "./guards/roles.guard";
import { Roles } from "./decorators/roles.decorator";
import { MembersService } from "../restaurants/members.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * `@Roles` answers for the house the session's token names, and only that house
 * (ADR 0162, the founder's answer A of 2026-09-18: "Only that house").
 *
 * `RolesGuard` gates every `@Roles` route (38 decorators in 9 controllers on
 * 2026-09-18) on `req.user.role`, and `JwtStrategy.validate` filled that from
 * the global `users.role`. Since a role change writes `users.role` only when the
 * person's `users` row names the house being changed (44.1p, closed), a person
 * demoted in house B kept manager on every `@Roles` route in B, promoted in B
 * was still refused there, and a person with no membership in B carried their
 * other house's role into it (PR #393's round-3 audit, finding 1; 44.1q).
 *
 * Each case runs the real pipeline over the filter-honouring stub: the change
 * through `MembersService.updateMemberRole`, then `JwtStrategy.validate` (which
 * calls the real `AuthService.validateJwtPayload`), then the real `RolesGuard`
 * against a handler carrying the real `@Roles("owner", "manager")`.
 */

const A = "house-a";
const B = "house-b";
const C = "house-c";
const P = "user-p";
const OWNER_B = "user-owner-b";

type Row = Record<string, any>;

function world(extra: { access?: Row[]; users?: Row[] }): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { user_id: OWNER_B, restaurant_id: B, role: "owner", is_active: true },
      ...(extra.access ?? []),
    ],
    users: [
      {
        user_id: OWNER_B,
        restaurant_id: B,
        role: "owner",
        email: "o@b.test",
        name: "Olu",
        email_verified: true,
      },
      ...(extra.users ?? []),
    ],
    system_audit_log: [],
    notifications: [],
  });
}

function authService(db: StubDb): AuthService {
  // (jwtService, configService, databaseService, tokenBlacklistService, gmailService)
  return new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
}

class Probe {
  @Roles("owner", "manager")
  managersOnly() {
    return true;
  }
}

/** `req.user` for a token naming `house`, as the gateway builds it. */
async function sessionIn(db: StubDb, house: string | undefined) {
  const strategy = new JwtStrategy(authService(db));
  const payload: JwtPayload = {
    sub: P,
    email: "p@a.test",
    // The token's own snapshot: never read for a token that names a house.
    role: "owner",
    ...(house ? { restaurantId: house } : {}),
  };
  return strategy.validate(payload);
}

/** Does `@Roles("owner", "manager")` let this session through? */
async function passesManagersOnly(db: StubDb, house: string | undefined) {
  const user = await sessionIn(db, house);
  const guard = new RolesGuard(new Reflector());
  const ctx = {
    getHandler: () => Probe.prototype.managersOnly,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
  return guard.canActivate(ctx);
}

const members = (db: StubDb) => new MembersService(asDatabaseService(db));

describe("@Roles answers for the token's house only (ADR 0162 answer A, 44.1q)", () => {
  it("refuses a person demoted in house B on a manager route in B, and still lets them through in A", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: A, role: "manager", is_active: true },
        { user_id: P, restaurant_id: B, role: "manager", is_active: true },
      ],
      users: [
        {
          user_id: P,
          restaurant_id: A,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    await members(db).updateMemberRole(OWNER_B, B, P, "staff");

    // The users row names A, so the demotion in B left `users.role` alone.
    expect(db.tables.users.find((u) => u.user_id === P)!.role).toBe("manager");
    expect(await passesManagersOnly(db, B)).toBe(false);
    expect(await passesManagersOnly(db, A)).toBe(true);
    expect((await sessionIn(db, B)).role).toBe("staff");
    expect((await sessionIn(db, B)).restaurantId).toBe(B);
  });

  it("lets a person promoted in house B through in B only", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: A, role: "staff", is_active: true },
        { user_id: P, restaurant_id: B, role: "staff", is_active: true },
      ],
      users: [
        {
          user_id: P,
          restaurant_id: A,
          role: "staff",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    await members(db).updateMemberRole(OWNER_B, B, P, "manager");

    expect(db.tables.users.find((u) => u.user_id === P)!.role).toBe("staff");
    expect(await passesManagersOnly(db, B)).toBe(true);
    expect(await passesManagersOnly(db, A)).toBe(false);
  });

  it("refuses a session in a house the person is not a member of, whatever their role elsewhere", async () => {
    // A manager of A holding a token for C (switchRestaurant's organisation
    // fallback mints such tokens with no access row in C).
    const db = world({
      access: [
        { user_id: P, restaurant_id: A, role: "manager", is_active: true },
      ],
      users: [
        {
          user_id: P,
          restaurant_id: A,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    expect(await passesManagersOnly(db, C)).toBe(false);
    expect((await sessionIn(db, C)).role).toBeNull();
  });

  it("refuses when the only row in the house is inactive", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: B, role: "manager", is_active: false },
      ],
      users: [
        {
          user_id: P,
          restaurant_id: A,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    expect(await passesManagersOnly(db, B)).toBe(false);
  });

  it("refuses an access row whose role is NULL, whatever the users row says", async () => {
    const db = world({
      access: [{ user_id: P, restaurant_id: B, role: null, is_active: true }],
      users: [
        {
          user_id: P,
          restaurant_id: B,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    expect(await passesManagersOnly(db, B)).toBe(false);
  });

  it("answers 503 and grants nothing when the role in the house cannot be read", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: B, role: "manager", is_active: true },
      ],
      users: [
        {
          user_id: P,
          restaurant_id: B,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });
    db.errors["user_restaurant_access:select"] = {
      message: "connection reset",
    };

    await expect(sessionIn(db, B)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(passesManagersOnly(db, B)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("reads a member known only by a users row naming the house at users.role (the setup-era manager)", async () => {
    // Unchanged by this fix: until migration 20260918153000 is applied, the
    // YAREN manager holds that house by their users row alone.
    const db = world({
      users: [
        {
          user_id: P,
          restaurant_id: B,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    expect(await passesManagersOnly(db, B)).toBe(true);
    expect((await sessionIn(db, B)).role).toBe("manager");
  });

  it("reads a users row naming the house with no role as staff, which @Roles(owner, manager) refuses", async () => {
    const db = world({
      users: [
        {
          user_id: P,
          restaurant_id: B,
          role: "",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    expect((await sessionIn(db, B)).role).toBe("staff");
    expect(await passesManagersOnly(db, B)).toBe(false);
  });

  it("treats a blank restaurantId as a token that names no house", async () => {
    const db = world({
      users: [
        {
          user_id: P,
          restaurant_id: A,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    const user = await sessionIn(db, "   ");
    expect(user.role).toBe("manager");
    expect(user.restaurantId).toBe(A);
  });

  it("keeps today's behaviour for a token that names no house: users.role, and the users row's house", async () => {
    const db = world({
      access: [
        { user_id: P, restaurant_id: A, role: "staff", is_active: true },
      ],
      users: [
        {
          user_id: P,
          restaurant_id: A,
          role: "manager",
          email: "p@a.test",
          email_verified: true,
        },
      ],
    });

    const user = await sessionIn(db, undefined);
    expect(user.role).toBe("manager");
    expect(user.restaurantId).toBe(A);
    // No house named, so no access read was made.
    expect(db.opsOn("user_restaurant_access", "select")).toHaveLength(0);
  });
});
