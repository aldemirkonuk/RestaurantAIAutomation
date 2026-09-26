import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import {
  FRESH_SIGN_IN_SECONDS,
  PASSKEY_AUDIT_ACTIONS,
  PasskeysService,
  RP_SIGN_IN_REFUSAL,
  SIGN_IN_REFUSAL,
  STEP_UP_REQUIRED,
  isFreshSignIn,
} from "./passkeys.service";
import { CODE_REFUSAL, SignInCodesService } from "./sign-in-codes.service";
import { SignInController } from "./sign-in.controller";
import { FakeDb, SoftAuthenticator, b64u } from "./testing/passkey-harness";

/**
 * The founder, 2026-09-25, item 29 (confirmed reading), ADR 0222 / ADR 0229:
 *   (1) a passkey IS a sign-in method;
 *   (3) adding one while signed in: a sign-in in the last ten minutes proceeds,
 *       otherwise an emailed code first -- replacing "type your password", and
 *       working for a Google-only account.
 * Every ceremony below is verified by the real `@simplewebauthn/server` against
 * a software authenticator; nothing is a mocked `verified: true`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOUSE = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://mudavym.com";
const nowSec = () => Math.floor(Date.now() / 1000);

function setup(role: string | null = "manager") {
  const db = new FakeDb();
  db.tables.users.push(
    // A Google-only account: no password at all.
    {
      user_id: USER,
      email: "m@example.com",
      name: "Mira",
      password_hash: null,
    },
    {
      user_id: OTHER,
      email: "o@example.com",
      name: "Onur",
      password_hash: null,
    },
  );
  const organizations = { resolveRestaurantRole: jest.fn(async () => role) };
  const mail = {
    sendEmail: jest.fn(async (_m: { subject: string; to: string[] }) => ({
      success: true,
    })),
  };
  const codes = new SignInCodesService({ client: db } as any, mail as any);
  const service = new PasskeysService(
    { client: db } as any,
    organizations as any,
    codes,
  );
  const lastCode = () =>
    mail.sendEmail.mock.calls[
      mail.sendEmail.mock.calls.length - 1
    ][0].subject.slice(0, 6);
  return { db, service, codes, mail, lastCode };
}

async function enrolFresh(
  service: PasskeysService,
  auth: SoftAuthenticator,
  userId = USER,
) {
  const { challengeId, options } = await service.startRegistration(
    userId,
    HOUSE,
    ORIGIN,
    nowSec(),
    undefined,
  );
  return service.finishRegistration(
    userId,
    HOUSE,
    ORIGIN,
    challengeId,
    auth.register(options, ORIGIN),
    "Phone",
  );
}

async function signIn(
  service: PasskeysService,
  auth: SoftAuthenticator,
  withHandle = true,
  mutate?: (a: any) => void,
) {
  const { challengeId, options } = await service.startSignIn(ORIGIN);
  const assertion: any = auth.assert(
    options,
    ORIGIN,
    "mudavym.com",
    withHandle,
  );
  mutate?.(assertion);
  return {
    challengeId,
    assertion,
    result: service.finishSignIn(ORIGIN, challengeId, assertion),
  };
}

describe("freshness: signed in within the last ten minutes", () => {
  it("is fresh up to and including ten minutes, and not one second after", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    const s = Math.floor(now / 1000);
    expect(FRESH_SIGN_IN_SECONDS).toBe(600);
    expect(isFreshSignIn(s, now)).toBe(true);
    expect(isFreshSignIn(s - 599, now)).toBe(true);
    expect(isFreshSignIn(s - 600, now)).toBe(true);
    expect(isFreshSignIn(s - 601, now)).toBe(false);
  });

  it("fails closed on a missing, malformed or far-future instant", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    const s = Math.floor(now / 1000);
    expect(isFreshSignIn(null, now)).toBe(false);
    expect(isFreshSignIn(undefined, now)).toBe(false);
    expect(isFreshSignIn(Number.NaN, now)).toBe(false);
    expect(isFreshSignIn(s + 60, now)).toBe(true); // clock slack
    expect(isFreshSignIn(s + 61, now)).toBe(false);
  });
});

describe("adding a passkey: fresh sign-in, or an emailed code", () => {
  it("proceeds directly on a fresh sign-in -- for a Google-only account too -- and burns no code", async () => {
    const { db, service, mail } = setup();
    const receipt = await enrolFresh(service, new SoftAuthenticator());
    expect(receipt.audited).toBe(true);
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(db.tables.sign_in_codes).toHaveLength(0);
  });

  it("asks for an emailed code when the sign-in is eleven minutes old: 403 STEP_UP_REQUIRED, never 401, nothing started", async () => {
    const { db, service } = setup();
    let err: unknown;
    try {
      await service.startRegistration(
        USER,
        HOUSE,
        ORIGIN,
        nowSec() - 660,
        undefined,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as HttpException).getStatus()).toBe(403);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: STEP_UP_REQUIRED,
    });
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("asks for a code when the token carries no sign-in time at all (minted before the claim)", async () => {
    const { service } = setup();
    await expect(
      service.startRegistration(USER, HOUSE, ORIGIN, null, undefined),
    ).rejects.toMatchObject({ response: { code: STEP_UP_REQUIRED } });
  });

  it("stale session + the emailed code: the passkey is added, and the code works once", async () => {
    const { db, service, mail, lastCode } = setup();
    const sent = await service.sendStepUpCode(USER, HOUSE, "203.0.113.5");
    expect(sent).toMatchObject({ sent: true, sentTo: "m•••@example.com" });
    expect(mail.sendEmail.mock.calls[0][0].to).toEqual(["m@example.com"]);
    const code = lastCode();

    const stale = nowSec() - 3600;
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      stale,
      code,
    );
    const receipt = await service.finishRegistration(
      USER,
      HOUSE,
      ORIGIN,
      challengeId,
      auth.register(options, ORIGIN),
      undefined,
    );
    expect(receipt.passkey.revokedAt).toBeNull();
    expect(db.tables.user_passkeys).toHaveLength(1);
    await expect(
      service.startRegistration(USER, HOUSE, ORIGIN, stale, code),
    ).rejects.toThrow(CODE_REFUSAL);
  });

  it("a wrong code starts nothing and counts as a guess", async () => {
    const { db, service, lastCode } = setup();
    await service.sendStepUpCode(USER, HOUSE, null);
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    await expect(
      service.startRegistration(USER, HOUSE, ORIGIN, nowSec() - 3600, wrong),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.webauthn_challenges).toHaveLength(0);
    expect(db.tables.sign_in_codes[0].attempts).toBe(1);
  });

  it("another person's step-up code proves nothing for me", async () => {
    const { service, lastCode } = setup();
    await service.sendStepUpCode(OTHER, HOUSE, null);
    await expect(
      service.startRegistration(
        USER,
        HOUSE,
        ORIGIN,
        nowSec() - 3600,
        lastCode(),
      ),
    ).rejects.toThrow(CODE_REFUSAL);
  });

  it("does not mail a code to someone who may not add a passkey here", async () => {
    const { service, mail } = setup(null);
    await expect(
      service.sendStepUpCode(USER, HOUSE, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

describe("signing in with a passkey", () => {
  it("starts a ceremony that names nobody and requires user verification", async () => {
    const { db, service } = setup();
    const { options } = await service.startSignIn(ORIGIN);
    expect(options.rpId).toBe("mudavym.com");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toHaveLength(0);
    expect(db.tables.webauthn_challenges[0]).toMatchObject({
      purpose: "sign_in",
      user_id: null,
      origin: ORIGIN,
    });
  });

  it("verifies a real assertion, names the account by its user handle, advances the counter and audits it", async () => {
    const { db, service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const { result } = await signIn(service, auth);
    const out = await result;
    expect(out.userId).toBe(USER);
    expect(out.audited).toBe(true);
    expect(db.tables.user_passkeys[0].sign_count).toBe(1);
    expect(db.tables.user_passkeys[0].last_used_at).not.toBeNull();
    expect(
      db.tables.system_audit_log.find(
        (r) => r.action === PASSKEY_AUDIT_ACTIONS.signedIn,
      ),
    ).toMatchObject({ actor_id: USER, entity_type: "user_passkey" });
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("refuses a replayed assertion: the ceremony answers once", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const { challengeId, assertion, result } = await signIn(service, auth);
    await result;
    await expect(
      service.finishSignIn(ORIGIN, challengeId, assertion),
    ).rejects.toThrow(/unknown or was already used/);
  });

  it("refuses an assertion without a user handle", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const { result } = await signIn(service, auth, false);
    await expect(result).rejects.toThrow(SIGN_IN_REFUSAL);
  });

  it("refuses a user handle naming someone else -- the signature does not cover it, so this check must", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const { result } = await signIn(service, auth, true, (a) => {
      a.response.userHandle = b64u(new TextEncoder().encode(OTHER));
    });
    await expect(result).rejects.toThrow(SIGN_IN_REFUSAL);
  });

  it("gives an unknown, a removed and a badly signed passkey the same sentence", async () => {
    const { db, service } = setup();
    const stranger = new SoftAuthenticator();
    // enrol on OTHER's side so the authenticator has a handle, then forget the row
    await enrolFresh(service, stranger, OTHER);
    db.tables.user_passkeys = [];
    const unknown = (await signIn(service, stranger)).result;
    await expect(unknown).rejects.toThrow(SIGN_IN_REFUSAL);

    const removed = new SoftAuthenticator();
    const r = await enrolFresh(service, removed);
    await service.revoke(USER, HOUSE, r.passkey.id);
    await expect((await signIn(service, removed)).result).rejects.toThrow(
      SIGN_IN_REFUSAL,
    );

    const forged = new SoftAuthenticator();
    await enrolFresh(service, forged);
    const bad = await signIn(service, forged, true, (a) => {
      const sig = Buffer.from(a.response.signature, "base64url");
      sig[sig.length - 1] ^= 0xff;
      a.response.signature = b64u(sig);
    });
    await expect(bad.result).rejects.toThrow(SIGN_IN_REFUSAL);
  });

  it("refuses an authenticator that did not verify the person (a bare tap)", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    auth.uv = false;
    await expect((await signIn(service, auth)).result).rejects.toThrow(
      SIGN_IN_REFUSAL,
    );
  });

  it("refuses a counter that went backwards (a cloned authenticator)", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    await (
      await signIn(service, auth)
    ).result; // counter 1
    await (
      await signIn(service, auth)
    ).result; // counter 2
    auth.setCounter(0); // next assertion carries 1
    await expect((await signIn(service, auth)).result).rejects.toThrow(
      SIGN_IN_REFUSAL,
    );
  });

  it("refuses a preview origin before anything is written", async () => {
    const { db, service } = setup();
    await expect(
      service.startSignIn("https://web-abc.vercel.app"),
    ).rejects.toThrow(RP_SIGN_IN_REFUSAL);
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("will not finish a sign-in on a signed-in person's check ceremony", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    await expect(
      service.finishSignIn(
        ORIGIN,
        challengeId,
        auth.assert(options, ORIGIN, "mudavym.com", true),
      ),
    ).rejects.toThrow(/unknown or was already used/);
  });

  it("refuses a ceremony finished on another address than it started on", async () => {
    const { service } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const { challengeId, options } = await service.startSignIn(ORIGIN);
    await expect(
      service.finishSignIn(
        "https://www.mudavym.com",
        challengeId,
        auth.assert(options, ORIGIN, "mudavym.com", true),
      ),
    ).rejects.toThrow(/started on another address/);
  });
});

describe("SignInController: the proof decides, AuthService mints", () => {
  it("mints a session for exactly the account the passkey proved, and none on a refusal", async () => {
    const { service, codes } = setup();
    const auth = new SoftAuthenticator();
    await enrolFresh(service, auth);
    const minted = {
      issueSessionForVerifiedSignIn: jest.fn(async () => ({
        accessToken: "a",
        refreshToken: "r",
      })),
    };
    const controller = new SignInController(service, codes, minted as any);

    const { challengeId, options } = await controller.passkeyOptions(ORIGIN);
    const ok = await controller.passkeyVerify(ORIGIN, {
      challengeId,
      response: auth.assert(options, ORIGIN, "mudavym.com", true) as any,
    });
    expect(ok).toEqual({ success: true, accessToken: "a", refreshToken: "r" });
    expect(minted.issueSessionForVerifiedSignIn).toHaveBeenCalledWith(
      USER,
      "passkey",
    );

    minted.issueSessionForVerifiedSignIn.mockClear();
    const again = await controller.passkeyOptions(ORIGIN);
    await expect(
      controller.passkeyVerify(ORIGIN, {
        challengeId: again.challengeId,
        response: auth.assert(
          again.options,
          ORIGIN,
          "mudavym.com",
          false,
        ) as any,
      }),
    ).rejects.toThrow(SIGN_IN_REFUSAL);
    expect(minted.issueSessionForVerifiedSignIn).not.toHaveBeenCalled();
  });

  it("mints for an emailed code only after it verifies", async () => {
    const { codes, service, lastCode } = setup();
    const minted = {
      issueSessionForVerifiedSignIn: jest.fn(async () => ({
        accessToken: "a",
        refreshToken: "r",
      })),
    };
    const controller = new SignInController(service, codes, minted as any);
    const req = { headers: {}, ip: "198.51.100.4" } as any;
    await controller.emailCode({ email: "m@example.com" }, req);
    await new Promise((r) => setImmediate(r));
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(
      controller.emailCodeVerify({ email: "m@example.com", code: wrong }),
    ).rejects.toThrow(CODE_REFUSAL);
    expect(minted.issueSessionForVerifiedSignIn).not.toHaveBeenCalled();
    await controller.emailCodeVerify({ email: "m@example.com", code });
    // The address the code was checked against goes along: AuthService marks
    // it verified (ADR 0229, round 6, item 37).
    expect(minted.issueSessionForVerifiedSignIn).toHaveBeenCalledWith(
      USER,
      "email_code",
      "m@example.com",
    );
  });
});
