import { UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";
import { findUserBySignInAddress } from "../passkeys/sign-in-codes.service";

/**
 * Password sign-in finds the account the way registration now stores it (QA
 * round 13 on PR #853; QA round 11 R11-02).
 *
 * Registration folds the address (`chef@bistro.com`), but password sign-in
 * looked it up exactly as typed: an owner who typed `Chef@Bistro.com` at
 * sign-up and again at /login got "Invalid credentials".
 * `findUserBySignInAddress` reads the address as typed, then folded.
 *
 * PRE-FIX PROOF: with auth.service.ts at the PR's previous head (32e406a54),
 * this file does not compile (no findUserBySignInAddress), and the validateUser
 * cases fail on their own: "Invalid credentials" for the mixed-case and padded
 * spellings.
 */

const PASSWORD = "the-right-password";
const OTHER = "somebody-elses-password";
const HASH = bcrypt.hashSync(PASSWORD, 4);

function account(user_id: string, email: string, password_hash = HASH) {
  return {
    user_id,
    email,
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

describe("findUserBySignInAddress", () => {
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
});
