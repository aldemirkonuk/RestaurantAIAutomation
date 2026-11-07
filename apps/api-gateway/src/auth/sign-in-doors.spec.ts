import "reflect-metadata";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";
import { STEP_UP_REQUIRED } from "../passkeys/passkeys.service";
import { SESSION_ENDED } from "./session-version";

/**
 * Three sign-in doors from QA round 11 (auth and integrations). R11-02
 * (password sign-in folding the typed address) moved to PR #853, which owns
 * the fold every door shares.
 *
 * R11-04 -- the password-reset request awaited the mail send, which an unknown
 * address never reaches, so the response time said whether the account
 * exists; the method's own doc comment says it must not.
 *
 * R11-07 -- sign-out refused only the 15-minute access token; the 7-day
 * refresh token on the device kept minting pairs. It is refused now too.
 *
 * R11-08 -- an account with no password could have one ADDED with nothing but
 * a live access token. The passkey enrolment rule (a sign-in in the last ten
 * minutes) now applies.
 *
 * PRE-FIX PROOF: with each fix reverted, the hung-mail case returns "hung",
 * the stale-token case sets the password, and the signed-out refresh token
 * still mints a pair -- each of those fails. The fresh-token and
 * has-a-password cases pass both ways (nothing real users rely on changes).
 */

const RIGHT = "the-right-password";
const HASH = bcrypt.hashSync(RIGHT, 4);
const nowSec = () => Math.floor(Date.now() / 1000);

function member(over: Record<string, unknown> = {}) {
  return {
    user_id: "u1",
    email: "chef@bistro.com",
    name: "Chef",
    password_hash: HASH,
    email_verified: true,
    created_at: new Date().toISOString(),
    session_version: 0,
    ...over,
  };
}

function service(
  users: Record<string, unknown>[],
  mail: { sendEmail: jest.Mock } = {
    sendEmail: jest.fn(async () => ({ success: true })),
  },
) {
  const db = makeStubDb({ users, password_resets: [] });
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false, blacklistToken: async () => undefined } as any,
    mail as any,
  );
  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).mailPasswordChangedNotice = jest.fn(async () => undefined);
  return { db, svc, mail };
}

describe("password-reset request does not wait for the mail (R11-04)", () => {
  it("answers at once for a known address even when the mail never returns", async () => {
    const hung = { sendEmail: jest.fn(() => new Promise<never>(() => undefined)) };
    const { svc } = service([member()], hung);

    const answer = await Promise.race([
      svc.requestPasswordReset("chef@bistro.com", "203.0.113.5"),
      new Promise((r) => setTimeout(() => r("hung"), 250)),
    ]);

    expect(answer).toEqual({ sent: true });
    // ...and the mail was still started, off the request's clock.
    await new Promise((r) => setImmediate(r));
    expect(hung.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a send that throws is logged, never surfaced", async () => {
    const failing = {
      sendEmail: jest.fn(async () => {
        throw new Error("smtp down");
      }),
    };
    const { svc } = service([member()], failing);
    await expect(
      svc.requestPasswordReset("chef@bistro.com", "203.0.113.5"),
    ).resolves.toEqual({ sent: true });
    await new Promise((r) => setImmediate(r));
    expect(failing.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("password-reset request answers before any database round trip (QA round 18)", () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };

  /** A query builder whose every call chains and whose await never settles. */
  const neverResolves: any = new Proxy(() => undefined, {
    get: (_t, key) => (key === "then" ? () => undefined : neverResolves),
    apply: () => neverResolves,
  });

  it("resolves for a known and an unknown address although no query ever answers", async () => {
    const { svc } = service([member()]);
    (svc as any).databaseService = { supabase: { from: () => neverResolves } };

    const answers = await Promise.race([
      Promise.all([
        svc.requestPasswordReset("chef@bistro.com", "203.0.113.5"),
        svc.requestPasswordReset("nobody@bistro.com", "203.0.113.5"),
      ]),
      new Promise((r) => setTimeout(() => r("hung"), 250)),
    ]);

    expect(answers).toEqual([{ sent: true }, { sent: true }]);
  });

  it("still inserts the row and sends the mail for a known address, and neither for an unknown one", async () => {
    const { db, svc, mail } = service([member()]);

    await svc.requestPasswordReset("nobody@bistro.com", "203.0.113.5");
    await flush();
    expect(db.tables.password_resets).toHaveLength(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();

    await svc.requestPasswordReset("chef@bistro.com", "203.0.113.5");
    await flush();
    expect(db.tables.password_resets).toHaveLength(1);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a request inside the cooldown gets no second row and no second mail", async () => {
    const { db, svc, mail } = service([member()]);

    await svc.requestPasswordReset("chef@bistro.com", "203.0.113.5");
    await flush();
    await svc.requestPasswordReset("chef@bistro.com", "203.0.113.5");
    await flush();

    expect(db.tables.password_resets).toHaveLength(1);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("adding a first password needs a recent sign-in (R11-08)", () => {
  it("refuses a token signed in more than ten minutes ago, and changes nothing", async () => {
    const { db, svc } = service([member({ password_hash: null })]);

    const err = await svc
      .changePassword("u1", undefined, "attacker-chosen-pw", {
        authTime: nowSec() - 11 * 60,
      })
      .then(
        () => null,
        (e) => e,
      );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: STEP_UP_REQUIRED,
    });
    expect(db.tables.users[0].password_hash).toBeNull();
  });

  it("refuses a token with no auth_time at all", async () => {
    const { db, svc } = service([member({ password_hash: null })]);
    await expect(
      svc.changePassword("u1", undefined, "attacker-chosen-pw", {}),
    ).rejects.toThrow(ForbiddenException);
    expect(db.tables.users[0].password_hash).toBeNull();
  });

  it("allows it within ten minutes of signing in", async () => {
    const { db, svc } = service([member({ password_hash: null })]);
    await expect(
      svc.changePassword("u1", undefined, "a-new-password", {
        authTime: nowSec() - 60,
      }),
    ).resolves.toEqual({ accessToken: "a", refreshToken: "r" });
    expect(
      bcrypt.compareSync("a-new-password", db.tables.users[0].password_hash),
    ).toBe(true);
  });

  it("a change with the current password still needs no recent sign-in", async () => {
    const { svc } = service([member()]);
    await expect(
      svc.changePassword("u1", RIGHT, "a-new-password", { authTime: null }),
    ).resolves.toEqual({ accessToken: "a", refreshToken: "r" });
  });
});

describe("sign-out refuses the device's refresh token too (R11-07)", () => {
  const SECRETS: Record<string, string> = {
    JWT_SECRET: "test-secret-for-sign-in-doors-spec",
    JWT_REFRESH_SECRET: "test-refresh-secret-for-sign-in-doors-spec",
  };

  function realTokens(users: Record<string, unknown>[]) {
    const db = makeStubDb({ users, user_restaurant_access: [], restaurants: [] });
    const listed = new Map<string, number>();
    const blacklist = {
      blacklistToken: async (t: string, until: Date) => {
        listed.set(t, until.getTime());
      },
      isBlacklisted: async (t: string) => listed.has(t),
    };
    const svc = new AuthService(
      new JwtService({}),
      { get: (k: string) => SECRETS[k] } as any,
      asDatabaseService(db),
      blacklist as any,
      { sendEmail: async () => ({ success: true }) } as any,
    );
    return { svc, listed };
  }

  const mint = (svc: AuthService, user: Record<string, unknown>) =>
    (svc as any).generateTokens(user, false, null, nowSec()) as Promise<{
      accessToken: string;
      refreshToken: string;
    }>;

  it("a refresh token signed out with mints nothing afterwards", async () => {
    const user = member();
    const { svc } = realTokens([user]);
    const pair = await mint(svc, user);

    // Before sign-out the same token refreshes, so the refusal below is the
    // sign-out's doing and not the harness's.
    await expect(svc.refreshSession(pair.refreshToken)).resolves.toHaveProperty(
      "accessToken",
    );

    await svc.logout("u1", pair.accessToken, pair.refreshToken);

    const err = await svc.refreshSession(pair.refreshToken).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({
      code: SESSION_ENDED,
    });
  });

  it("cannot be used to end somebody else's session", async () => {
    const mine = member();
    const theirs = member({ user_id: "u2", email: "other@bistro.com" });
    const { svc, listed } = realTokens([mine, theirs]);
    const their = await mint(svc, theirs);

    await svc.logout("u1", undefined, their.refreshToken);

    expect(listed.has(their.refreshToken)).toBe(false);
    await expect(svc.refreshSession(their.refreshToken)).resolves.toHaveProperty(
      "accessToken",
    );
  });

  it("an older client that sends no refresh token still signs out", async () => {
    const user = member();
    const { svc, listed } = realTokens([user]);
    const pair = await mint(svc, user);
    await svc.logout("u1", pair.accessToken);
    expect(listed.has(pair.accessToken)).toBe(true);
    expect(listed.size).toBe(1);
  });
});
