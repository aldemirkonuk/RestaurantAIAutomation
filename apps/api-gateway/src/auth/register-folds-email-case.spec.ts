import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";
import { SignInCodesService } from "../passkeys/sign-in-codes.service";
import { FakeDb } from "../passkeys/testing/passkey-harness";

/**
 * An owner who registers with a capital letter can still be found (QA round
 * 11, R11-01, BLOCKER).
 *
 * `registerRestaurant` stored the address exactly as typed, while every door
 * that looks an account up folds it first: `requestPasswordReset`
 * (`email.trim().toLowerCase()`), the emailed sign-in code (`normalizeEmail`),
 * Google, `/sign-in-methods`. So an owner who signed up as `Chef@Bistro.com`
 * had a row that "forgot password" and "email me a code" both answered for
 * with silence, and the house stayed reachable only until the seven-day
 * refresh token lapsed. These specs drive the real register, then the real
 * reset and the real sign-in-code issue against the row it wrote.
 *
 * PRE-FIX PROOF: with `const email = normalizeEmail(dto.email)` reverted in
 * `registerRestaurant`, the stored row reads `Chef@Bistro.com`, the reset mail
 * count is 0 and `issueForSignIn` sends nothing -- all four cases fail.
 */

const OWNER: RegisterRestaurantDto = {
  name: "Chef",
  email: "  Chef@Bistro.com ",
  password: "a-long-enough-password",
  restaurantName: "Bistro",
  address: "1 Main Street",
  city: "East Lansing",
  country: "United States",
};

async function register(tables: Record<string, any[]> = {}) {
  const db = makeStubDb({ users: [], password_resets: [], ...tables });
  const mail = { sendEmail: jest.fn(async () => ({ success: true })) };
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false, blacklistToken: async () => undefined } as any,
    {
      ...mail,
      sendOnboardingEmail: jest.fn(async () => undefined),
    } as any,
  );
  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).queueEmailVerification = jest.fn().mockResolvedValue(undefined);
  return { db, svc, mail };
}

/** Register OWNER; the stub does not run `users.user_id DEFAULT uuid_generate_v4()`, so stand in for it. */
async function registered() {
  const ctx = await register();
  await ctx.svc.registerRestaurant(OWNER);
  for (const u of ctx.db.tables.users) u.user_id ??= "owner-1";
  return ctx;
}

describe("registerRestaurant folds the address it stores (R11-01)", () => {
  it("writes the trimmed, lower-case address, and mails it there", async () => {
    const { db, svc } = await register();

    await svc.registerRestaurant(OWNER);

    const users = db.tables.users;
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("chef@bistro.com");
    // The verification mail goes to the folded address too.
    expect((svc as any).queueEmailVerification.mock.calls[0][1]).toBe(
      "chef@bistro.com",
    );
  });

  it("refuses a case-variant of an address that already has an account", async () => {
    const { db, svc } = await register({
      users: [{ user_id: "victim", email: "chef@bistro.com", name: "V" }],
    });

    await expect(svc.registerRestaurant(OWNER)).rejects.toThrow(
      "Email already registered",
    );
    expect(db.tables.users).toHaveLength(1);
  });

  it("the owner it wrote can ask for a password reset", async () => {
    const { db, svc, mail } = await registered();

    // The reset form, typed the way the owner typed it at sign-up.
    await svc.requestPasswordReset("Chef@Bistro.com", null);
    // The account work runs after the answer (#925): let it finish.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

    expect(db.tables.password_resets).toHaveLength(1);
    expect(db.tables.password_resets[0].user_id).toBe(
      db.tables.users[0].user_id,
    );
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect((mail.sendEmail.mock.calls[0] as any)[0].to).toEqual([
      "chef@bistro.com",
    ]);
  });

  it("the owner it wrote can be emailed a sign-in code", async () => {
    const { db } = await registered();

    const codesDb = new FakeDb();
    codesDb.tables.users.push(...db.tables.users.map((u) => ({ ...u })));
    const codeMail = { sendEmail: jest.fn(async () => ({ success: true })) };
    const codes = new SignInCodesService(
      { client: codesDb } as any,
      codeMail as any,
    );

    await codes.issueForSignIn("Chef@Bistro.com", "203.0.113.9");
    await new Promise((r) => setImmediate(r));

    expect(codesDb.tables.sign_in_codes).toHaveLength(1);
    expect(codesDb.tables.sign_in_codes[0].user_id).toBe(
      db.tables.users[0].user_id,
    );
    expect(codeMail.sendEmail).toHaveBeenCalledTimes(1);
  });
});
