import { createHash } from "crypto";
import { BadRequestException, HttpException } from "@nestjs/common";
import {
  ADDRESS_BUSY,
  CODE_REFUSAL,
  CODE_SPENT,
  CODE_TTL_MS,
  DAILY_LOCK,
  MAX_ATTEMPTS_PER_CODE,
  MAX_CODES_PER_EMAIL_PER_HOUR,
  MAX_CODES_PER_SOURCE_PER_HOUR,
  MAX_FAILED_PER_EMAIL_PER_DAY,
  SIGN_IN_SENT,
  SOURCE_BUSY,
  SignInCodesService,
  maskEmail,
} from "./sign-in-codes.service";
import { FakeDb } from "./testing/passkey-harness";

/**
 * Emailed one-time codes (ADR 0229, Proposed; founder 2026-09-25, item 29:
 * "logged-out with no passkey -> emailed one-time code"). Issue, verify,
 * expiry, lockout, and -- because the sign-in route is typed into by
 * strangers -- that nothing it answers says whether an address has an account.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "mira@example.com";
const NOBODY = "nobody@example.com";
const T0 = Date.parse("2026-09-25T12:00:00Z");

function setup(
  mailImpl: () => Promise<{ success: boolean; error?: string }> = async () => ({
    success: true,
  }),
) {
  const db = new FakeDb();
  db.tables.users.push({ user_id: USER, email: EMAIL, name: "Mira Kaya" });
  const mail = {
    sendEmail: jest.fn((_m: { to: string[]; subject: string }) => mailImpl()),
  };
  const svc = new SignInCodesService({ client: db } as any, mail as any);
  let now = T0;
  svc.now = () => now;
  const tick = (ms: number) => {
    now += ms;
  };
  const lastCode = () => {
    const calls = mail.sendEmail.mock.calls as unknown as Array<
      [{ subject: string }]
    >;
    const subject = calls[calls.length - 1][0].subject;
    return subject.slice(0, 6);
  };
  return { db, mail, svc, tick, lastCode };
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof HttpException
      ? `${e.getStatus()} ${(e.getResponse() as any).message ?? e.getResponse()}`
      : String(e);
  }
};

const flush = () => new Promise((r) => setImmediate(r));

describe("SignInCodesService — issuing", () => {
  it("stores a keyed hash, never the code, and mails six digits to the account", async () => {
    const { db, mail, svc, lastCode } = setup();
    const res = await svc.issueForSignIn("  Mira@Example.com ", "203.0.113.9");
    await flush();
    expect(res).toEqual({
      sent: true,
      message: SIGN_IN_SENT,
      expiresInSeconds: 600,
    });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    const [row] = db.tables.sign_in_codes;
    expect(row).toMatchObject({
      email: EMAIL,
      user_id: USER,
      purpose: "sign_in",
      attempts: 0,
    });
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    // Not a plain hash: a leaked table cannot be ground through a million sha256s.
    expect(row.code_hash).not.toBe(
      createHash("sha256").update(code).digest("hex"),
    );
    // The caller's address is counted, never kept raw.
    expect(row.requested_from).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    expect(row.expires_at).toBe(new Date(T0 + CODE_TTL_MS).toISOString());
  });

  it("answers an address with no account exactly as it answers one with an account", async () => {
    const a = setup();
    const b = setup();
    const known = await a.svc.issueForSignIn(EMAIL, "198.51.100.1");
    const unknown = await b.svc.issueForSignIn(NOBODY, "198.51.100.1");
    await flush();
    expect(unknown).toEqual(known);
    // ...writes a row either way (so every limit trips the same), mails nobody.
    expect(b.db.tables.sign_in_codes).toHaveLength(1);
    expect(b.db.tables.sign_in_codes[0].user_id).toBeNull();
    expect(b.mail.sendEmail).not.toHaveBeenCalled();
  });

  it("does not wait for the mail, so the response time says nothing either", async () => {
    const { svc } = setup(() => new Promise(() => undefined));
    await expect(svc.issueForSignIn(EMAIL, null)).resolves.toMatchObject({
      sent: true,
    });
  });

  it("caps codes per address per hour -- identically for an address with no account", async () => {
    for (const address of [EMAIL, NOBODY]) {
      const { svc, tick } = setup();
      for (let i = 0; i < MAX_CODES_PER_EMAIL_PER_HOUR; i++) {
        await svc.issueForSignIn(address, `10.0.0.${i}`);
        tick(1000);
      }
      expect(await statusOf(svc.issueForSignIn(address, "10.0.1.1"))).toBe(
        `429 ${ADDRESS_BUSY}`,
      );
      tick(60 * 60 * 1000);
      await expect(
        svc.issueForSignIn(address, "10.0.1.1"),
      ).resolves.toBeTruthy();
    }
  });

  it("caps codes per requesting address per hour, across many addresses", async () => {
    const { svc } = setup();
    for (let i = 0; i < MAX_CODES_PER_SOURCE_PER_HOUR; i++) {
      await svc.issueForSignIn(`p${i}@example.com`, "192.0.2.7");
    }
    expect(
      await statusOf(svc.issueForSignIn("another@example.com", "192.0.2.7")),
    ).toBe(`429 ${SOURCE_BUSY}`);
    await expect(
      svc.issueForSignIn("another@example.com", "192.0.2.8"),
    ).resolves.toBeTruthy();
  });

  it("a newer code supersedes the older one", async () => {
    const { svc, tick, lastCode } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const first = lastCode();
    tick(1000);
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const second = lastCode();
    if (first !== second) {
      await expect(svc.verify("sign_in", EMAIL, first)).rejects.toThrow(
        CODE_REFUSAL,
      );
    }
    await expect(svc.verify("sign_in", EMAIL, second)).resolves.toBe(USER);
  });

  it("step-up mails the account's own address, awaits it, and says a failure", async () => {
    const ok = setup();
    const res = await ok.svc.issueForStepUp(USER, null);
    expect(res).toEqual({
      sent: true,
      sentTo: "m•••@example.com",
      expiresInSeconds: 600,
    });
    expect(ok.mail.sendEmail.mock.calls[0][0]).toMatchObject({ to: [EMAIL] });

    const down = setup(async () => ({ success: false, error: "smtp down" }));
    expect(await statusOf(down.svc.issueForStepUp(USER, null))).toMatch(
      /^502 /,
    );
  });

  it("masks an address to its first letter and domain", () => {
    expect(maskEmail("mira@example.com")).toBe("m•••@example.com");
    expect(maskEmail("broken")).toBe("your email address");
  });
});

describe("SignInCodesService — checking", () => {
  it("signs in once, and never twice with the same code", async () => {
    const { svc, lastCode } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const code = lastCode();
    await expect(svc.verify("sign_in", "MIRA@example.com", code)).resolves.toBe(
      USER,
    );
    await expect(svc.verify("sign_in", EMAIL, code)).rejects.toThrow(
      CODE_REFUSAL,
    );
  });

  it("accepts spaces a person typed inside the code", async () => {
    const { svc, lastCode } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const c = lastCode();
    await expect(
      svc.verify("sign_in", EMAIL, `${c.slice(0, 3)} ${c.slice(3)}`),
    ).resolves.toBe(USER);
  });

  it("refuses a malformed code without counting it as a guess", async () => {
    const { db, svc } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await expect(svc.verify("sign_in", EMAIL, "12345")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.verify("sign_in", EMAIL, "abcdef")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.tables.sign_in_codes[0].attempts).toBe(0);
  });

  it("expires at ten minutes: a millisecond before works, the instant itself does not", async () => {
    const early = setup();
    await early.svc.issueForSignIn(EMAIL, null);
    await flush();
    early.tick(CODE_TTL_MS - 1);
    await expect(
      early.svc.verify("sign_in", EMAIL, early.lastCode()),
    ).resolves.toBe(USER);

    const late = setup();
    await late.svc.issueForSignIn(EMAIL, null);
    await flush();
    late.tick(CODE_TTL_MS);
    await expect(
      late.svc.verify("sign_in", EMAIL, late.lastCode()),
    ).rejects.toThrow(CODE_REFUSAL);
  });

  it("kills a code after five wrong tries, even when the sixth is right", async () => {
    const { db, svc, lastCode } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_ATTEMPTS_PER_CODE; i++) {
      await expect(svc.verify("sign_in", EMAIL, wrong)).rejects.toThrow(
        CODE_REFUSAL,
      );
    }
    await expect(svc.verify("sign_in", EMAIL, wrong)).rejects.toThrow(
      CODE_SPENT,
    );
    expect(db.tables.sign_in_codes[0].attempts).toBe(MAX_ATTEMPTS_PER_CODE);
    await expect(svc.verify("sign_in", EMAIL, code)).rejects.toThrow(
      CODE_SPENT,
    );
  });

  it("locks the address for the day after twenty wrong tries -- issue and check alike, account or not", async () => {
    for (const address of [EMAIL, NOBODY]) {
      const { svc, tick } = setup();
      let failed = 0;
      while (failed < MAX_FAILED_PER_EMAIL_PER_DAY) {
        await svc.issueForSignIn(address, `10.1.${failed}.1`);
        for (
          let i = 0;
          i < MAX_ATTEMPTS_PER_CODE && failed < MAX_FAILED_PER_EMAIL_PER_DAY;
          i++
        ) {
          // "999999" is wrong for the known account unless astronomically unlucky;
          // the unknown address has no right code at all.
          await svc.verify("sign_in", address, "999999").catch(() => undefined);
          failed++;
        }
        tick(13 * 60 * 1000); // stay under the per-hour issue cap
      }
      expect(await statusOf(svc.issueForSignIn(address, "10.9.9.9"))).toBe(
        `429 ${DAILY_LOCK}`,
      );
      expect(await statusOf(svc.verify("sign_in", address, "123456"))).toBe(
        `429 ${DAILY_LOCK}`,
      );
      tick(24 * 60 * 60 * 1000);
      await expect(
        svc.issueForSignIn(address, "10.9.9.9"),
      ).resolves.toBeTruthy();
    }
  });

  it("gives an address with no account the same refusal as a wrong code", async () => {
    const known = setup();
    await known.svc.issueForSignIn(EMAIL, null);
    await flush();
    const good = known.lastCode();
    const wrong = good === "424242" ? "434343" : "424242";
    const a = await statusOf(known.svc.verify("sign_in", EMAIL, wrong));

    const unknown = setup();
    await unknown.svc.issueForSignIn(NOBODY, null);
    const b = await statusOf(unknown.svc.verify("sign_in", NOBODY, wrong));
    expect(b).toBe(a);
    expect(a).toBe(`400 ${CODE_REFUSAL}`);
    // ...and no code at all reads the same too.
    const none = setup();
    expect(await statusOf(none.svc.verify("sign_in", NOBODY, wrong))).toBe(a);
  });

  it("keeps purposes apart: a sign-in code is not a step-up proof", async () => {
    const { svc, lastCode } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    await expect(svc.verifyStepUp(USER, lastCode())).rejects.toThrow(
      CODE_REFUSAL,
    );
  });

  it("a step-up code proves only its own account", async () => {
    const { db, svc, lastCode } = setup();
    const OTHER = "22222222-2222-4222-8222-222222222222";
    db.tables.users.push({
      user_id: OTHER,
      email: "onur@example.com",
      name: "Onur",
    });
    await svc.issueForStepUp(USER, null);
    const mine = lastCode();
    await expect(svc.verifyStepUp(OTHER, mine)).rejects.toThrow(CODE_REFUSAL);
    await expect(svc.verifyStepUp(USER, mine)).resolves.toBeUndefined();
  });

  it("says a failed read is a failure, never a wrong code", async () => {
    const { db, svc } = setup();
    db.failReadOn = "sign_in_codes";
    expect(await statusOf(svc.verify("sign_in", EMAIL, "123456"))).toMatch(
      /^500 /,
    );
  });
});
