import "reflect-metadata";
import { BadRequestException, HttpException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import {
  CODE_REFUSAL,
  CODE_SPENT,
  DAILY_LOCK,
  MAX_ATTEMPTS_PER_CODE,
} from "../passkeys/sign-in-codes.service";
import { FakeDb } from "../passkeys/testing/passkey-harness";

/**
 * Onboarding OB-6: `/verify-email`'s code box words a refusal from its status
 * and code, never the gateway's prose. `SignInCodesService` answers a wrong
 * code and a spent one (five wrong tries) with the same 400 and only different
 * sentences, so `verifyEmailWithCode` now tags each with a code. The message
 * is kept, so every #789 assertion on it still holds.
 */

const SECRETS: Record<string, string> = {
  JWT_SECRET: "verify-code-refusal-spec-access-secret",
  JWT_REFRESH_SECRET: "verify-code-refusal-spec-refresh-secret",
  FRONTEND_URL: "https://mudavym.com",
};

function world() {
  const db = new FakeDb();
  db.tables.user_restaurant_access = [];
  db.tables.user_roles = [];
  db.tables.email_verifications = [];
  const mail = {
    sendEmail: jest.fn(async (_m: { to: string[]; html: string }) => ({
      success: true,
      messageId: "m1",
    })),
  };
  const auth = new AuthService(
    new JwtService({}),
    { get: (k: string) => SECRETS[k] } as any,
    { supabase: db, client: db } as any,
    { isBlacklisted: async () => false } as any,
    mail as any,
  );
  (auth as any).websocketGateway = { endStaleSessions: jest.fn(() => 0) };
  const controller = new AuthController(auth);
  return { db, mail, auth, controller };
}

async function registered(w: ReturnType<typeof world>, email: string) {
  await w.controller.registerAccount({
    email,
    password: "a password of my own",
    name: "Mira Kaya",
  } as any);
  const userId = w.db.tables.users.find((u) => u.email === email)!
    .user_id as string;
  const html = w.mail.sendEmail.mock.calls.at(-1)![0].html;
  const code = /(\d{6}) — your Mudavym code/.exec(html)![1];
  return { userId, code };
}

const wrong = (right: string) =>
  String((Number(right) + 1) % 1_000_000).padStart(6, "0");

async function refusedWith(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  const e = err as HttpException;
  return {
    status: e.getStatus(),
    body: e.getResponse() as { code?: string; message?: string },
  };
}

describe("OB-6: a verify_email code's refusal carries a code", () => {
  it("a wrong code is 400 CODE_REFUSED, its message unchanged", async () => {
    const w = world();
    const { userId, code } = await registered(w, "mira@example.com");
    const r = await refusedWith(w.auth.verifyEmailWithCode(wrong(code), userId));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "CODE_REFUSED", message: CODE_REFUSAL });
  });

  it("the fifth wrong try spends the code: 400 CODE_SPENT", async () => {
    const w = world();
    const { userId, code } = await registered(w, "mira@example.com");
    for (let i = 0; i < MAX_ATTEMPTS_PER_CODE - 1; i++) {
      await w.auth.verifyEmailWithCode(wrong(code), userId).catch(() => null);
    }
    const fifth = await refusedWith(
      w.auth.verifyEmailWithCode(wrong(code), userId),
    );
    expect(fifth.body).toMatchObject({ code: "CODE_SPENT", message: CODE_SPENT });
    const after = await refusedWith(w.auth.verifyEmailWithCode(code, userId));
    expect(after.status).toBe(400);
    expect(after.body.code).toBe("CODE_SPENT");
  });

  it("the address's daily lock is 429 CODE_LOCKED_FOR_THE_DAY", async () => {
    const w = world();
    const { userId } = await registered(w, "mira@example.com");
    // Twenty wrong tries already counted against the address today.
    const now = new Date().toISOString();
    for (let i = 0; i < 4; i++) {
      w.db.tables.sign_in_codes.push({
        id: `spent-${i}`,
        email: "mira@example.com",
        user_id: userId,
        purpose: "verify_email",
        code_hash: "00",
        attempts: 5,
        created_at: now,
        expires_at: now,
        consumed_at: null,
      });
    }
    const r = await refusedWith(w.auth.verifyEmailWithCode("123456", userId));
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({
      code: "CODE_LOCKED_FOR_THE_DAY",
      message: DAILY_LOCK,
    });
  });

  it("keeps BadRequestException for a 400, as #789's specs read it", async () => {
    const w = world();
    const { userId, code } = await registered(w, "mira@example.com");
    await expect(
      w.auth.verifyEmailWithCode(wrong(code), userId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
