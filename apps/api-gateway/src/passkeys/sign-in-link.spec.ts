import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { EmailCodeLinkDto } from "./dto/passkeys.dto";
import {
  CODE_TTL_MS,
  DAILY_LOCK,
  LINK_REFUSAL,
  LINK_UNREADABLE,
  SignInCodesService,
} from "./sign-in-codes.service";
import { SignInController } from "./sign-in.controller";
import { FakeDb } from "./testing/passkey-harness";
import {
  foldAccount,
  readSignInDevice,
  signInDeviceSecret,
} from "../common/rate-limit/sign-in-device";

// QA round 23 (#953 item 1): 4 codes and 20 wrong guesses lock the address's
// code path for the day; the link in the mail must still open the door.

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "mira@example.com";
const NOBODY = "nobody@example.com";
const JWT = "spec-jwt-secret";
const T0 = Date.parse("2026-11-07T12:00:00Z");

function setup() {
  const db = new FakeDb();
  db.tables.users.push({ user_id: USER, email: EMAIL, name: "Mira Kaya" });
  type Mail = { to: string[]; subject: string; html: string };
  const mail = { sendEmail: jest.fn(async (_m: Mail) => ({ success: true })) };
  const svc = new SignInCodesService({ client: db } as any, mail as any);
  let now = T0;
  svc.now = () => now;
  const tick = (ms: number) => {
    now += ms;
  };
  const last = () => {
    const m = mail.sendEmail.mock.calls[mail.sendEmail.mock.calls.length - 1][0];
    return {
      code: m.subject.slice(0, 6),
      token: /\/login\/code#t=([A-Za-z0-9._-]+)"/.exec(m.html)?.[1] ?? "",
    };
  };
  const session = { accessToken: "a", refreshToken: "r" };
  const auth = { issueSessionForVerifiedSignIn: jest.fn(async () => session) };
  const controller = new SignInController({} as any, svc, auth as any, {
    get: () => JWT,
  } as any);
  return { db, mail, svc, tick, last, auth, controller };
}

const statusOf = (p: Promise<unknown>) =>
  p.then(() => "resolved", (e) => `${e.getStatus?.()} ${e.message}`);
const flush = () => new Promise((r) => setImmediate(r));
const REFUSED = `400 ${LINK_REFUSAL}`;

describe("QA round 23: the code mail carries a link the daily lock cannot close", () => {
  it("after 4 codes and 20 wrong tries the code is locked, and the newest link still signs in", async () => {
    const { svc, last, controller, auth, tick } = setup();
    for (let i = 0; i < 4; i++) {
      tick(1000);
      await svc.issueForSignIn(EMAIL, `203.0.113.${i}`);
      await flush();
      const wrong = last().code === "000000" ? "000001" : "000000";
      for (let j = 0; j < 5; j++) await statusOf(svc.verify("sign_in", EMAIL, wrong));
    }
    const LOCKED = `429 ${DAILY_LOCK}`;
    expect(await statusOf(svc.verify("sign_in", EMAIL, last().code))).toBe(LOCKED);
    const lock = jest.spyOn(svc as any, "assertNotLockedForTheDay");
    const out: any = await controller.emailCodeLink({ token: last().token } as any);
    expect(lock).not.toHaveBeenCalled();
    const call = [USER, "email_code", EMAIL, undefined];
    expect(auth.issueSessionForVerifiedSignIn).toHaveBeenCalledWith(...call);
    expect(out).toMatchObject({ success: true, accessToken: "a", email: EMAIL });
    const secret = signInDeviceSecret(JWT);
    expect(readSignInDevice(secret, out.signInDevice, foldAccount(EMAIL))).toMatch(/^[0-9a-f]{32}$/);
    // The link does not loosen the lock the guesser set: still 20 failures.
    expect(await statusOf(svc.verify("sign_in", EMAIL, "123456"))).toBe(LOCKED);
  });

  it("works once; the second use is refused", async () => {
    const { svc, last } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const { token } = last();
    expect(token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(await svc.verifyLink(token)).toEqual({ userId: USER, email: EMAIL });
    expect(await statusOf(svc.verifyLink(token))).toBe(REFUSED);
  });

  it("refuses a tampered mac, another row's mac, a bad shape, an expired row and an accountless row alike", async () => {
    const { svc, last, db, tick, mail } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await svc.issueForSignIn(NOBODY, null);
    await flush();
    expect(mail.sendEmail.mock.calls.map((c) => c[0].to[0])).toEqual([EMAIL]);
    const mine = last().token;
    const [id, mac] = mine.split(".");
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    const nobody = db.tables.sign_in_codes.find((r) => r.email === NOBODY)!;
    const theirs = svc.linkToken(nobody.id, nobody.code_hash);
    for (const bad of [
      `${id}.${flip(mac, 0)}`,
      `${id}.${flip(mac, mac.length - 1)}`, // a second spelling of the same bytes
      `${id}.${theirs.split(".")[1]}`,
      theirs,
      "nope",
      `${mine}.x`,
      `${id}.${"A".repeat(200)}`,
      `not-a-uuid.${mac}`,
    ]) {
      expect(await statusOf(svc.verifyLink(bad))).toBe(REFUSED);
    }
    tick(CODE_TTL_MS + 1);
    expect(await statusOf(svc.verifyLink(mine))).toBe(REFUSED);
  });

  it("refuses a superseded row and a row the code already consumed", async () => {
    const { svc, last, tick } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const older = last().token;
    tick(1000);
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    expect(await statusOf(svc.verifyLink(older))).toBe(REFUSED);
    const newer = last();
    expect(await svc.verify("sign_in", EMAIL, newer.code)).toBe(USER);
    expect(await statusOf(svc.verifyLink(newer.token))).toBe(REFUSED);
  });

  it("fails closed: an unreadable or unwritable row is a 503, never a session", async () => {
    const { svc, last, db } = setup();
    await svc.issueForSignIn(EMAIL, null);
    await flush();
    const DOWN = `503 ${LINK_UNREADABLE}`;
    db.failReadOn = "sign_in_codes";
    expect(await statusOf(svc.verifyLink(last().token))).toBe(DOWN);
    db.failReadOn = null;
    db.failUpdateOn = "sign_in_codes";
    expect(await statusOf(svc.verifyLink(last().token))).toBe(DOWN);
    expect(db.tables.sign_in_codes[0].consumed_at ?? null).toBeNull();
  });

  it("a step-up mail carries no sign-in link", async () => {
    const { svc, mail } = setup();
    await svc.issueForStepUp(USER, null);
    expect(mail.sendEmail.mock.calls[0][0].html).not.toContain("/login/code");
  });
});

describe("POST /auth/email-code/link body", () => {
  const check = async (body: object) =>
    (
      await validate(plainToInstance(EmailCodeLinkDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it("takes token, signInDevice and lastHouses; refuses unknown fields and long tokens", async () => {
    expect(await check({ token: "t", signInDevice: "d", lastHouses: [] })).toEqual([]);
    expect(await check({ token: "t", email: EMAIL })).toEqual(["email"]);
    expect(await check({ token: "x".repeat(201) })).toEqual(["token"]);
    expect(await check({})).toEqual(["token"]);
  });
});
