import "reflect-metadata";
import { ServiceUnavailableException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../auth/auth.service";
import { makeStubDb, StubDb } from "../team/testing/supabase-stub";
import {
  PASSKEY_AUDIT_ACTIONS,
  PasskeysService,
  SIGN_IN_REFUSAL,
} from "./passkeys.service";
import { PASSWORD_RESET_REASON, retireEveryPasskey } from "./retire-passkeys";
import { SignInCodesService } from "./sign-in-codes.service";
import { FakeDb, SoftAuthenticator } from "./testing/passkey-harness";

/**
 * The founder, 2026-09-26, round 6, item 37 (ADR 0229), verbatim: "Passkeys
 * (ADR 0229): password reset RETIRES every passkey (kept as revoked, not
 * deleted) + every new passkey emails the account; staff may enrol passkeys
 * too; emailed-code sign-in marks email verified."
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

function world(role: string | null = "manager") {
  const db = new FakeDb();
  db.tables.users.push(
    {
      user_id: USER,
      email: "m@example.com",
      name: "Mira",
      password_hash: "$2b$04$old",
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
  const organizations = { resolveRestaurantRole: jest.fn(async () => role) };
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
    organizations as any,
    codes,
    enrolMail as any,
  );
  const auth = new AuthService(
    new JwtService({}),
    { get: () => undefined } as any,
    { supabase: db, client: db } as any,
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => ({ success: true }) } as any,
  );
  return { db, passkeys, auth, enrolMail };
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

describe("round 6 (1): a password reset retires every passkey", () => {
  it("keeps every row, marks it revoked by the account now, audits the cause, and none of them signs in again", async () => {
    const { db, passkeys, auth } = world();
    const phone = new SoftAuthenticator();
    const laptop = new SoftAuthenticator();
    await enrol(passkeys, phone, USER, "Phone");
    await enrol(passkeys, laptop, USER, "Laptop");
    // Someone else's passkey is not touched.
    const theirs = new SoftAuthenticator();
    await enrol(passkeys, theirs, OTHER, "Theirs");
    // Before the reset the passkey signs in.
    await expect(signIn(passkeys, phone)).resolves.toMatchObject({
      userId: USER,
    });

    const before = Date.now();
    await auth.resetPassword(TOKEN, "a brand new password");

    const mine = db.tables.user_passkeys.filter((r) => r.user_id === USER);
    expect(mine).toHaveLength(2); // kept, never deleted
    for (const row of mine) {
      expect(row.revoked_by).toBe(USER);
      expect(new Date(row.revoked_at).getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    }
    const retiredAudit = db.tables.system_audit_log.filter(
      (r) =>
        r.action === PASSKEY_AUDIT_ACTIONS.revoked &&
        r.reason === PASSWORD_RESET_REASON,
    );
    expect(retiredAudit.map((r) => r.entity_id).sort()).toEqual(
      mine.map((r) => r.id).sort(),
    );
    expect(
      db.tables.user_passkeys.find((r) => r.user_id === OTHER)?.revoked_at,
    ).toBeNull();

    // A retired passkey cannot sign in; the other account's still can.
    await expect(signIn(passkeys, phone)).rejects.toThrow(SIGN_IN_REFUSAL);
    await expect(signIn(passkeys, laptop)).rejects.toThrow(SIGN_IN_REFUSAL);
    await expect(signIn(passkeys, theirs)).resolves.toMatchObject({
      userId: OTHER,
    });
    // And the link is spent.
    expect(db.tables.password_resets[0].used_at).not.toBeNull();
  });

  it("a passkey removed earlier on /profile keeps its own time and actor", async () => {
    const { db, passkeys, auth } = world();
    const r = await enrol(passkeys, new SoftAuthenticator());
    await passkeys.revoke(USER, HOUSE, r.passkey.id);
    const earlier = db.tables.user_passkeys[0].revoked_at;
    await auth.resetPassword(TOKEN, "a brand new password");
    expect(db.tables.user_passkeys[0].revoked_at).toBe(earlier);
    expect(
      db.tables.system_audit_log.filter(
        (x) => x.reason === PASSWORD_RESET_REASON,
      ),
    ).toHaveLength(0);
  });

  it("if the passkeys cannot be retired, the reset is not reported done and the same link still finishes it", async () => {
    const { db, passkeys, auth } = world();
    const phone = new SoftAuthenticator();
    await enrol(passkeys, phone);
    db.failUpdateOn = "user_passkeys";
    await expect(
      auth.resetPassword(TOKEN, "a brand new password"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.tables.password_resets[0].used_at).toBeNull();

    db.failUpdateOn = null;
    await auth.resetPassword(TOKEN, "a brand new password");
    await expect(signIn(passkeys, phone)).rejects.toThrow(SIGN_IN_REFUSAL);
  });

  it("retires nothing and throws nothing for an account with no passkeys", async () => {
    const { db } = world();
    await expect(
      retireEveryPasskey(db, USER, PASSWORD_RESET_REASON),
    ).resolves.toEqual({ retired: 0, audited: 0 });
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

describe("round 6 (3): staff may enrol passkeys", () => {
  it("a staff member enrols, is mailed, and then signs in with it", async () => {
    const { passkeys, enrolMail } = world("staff");
    const device = new SoftAuthenticator();
    const r = await enrol(passkeys, device);
    expect(r).toMatchObject({ audited: true, mailed: true });
    expect(enrolMail.sendEmail).toHaveBeenCalledTimes(1);
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
