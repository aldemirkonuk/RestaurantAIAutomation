import "reflect-metadata";
import { JwtService } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService, VERIFICATION_SEND_BOUND_MS } from "./auth.service";
import { FakeDb } from "../passkeys/testing/passkey-harness";

/**
 * Onboarding OB-6 (founder /goal 2026-11-07; proposal
 * p4-scratch/sw-walk/onboarding/proposal.md §3 OB-6). Since #789, sign-up and
 * resend await the verification send so they can say whether it left. Gmail's
 * `messages.send` has no timeout (`gmail.service.ts` bounds only the OAuth
 * token fetch), so a hung send held "Create account" open forever.
 *
 * Now the send is raced against `VERIFICATION_SEND_BOUND_MS`. A send still
 * open at the bound answers 'unconfirmed' -- it may still leave, so it is never
 * 'not_sent' -- and its late answer is still logged.
 *
 * Driven through the real `AuthService` and `AuthController` over the
 * in-memory `FakeDb`; `sendEmail` and bcrypt are mocks. bcrypt is stubbed
 * because its real hash runs on the libuv pool: under parallel jest workers it
 * outran a fixed count of ticks and the send had not been called yet (audit,
 * 2026-11-07). The wait below is on a wall-clock deadline instead.
 */

jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed"),
  compare: jest.fn(),
}));

const SECRETS: Record<string, string> = {
  JWT_SECRET: "verification-mail-timeout-spec-access-secret",
  JWT_REFRESH_SECRET: "verification-mail-timeout-spec-refresh-secret",
  FRONTEND_URL: "https://mudavym.com",
};

type SendAnswer = { success: boolean; error?: string; messageId?: string };

function world() {
  const db = new FakeDb();
  db.tables.user_restaurant_access = [];
  db.tables.user_roles = [];
  db.tables.email_verifications = [];
  const mail = { sendEmail: jest.fn<Promise<SendAnswer>, [unknown]>() };
  const auth = new AuthService(
    new JwtService({}),
    { get: (k: string) => SECRETS[k] } as any,
    { supabase: db, client: db } as any,
    { isBlacklisted: async () => false } as any,
    mail as any,
  );
  (auth as any).websocketGateway = { endStaleSessions: jest.fn(() => 0) };
  const controller = new AuthController(auth);
  const logger = (auth as any).logger;
  const register = (email: string) =>
    controller.registerAccount({
      email,
      password: "a password of my own",
      name: "Mira Kaya",
    } as any) as Promise<any>;
  const userId = (email: string) =>
    db.tables.users.find((u) => u.email === email)!.user_id as string;
  return { db, mail, auth, register, userId, logger };
}

/** A send that answers only when the test says so. */
function hungSend() {
  let release: (answer: SendAnswer) => void = () => undefined;
  const promise = new Promise<SendAnswer>((resolve) => {
    release = resolve;
  });
  return { promise, release: (a: SendAnswer) => release(a) };
}

/**
 * Let microtasks and real I/O run until the send has been called, up to a
 * wall-clock deadline. `process.hrtime` is not faked, so the deadline is real
 * time however busy the machine is, never a count of ticks.
 */
async function untilSendIsCalled(mail: { sendEmail: jest.Mock }, n = 1) {
  const deadline = process.hrtime.bigint() + 10_000_000_000n;
  while (
    mail.sendEmail.mock.calls.length < n &&
    process.hrtime.bigint() < deadline
  ) {
    await new Promise((r) => setImmediate(r));
  }
  expect(mail.sendEmail).toHaveBeenCalledTimes(n);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] });
});
afterEach(() => {
  jest.useRealTimers();
});

describe("OB-6 (t1): a send that never answers does not hold sign-up open", () => {
  it("answers verificationMail 'unconfirmed' at the bound, and the account exists", async () => {
    const w = world();
    const hung = hungSend();
    w.mail.sendEmail.mockReturnValueOnce(hung.promise);
    let answered = false;
    const pending = w.register("mira@example.com").then((body) => {
      answered = true;
      return body;
    });
    await untilSendIsCalled(w.mail);

    await jest.advanceTimersByTimeAsync(VERIFICATION_SEND_BOUND_MS - 1);
    expect(answered).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const body = await pending;
    expect(body.verificationMail).toBe("unconfirmed");
    expect(body.verificationMail).not.toBe("not_sent");
    expect(typeof body.accessToken).toBe("string");
    expect(w.userId("mira@example.com")).toBeTruthy();
  });

  it("still logs the late send's answer after the bound", async () => {
    const w = world();
    const logged = jest.spyOn(w.logger, "log");
    const hung = hungSend();
    w.mail.sendEmail.mockReturnValueOnce(hung.promise);
    const pending = w.register("mira@example.com");
    await untilSendIsCalled(w.mail);
    await jest.advanceTimersByTimeAsync(VERIFICATION_SEND_BOUND_MS);
    expect((await pending).verificationMail).toBe("unconfirmed");

    hung.release({ success: true, messageId: "late-1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("left after the bound (id: late-1)"),
    );
  });
});

describe("OB-6 (t2): a refused send is still 'not_sent'", () => {
  it("answers 'not_sent' when sendEmail resolves { success: false } inside the bound", async () => {
    const w = world();
    w.mail.sendEmail.mockResolvedValueOnce({
      success: false,
      error: "quota",
    });
    const body = await w.register("mira@example.com");
    expect(body.verificationMail).toBe("not_sent");
  });

  it("answers 'sent' when sendEmail succeeds inside the bound", async () => {
    const w = world();
    w.mail.sendEmail.mockResolvedValueOnce({ success: true, messageId: "m1" });
    const body = await w.register("mira@example.com");
    expect(body.verificationMail).toBe("sent");
  });
});

describe("OB-6 (t3): a resend on a hung send", () => {
  it("answers { sent: false, verificationMail: 'unconfirmed' }", async () => {
    const w = world();
    w.mail.sendEmail.mockResolvedValueOnce({ success: true, messageId: "m1" });
    await w.register("mira@example.com");
    const id = w.userId("mira@example.com");

    const hung = hungSend();
    w.mail.sendEmail.mockReturnValueOnce(hung.promise);
    const pending = w.auth.resendVerification(id, "mira@example.com");
    await untilSendIsCalled(w.mail, 2);
    await jest.advanceTimersByTimeAsync(VERIFICATION_SEND_BOUND_MS);

    await expect(pending).resolves.toEqual({
      sent: false,
      verificationMail: "unconfirmed",
    });
  });
});
