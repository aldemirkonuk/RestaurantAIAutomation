import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";
import {
  asciiFoldAddress,
  findUserBySignInAddress,
  SignInCodesService,
} from "../passkeys/sign-in-codes.service";
import { FakeDb } from "../passkeys/testing/passkey-harness";

/**
 * Every door finds the account the way registration now stores it (QA round
 * 13 on PR #853; QA round 11 R11-01 and R11-02).
 *
 * Registration folds the address (`chef@bistro.com`), but password sign-in
 * looked it up exactly as typed: an owner who typed `Chef@Bistro.com` at
 * sign-up and again at /login got "Invalid credentials". And the backfill
 * holds two kinds of existing row unfolded -- a row whose lower-case twin
 * exists, and a row with a non-ASCII letter -- which the folded lookup alone
 * can never reach. `findUserBySignInAddress` reads the address as typed, then
 * folded, then through the SQL fold (`users.email_folded`, a computed field
 * the stub cannot run, so the fixture carries the value the SQL would compute
 * -- the SQL side is proved by the migration's own supabase/tests file).
 *
 * PRE-FIX PROOF: with auth.service.ts and sign-in-codes.service.ts at the PR's
 * previous head (32e406a54), this file does not compile (no
 * findUserBySignInAddress / asciiFoldAddress), and the four validateUser
 * cases fail on their own: "Invalid credentials" for the mixed-case and
 * padded spellings and the held non-ASCII row, and the held twin's owner
 * meets the same refusal (the folded read finds the twin).
 */

const PASSWORD = "the-right-password";
const OTHER = "somebody-elses-password";
const HASH = bcrypt.hashSync(PASSWORD, 4);
const OTHER_HASH = bcrypt.hashSync(OTHER, 4);

/** What `public.sign_in_address_fold` returns, for the fixture's computed field. */
const sqlFold = (email: string) => asciiFoldAddress(email.trim());

function account(user_id: string, email: string, password_hash = HASH) {
  return {
    user_id,
    email,
    email_folded: sqlFold(email),
    name: user_id,
    password_hash,
    email_verified: true,
    created_at: new Date().toISOString(),
    session_version: 0,
  };
}

function service(users: Record<string, unknown>[]) {
  const db = makeStubDb({ users, password_resets: [] });
  const mail = { sendEmail: jest.fn(async () => ({ success: true })) };
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false, blacklistToken: async () => undefined } as any,
    mail as any,
  );
  return { db, svc, mail };
}

describe("password sign-in finds the folded row (R11-02, the #853 regression)", () => {
  it("Chef@Bistro.com signs in to the row registration stored as chef@bistro.com", async () => {
    const { svc } = service([account("owner", "chef@bistro.com")]);
    await expect(svc.validateUser("Chef@Bistro.com", PASSWORD)).resolves.toMatchObject({
      user_id: "owner",
    });
  });

  it("padded and upper-case spellings sign in too", async () => {
    const { svc } = service([account("owner", "chef@bistro.com")]);
    for (const typed of [" chef@bistro.com", "CHEF@BISTRO.COM ", "\tChef@Bistro.Com"]) {
      await expect(svc.validateUser(typed, PASSWORD)).resolves.toMatchObject({
        user_id: "owner",
      });
    }
  });

  it("a wrong password is still the one refusal", async () => {
    const { svc } = service([account("owner", "chef@bistro.com")]);
    await expect(svc.validateUser("Chef@Bistro.com", OTHER)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe("rows the backfill held stay reachable (R11-01, existing owners)", () => {
  it("a held twin's owner signs in by their own spelling, ahead of the lower-case twin", async () => {
    const { svc } = service([
      account("real-owner", "Victim@Gmail.com"),
      account("squatter", "victim@gmail.com", OTHER_HASH),
    ]);
    await expect(svc.validateUser("Victim@Gmail.com", PASSWORD)).resolves.toMatchObject({
      user_id: "real-owner",
    });
    // The lower-case row is still its own holder's.
    await expect(svc.validateUser("victim@gmail.com", OTHER)).resolves.toMatchObject({
      user_id: "squatter",
    });
  });

  it("a held non-ASCII row is found typed in another ASCII case, through the SQL fold", async () => {
    const { svc } = service([account("ilker", "İLKER@X.com")]);
    await expect(svc.validateUser("İlker@x.COM", PASSWORD)).resolves.toMatchObject({
      user_id: "ilker",
    });
    await expect(svc.validateUser("İLKER@X.com", PASSWORD)).resolves.toMatchObject({
      user_id: "ilker",
    });
  });

  it("a password reset for a held row typed in another case is filed for that account", async () => {
    const { svc, db } = service([account("ilker", "İLKER@X.com")]);
    await expect(svc.requestPasswordReset("İlker@x.com", null)).resolves.toEqual({
      sent: true,
    });
    expect(db.tables.password_resets).toHaveLength(1);
    expect(db.tables.password_resets[0].user_id).toBe("ilker");
  });

  it("two unfolded twins: an ambiguous spelling names nobody, and registration refuses it", async () => {
    const { svc } = service([
      account("twin-a", "Twin@Example.com"),
      account("twin-b", "TWIN@example.com"),
    ]);
    await expect(svc.validateUser("twin@example.com", PASSWORD)).rejects.toThrow(
      UnauthorizedException,
    );
    // Each twin still answers to its own spelling.
    await expect(svc.validateUser("TWIN@example.com", PASSWORD)).resolves.toMatchObject({
      user_id: "twin-b",
    });
    // No third account is written beside them.
    await expect(svc.checkEmailExists("twin@example.com")).resolves.toBe(true);
  });

  it("registration refuses an address a held row answers to under the fold", async () => {
    const { svc } = service([account("ilker", "İLKER@X.com")]);
    await expect(svc.checkEmailExists("İlker@X.COM")).resolves.toBe(true);
    await expect(svc.checkEmailExists("someone-else@x.com")).resolves.toBe(false);
  });
});

describe("findUserBySignInAddress", () => {
  it("reads as typed, then folded, then the SQL fold -- and stops at the first hit", async () => {
    const db = makeStubDb({ users: [account("owner", "chef@bistro.com")] });
    const hit = await findUserBySignInAddress(
      () => (db.supabase as any).from("users").select("user_id"),
      "Chef@Bistro.com",
    );
    expect(hit).toMatchObject({ user: { user_id: "owner" }, error: null, ambiguous: false });
    const reads = db.opsOn("users", "select");
    expect(reads.length).toBe(2); // as typed (miss), folded (hit); no third read
  });

  it("a failed read is an error, never 'no account'", async () => {
    const db = makeStubDb(
      { users: [account("owner", "chef@bistro.com")] },
      { "users:select": { message: "connection reset" } },
    );
    const got = await findUserBySignInAddress(
      () => (db.supabase as any).from("users").select("user_id"),
      "chef@bistro.com",
    );
    expect(got.user).toBeNull();
    expect(got.error).toEqual({ message: "connection reset" });
  });

  it("the TypeScript fold is trim + A-Z only, like the SQL one", () => {
    expect(asciiFoldAddress("MiXeD.I@Example.COM")).toBe("mixed.i@example.com");
    // Non-ASCII letters are left alone on both sides (JS toLowerCase is not).
    expect(asciiFoldAddress("İLKER@X.com")).toBe("İlker@x.com");
  });
});

describe("the emailed sign-in code finds the row by the shared lookup (R11-02)", () => {
  async function issue(stored: string, typed: string) {
    const db = new FakeDb();
    db.tables.users.push({ user_id: "owner", name: "Chef", email: stored });
    const mail = { sendEmail: jest.fn(async () => ({ success: true })) };
    const codes = new SignInCodesService({ client: db } as any, mail as any);
    await codes.issueForSignIn(typed, "203.0.113.9");
    await new Promise((r) => setImmediate(r));
    return { db, mail };
  }

  it("a row stored unfolded is found by the address as typed, and the code goes to the stored address", async () => {
    const { db, mail } = await issue("Chef@Bistro.com", "Chef@Bistro.com");
    expect(db.tables.sign_in_codes).toHaveLength(1);
    expect(db.tables.sign_in_codes[0].user_id).toBe("owner");
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect((mail.sendEmail.mock.calls[0] as any)[0].to).toEqual(["Chef@Bistro.com"]);
  });

  it("a folded row is found typed in another case", async () => {
    const { mail } = await issue("chef@bistro.com", "CHEF@bistro.com");
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect((mail.sendEmail.mock.calls[0] as any)[0].to).toEqual(["chef@bistro.com"]);
  });
});

describe("reset, sign-in-methods and the Google link find the row by the shared lookup (R11-02)", () => {
  it("a password reset typed exactly as an unfolded row is stored is filed for that account (read 1)", async () => {
    const { svc, db } = service([account("owner", "Chef@Bistro.com")]);
    await expect(svc.requestPasswordReset("Chef@Bistro.com", null)).resolves.toEqual({
      sent: true,
    });
    expect(db.tables.password_resets).toHaveLength(1);
    expect(db.tables.password_resets[0].user_id).toBe("owner");
  });

  it("R1: reset mails the stored address", async () => {
    const { svc, db, mail } = service([account("owner", "Chef@Bistro.com")]);
    await svc.requestPasswordReset("Chef@Bistro.com", null);
    expect((mail.sendEmail.mock.calls[0] as any)[0].to).toEqual(["Chef@Bistro.com"]);
    expect(db.tables.password_resets[0].email).toBe("Chef@Bistro.com");
  });

  it("R9: a twin's reset does not throttle", async () => {
    const { svc, db, mail } = service([account("owner", "Chef@Bistro.com"), account("twin", "chef@bistro.com")]);
    db.tables.password_resets.push({ user_id: "twin", email: "chef@bistro.com", created_at: new Date().toISOString() });
    await svc.requestPasswordReset("Chef@Bistro.com", null);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("sign-in-methods finds an unfolded row typed exactly (read 1) and reports its password", async () => {
    const { svc } = service([account("owner", "Chef@Bistro.com")]);
    const got = await svc.resolveSignInMethods("Chef@Bistro.com");
    expect(got.methods.map((m: any) => m.id)).toContain("password");
  });

  it("sign-in-methods on a failed users read is 503, never a described empty account", async () => {
    const db = makeStubDb({ users: [] }, { "users:select": { message: "connection reset" } });
    const svc = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false, blacklistToken: async () => undefined } as any,
      { sendEmail: jest.fn() } as any,
    );
    await expect(svc.resolveSignInMethods("chef@bistro.com")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("the Google link on a failed users read is 503 and writes no account", async () => {
    const db = makeStubDb({ users: [] }, { "users:select": { message: "connection reset" } });
    const svc = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false, blacklistToken: async () => undefined } as any,
      { sendEmail: jest.fn() } as any,
    );
    await expect(
      svc.findOrCreateOAuthUser({
        provider: "google",
        providerId: "g-1",
        email: "Chef@Bistro.com",
        name: "Chef",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.tables.users).toHaveLength(0);
  });
});
