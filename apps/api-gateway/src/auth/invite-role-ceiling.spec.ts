import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";

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
 * The role is read ONLY from the inviter's active access row in the house
 * being invited to: no `users`-row fallback, a NULL or unknown role grants
 * nothing, and a failed read is a 503, not a guess in either direction.
 */

type Access = { data: any; error: any };

function makeService(opts: { access?: Access; legacyUser?: Access }) {
  const inserted: Array<{ table: string; payload: any }> = [];

  // `single` answers the insert; `maybeSingle` answers reads (the code
  // collision check reads organization_invites too, and must find nothing).
  const chain = (table: string, result: any, readResult = result): any => {
    const c: any = {
      select: () => c,
      update: () => c,
      insert: (payload: any) => {
        inserted.push({ table, payload });
        return c;
      },
      upsert: () => c,
      delete: () => c,
      order: () => c,
      limit: () => c,
      eq: () => c,
      is: () => c,
      gt: () => c,
      maybeSingle: jest.fn().mockResolvedValue(readResult),
      single: jest.fn().mockResolvedValue(result),
      // The onboarding flag is updated fire-and-forget with .then().
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return c;
  };

  const supabase = {
    from: (table: string) => {
      if (table === "user_restaurant_access")
        return chain(table, opts.access ?? { data: null, error: null });
      if (table === "users")
        return chain(table, opts.legacyUser ?? { data: null, error: null });
      if (table === "restaurants")
        return chain(table, {
          data: { organization_id: "org-1" },
          error: null,
        });
      if (table === "organization_invites")
        return chain(
          table,
          {
            data: { id: "inv-1", code: "ABCD2345", expires_at: null },
            error: null,
          },
          { data: null, error: null },
        );
      return chain(table, { data: null, error: null });
    },
  };

  // Order matters: (jwtService, configService, databaseService,
  // tokenBlacklistService, gmailService).
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    { supabase } as any,
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
    svc.generateInvite("user-1", "house-1", {
      restaurantId: "house-1",
      role,
    } as any);

  const invitesWritten = () =>
    inserted.filter((i) => i.table === "organization_invites");

  return { invite, invitesWritten };
}

const asRole = (role: string) => ({
  access: { data: { role }, error: null },
});

describe("POST /auth/invite grants no role above the inviter's own", () => {
  it("refuses a manager who asks for an owner's invite, and writes nothing", async () => {
    const { invite, invitesWritten } = makeService(asRole("manager"));
    await expect(invite("owner")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("lets a manager invite a manager or staff", async () => {
    const { invite, invitesWritten } = makeService(asRole("manager"));
    await invite("manager");
    await invite("staff");
    expect(invitesWritten().map((i) => i.payload.role)).toEqual([
      "manager",
      "staff",
    ]);
  });

  it("lets an owner invite an owner", async () => {
    const { invite, invitesWritten } = makeService(asRole("owner"));
    await invite("owner");
    expect(invitesWritten().map((i) => i.payload.role)).toEqual(["owner"]);
  });

  it("refuses staff in THIS house, whatever role the token carries elsewhere", async () => {
    const { invite, invitesWritten } = makeService(asRole("staff"));
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("writes the default role only when the inviter may grant it", async () => {
    const { invite, invitesWritten } = makeService(asRole("manager"));
    await invite(undefined);
    expect(invitesWritten().map((i) => i.payload.role)).toEqual(["manager"]);
  });

  it("refuses a role the rank table does not know", async () => {
    const { invite, invitesWritten } = makeService(asRole("owner"));
    await expect(invite("superuser")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(invitesWritten()).toEqual([]);
  });

  it("refuses a member whose only claim is a stale users row", async () => {
    // Removed from this house (no access row) while `users.restaurant_id`
    // still names it and `users.role` says manager: the stale chain.
    const { invite, invitesWritten } = makeService({
      access: { data: null, error: null },
      legacyUser: {
        data: { restaurant_id: "house-1", role: "manager" },
        error: null,
      },
    });
    await expect(invite("owner")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(invite("staff")).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitesWritten()).toEqual([]);
  });

  it("refuses an access row whose role is NULL, whatever the users row says", async () => {
    const { invite, invitesWritten } = makeService({
      access: { data: { role: null }, error: null },
      legacyUser: {
        data: { restaurant_id: "house-1", role: "manager" },
        error: null,
      },
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
      access: { data: null, error: { message: "connection reset" } },
    });
    await expect(invite("staff")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(invitesWritten()).toEqual([]);
  });
});
