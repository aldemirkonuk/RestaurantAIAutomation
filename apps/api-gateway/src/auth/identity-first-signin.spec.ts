import * as fs from "fs";
import * as path from "path";
import { Reflector } from "@nestjs/core";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import {
  IDENTITY_PROVIDERS,
  STORABLE_OAUTH_PROVIDER_IDS,
  defaultSignInMethods,
} from "./identity-providers";

/**
 * ADR 0024 — identity-first sign-in.
 *
 * The bug these pin down: `validateUser` used to answer "which provider does
 * this password-less account use?" with `oauth_provider === "microsoft" ?
 * "microsoft" : "google"`, i.e. a coin-flip weighted to Google. Verified
 * against production on 2026-08-26, that branch fired on four accounts and was
 * wrong on all four — every one had `oauth_provider` NULL and zero rows in
 * `user_oauth_accounts`, so every one was told to use a Google flow that could
 * never work.
 *
 * So the property under test is not "does it return something" but "does it
 * only ever say things that are true of the row in front of it". Each test
 * below was run against the reverted implementation and observed to FAIL
 * before being kept — a test that passes against the bug is worse than none.
 */

interface Fixture {
  /** The `users` row for the address, or null for an unknown address. */
  userByEmail?: {
    user_id: string;
    email?: string;
    password_hash: string | null;
    oauth_provider?: string | null;
  } | null;
  /** Rows in `user_oauth_accounts` for that user. */
  oauthRows?: { provider: string }[];
}

function makeService(fx: Fixture) {
  const from = jest.fn((table: string) => {
    if (table === "user_oauth_accounts") {
      // `resolveLinkedProviderIds` awaits `.select().eq()` directly — there is
      // no terminal `.single()`, so `eq` must resolve.
      const chain: any = {
        select: () => chain,
        eq: () => Promise.resolve({ data: fx.oauthRows ?? [], error: null }),
      };
      return chain;
    }

    if (table === "users") {
      // `users` is read three different ways. Discriminate on the projection:
      //   "*"                    -> validateUser
      //   "user_id, password_hash" -> resolveSignInMethods
      //   "oauth_provider"       -> the legacy hint inside resolveLinkedProviderIds
      let cols = "";
      const row = fx.userByEmail ?? null;
      const chain: any = {
        select: (c: string) => {
          cols = c;
          return chain;
        },
        eq: () => chain,
        maybeSingle: () => {
          if (cols === "oauth_provider") {
            return Promise.resolve({
              data: row ? { oauth_provider: row.oauth_provider ?? null } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: row, error: null });
        },
        single: () =>
          Promise.resolve(
            row
              ? { data: row, error: null }
              : { data: null, error: { message: "no rows" } },
          ),
      };
      return chain;
    }

    throw new Error(`unexpected table in this fixture: ${table}`);
  });

  const svc = new AuthService(
    { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
    { get: jest.fn().mockReturnValue(undefined) } as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    { sendEmail: jest.fn() } as any,
  );

  return { svc, from };
}

/** Pull the structured body out of an UnauthorizedException. */
function bodyOf(err: unknown): any {
  expect(err).toBeInstanceOf(UnauthorizedException);
  return (err as UnauthorizedException).getResponse();
}

/**
 * Remove block comments and whole-line `//` / ` *` comments.
 *
 * Deliberately conservative: it never strips a trailing comment that shares a
 * line with code, so a real violation can never be hidden by this function —
 * only a comment-only line can be. The reverse (stripping too eagerly) would
 * make the guard vacuous, which is worse.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

describe("resolveSignInMethods — the methods that actually exist", () => {
  it("password-only identity offers password and nothing else", async () => {
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-pw",
        password_hash: "$2b$10$hash",
        oauth_provider: null,
      },
      oauthRows: [],
    });

    const result = await svc.resolveSignInMethods("owner@meyhouse-pa.com");

    expect(result.methods.map((m) => m.id)).toEqual(["password"]);
    expect(result.noSignInMethod).toBe(false);
  });

  it("google-linked identity offers google, sourced from user_oauth_accounts", async () => {
    const { svc } = makeService({
      // `oauth_provider` is deliberately NULL here: that is the shape of the
      // one production user who genuinely does have a linked Google account.
      // If the resolver read the column instead of the rows, google would be
      // missing from this list.
      userByEmail: {
        user_id: "u-goog",
        password_hash: null,
        oauth_provider: null,
      },
      oauthRows: [{ provider: "google" }],
    });

    const result = await svc.resolveSignInMethods("someone@gmail.com");

    expect(result.methods.map((m) => m.id)).toEqual(["google"]);
    expect(result.noSignInMethod).toBe(false);
  });

  it("password + google identity offers both, in registry order", async () => {
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-both",
        password_hash: "$2b$10$hash",
        oauth_provider: "google",
      },
      oauthRows: [{ provider: "google" }],
    });

    const result = await svc.resolveSignInMethods("aldemirkonuk2004@gmail.com");

    expect(result.methods.map((m) => m.id)).toEqual(["password", "google"]);
  });

  it("an identity with NEITHER reports no sign-in method, and names no provider", async () => {
    // The aldemirkonuk@hotmail.com case, verified in production 2026-08-26:
    // password_hash NULL, oauth_provider NULL, zero user_oauth_accounts rows.
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-none",
        password_hash: null,
        oauth_provider: null,
      },
      oauthRows: [],
    });

    const result = await svc.resolveSignInMethods("aldemirkonuk@hotmail.com");

    expect(result.methods).toEqual([]);
    expect(result.noSignInMethod).toBe(true);
    // The whole point: a hotmail address must not conjure Microsoft, and a
    // password-less account must not conjure Google.
    expect(JSON.stringify(result.methods)).not.toMatch(/google|microsoft/i);
  });

  it("an unknown email returns the standard set and claims nothing about the address", async () => {
    const { svc } = makeService({ userByEmail: null });

    const result = await svc.resolveSignInMethods("nobody@example.com");

    expect(result.methods).toEqual(defaultSignInMethods());
    expect(result.methods.map((m) => m.id)).toEqual(["password", "google"]);
    // Must NOT be the method-less shape: saying "this account has no sign-in
    // method" about an address with no account fabricates the account.
    expect(result.noSignInMethod).toBe(false);
  });

  it("normalises the address so casing and whitespace cannot split an identity", async () => {
    const { svc, from } = makeService({
      userByEmail: {
        user_id: "u-pw",
        password_hash: "$2b$10$hash",
      },
    });

    const result = await svc.resolveSignInMethods("  Owner@Meyhouse-PA.com ");

    expect(result.email).toBe("owner@meyhouse-pa.com");
    expect(from).toHaveBeenCalledWith("users");
  });

  it("ships the whole registry as `declared`, and claims no unavailable method for a stranger", async () => {
    const { svc } = makeService({ userByEmail: null });

    const result = await svc.resolveSignInMethods("nobody@example.com");

    expect(result.declared.map((p) => p.id)).toEqual([
      "password",
      "google",
      "microsoft",
      "apple",
    ]);
    for (const p of result.declared.filter((d) => !d.enabled)) {
      expect(p.disabledReason).toBeTruthy();
    }
    // `unavailable` is per-identity, not the registry's disabled list — an
    // address with no account has no linked providers to be unable to use.
    expect(result.unavailable).toEqual([]);
  });

  it("a linked-but-unusable provider lands in `unavailable`, with its reason", async () => {
    const { svc } = makeService({
      userByEmail: { user_id: "u-ms", password_hash: null },
      oauthRows: [{ provider: "microsoft" }],
    });

    const result = await svc.resolveSignInMethods("someone@hotmail.com");

    expect(result.methods).toEqual([]);
    expect(result.unavailable.map((p) => p.id)).toEqual(["microsoft"]);
    expect(result.unavailable[0].disabledReason).toBeTruthy();
    // It HAS a sign-in method — just not one this page can drive. Saying "no
    // sign-in method" here would be false.
    expect(result.noSignInMethod).toBe(false);
  });

  it("ignores an unrecognised provider row rather than offering a method that does not exist", async () => {
    const { svc } = makeService({
      userByEmail: { user_id: "u-x", password_hash: null },
      oauthRows: [{ provider: "myspace" }],
    });

    const result = await svc.resolveSignInMethods("x@example.com");

    expect(result.methods).toEqual([]);
    expect(result.noSignInMethod).toBe(true);
  });
});

describe("validateUser — never guesses a provider", () => {
  it("an account with NO password and NO linked provider is told the truth", async () => {
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-none",
        email: "aldemirkonuk@hotmail.com",
        password_hash: null,
        oauth_provider: null,
      },
      oauthRows: [],
    });

    const err = await svc
      .validateUser("aldemirkonuk@hotmail.com", "whatever")
      .then(
        () => {
          throw new Error("expected validateUser to reject");
        },
        (e) => e,
      );

    const body = bodyOf(err);
    expect(body.code).toBe("NO_SIGNIN_METHOD");
    expect(body.message).toMatch(/doesn't have a sign-in method set up yet/i);
    expect(body.message).toMatch(/Forgot password/i);
    // The regression that started this: a fabricated provider name.
    expect(body.message).not.toMatch(/Google|Microsoft|Apple/);
    expect(body.provider).toBeUndefined();
  });

  it("an account with a linked provider is told which one, from the rows", async () => {
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-goog",
        email: "someone@gmail.com",
        password_hash: null,
        oauth_provider: null,
      },
      oauthRows: [{ provider: "google" }],
    });

    const err = await svc.validateUser("someone@gmail.com", "whatever").then(
      () => {
        throw new Error("expected validateUser to reject");
      },
      (e) => e,
    );

    const body = bodyOf(err);
    expect(body.code).toBe("OAUTH_ONLY");
    expect(body.providers).toEqual(["google"]);
    // Back-compat: the existing web client branches on the singular field.
    expect(body.provider).toBe("google");
    expect(body.message).toMatch(/Google/);
  });

  it("a linked-but-unusable provider says so instead of offering a dead button", async () => {
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-ms",
        email: "someone@hotmail.com",
        password_hash: null,
        oauth_provider: null,
      },
      oauthRows: [{ provider: "microsoft" }],
    });

    const err = await svc.validateUser("someone@hotmail.com", "whatever").then(
      () => {
        throw new Error("expected validateUser to reject");
      },
      (e) => e,
    );

    const body = bodyOf(err);
    expect(body.code).toBe("OAUTH_ONLY");
    expect(body.provider).toBe("microsoft");
    expect(body.message).toMatch(/isn't available on this page yet/i);
    expect(body.message).not.toMatch(/Google/);
  });

  it("a hotmail address with a linked GOOGLE account is told Google, not Microsoft", async () => {
    // Guards against anyone reintroducing a domain heuristic: the address
    // says Microsoft, the facts say Google, and the facts win.
    const { svc } = makeService({
      userByEmail: {
        user_id: "u-mix",
        email: "someone@hotmail.com",
        password_hash: null,
        oauth_provider: null,
      },
      oauthRows: [{ provider: "google" }],
    });

    const err = await svc.validateUser("someone@hotmail.com", "whatever").then(
      () => {
        throw new Error("expected validateUser to reject");
      },
      (e) => e,
    );

    const body = bodyOf(err);
    expect(body.provider).toBe("google");
    expect(body.message).not.toMatch(/Microsoft/);
  });
});

describe("POST /auth/sign-in-methods is rate limited", () => {
  // RateLimitGuard starts a 60s cleanup interval in its constructor and has no
  // teardown hook. Left running it keeps the Node event loop alive and jest
  // never exits — observed as a suite that "passes" and then hangs forever.
  const guards: RateLimitGuard[] = [];
  function makeGuard() {
    const g = new RateLimitGuard(new Reflector(), { get: jest.fn() } as any);
    guards.push(g);
    return g;
  }
  afterAll(() => {
    for (const g of guards) clearInterval((g as any).cleanupInterval);
  });

  /**
   * Drives the REAL guard with the REAL decorator metadata off the REAL
   * handler — not a hand-written config. If the `@RateLimit` decorator is
   * removed from the controller this falls back to the `/auth/` default and
   * the assertion on the 11th call changes, so the test cannot pass against a
   * missing decorator.
   */
  function contextFor(ip: string) {
    const res = { setHeader: jest.fn() };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { "x-forwarded-for": ip },
          url: "/api/v1/auth/sign-in-methods",
          route: { path: "/auth/sign-in-methods" },
        }),
        getResponse: () => res,
      }),
      getHandler: () => AuthController.prototype.signInMethods,
      getClass: () => AuthController,
    } as any;
    ctx.headers = res.setHeader;
    return ctx;
  }

  it("reads a tighter limit than the /auth/ default from the handler metadata", () => {
    const config = new Reflector().get(
      "rateLimit",
      AuthController.prototype.signInMethods,
    );
    expect(config).toBeDefined();
    expect(config.limit).toBe(10);
    expect(config.windowSeconds).toBe(600);
  });

  it("applies the 600s window, not the 60s /auth/ default", async () => {
    // Counting rejections alone cannot tell the decorator apart from the
    // default: DEFAULT_RATE_LIMITS.auth is also `limit: 10`, so an endpoint
    // that lost its decorator would still reject the 11th call and this suite
    // would happily report success. The WINDOW is what differs (600s vs 60s),
    // so assert on the reset header the guard actually emits.
    const guard = makeGuard();
    const ctx = contextFor("203.0.113.10");
    const before = Date.now();

    await guard.canActivate(ctx);

    const reset = ctx.headers.mock.calls.find(
      (c: any[]) => c[0] === "X-RateLimit-Reset",
    );
    expect(reset).toBeDefined();
    const windowSeconds = reset[1] - Math.floor(before / 1000);
    expect(windowSeconds).toBeGreaterThan(300);
    expect(windowSeconds).toBeLessThanOrEqual(601);
  });

  it("rejects the 11th request from one IP inside the window", async () => {
    const guard = makeGuard();
    const ctx = contextFor("203.0.113.7");

    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("does not penalise a different IP", async () => {
    const guard = makeGuard();

    for (let i = 0; i < 10; i++) {
      await guard.canActivate(contextFor("203.0.113.8"));
    }

    await expect(
      guard.canActivate(contextFor("203.0.113.9")),
    ).resolves.toBe(true);
  });
});

describe("the provider registry is the only place provider names live", () => {
  it("declares password, google, microsoft and apple", () => {
    expect(IDENTITY_PROVIDERS.map((p) => p.id)).toEqual([
      "password",
      "google",
      "microsoft",
      "apple",
    ]);
  });

  it("gives every disabled provider a reason, and every enabled one none", () => {
    for (const p of IDENTITY_PROVIDERS) {
      if (p.enabled) expect(p.disabledReason).toBeNull();
      else expect(typeof p.disabledReason).toBe("string");
    }
  });

  it("never enables an OAuth provider the database cannot store", () => {
    // user_oauth_accounts.provider CHECK admits only google|microsoft
    // (baseline_from_production.sql:5771). Enabling `apple` without widening
    // that constraint would fail at insert time during a real sign-in, not
    // here — so it fails here instead.
    const enabledOauth = IDENTITY_PROVIDERS.filter(
      (p) => p.kind === "oauth" && p.enabled,
    ).map((p) => p.id);

    for (const id of enabledOauth) {
      expect(STORABLE_OAUTH_PROVIDER_IDS).toContain(id);
    }
  });

  it("no provider name is inferred from users.oauth_provider in auth.service.ts", () => {
    const raw = fs.readFileSync(path.join(__dirname, "auth.service.ts"), "utf8");

    // Comments are stripped FIRST. A grep for a removed pattern matches the
    // comment explaining its removal — this test failed on its own first run
    // for exactly that reason, which is the failure shape CLAUDE.md §5b names.
    const src = stripComments(raw);

    // Sanity: the stripper must not have eaten the file. A guard that checks
    // an empty string passes forever.
    expect(src.length).toBeGreaterThan(raw.length / 2);
    expect(src).toContain("async validateUser");

    // The pattern that caused the bug: reading the legacy column and comparing
    // it to a literal provider name to decide what to TELL the user. Strategy
    // dispatch on an explicit `provider` argument (`linkOAuthProvider` picking
    // a token verifier) is a different thing and stays — that function is told
    // which provider it is handling, it does not guess.
    const inferencePattern = /oauth_provider\s*===\s*["'](google|microsoft)["']/g;
    expect(src.match(inferencePattern)).toBeNull();
  });
});
