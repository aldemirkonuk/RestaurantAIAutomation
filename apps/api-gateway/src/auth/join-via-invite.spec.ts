import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * `POST /auth/join` — account takeover, closed 2026-08-26.
 *
 * `JoinViaInviteDto` requires a password, but it was consumed only by the
 * NEW-user branch. When the supplied email matched an existing account, the
 * code assigned `user = existingUser` and fell through to token generation
 * with nothing verified. The route is `@Public()`, so any holder of one unused
 * invite code could type someone else's email — the owner's, say — and receive
 * a working session for that account.
 *
 * Joining an ADDITIONAL restaurant with an existing account is a legitimate
 * flow and still works; it now costs that account's own password.
 */

const ISSUER = "issuer-1";
const HOUSE = "rest-1";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

let lastDb: ReturnType<typeof makeStubDb>;

function makeService(opts: {
  invite?: any;
  existingUser?: any;
  /** The issuer's own active access row. Defaults to a standing owner — the
   * account-takeover cases below are about the PASSWORD check, not this
   * newer one (item 5, and Path A's own copy of it, round 2 2026-09-19), so
   * every case needs a legitimate issuer unless it says otherwise. */
  issuerAccess?: any;
  /** Every users row, for the lookup cases (QA r17 gap 1). */
  users?: any[];
  usersReadFails?: boolean;
}) {
  const invite = opts.invite ?? {
    id: "inv-1",
    code: "INVITE",
    restaurant_id: HOUSE,
    invited_by: ISSUER,
    role: "staff",
    email: null,
    used_at: null,
    expires_at: FUTURE,
  };
  const issuerAccess =
    opts.issuerAccess === undefined
      ? {
          user_id: ISSUER,
          restaurant_id: HOUSE,
          role: "owner",
          is_active: true,
        }
      : opts.issuerAccess;

  // The real, filter-applying stub (not a chain that replays one canned
  // answer for every query against a table): `joinViaInvite` now makes TWO
  // different `user_restaurant_access` reads in the existing-user branch —
  // the issuer's own standing, and whether the JOINER already has access at
  // this house — and they must be able to answer differently, which a
  // one-result-per-table stub cannot do.
  const db = makeStubDb({
    organization_invites: [invite],
    users: opts.users ?? (opts.existingUser ? [opts.existingUser] : []),
    user_restaurant_access: issuerAccess ? [issuerAccess] : [],
    organization_members: [],
  }, opts.usersReadFails ? { "users:select": { message: "down" } } : {});
  lastDb = db;

  // Order matters: (jwtService, configService, databaseService,
  // tokenBlacklistService, gmailService) — auth.service.ts:58-64.
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    {
      get: (k: string) =>
        k === "JWT_SECRET" ? "test-secret-value" : undefined,
    } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  // The takeover is entirely upstream of token minting and membership
  // bookkeeping; stubbing them keeps the test on the branch under scrutiny.
  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).claimTeamMemberFromInvite = jest
    .fn()
    .mockResolvedValue(undefined);
  stubDbOf.set(svc, db);
  return svc;
}

const stubDbOf = new WeakMap<AuthService, ReturnType<typeof makeStubDb>>();

describe("AuthService#joinViaInvite — existing account branch", () => {
  const email = "owner@restaurant.com";

  it("refuses to hand over an existing account on a wrong password", async () => {
    const existingUser = {
      user_id: "victim",
      email,
      name: "Owner",
      password_hash: await bcrypt.hash("the-real-password", 10),
    };
    const svc = makeService({ existingUser });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Attacker",
        password: "not-the-password",
      } as any),
    ).rejects.toThrow(UnauthorizedException);

    // The decisive assertion: no session was minted for the victim.
    expect((svc as any).generateTokens).not.toHaveBeenCalled();
  });

  it("refuses when the existing account has no usable password hash", async () => {
    // OAuth-only accounts have no local password. Comparing against an empty
    // or absent hash must fail closed rather than pass vacuously.
    const svc = makeService({
      existingUser: { user_id: "victim", email, password_hash: null },
    });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Attacker",
        password: "anything",
      } as any),
    ).rejects.toThrow(UnauthorizedException);
    expect((svc as any).generateTokens).not.toHaveBeenCalled();
  });

  it("still lets the real owner join an additional restaurant", async () => {
    const password = "the-real-password";
    const svc = makeService({
      existingUser: {
        user_id: "owner",
        email,
        name: "Owner",
        password_hash: await bcrypt.hash(password, 10),
        // A real owner's address is proved. Since ADR 0229 fork 8 (item 73)
        // an unverified account's password lapses seven days after
        // registration, at this door too (unproven-address.spec.ts).
        email_verified: true,
      },
    });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Owner",
        password,
      } as any),
    ).resolves.toEqual({
      accessToken: "a",
      refreshToken: "r",
      // A verified account's membership is granted at once (ADR 0229 fork 13
      // holds only a join whose address is unproven).
      membershipHeld: false,
    });
    expect((svc as any).generateTokens).toHaveBeenCalled();
  });
});

/**
 * QA round 11, R11-03: the invite is consumed before the password is checked,
 * and a wrong password used to leave it consumed. One typo, or anyone who
 * holds the code and types a member's address, spent the code for the person
 * it was made for.
 *
 * PRE-FIX PROOF: without the give-back in the `!passwordMatches` branch,
 * `used_at` stays set and the real member's join is refused as "invalid,
 * expired, or already used" -- both cases fail.
 */
describe("AuthService#joinViaInvite — a wrong password gives the invite back (R11-03)", () => {
  const email = "member@restaurant.com";

  it("leaves the invite unused after a wrong password", async () => {
    const existingUser = {
      user_id: "member",
      email,
      name: "Member",
      password_hash: await bcrypt.hash("the-real-password", 10),
    };
    const svc = makeService({ existingUser });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Member",
        password: "a-typo",
      } as any),
    ).rejects.toThrow(UnauthorizedException);

    const invite = stubDbOf.get(svc)!.tables.organization_invites[0];
    expect(invite.used_at).toBeNull();
    expect(invite.used_by_email).toBeNull();
  });

  it("so the member can still join with the right password afterwards", async () => {
    const existingUser = {
      user_id: "member",
      email,
      name: "Member",
      password_hash: await bcrypt.hash("the-real-password", 10),
      email_verified: true,
    };
    const svc = makeService({ existingUser });

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Member",
        password: "a-typo",
      } as any),
    ).rejects.toThrow(UnauthorizedException);

    await expect(
      svc.joinViaInvite({
        code: "INVITE",
        email,
        name: "Member",
        password: "the-real-password",
      } as any),
    ).resolves.toMatchObject({ accessToken: "a" });
  });
});

/**
 * QA round 11, R11-09 (its side note): `acceptInviteAsExistingUser` read the
 * accepting account without checking the read, so a failed read went on to
 * spend the invite with no `used_by_email`.
 *
 * PRE-FIX PROOF: without the `actorErr` check the call goes on, the invite is
 * spent, and the case fails on both assertions.
 */
describe("AuthService#acceptInviteAsExistingUser — an unreadable account spends nothing", () => {
  it("refuses before the invite is touched", async () => {
    const invite = {
      id: "inv-1",
      code: "INVITE",
      restaurant_id: HOUSE,
      organization_id: "org-1",
      invited_by: ISSUER,
      role: "staff",
      used_at: null,
      expires_at: FUTURE,
    };
    const db = makeStubDb(
      {
        organization_invites: [invite],
        users: [{ user_id: "member", email: "member@restaurant.com" }],
        user_restaurant_access: [
          { user_id: ISSUER, restaurant_id: HOUSE, role: "owner", is_active: true },
        ],
        organization_members: [],
      },
      { "users:select": { message: "connection reset" } },
    );
    const svc = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false } as any,
      { sendEmail: async () => undefined } as any,
    );

    await expect(
      svc.acceptInviteAsExistingUser("member", "INVITE"),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(db.tables.organization_invites[0].used_at).toBeNull();
    expect(db.tables.user_restaurant_access).toHaveLength(1);
  });
});

describe("AuthService#joinViaInvite — the shared lookup (QA r17 gap 1)", () => {
  const held = async (user_id: string, email: string) => ({
    user_id,
    email,
    email_folded: email.toLowerCase(),
    name: "Chef",
    password_hash: await bcrypt.hash("pw", 4),
    email_verified: true,
  });
  const join = (svc: AuthService, email: string) =>
    svc.joinViaInvite({ code: "INVITE", email, name: "Chef", password: "pw" } as any);

  it("a held row typed in another case joins as that account, no twin", async () => {
    const svc = makeService({ users: [await held("chef", "Chef@Bistro.com")] });
    await join(svc, "chef@bistro.com");
    // toHaveLength, not toEqual on ids: toEqual skips an inserted row's
    // undefined user_id, which hid the twin this spec is about.
    expect(lastDb.tables.users).toHaveLength(1);
    expect(lastDb.opsOn("users", "insert")).toEqual([]);
  });

  it("held twins: refused, nothing inserted, the invite given back", async () => {
    const svc = makeService({
      users: [await held("a", "Chef@Bistro.com"), await held("b", "CHEF@bistro.com")],
    });
    await expect(join(svc, "chef@bistro.com")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(lastDb.tables.users).toHaveLength(2);
    expect(lastDb.tables.organization_invites[0].used_at).toBeNull();
  });

  it("a failed users read is a 503, not a new account, and the invite is given back", async () => {
    const svc = makeService({ usersReadFails: true });
    await expect(join(svc, "new@bistro.com")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(lastDb.tables.users).toHaveLength(0);
    expect(lastDb.tables.organization_invites[0].used_at).toBeNull();
  });
});
