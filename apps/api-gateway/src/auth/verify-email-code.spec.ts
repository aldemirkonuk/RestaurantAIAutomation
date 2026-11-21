import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import {
  CODE_REFUSAL,
  CODE_SPENT,
  MAX_ATTEMPTS_PER_CODE,
} from "../passkeys/sign-in-codes.service";
import { verifyEmailTemplate } from "../communications/email-templates/verify-email.template";
import { FakeDb } from "../passkeys/testing/passkey-harness";

/**
 * Onboarding OB-3 (founder /goal 2026-11-07; proposal
 * p4-scratch/sw-walk/onboarding/proposal.md §3 Phase 1 row OB-3, §4 F3 "the
 * mail carries a six-digit code and the link", §5 I15 "A failed send is said
 * to the person").
 *
 * Before: `registerAccount` fired `queueEmailVerification` and forgot it, so a
 * refused send was only logged; and the mail carried only a link, which
 * verifies only in a signed-in browser that opens the mail.
 *
 * Driven through the real `AuthService` (registration, the mail, the code
 * check, the compare-and-set), the real `SignInCodesService` it builds, the
 * real `AuthController` handlers and the real `JwtService`, over the
 * in-memory `FakeDb`. No mail is sent: `sendEmail` is a mock, and the code is
 * read out of the html it was handed.
 */

const SECRETS: Record<string, string> = {
  JWT_SECRET: "verify-email-code-spec-access-secret",
  JWT_REFRESH_SECRET: "verify-email-code-spec-refresh-secret",
  FRONTEND_URL: "https://mudavym.com",
};

type Mail = { to: string[]; subject: string; html: string };

function world(
  sendResult: { success: boolean; error?: string } = { success: true },
) {
  const db = new FakeDb();
  db.tables.user_restaurant_access = [];
  db.tables.user_roles = [];
  db.tables.email_verifications = [];
  const mail = {
    sendEmail: jest.fn(async (_m: Mail) => ({
      ...sendResult,
      messageId: sendResult.success ? "m1" : undefined,
    })),
  };
  const jwt = new JwtService({});
  const auth = new AuthService(
    jwt,
    { get: (k: string) => SECRETS[k] } as any,
    { supabase: db, client: db } as any,
    { isBlacklisted: async () => false } as any,
    mail as any,
  );
  (auth as any).websocketGateway = { endStaleSessions: jest.fn(() => 0) };
  const controller = new AuthController(auth);

  async function register(email: string) {
    const body: any = await controller.registerAccount({
      email,
      password: "a password of my own",
      name: "Mira Kaya",
    } as any);
    const user = db.tables.users.find((u) => u.email === email)!;
    return { body, userId: user.user_id as string };
  }

  /** The six digits in the newest mail to `email`. */
  function codeMailedTo(email: string): string {
    const sent = mail.sendEmail.mock.calls
      .map((c) => c[0])
      .filter((m) => m.to.includes(email));
    const html = sent[sent.length - 1].html;
    const m = /(\d{6}) — your Mudavym code/.exec(html);
    if (!m) throw new Error(`no code in the mail to ${email}`);
    return m[1];
  }

  /** POST /auth/verify-email with `{ code }`, as the signed-in person. */
  const verifyByCode = (userId: string, code: string) =>
    controller.verifyEmail(
      { user: { userId, restaurantId: null } } as any,
      { code } as any,
    );

  const account = (userId: string) =>
    db.tables.users.find((u) => u.user_id === userId)!;
  return { db, mail, jwt, auth, register, codeMailedTo, verifyByCode, account };
}

const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e).toBeInstanceOf(BadRequestException);
  return (e as BadRequestException).message;
};

const wrongCode = (right: string) =>
  String((Number(right) + 1) % 1_000_000).padStart(6, "0");

describe("OB-3 (t1): the right code from the signed-in person verifies them", () => {
  it("marks email_verified and returns a fresh session that says so", async () => {
    const w = world();
    const { userId } = await w.register("mira@example.com");
    expect(w.account(userId).email_verified).toBe(false);

    const res: any = await w.verifyByCode(
      userId,
      w.codeMailedTo("mira@example.com"),
    );

    expect(res).toMatchObject({ success: true, message: "Email verified" });
    expect(typeof res.accessToken).toBe("string");
    expect((w.jwt.decode(res.accessToken) as any).emailVerified).toBe(true);
    expect(w.account(userId).email_verified).toBe(true);
    // Inside the seven days a code, like the link, keeps the person's password.
    expect(w.account(userId).password_hash).toBeTruthy();
    // The link in the same mail is spent too.
    expect(w.db.tables.email_verifications.every((v) => v.verified_at)).toBe(
      true,
    );
  });

  it("works once: the same code a second time is refused", async () => {
    const w = world();
    const { userId } = await w.register("mira@example.com");
    const code = w.codeMailedTo("mira@example.com");
    await w.verifyByCode(userId, code);
    w.account(userId).email_verified = false;
    expect(await refusal(w.verifyByCode(userId, code))).toBe(CODE_REFUSAL);
  });
});

describe("OB-3 (t2): a code issued for another address is refused", () => {
  it("another account's code does not verify this one, and stays good for its owner", async () => {
    const w = world();
    const a = await w.register("a@example.com");
    const b = await w.register("b@example.com");
    const bCode = w.codeMailedTo("b@example.com");

    expect(await refusal(w.verifyByCode(a.userId, bCode))).toBe(CODE_REFUSAL);
    expect(w.account(a.userId).email_verified).toBe(false);

    await w.verifyByCode(b.userId, bCode);
    expect(w.account(b.userId).email_verified).toBe(true);
  });

  it("a code mailed to an address the account has moved away from is refused", async () => {
    const w = world();
    const { userId } = await w.register("old@example.com");
    const code = w.codeMailedTo("old@example.com");
    w.account(userId).email = "new@example.com";

    expect(await refusal(w.verifyByCode(userId, code))).toBe(CODE_REFUSAL);
    expect(w.account(userId).email_verified).toBe(false);
  });
});

describe("OB-3 (t3): five wrong codes lock it, the same rule as sign-in", () => {
  it("after five wrong tries even the right code no longer works", async () => {
    const w = world();
    const { userId } = await w.register("mira@example.com");
    const right = w.codeMailedTo("mira@example.com");

    for (let i = 0; i < MAX_ATTEMPTS_PER_CODE - 1; i++) {
      expect(await refusal(w.verifyByCode(userId, wrongCode(right)))).toBe(
        CODE_REFUSAL,
      );
    }
    expect(await refusal(w.verifyByCode(userId, wrongCode(right)))).toBe(
      CODE_SPENT,
    );
    expect(await refusal(w.verifyByCode(userId, right))).toBe(CODE_SPENT);
    expect(w.account(userId).email_verified).toBe(false);
  });
});

describe("OB-3 (t4): sign-up says whether the verification mail left", () => {
  it("returns verificationMail 'not_sent' when the send is refused, and still creates the account", async () => {
    const w = world({ success: false, error: "SMTP down" });
    const { body, userId } = await w.register("mira@example.com");
    expect(body.verificationMail).toBe("not_sent");
    expect(body.success).toBe(true);
    expect(typeof body.accessToken).toBe("string");
    expect(w.account(userId)).toBeDefined();
  });

  it("returns verificationMail 'sent' when the send succeeds", async () => {
    const w = world({ success: true });
    const { body } = await w.register("mira@example.com");
    expect(body.verificationMail).toBe("sent");
  });

  it("says 'not_sent' when the send throws, and the sign-up still succeeds", async () => {
    const w = world();
    w.mail.sendEmail.mockRejectedValueOnce(new Error("socket hang up"));
    const { body } = await w.register("mira@example.com");
    expect(body.verificationMail).toBe("not_sent");
    expect(body.success).toBe(true);
  });
});

describe("OB-3 (t5): the mail carries the code and the link, on the paper sheet", () => {
  it("the template shows the six digits and the link, and no #7c2d12 banner", () => {
    const html = verifyEmailTemplate({
      code: "042917",
      verifyUrl: "https://mudavym.com/verify-email?token=tok-1",
    });
    expect(html).toContain("042917");
    expect(html).toContain("https://mudavym.com/verify-email?token=tok-1");
    expect(html.toLowerCase()).not.toContain("#7c2d12");
    expect(html.toLowerCase()).not.toContain("wineops");
  });

  it("the mail registration sends is that template: code, link, no wine banner", async () => {
    const w = world();
    await w.register("mira@example.com");
    const { subject, html } = w.mail.sendEmail.mock.calls[0][0];
    expect(subject).toBe("Verify your Mudavym account");
    expect(html).toContain(w.codeMailedTo("mira@example.com"));
    expect(html).toContain("https://mudavym.com/verify-email?token=");
    expect(html.toLowerCase()).not.toContain("#7c2d12");
  });

  it("without a code (none could be stored) the link still goes, and no code is promised", () => {
    const html = verifyEmailTemplate({
      code: null,
      verifyUrl: "https://mudavym.com/verify-email?token=tok-2",
    });
    expect(html).toContain("https://mudavym.com/verify-email?token=tok-2");
    expect(html).not.toMatch(/Type this code/);
  });
});
