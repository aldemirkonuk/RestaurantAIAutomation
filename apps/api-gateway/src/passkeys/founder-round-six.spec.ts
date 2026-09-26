import "reflect-metadata";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService } from "../auth/auth.service";
import { makeStubDb, StubDb } from "../team/testing/supabase-stub";
import { PASSKEY_AUDIT_ACTIONS, PasskeysService } from "./passkeys.service";
import { SignInCodesService } from "./sign-in-codes.service";
import { FakeDb, SoftAuthenticator } from "./testing/passkey-harness";

/**
 * The founder, 2026-09-26, round 6, item 37 (ADR 0229), verbatim: "Passkeys
 * (ADR 0229): password reset RETIRES every passkey (kept as revoked, not
 * deleted) + every new passkey emails the account; staff may enrol passkeys
 * too; emailed-code sign-in marks email verified."
 *
 * Round 7, item 44, the same day, his words: "do industry mimic both for
 * password RESET retires every passkey, and password CHANGE while signed in do
 * same" -- follow industry practice for both. Industry (Google, Apple,
 * Microsoft, GitHub, Okta; NIST SP 800-63B-4 §4.2 / §4.1.2.1) keeps passkeys
 * across a password reset AND a change, and notifies the account. So part (1)
 * below is round 7's: a reset and a change keep every passkey and mail the
 * account the list of passkeys that still sign it in. "No-house enrolment:
 * passkey belongs to the person (industry) → allowed" is part (3).
 *
 * Each answer is driven through the real code: the real `AuthService`
 * (`resetPassword`, `issueSessionForVerifiedSignIn`), the real
 * `PasskeysService` against a software authenticator verified by the real
 * `@simplewebauthn/server`, and an in-memory database.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOUSE = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://mudavym.com";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const nowSec = () => Math.floor(Date.now() / 1000);

const OLD_PASSWORD = "the old password";
const OLD_HASH = bcrypt.hashSync(OLD_PASSWORD, 4);

function world() {
  const db = new FakeDb();
  db.tables.users.push(
    {
      user_id: USER,
      email: "m@example.com",
      name: "Mira",
      password_hash: OLD_HASH,
    },
    {
      user_id: OTHER,
      email: "o@example.com",
      name: "Onur",
      password_hash: "$2b$04$old",
    },
  );
  db.tables.password_resets = [
    {
      id: "r1",
      token: TOKEN,
      user_id: USER,
      email: "m@example.com",
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      used_at: null,
    },
  ];
  const codeMail = { sendEmail: jest.fn(async () => ({ success: true })) };
  const enrolMail = {
    sendEmail: jest.fn(
      async (_m: { to: string[]; subject: string; html: string }) =>
        ({ success: true }) as { success: boolean; error?: string },
    ),
  };
  const codes = new SignInCodesService({ client: db } as any, codeMail as any);
  const passkeys = new PasskeysService(
    { client: db } as any,
    codes,
    enrolMail as any,
  );
  // The account mail AuthService sends ("your password was reset/changed").
  const authMail = {
    sendEmail: jest.fn(
      async (_m: { to: string[]; subject: string; html: string }) =>
        ({ success: true }) as { success: boolean; error?: string },
    ),
  };
  const auth = new AuthService(
    new JwtService({}),
    { get: () => undefined } as any,
    { supabase: db, client: db } as any,
    { isBlacklisted: async () => false } as any,
    authMail as any,
  );
  return { db, passkeys, auth, enrolMail, authMail };
}

async function enrol(
  passkeys: PasskeysService,
  device: SoftAuthenticator,
  userId = USER,
  nickname = "Phone",
) {
  const { challengeId, options } = await passkeys.startRegistration(
    userId,
    HOUSE,
    ORIGIN,
    nowSec(),
    undefined,
  );
  return passkeys.finishRegistration(
    userId,
    HOUSE,
    ORIGIN,
    challengeId,
    device.register(options, ORIGIN),
    nickname,
  );
}

async function signIn(passkeys: PasskeysService, device: SoftAuthenticator) {
  const { challengeId, options } = await passkeys.startSignIn(ORIGIN);
  return passkeys.finishSignIn(
    ORIGIN,
    challengeId,
    device.assert(options, ORIGIN, "mudavym.com", true),
  );
}

describe("round 7 (1): a password reset or change keeps every passkey and tells the account", () => {
  it("a reset keeps every passkey live -- none revoked, all still sign in -- and spends the link", async () => {
    const { db, passkeys, auth } = world();
    const phone = new SoftAuthenticator();
    const laptop = new SoftAuthenticator();
    await enrol(passkeys, phone, USER, "Phone");
    await enrol(passkeys, laptop, USER, "Laptop");

    await auth.resetPassword(TOKEN, "a brand new password");

    const mine = db.tables.user_passkeys.filter((r) => r.user_id === USER);
    expect(mine).toHaveLength(2);
    for (const row of mine) {
      expect(row.revoked_at).toBeNull();
      expect(row.revoked_by ?? null).toBeNull();
    }
    expect(
      db.tables.system_audit_log.filter(
        (r) => r.action === PASSKEY_AUDIT_ACTIONS.revoked,
      ),
    ).toHaveLength(0);
    await expect(signIn(passkeys, phone)).resolves.toMatchObject({
      userId: USER,
    });
    await expect(signIn(passkeys, laptop)).resolves.toMatchObject({
      userId: USER,
    });
    expect(db.tables.password_resets[0].used_at).not.toBeNull();
  });

  it("a reset mails the account's own address the passkeys that still sign it in, with no secret and no link", async () => {
    const { db, passkeys, auth, authMail } = world();
    await enrol(passkeys, new SoftAuthenticator(), USER, "Phone <i>");
    await enrol(passkeys, new SoftAuthenticator(), USER, "Laptop");
    const removed = await enrol(
      passkeys,
      new SoftAuthenticator(),
      USER,
      "Gone",
    );
    await passkeys.revoke(USER, HOUSE, removed.passkey.id);
    // Someone else's passkey is never listed.
    await enrol(passkeys, new SoftAuthenticator(), OTHER, "Theirs");

    await auth.resetPassword(TOKEN, "a brand new password");

    expect(authMail.sendEmail).toHaveBeenCalledTimes(1);
    const mail = authMail.sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(["m@example.com"]);
    expect(mail.subject).toBe("Your Mudavym password was reset");
    expect(mail.html).toContain("These 2 passkeys still sign you in");
    expect(mail.html).toContain("Phone &lt;i&gt;"); // escaped, not markup
    expect(mail.html).toContain("Laptop");
    expect(mail.html).not.toContain("Gone"); // a removed one is not "still"
    expect(mail.html).not.toContain("Theirs");
    for (const row of db.tables.user_passkeys) {
      expect(mail.html).not.toContain(row.credential_id);
      expect(mail.html).not.toContain(row.public_key);
    }
    expect(mail.html).not.toContain(TOKEN);
    expect(mail.html).not.toMatch(/href="https?:\/\/[^"]*mudavym/);
  });

  it("a change while signed in keeps every passkey too, and mails the same review", async () => {
    const { db, passkeys, auth, authMail } = world();
    const phone = new SoftAuthenticator();
    await enrol(passkeys, phone, USER, "Phone");

    await auth.changePassword(USER, OLD_PASSWORD, "a brand new password");

    expect(db.tables.user_passkeys[0].revoked_at).toBeNull();
    await expect(signIn(passkeys, phone)).resolves.toMatchObject({
      userId: USER,
    });
    expect(authMail.sendEmail).toHaveBeenCalledTimes(1);
    const mail = authMail.sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(["m@example.com"]);
    expect(mail.subject).toBe("Your Mudavym password was changed");
    expect(mail.html).toContain("This passkey still signs you in");
    expect(mail.html).toContain("Phone");
  });

  it("a wrong current password changes nothing and mails nothing", async () => {
    const { auth, authMail } = world();
    await expect(
      auth.changePassword(USER, "not the password", "a brand new password"),
    ).rejects.toThrow(/incorrect/);
    expect(authMail.sendEmail).not.toHaveBeenCalled();
  });

  it("with no passkeys, the mail says there are none", async () => {
    const { auth, authMail } = world();
    await auth.resetPassword(TOKEN, "a brand new password");
    expect(authMail.sendEmail.mock.calls[0][0].html).toContain(
      "There are no passkeys on your account.",
    );
  });

  it("when the passkeys cannot be read, the mail says so instead of claiming there are none, and the reset still finishes", async () => {
    const { db, passkeys, auth, authMail } = world();
    await enrol(passkeys, new SoftAuthenticator(), USER, "Phone");
    db.failReadOn = "user_passkeys";
    await auth.resetPassword(TOKEN, "a brand new password");
    const html = authMail.sendEmail.mock.calls[0][0].html;
    expect(html).not.toContain("There are no passkeys");
    expect(html).toContain("could not read them just now");
    expect(db.tables.password_resets[0].used_at).not.toBeNull();
  });

  it("a notice that cannot be sent never undoes or fails the reset", async () => {
    const { db, auth, authMail } = world();
    authMail.sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    await expect(
      auth.resetPassword(TOKEN, "a brand new password"),
    ).resolves.toBeUndefined();
    expect(db.tables.password_resets[0].used_at).not.toBeNull();
    const user = db.tables.users.find((u) => u.user_id === USER)!;
    expect(user.password_hash).not.toBe(OLD_HASH);
  });
});

describe("round 6 (2): every new passkey emails the account", () => {
  it("mails the account's own address once per enrolment, with no secret in it", async () => {
    const { db, passkeys, enrolMail } = world();
    const r = await enrol(passkeys, new SoftAuthenticator(), USER, "Work <b>");
    expect(r.mailed).toBe(true);
    expect(enrolMail.sendEmail).toHaveBeenCalledTimes(1);
    const mail = enrolMail.sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(["m@example.com"]);
    expect(mail.subject).toBe("A passkey was added to your Mudavym account");
    expect(mail.html).toContain("Work &lt;b&gt;"); // escaped, not markup
    expect(mail.html).toContain("mudavym.com");
    const row = db.tables.user_passkeys[0];
    expect(mail.html).not.toContain(row.credential_id);
    expect(mail.html).not.toContain(row.public_key);
    expect(mail.html).not.toContain(row.id);
    expect(mail.html).not.toMatch(/href="https?:\/\/[^"]*mudavym/);
  });

  it("a mail that fails does not undo the passkey, and the receipt says it was not sent", async () => {
    const { db, passkeys, enrolMail } = world();
    enrolMail.sendEmail.mockResolvedValueOnce({
      success: false,
      error: "smtp down",
    });
    const r = await enrol(passkeys, new SoftAuthenticator());
    expect(r.mailed).toBe(false);
    expect(db.tables.user_passkeys).toHaveLength(1);
    expect(r.audited).toBe(true);
  });

  it("removing a passkey sends no mail", async () => {
    const { passkeys, enrolMail } = world();
    const r = await enrol(passkeys, new SoftAuthenticator());
    enrolMail.sendEmail.mockClear();
    await passkeys.revoke(USER, HOUSE, r.passkey.id);
    expect(enrolMail.sendEmail).not.toHaveBeenCalled();
  });
});

describe("round 6 (3) + round 7: a passkey is the person's -- staff, and people with no house, enrol", () => {
  it("a person whose session names no house enrols, is mailed, and then signs in with it", async () => {
    const { db, passkeys, enrolMail } = world();
    const device = new SoftAuthenticator();
    const { challengeId, options } = await passkeys.startRegistration(
      USER,
      null,
      ORIGIN,
      nowSec(),
      undefined,
    );
    const r = await passkeys.finishRegistration(
      USER,
      null,
      ORIGIN,
      challengeId,
      device.register(options, ORIGIN),
      "Phone",
    );
    expect(r).toMatchObject({ audited: true, mailed: true, notified: false });
    expect(enrolMail.sendEmail).toHaveBeenCalledTimes(1);
    expect(db.tables.system_audit_log[0].restaurant_id).toBeNull();
    await expect(signIn(passkeys, device)).resolves.toMatchObject({
      userId: USER,
    });
  });
});

describe("round 6 (4): an emailed-code sign-in marks the email verified", () => {
  const SECRET = "round-six-secret";
  function authOver(db: StubDb) {
    const jwt = new JwtService({});
    const svc = new AuthService(
      jwt,
      {
        get: (k: string) =>
          k === "JWT_SECRET"
            ? SECRET
            : k === "JWT_REFRESH_SECRET"
              ? "r"
              : undefined,
      } as any,
      { supabase: db.supabase } as any,
      { isBlacklisted: async () => false } as any,
      { sendEmail: async () => ({ success: true }) } as any,
    );
    return { svc, jwt };
  }
  const unverified = () =>
    makeStubDb({
      users: [
        {
          user_id: USER,
          email: "m@example.com",
          name: "Mira",
          role: "manager",
          restaurant_id: HOUSE,
          email_verified: false,
        },
      ],
      user_restaurant_access: [
        {
          user_id: USER,
          restaurant_id: HOUSE,
          role: "manager",
          is_active: true,
        },
      ],
      user_roles: [],
    });

  it("writes email_verified and signs the session verified", async () => {
    // FakeDb hands out copies of rows (as PostgREST does), so the session can
    // only come out verified if it is minted from the row the write returned.
    const db = new FakeDb();
    db.tables.users.push({
      user_id: USER,
      email: "m@example.com",
      name: "Mira",
      role: "manager",
      restaurant_id: HOUSE,
      email_verified: false,
    });
    db.tables.user_restaurant_access = [
      { user_id: USER, restaurant_id: HOUSE, role: "manager", is_active: true },
    ];
    db.tables.user_roles = [];
    const { svc, jwt } = authOver({ supabase: db } as unknown as StubDb);
    const pair = await svc.issueSessionForVerifiedSignIn(
      USER,
      "email_code",
      "M@Example.com ",
    );
    expect(db.tables.users[0].email_verified).toBe(true);
    const c = jwt.verify(pair.accessToken, { secret: SECRET }) as any;
    expect(c.emailVerified).toBe(true);
  });

  it("a passkey sign-in verifies nothing -- it proves the device, not the mailbox", async () => {
    const db = unverified();
    const { svc } = authOver(db);
    await svc.issueSessionForVerifiedSignIn(USER, "passkey", "m@example.com");
    expect(db.tables.users[0].email_verified).toBe(false);
  });

  it("a code for an address the account has since moved away from verifies nothing", async () => {
    const db = unverified();
    const { svc, jwt } = authOver(db);
    const pair = await svc.issueSessionForVerifiedSignIn(
      USER,
      "email_code",
      "old@example.com",
    );
    expect(db.tables.users[0].email_verified).toBe(false);
    const c = jwt.verify(pair.accessToken, { secret: SECRET }) as any;
    expect(c.emailVerified).toBe(false);
  });

  it("with no proved address given, nothing is written", async () => {
    const db = unverified();
    const { svc } = authOver(db);
    await svc.issueSessionForVerifiedSignIn(USER, "email_code");
    expect(db.tables.users[0].email_verified).toBe(false);
    expect(db.opsOn("users", "update")).toHaveLength(0);
  });
});
