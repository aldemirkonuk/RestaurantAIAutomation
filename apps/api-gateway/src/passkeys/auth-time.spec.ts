import "reflect-metadata";
import * as bcrypt from "bcrypt";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService, signedInNow } from "../auth/auth.service";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * The `auth_time` claim (ADR 0229, Proposed; the founder, 2026-09-25, item 29:
 * "enrolling while signed in: signed in within last 10 min = direct, else email
 * code first").
 *
 * The rule is only as good as the claim: an interactive sign-in must stamp it,
 * and nothing else may renew it. These cases run the real `AuthService` and a
 * real `JwtService`, decode what was signed, and check each path.
 */

const SECRET = "auth-time-spec-secret";
const REFRESH = "auth-time-spec-refresh";
// UUID-shaped (unlike a plain slug) because `parseLastHouseHints` (ADR 0164)
// drops any hint whose ids are not: the new multi-house cases below exercise
// it, where the old ones (login, refresh, switch) never touched it.
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOUSE_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PASSWORD = "a long enough password";

async function world(): Promise<StubDb> {
  return makeStubDb({
    users: [
      {
        user_id: USER,
        email: "a@example.test",
        name: "Ada",
        role: "manager",
        restaurant_id: HOUSE,
        email_verified: true,
        password_hash: await bcrypt.hash(PASSWORD, 4),
      },
    ],
    user_restaurant_access: [
      { user_id: USER, restaurant_id: HOUSE, role: "manager", is_active: true },
      {
        user_id: USER,
        restaurant_id: HOUSE_2,
        role: "manager",
        is_active: true,
      },
    ],
    // `memberHouses` (ADR 0164) names a house only where it can also read
    // it here -- needed now that a passkey/emailed-code sign-in goes through
    // it too, instead of minting directly off `users.restaurant_id`.
    restaurants: [
      { id: HOUSE, name: "House A", city: null },
      { id: HOUSE_2, name: "House B", city: null },
    ],
    user_roles: [],
  });
}

function service(db: StubDb) {
  const jwt = new JwtService({});
  const svc = new AuthService(
    jwt,
    {
      get: (k: string) =>
        k === "JWT_SECRET"
          ? SECRET
          : k === "JWT_REFRESH_SECRET"
            ? REFRESH
            : undefined,
    } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => ({ success: true }) } as any,
  );
  return { svc, jwt };
}

const claims = (jwt: JwtService, token: string) =>
  jwt.verify(token, { secret: SECRET }) as Record<string, unknown>;

describe("auth_time: stamped by a sign-in, carried by everything else", () => {
  it("a password sign-in stamps it now, in seconds", async () => {
    const { svc, jwt } = await service(await world());
    const before = signedInNow();
    const pair = await svc.login({
      email: "a@example.test",
      password: PASSWORD,
    });
    const at = claims(jwt, pair.accessToken).auth_time as number;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(signedInNow());
    // the refresh token carries the same instant
    const r = jwt.verify(pair.refreshToken, { secret: REFRESH }) as any;
    expect(r.auth_time).toBe(at);
  });

  it("a passkey or emailed-code sign-in stamps it now, and lands in the hinted house exactly like a password sign-in (ADR 0164)", async () => {
    const { svc, jwt } = await service(await world());
    const pair = await svc.issueSessionForVerifiedSignIn(
      USER,
      "passkey",
      null,
      [{ userId: USER, houseId: HOUSE, usedAt: Date.now() }],
    );
    const c = claims(jwt, pair.accessToken);
    expect(c.sub).toBe(USER);
    expect(c.restaurantId).toBe(HOUSE);
    expect(c.role).toBe("manager");
    expect(
      Math.abs((c.auth_time as number) - signedInNow()),
    ).toBeLessThanOrEqual(1);
  });

  it("a passkey or emailed-code sign-in with no hint asks a multi-house account to choose, instead of minting whatever users.restaurant_id happened to say (ADR 0090 audit of PR #479, 2026-09-26)", async () => {
    const { svc, jwt } = await service(await world());
    const pair = await svc.issueSessionForVerifiedSignIn(USER, "email_code");
    expect(pair.restaurantId).toBeNull();
    expect((pair.chooseHouse?.houses ?? []).map((h) => h.id).sort()).toEqual(
      [HOUSE, HOUSE_2].sort(),
    );
    const c = claims(jwt, pair.accessToken);
    expect(c.restaurantId).toBeNull();
    expect(c.role).toBeNull();
    expect(
      Math.abs((c.auth_time as number) - signedInNow()),
    ).toBeLessThanOrEqual(1);
  });

  it("refuses to mint for an account that is not there", async () => {
    const { svc } = await service(await world());
    await expect(
      svc.issueSessionForVerifiedSignIn("nobody", "email_code"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("a refresh carries the original instant -- a seven-day chain never looks fresh", async () => {
    const { svc, jwt } = await service(await world());
    const hourAgo = signedInNow() - 3600;
    const old = jwt.sign(
      { sub: USER, restaurantId: HOUSE, auth_time: hourAgo },
      { secret: REFRESH, expiresIn: "7d" },
    );
    const pair = await svc.refreshAccessToken(old);
    expect(claims(jwt, pair.accessToken).auth_time).toBe(hourAgo);
  });

  it("a refresh of a token minted before the claim existed stays without one (not fresh)", async () => {
    const { svc, jwt } = await service(await world());
    const legacy = jwt.sign(
      { sub: USER, restaurantId: HOUSE },
      { secret: REFRESH, expiresIn: "7d" },
    );
    const pair = await svc.refreshAccessToken(legacy);
    expect(claims(jwt, pair.accessToken)).not.toHaveProperty("auth_time");
  });

  it("a house switch carries the instant it was given, and invents none", async () => {
    const { svc, jwt } = await service(await world());
    const t = signedInNow() - 900;
    const carried = await svc.switchRestaurant(USER, HOUSE_2, false, t);
    expect(claims(jwt, carried.accessToken)).toMatchObject({
      restaurantId: HOUSE_2,
      auth_time: t,
    });
    const none = await svc.switchRestaurant(USER, HOUSE_2, false, null);
    expect(claims(jwt, none.accessToken)).not.toHaveProperty("auth_time");
  });

  it("JwtStrategy hands the claim to the route as authTime, and null when absent", async () => {
    const db = await world();
    const { svc } = await service(db);
    const strategy = new JwtStrategy(svc);
    const t = signedInNow();
    const withIt = await strategy.validate({
      sub: USER,
      restaurantId: HOUSE,
      auth_time: t,
    } as any);
    expect(withIt.authTime).toBe(t);
    const without = await strategy.validate({
      sub: USER,
      restaurantId: HOUSE,
    } as any);
    expect(without.authTime).toBeNull();
    const forged = await strategy.validate({
      sub: USER,
      restaurantId: HOUSE,
      auth_time: String(t),
    } as any);
    expect(forged.authTime).toBeNull();
  });
});
