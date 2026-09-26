/**
 * ADR 0222 (Proposed): passkeys on /profile.
 *
 * These tests drive the REAL `@simplewebauthn/server` verification with a
 * software authenticator built from node's own crypto (an ES256 key, a CBOR
 * attestation object with fmt "none", a DER signature), so what they prove is
 * the ceremony end to end -- not a mocked `verified: true`. The database is an
 * in-memory stand-in for the three tables the service touches.
 */
import { randomBytes } from "crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PASSKEY_AUDIT_ACTIONS, PasskeysService } from "./passkeys.service";
import { resolveRelyingParty } from "./relying-party";
import { SignInCodesService } from "./sign-in-codes.service";
import { FakeDb, SoftAuthenticator, b64u } from "./testing/passkey-harness";

/* ── the service under test ───────────────────────────────────────────── */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOUSE = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://mudavym.com";
/** An `auth_time` from a sign-in that just happened. */
const FRESH = () => Math.floor(Date.now() / 1000);

async function setup(
  passwordHash: string | null = "$2b$04$not-read-by-passkeys",
) {
  const db = new FakeDb();
  const hash = passwordHash;
  db.tables.users.push({
    user_id: USER,
    email: "m@example.com",
    name: "Mira",
    password_hash: hash,
  });
  db.tables.users.push({
    user_id: OTHER,
    email: "o@example.com",
    name: "Onur",
    password_hash: hash,
  });
  const mail = { sendEmail: jest.fn(async () => ({ success: true })) };
  const codes = new SignInCodesService({ client: db } as any, mail as any);
  // The "a passkey was added" mail, kept apart from the code mails above.
  const enrolMail = {
    sendEmail: jest.fn(
      async (_m: { to: string[]; subject: string; html: string }) =>
        ({ success: true }) as { success: boolean; error?: string },
    ),
  };
  const service = new PasskeysService(
    { client: db } as any,
    codes,
    enrolMail as any,
  );
  return { db, service, codes, mail, enrolMail };
}

async function enrol(
  service: PasskeysService,
  auth: SoftAuthenticator,
  origin = ORIGIN,
  nickname: string | undefined = "Work laptop",
) {
  const { challengeId, options } = await service.startRegistration(
    USER,
    HOUSE,
    origin,
    FRESH(),
    undefined,
  );
  return service.finishRegistration(
    USER,
    HOUSE,
    origin,
    challengeId,
    auth.register(options, origin),
    nickname,
  );
}

describe("relying party", () => {
  it("binds every mudavym.com origin to one RP ID, and refuses previews", () => {
    expect(resolveRelyingParty("https://mudavym.com", {} as any)).toEqual({
      rpId: "mudavym.com",
      origin: "https://mudavym.com",
    });
    expect(
      resolveRelyingParty("https://www.mudavym.com", {} as any)?.rpId,
    ).toBe("mudavym.com");
    expect(resolveRelyingParty("http://mudavym.com", {} as any)).toBeNull();
    expect(
      resolveRelyingParty("https://mudavym.com.evil.io", {} as any),
    ).toBeNull();
    expect(
      resolveRelyingParty("https://web-abc.vercel.app", {} as any),
    ).toBeNull();
    expect(resolveRelyingParty(undefined, {} as any)).toBeNull();
  });

  it("allows localhost only outside production", () => {
    expect(
      resolveRelyingParty("http://localhost:5173", {
        NODE_ENV: "development",
      } as any)?.rpId,
    ).toBe("localhost");
    expect(
      resolveRelyingParty("http://localhost:5173", {
        NODE_ENV: "production",
      } as any),
    ).toBeNull();
  });

  it("honours an override only when both halves are set and the origin is listed", () => {
    const env = {
      NODE_ENV: "production",
      WEBAUTHN_RP_ID: "example.org",
      WEBAUTHN_ORIGINS: "https://app.example.org",
    } as any;
    expect(resolveRelyingParty("https://app.example.org", env)?.rpId).toBe(
      "example.org",
    );
    expect(resolveRelyingParty("https://other.example.org", env)).toBeNull();
    expect(
      resolveRelyingParty("https://app.example.org", {
        WEBAUTHN_RP_ID: "example.org",
      } as any),
    ).toBeNull();
  });
});

describe("PasskeysService — enrolment", () => {
  it("verifies a real attestation, stores the credential per user, audits it and tells the person", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const receipt = await enrol(service, auth);

    expect(receipt.passkey.nickname).toBe("Work laptop");
    expect(receipt.passkey.rpId).toBe("mudavym.com");
    expect(receipt.audited).toBe(true);
    expect(receipt.notified).toBe(true);
    expect(db.tables.user_passkeys).toHaveLength(1);
    expect(db.tables.user_passkeys[0]).toMatchObject({
      user_id: USER,
      credential_id: b64u(auth.credentialId),
      rp_id: "mudavym.com",
    });
    expect(db.tables.system_audit_log[0]).toMatchObject({
      action: PASSKEY_AUDIT_ACTIONS.enrolled,
      actor_id: USER,
      restaurant_id: HOUSE,
      entity_type: "user_passkey",
    });
    expect(db.tables.notifications[0]).toMatchObject({
      user_id: USER,
      title: "A passkey was added to your account",
    });
    // the ceremony is gone: single use
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("asks for user verification and no attestation, and excludes what is already enrolled", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    const { options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      FRESH(),
      undefined,
    );
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection?.userVerification).toBe("required");
    expect(options.rp.id).toBe("mudavym.com");
    expect(options.user.id).toBe(b64u(new TextEncoder().encode(USER)));
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual([
      b64u(auth.credentialId),
    ]);
  });

  // The founder, 2026-09-26: round 6, item 37 ("staff may enrol passkeys
  // too") and round 7, item 44 ("passkey belongs to the person (industry) →
  // allowed"). No house role is read at all: the service no longer has one to
  // read (OrganizationsService is not injected).
  it("lets a session with no house enrol, audited with no house and mailed, with no in-app notice (notifications.restaurant_id is NOT NULL)", async () => {
    const { db, service, enrolMail } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      null,
      ORIGIN,
      FRESH(),
      undefined,
    );
    const receipt = await service.finishRegistration(
      USER,
      null,
      ORIGIN,
      challengeId,
      auth.register(options, ORIGIN),
      "Phone",
    );
    expect(receipt).toMatchObject({
      audited: true,
      notified: false,
      mailed: true,
    });
    expect(db.tables.user_passkeys).toHaveLength(1);
    expect(db.tables.system_audit_log[0]).toMatchObject({
      action: PASSKEY_AUDIT_ACTIONS.enrolled,
      restaurant_id: null,
    });
    expect(db.tables.notifications).toHaveLength(0);
    expect(enrolMail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a houseless session still needs a recent sign-in or an emailed code", async () => {
    const { db, service } = await setup();
    await expect(
      service.startRegistration(USER, null, ORIGIN, null, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("lets anyone in a house enrol, with the in-app notice filed in that house", async () => {
    const { db, service } = await setup();
    await expect(
      enrol(service, new SoftAuthenticator()),
    ).resolves.toMatchObject({ audited: true, notified: true });
    expect(db.tables.notifications[0].restaurant_id).toBe(HOUSE);
  });

  it("refuses a preview origin before anything starts", async () => {
    const { db, service } = await setup();
    await expect(
      service.startRegistration(
        USER,
        HOUSE,
        "https://web-abc.vercel.app",
        FRESH(),
        undefined,
      ),
    ).rejects.toThrow(/only on mudavym.com/);
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("refuses a replayed ceremony", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      FRESH(),
      undefined,
    );
    const response = auth.register(options, ORIGIN);
    await service.finishRegistration(
      USER,
      HOUSE,
      ORIGIN,
      challengeId,
      response,
      undefined,
    );
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        response,
        undefined,
      ),
    ).rejects.toThrow(/already used/);
  });

  it("refuses an expired ceremony", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      FRESH(),
      undefined,
    );
    db.tables.webauthn_challenges[0].expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.register(options, ORIGIN),
        undefined,
      ),
    ).rejects.toThrow(/expired/);
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("refuses a ceremony finished on another address than it started on", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      FRESH(),
      undefined,
    );
    const other = "https://www.mudavym.com";
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        other,
        challengeId,
        auth.register(options, other),
        undefined,
      ),
    ).rejects.toThrow(/another address/);
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("refuses a response signed for another origin or challenge (the library's check, really run)", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      FRESH(),
      undefined,
    );
    const forged = auth.register(
      { ...options, challenge: b64u(randomBytes(32)) },
      ORIGIN,
    );
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        forged,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("refuses an authenticator that did not verify the user", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    auth.uv = false;
    await expect(enrol(service, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("will not take another person's ceremony", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      FRESH(),
      undefined,
    );
    await expect(
      service.finishRegistration(
        OTHER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.register(options, ORIGIN),
        undefined,
      ),
    ).rejects.toThrow(/unknown/);
  });

  it("says a duplicate credential is a conflict, not a server fault", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    // the same authenticator credential, presented again past excludeCredentials
    db.tables.user_passkeys[0].rp_id = "elsewhere";
    await expect(enrol(service, auth)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("reports an audit row that failed instead of hiding it", async () => {
    const { db, service } = await setup();
    db.failInsertOn = "system_audit_log";
    const receipt = await enrol(service, new SoftAuthenticator());
    expect(receipt.audited).toBe(false);
    expect(receipt.auditReason).toBe("insert refused");
    expect(db.tables.user_passkeys).toHaveLength(1);
  });

  it("refuses a name over sixty characters", async () => {
    const { service } = await setup();
    await expect(
      enrol(service, new SoftAuthenticator(), ORIGIN, "x".repeat(61)),
    ).rejects.toThrow(/at most 60/);
  });
});

describe("PasskeysService — list and revoke", () => {
  it("lists only the caller's own passkeys, with eligibility in words", async () => {
    const { db, service } = await setup();
    await enrol(service, new SoftAuthenticator());
    db.tables.user_passkeys.push({
      ...db.tables.user_passkeys[0],
      id: "x",
      user_id: OTHER,
      credential_id: "other",
    });
    const mine = await service.list(USER, HOUSE);
    expect(mine.readable).toBe(true);
    expect(mine.eligible).toBe(true);
    expect(mine.passkeys).toHaveLength(1);
  });

  it("a session with no house reads its passkeys and may add one (ADR 0229, round 7)", async () => {
    const { service } = await setup();
    await enrol(service, new SoftAuthenticator());
    const readout = await service.list(USER, null);
    expect(readout.passkeys).toHaveLength(1);
    expect(readout.eligible).toBe(true);
    expect(readout.eligibilityReason).toBeNull();
  });

  it("revokes, keeps the row marked, audits, tells the person — and a revoked passkey no longer checks", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { passkey } = await enrol(service, auth);
    const receipt = await service.revoke(USER, HOUSE, passkey.id);
    expect(receipt.passkey.revokedAt).not.toBeNull();
    expect(receipt.audited).toBe(true);
    expect(db.tables.user_passkeys).toHaveLength(1);
    expect(db.tables.system_audit_log.map((r) => r.action)).toEqual([
      PASSKEY_AUDIT_ACTIONS.enrolled,
      PASSKEY_AUDIT_ACTIONS.revoked,
    ]);
    expect(db.tables.notifications.map((r) => r.title)).toContain(
      "A passkey was removed from your account",
    );
    await expect(service.startCheck(USER, HOUSE, ORIGIN)).rejects.toThrow(
      /no passkey/,
    );
  });

  it("lets someone with no house remove what they enrolled", async () => {
    const { service } = await setup();
    const { passkey } = await enrol(service, new SoftAuthenticator());
    await expect(service.revoke(USER, null, passkey.id)).resolves.toMatchObject(
      { audited: true, notified: false },
    );
  });

  it("answers another person's passkey exactly like a missing one", async () => {
    const { service } = await setup();
    const { passkey } = await enrol(service, new SoftAuthenticator());
    await expect(
      service.revoke(OTHER, HOUSE, passkey.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("PasskeysService — check", () => {
  it("verifies a real assertion, advances the counter, stamps the use and audits it", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    expect(options.userVerification).toBe("required");
    const receipt = await service.finishCheck(
      USER,
      HOUSE,
      ORIGIN,
      challengeId,
      auth.assert(options, ORIGIN, "mudavym.com"),
    );
    expect(receipt.passkey.lastUsedAt).not.toBeNull();
    expect(Number(db.tables.user_passkeys[0].sign_count)).toBe(1);
    expect(db.tables.system_audit_log.at(-1)).toMatchObject({
      action: PASSKEY_AUDIT_ACTIONS.checked,
    });
  });

  it("refuses an assertion signed for another RP ID", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    await expect(
      service.finishCheck(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.assert(options, ORIGIN, "evil.example"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a counter that went backwards (a cloned authenticator)", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    db.tables.user_passkeys[0].sign_count = 50;
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    await expect(
      service.finishCheck(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.assert(options, ORIGIN, "mudavym.com"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
