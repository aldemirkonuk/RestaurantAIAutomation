import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService, JwtPayload } from "../auth/auth.service";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import { SESSION_ENDED } from "../auth/session-version";
import { SignInController } from "./sign-in.controller";
import { SignInCodesService } from "./sign-in-codes.service";
import { FakeDb } from "./testing/passkey-harness";

/**
 * ADR 0229 fork 6 -- the pre-account-takeover through an emailed code. The
 * founder, 2026-09-27, item 67, verbatim: "option 1 + do what industry do for
 * these, for security ops do what the industry leaders do".
 *
 * The attack (Sudhodanan & Paverd, "Pre-hijacked accounts", USENIX Security
 * 2022, the Unexpired Session class, with this codebase's code door as the
 * victim's action): a stranger registers the victim's address with a password
 * of their own and keeps a session; the victim, told the address is taken,
 * signs in with "Email me a code"; that code is the first proof of the
 * mailbox. Before this change it flipped `email_verified` and left the
 * stranger's password and sessions standing -- now verified.
 *
 * Driven through the real code end to end: the public registration
 * (`AuthService.registerAccount`), the real `SignInCodesService` (the code is
 * read out of the mail it sends), the real `SignInController` route, the real
 * `JwtService` and `JwtStrategy` (the guard's check on every request) and the
 * real refresh, over the in-memory `FakeDb`, which hands out copies of rows as
 * PostgREST does.
 */

const VICTIM = "victim@example.com";
const STRANGER_PASSWORD = "the stranger's password";
const SECRETS: Record<string, string> = {
  JWT_SECRET: "pre-hijack-spec-access-secret",
  JWT_REFRESH_SECRET: "pre-hijack-spec-refresh-secret",
};

type Mail = { to: string[]; subject: string; html: string };

function world() {
  const db = new FakeDb();
  db.tables.user_restaurant_access = [];
  db.tables.user_roles = [];
  db.tables.email_verifications = [];
  const authMail = {
    sendEmail: jest.fn(
      async (_m: Mail) =>
        ({ success: true }) as { success: boolean; error?: string },
    ),
  };
  const codeMail = {
    sendEmail: jest.fn(async (_m: Mail) => ({ success: true })),
  };
  const jwt = new JwtService({});
  const auth = new AuthService(
    jwt,
    { get: (k: string) => SECRETS[k] } as any,
    { supabase: db, client: db } as any,
    { isBlacklisted: async () => false } as any,
    authMail as any,
  );
  const sockets = { endStaleSessions: jest.fn(() => 0) };
  (auth as any).websocketGateway = sockets;
  const codes = new SignInCodesService({ client: db } as any, codeMail as any);
  const route = new SignInController({} as any, codes, auth);
  const guard = (accessToken: string) =>
    new JwtStrategy(auth).validate(jwt.decode(accessToken) as JwtPayload);

  /** "Email me a sign-in code", then type the code from the mail. */
  async function codeSignIn(email = VICTIM) {
    await route.emailCode(
      { email } as any,
      {
        headers: {},
        socket: {},
      } as any,
    );
    await new Promise((r) => setImmediate(r)); // the send is not awaited
    const calls = codeMail.sendEmail.mock.calls;
    const code = calls[calls.length - 1][0].subject.slice(0, 6);
    return route.emailCodeVerify({ email, code } as any);
  }

  const account = () => db.tables.users.find((u) => u.email === VICTIM)!;
  const removalMails = () =>
    authMail.sendEmail.mock.calls
      .map((c) => c[0])
      .filter((m) => /password nobody confirmed/.test(m.subject));
  return {
    db,
    auth,
    jwt,
    guard,
    codeSignIn,
    account,
    authMail,
    sockets,
    removalMails,
  };
}

async function refusedAsEnded(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(UnauthorizedException);
  expect((err as UnauthorizedException).getResponse()).toMatchObject({
    code: SESSION_ENDED,
  });
}

async function strangerRegisters(w: ReturnType<typeof world>) {
  const registered = await w.auth.registerAccount({
    email: VICTIM,
    password: STRANGER_PASSWORD,
    name: "Not the owner",
  } as any);
  const signedIn = await w.auth.login({
    email: VICTIM,
    password: STRANGER_PASSWORD,
  });
  return { registered, signedIn };
}

describe("fork 6 (item 67): the first emailed code ends a stranger's pre-registration", () => {
  it("the whole attack: the stranger's password, access tokens and refresh tokens all stop working, and the owner's session is verified", async () => {
    const w = world();
    const { registered, signedIn } = await strangerRegisters(w);

    // Before the owner arrives: an unverified account, the stranger's
    // password works, and their session is live but unverified.
    expect(w.account().email_verified).toBe(false);
    expect((await w.guard(signedIn.accessToken)).emailVerified).toBe(false);

    const owner = await w.codeSignIn();

    // The first proof of the mailbox verified the address, removed the
    // password nobody had proved, and moved the session version.
    expect(w.account().email_verified).toBe(true);
    expect(w.account().password_hash).toBeNull();
    expect(w.account().session_version).toBe(1);

    // The stranger's password no longer signs in.
    await expect(
      w.auth.login({ email: VICTIM, password: STRANGER_PASSWORD }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "NO_SIGNIN_METHOD" }),
    });
    // Every token minted before the proof is refused: both sign-ins' access
    // tokens on every request, and their refresh tokens.
    await refusedAsEnded(w.guard(registered.accessToken));
    await refusedAsEnded(w.guard(signedIn.accessToken));
    await refusedAsEnded(w.auth.refreshAccessToken(registered.refreshToken));
    await refusedAsEnded(w.auth.refreshAccessToken(signedIn.refreshToken));
    // Their open sockets are closed too.
    expect(w.sockets.endStaleSessions).toHaveBeenCalledWith(
      w.account().user_id,
      1,
    );

    // The owner's session is the one that survives, verified.
    const me = await w.guard(owner.accessToken);
    expect(me.emailVerified).toBe(true);
    await expect(
      w.auth.refreshAccessToken(owner.refreshToken),
    ).resolves.toBeTruthy();
  });

  it("the address is told the password was removed and every other session signed out -- with no secret and no link", async () => {
    const w = world();
    await strangerRegisters(w);
    w.authMail.sendEmail.mockClear();

    await w.codeSignIn();

    const mails = w.removalMails();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([VICTIM]);
    expect(mails[0].html).toContain("we removed that password");
    expect(mails[0].html).toContain("signed out every other session");
    expect(mails[0].html).not.toContain(STRANGER_PASSWORD);
    expect(mails[0].html).not.toMatch(/href="https?:/);
    expect(mails[0].html).not.toContain("Not the owner"); // the stranger's typed name is not echoed as a greeting
  });

  it("a notice that cannot be sent never fails the sign-in or undoes the removal", async () => {
    const w = world();
    await strangerRegisters(w);
    w.authMail.sendEmail.mockRejectedValue(new Error("smtp down"));

    const owner = await w.codeSignIn();

    expect(owner.accessToken).toBeTruthy();
    expect(w.account().password_hash).toBeNull();
    expect(w.account().email_verified).toBe(true);
  });

  it("a later code on the now-verified account changes nothing: no second bump, no mail", async () => {
    const w = world();
    await strangerRegisters(w);
    const first = await w.codeSignIn();
    w.authMail.sendEmail.mockClear();

    const second = await w.codeSignIn();

    expect(w.account().session_version).toBe(1);
    expect(w.removalMails()).toHaveLength(0);
    // Both of the owner's own sessions are still live.
    expect((await w.guard(first.accessToken)).emailVerified).toBe(true);
    expect((await w.guard(second.accessToken)).emailVerified).toBe(true);
  });
});

describe("fork 6: what the first code does NOT touch", () => {
  it("an already-verified account keeps its password and every session -- a code is just a sign-in", async () => {
    const w = world();
    const { signedIn } = await strangerRegisters(w);
    w.account().email_verified = true; // proved earlier, e.g. by the link

    await w.codeSignIn();

    expect(w.account().password_hash).toEqual(expect.any(String));
    expect(w.account().session_version).toBe(0);
    await expect(
      w.auth.login({ email: VICTIM, password: STRANGER_PASSWORD }),
    ).resolves.toBeTruthy();
    expect((await w.guard(signedIn.accessToken)).emailVerified).toBe(true);
    expect(w.removalMails()).toHaveLength(0);
  });

  it("an unverified account with no password is verified and its earlier sessions end, with no removal mail", async () => {
    const w = world();
    w.db.tables.users.push({
      user_id: "55555555-5555-4555-8555-555555555555",
      email: VICTIM,
      name: "Mira",
      password_hash: null,
      email_verified: false,
      session_version: 0,
    });

    const owner = await w.codeSignIn();

    expect(w.account().email_verified).toBe(true);
    expect(w.account().session_version).toBe(1);
    expect(w.removalMails()).toHaveLength(0);
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
  });

  it("a passkey sign-in removes nothing: it proves the device, not the mailbox", async () => {
    const w = world();
    await strangerRegisters(w);
    const { user_id } = w.account();

    await w.auth.issueSessionForVerifiedSignIn(user_id, "passkey", VICTIM);

    expect(w.account().password_hash).toEqual(expect.any(String));
    expect(w.account().email_verified).toBe(false);
    expect(w.account().session_version).toBe(0);
  });

  it("a code for an address the account has moved away from removes nothing", async () => {
    const w = world();
    await strangerRegisters(w);
    const { user_id } = w.account();

    await w.auth.issueSessionForVerifiedSignIn(
      user_id,
      "email_code",
      "someone-else@example.com",
    );

    expect(w.account().password_hash).toEqual(expect.any(String));
    expect(w.account().email_verified).toBe(false);
    expect(w.account().session_version).toBe(0);
  });
});

describe("fork 6: a reset link proves the mailbox too", () => {
  const TOKEN = "44444444-4444-4444-8444-444444444444";
  function resetRow(w: ReturnType<typeof world>, email = VICTIM) {
    w.db.tables.password_resets = [
      {
        id: "r1",
        token: TOKEN,
        user_id: w.account().user_id,
        email,
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        used_at: null,
      },
    ];
  }

  it("the owner who resets instead of using a code verifies the address, ends the stranger's sessions, and a later code keeps the owner's password", async () => {
    const w = world();
    const { signedIn } = await strangerRegisters(w);
    resetRow(w);

    await w.auth.resetPassword(TOKEN, "the owner's own password");

    expect(w.account().email_verified).toBe(true);
    expect(w.account().session_version).toBe(1);
    await refusedAsEnded(w.guard(signedIn.accessToken));
    await expect(
      w.auth.login({ email: VICTIM, password: STRANGER_PASSWORD }),
    ).rejects.toThrow(/Invalid credentials/);

    await w.codeSignIn();

    expect(w.account().password_hash).toEqual(expect.any(String));
    expect(w.account().session_version).toBe(1);
    expect(w.removalMails()).toHaveLength(0);
    await expect(
      w.auth.login({ email: VICTIM, password: "the owner's own password" }),
    ).resolves.toBeTruthy();
  });

  it("an address change racing the reset's write is not verified by the old mailbox", async () => {
    const w = world();
    await strangerRegisters(w);
    resetRow(w);
    const from = w.db.from.bind(w.db);
    let armed = true;
    w.db.from = (table: string) => {
      const q: any = from(table);
      if (table !== "users") return q;
      const update = q.update.bind(q);
      q.update = (payload: any) => {
        if (armed && payload?.email_verified === true) {
          armed = false;
          w.db.tables.users[0].email = "moved@example.com";
        }
        return update(payload);
      };
      return q;
    };

    await w.auth.resetPassword(TOKEN, "the owner's own password");

    expect(w.db.tables.users[0].email_verified).toBe(false);
  });

  it("a reset link mailed to an address the account has since left sets the password but verifies nothing", async () => {
    const w = world();
    await strangerRegisters(w);
    resetRow(w, "old-address@example.com");

    await w.auth.resetPassword(TOKEN, "the owner's own password");

    expect(w.account().email_verified).toBe(false);
    expect(w.account().session_version).toBe(1);
  });
});

describe("fork 6: the write is one compare-and-set, and a race fails closed", () => {
  /**
   * Make the row move just before the code's write lands, the way a racing
   * write in another request would.
   */
  function raceBeforeTheWrite(db: FakeDb, move: (row: any) => void) {
    const from = db.from.bind(db);
    let armed = true;
    db.from = (table: string) => {
      const q: any = from(table);
      if (table !== "users") return q;
      const update = q.update.bind(q);
      q.update = (payload: any) => {
        if (armed && payload && payload.email_verified === true) {
          armed = false;
          move(db.tables.users.find((u) => u.email === VICTIM));
        }
        return update(payload);
      };
      return q;
    };
  }

  it("a link verification landing first keeps the password it proved: the code's write misses and removes nothing", async () => {
    const w = world();
    await strangerRegisters(w);
    raceBeforeTheWrite(w.db, (row) => {
      row.email_verified = true; // the emailed link was clicked a moment earlier
    });

    const owner = await w.codeSignIn();

    expect(w.account().password_hash).toEqual(expect.any(String));
    expect(w.account().session_version).toBe(0);
    expect(w.removalMails()).toHaveLength(0);
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
  });

  it("a reset landing first is not overwritten: it verified the address with the owner's new password, so the code removes nothing", async () => {
    const w = world();
    await strangerRegisters(w);
    raceBeforeTheWrite(w.db, (row) => {
      // What resetPassword writes in one update when the link was mailed to
      // the account's address: a new hash, the next version, verified.
      row.password_hash = "$2b$04$reset-hash-written-by-the-owner";
      row.session_version = 1;
      row.email_verified = true;
    });

    const owner = await w.codeSignIn();

    expect(w.account().password_hash).toBe(
      "$2b$04$reset-hash-written-by-the-owner",
    );
    expect(w.account().session_version).toBe(1);
    expect(w.removalMails()).toHaveLength(0);
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
  });

  it("a version that moved without verifying (a racing write) is re-read, and the retry acts on the row as it now is", async () => {
    const w = world();
    const { signedIn } = await strangerRegisters(w);
    raceBeforeTheWrite(w.db, (row) => {
      row.session_version = 1; // some write that ended sessions but proved nothing
    });

    const owner = await w.codeSignIn();

    expect(w.account().email_verified).toBe(true);
    expect(w.account().password_hash).toBeNull();
    expect(w.account().session_version).toBe(2);
    await refusedAsEnded(w.guard(signedIn.accessToken));
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
  });

  it("an address change landing first verifies nothing and removes nothing", async () => {
    const w = world();
    await strangerRegisters(w);
    raceBeforeTheWrite(w.db, (row) => {
      row.email = "moved@example.com";
    });

    await w.codeSignIn();

    const row = w.db.tables.users[0];
    expect(row.email_verified).toBe(false);
    expect(row.password_hash).toEqual(expect.any(String));
    expect(row.session_version).toBe(0);
  });

  it("a failed write mints an unverified session and removes nothing", async () => {
    const w = world();
    await strangerRegisters(w);
    w.db.failUpdateOn = "users";

    const owner = await w.codeSignIn();

    expect(w.account().email_verified).toBe(false);
    expect(w.account().password_hash).toEqual(expect.any(String));
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(false);
  });
});
