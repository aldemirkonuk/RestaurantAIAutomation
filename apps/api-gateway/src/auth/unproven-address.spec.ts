import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService, JwtPayload } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SESSION_ENDED } from "./session-version";
import {
  UNPROVEN_PASSWORD_WINDOW_MS,
  inviteVerifiesAddress,
  unprovenPasswordHasLapsed,
} from "./unproven-address";
import { SignInController } from "../passkeys/sign-in.controller";
import { SignInCodesService } from "../passkeys/sign-in-codes.service";
import { FakeDb } from "../passkeys/testing/passkey-harness";

/**
 * ADR 0229 forks 7 and 8 -- the founder, 2026-09-27:
 *   item 72, "Bind invite to address (Recommended)": an invitation verifies
 *     the account it creates only when the joiner's address is the one the
 *     invite was made for; otherwise the account starts unverified.
 *   item 73, "Expire the password, 7 days (Recommended)": an account still
 *     unverified seven days after registration keeps its row, but its
 *     unproven password no longer signs in -- with the wrong-password answer;
 *     the emailed code still does.
 *
 * Driven end to end through the real `AuthService` (generateInvite,
 * joinViaInvite, registerAccount, login, refresh), the real
 * `SignInCodesService` + `SignInController` (the code is read out of the mail
 * it sends), the real `JwtService` and `JwtStrategy`, over the in-memory
 * `FakeDb`.
 */

const SECRETS: Record<string, string> = {
  JWT_SECRET: "unproven-address-spec-access-secret",
  JWT_REFRESH_SECRET: "unproven-address-spec-refresh-secret",
};
const HOUSE = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const MINTER = "33333333-3333-4333-8333-333333333333";
const VICTIM = "victim@example.com";
const ATTACKER_PASSWORD = "the attacker's own password";
const DAY = 24 * 60 * 60 * 1000;

type Mail = { to: string[]; subject: string; html: string };

function world() {
  const db = new FakeDb();
  db.tables.restaurants = [{ id: HOUSE, organization_id: ORG, name: "H" }];
  db.tables.users = [
    {
      user_id: MINTER,
      email: "minter@example.com",
      name: "Minter",
      password_hash: null,
      email_verified: true,
      session_version: 0,
      created_at: new Date(Date.now() - 90 * DAY).toISOString(),
    },
  ];
  db.tables.user_restaurant_access = [
    { user_id: MINTER, restaurant_id: HOUSE, role: "owner", is_active: true },
  ];
  db.tables.user_roles = [];
  db.tables.organization_invites = [];
  db.tables.organization_members = [];
  db.tables.team_members = [];
  db.tables.user_onboarding_progress = [];
  db.tables.email_verifications = [];
  // PostgREST returns only the columns a select names; the in-memory builder
  // returns whole rows. Project the invite reads, so a join that forgets to
  // ask for `target_email` sees none -- as it would in production.
  const from = db.from.bind(db);
  db.from = ((table: string) => {
    const q: any = from(table);
    if (table !== "organization_invites") return q;
    const select = q.select.bind(q);
    const then = q.then.bind(q);
    let cols: string[] | null = null;
    q.select = (c?: string) => {
      if (c && c.trim() !== "*") cols = c.split(",").map((s) => s.trim());
      return select(c);
    };
    q.then = (ok: any, bad: any) =>
      then((res: { data: any; error: any }) => {
        const pick = (r: any) =>
          cols ? Object.fromEntries(cols.map((k) => [k, r[k]])) : r;
        const data = Array.isArray(res.data)
          ? res.data.map(pick)
          : res.data && pick(res.data);
        return ok ? ok({ ...res, data }) : { ...res, data };
      }, bad);
    return q;
  }) as any;
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
  (auth as any).websocketGateway = { endStaleSessions: jest.fn(() => 0) };
  const codes = new SignInCodesService({ client: db } as any, codeMail as any);
  const route = new SignInController({} as any, codes, auth);
  const guard = (accessToken: string) =>
    new JwtStrategy(auth).validate(jwt.decode(accessToken) as JwtPayload);

  async function codeSignIn(email: string) {
    await route.emailCode({ email } as any, { headers: {}, socket: {} } as any);
    await new Promise((r) => setImmediate(r)); // the send is not awaited
    const calls = codeMail.sendEmail.mock.calls;
    const code = calls[calls.length - 1][0].subject.slice(0, 6);
    return route.emailCodeVerify({ email, code } as any);
  }

  async function invite(targetEmail?: string) {
    const made = (await auth.generateInvite(MINTER, HOUSE, {
      restaurantId: HOUSE,
      role: "staff",
      ...(targetEmail !== undefined ? { targetEmail } : {}),
    } as any)) as { code: string };
    // The column default the baseline declares (`now() + '7 days'`), which
    // the in-memory table does not apply by itself.
    const minted = db.tables.organization_invites.find(
      (i) => i.code === made.code,
    )!;
    minted.expires_at ??= new Date(Date.now() + 7 * DAY).toISOString();
    minted.used_at ??= null;
    return made.code;
  }

  const join = (code: string, email: string, password = ATTACKER_PASSWORD) =>
    auth.joinViaInvite({ code, email, name: "Joiner", password } as any);

  const row = (email: string) => db.tables.users.find((u) => u.email === email);
  const verificationMails = () =>
    authMail.sendEmail.mock.calls
      .map((c) => c[0])
      .filter((m) => /Verify your Mudavym account/.test(m.subject));
  const settle = () => new Promise((r) => setImmediate(r));

  return {
    db,
    auth,
    guard,
    codeSignIn,
    invite,
    join,
    row,
    verificationMails,
    settle,
  };
}

/** The refusal a wrong password gets, captured from the real code. */
async function refusal(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(UnauthorizedException);
  return {
    status: (err as UnauthorizedException).getStatus(),
    body: (err as UnauthorizedException).getResponse(),
  };
}

/* ── fork 7 ─────────────────────────────────────────────────────────────── */

describe("fork 7 (item 72): an invite verifies only the address it was made for", () => {
  it("the invite remembers its address, trimmed and lower-cased", async () => {
    const w = world();
    await w.invite("  Alice@Example.COM ");
    expect(w.db.tables.organization_invites[0].target_email).toBe(
      "alice@example.com",
    );
    await w.invite();
    expect(w.db.tables.organization_invites[1].target_email).toBeNull();
  });

  it("a join with the invited address (any case, any spacing) is verified at once, and no verification mail goes out", async () => {
    const w = world();
    const code = await w.invite("Alice@Example.com");

    const s = await w.join(code, "  alice@EXAMPLE.com ", "alice's password");
    await w.settle();

    const alice = w.row("alice@example.com")!;
    expect(alice).toBeDefined(); // stored in the one spelling the code door looks up
    expect(alice.email_verified).toBe(true);
    expect((await w.guard(s.accessToken)).emailVerified).toBe(true);
    expect(w.verificationMails()).toHaveLength(0);
    expect(w.db.tables.email_verifications).toHaveLength(0);
  });

  it("an invite made with no address creates an UNVERIFIED account and mails the link to the typed address", async () => {
    const w = world();
    const code = await w.invite();

    const s = await w.join(code, "bob@example.com");
    await w.settle();

    expect(w.row("bob@example.com")!.email_verified).toBe(false);
    expect((await w.guard(s.accessToken)).emailVerified).toBe(false);
    const mails = w.verificationMails();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(["bob@example.com"]);
    expect(w.db.tables.email_verifications).toHaveLength(1);
  });

  it("a join with a different address than the invite's is unverified", async () => {
    const w = world();
    const code = await w.invite("alice@example.com");

    await w.join(code, "mallory@example.com");
    await w.settle();

    expect(w.row("mallory@example.com")!.email_verified).toBe(false);
    expect(w.verificationMails().map((m) => m.to)).toEqual([
      ["mallory@example.com"],
    ]);
  });

  it("an invite minted before this change (no target_email at all) verifies nobody", async () => {
    const w = world();
    const code = await w.invite();
    delete w.db.tables.organization_invites[0].target_email;

    await w.join(code, "carol@example.com");
    expect(w.row("carol@example.com")!.email_verified).toBe(false);
  });

  it("the attack end to end: a stolen or self-minted invite with no address, a victim's address and the attacker's password -- the victim's first emailed code takes the account back", async () => {
    const w = world();
    const code = await w.invite(); // any house owner can mint one
    const attacker = await w.join(code, VICTIM);
    await w.settle();

    // Before: the stranger's account is NOT verified (it was, until item 72),
    // so their session reaches only the escape hatches.
    expect(w.row(VICTIM)!.email_verified).toBe(false);
    expect((await w.guard(attacker.accessToken)).emailVerified).toBe(false);

    // The victim, told the address is taken, asks for a code.
    const owner = await w.codeSignIn(VICTIM);

    // Fork 6 fires because the address was unproven: the attacker's password
    // is gone, their sessions end, and the victim's session is verified.
    expect(w.row(VICTIM)!.email_verified).toBe(true);
    expect(w.row(VICTIM)!.password_hash).toBeNull();
    await expect(
      w.auth.login({ email: VICTIM, password: ATTACKER_PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const ended = await refusal(w.guard(attacker.accessToken));
    expect(ended.body).toMatchObject({ code: SESSION_ENDED });
    const endedRefresh = await refusal(
      w.auth.refreshAccessToken(attacker.refreshToken),
    );
    expect(endedRefresh.body).toMatchObject({ code: SESSION_ENDED });
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
  });
});

/* ── fork 8 ─────────────────────────────────────────────────────────────── */

describe("fork 8 (item 73): an unproven password stops signing in after seven days", () => {
  async function registered(w: ReturnType<typeof world>, ageMs: number) {
    await w.auth.registerAccount({
      email: VICTIM,
      password: ATTACKER_PASSWORD,
      name: "Not the owner",
    } as any);
    w.row(VICTIM)!.created_at = new Date(Date.now() - ageMs).toISOString();
    return w.row(VICTIM)!;
  }

  it("inside the window the unproven password still signs in", async () => {
    const w = world();
    await registered(w, 7 * DAY - 60_000);
    await expect(
      w.auth.login({ email: VICTIM, password: ATTACKER_PASSWORD }),
    ).resolves.toHaveProperty("accessToken");
  });

  it("past seven days the right password gets exactly the wrong-password answer, and the row is kept", async () => {
    const w = world();
    await registered(w, 7 * DAY + 60_000);
    const before = w.db.tables.users.length;

    const right = await refusal(
      w.auth.login({ email: VICTIM, password: ATTACKER_PASSWORD }),
    );
    const wrong = await refusal(
      w.auth.login({ email: VICTIM, password: "not the password" }),
    );
    const nobody = await refusal(
      w.auth.login({ email: "nobody@example.com", password: "x" }),
    );

    expect(right).toEqual(wrong); // no enumeration of "unverified" or "lapsed"
    expect(right).toEqual(nobody);
    expect(right.status).toBe(401);
    expect(w.db.tables.users.length).toBe(before); // ADR 0149 answer 2
    expect(w.row(VICTIM)!.password_hash).toEqual(expect.any(String));
  });

  it("a verified account's password never lapses, however old", async () => {
    const w = world();
    const r = await registered(w, 400 * DAY);
    r.email_verified = true;
    await expect(
      w.auth.login({ email: VICTIM, password: ATTACKER_PASSWORD }),
    ).resolves.toHaveProperty("accessToken");
  });

  it("the attack end to end: a months-old pre-registration's password is dead, and the owner's emailed code still signs in, verifies and removes it", async () => {
    const w = world();
    await registered(w, 60 * DAY);

    await expect(
      w.auth.login({ email: VICTIM, password: ATTACKER_PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const owner = await w.codeSignIn(VICTIM);

    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
    expect(w.row(VICTIM)!.email_verified).toBe(true);
    expect(w.row(VICTIM)!.password_hash).toBeNull(); // fork 6
  });

  it("the invite door honours the lapse: a lapsed unproven password cannot join another house as that account", async () => {
    const w = world();
    const victim = await registered(w, 8 * DAY);
    const code = await w.invite();

    const joined = await refusal(w.join(code, VICTIM, ATTACKER_PASSWORD));
    const wrong = await refusal(
      w.auth.login({ email: VICTIM, password: "not the password" }),
    );

    expect(joined).toEqual(wrong);
    expect(
      w.db.tables.user_restaurant_access.some(
        (a) => a.user_id === victim.user_id,
      ),
    ).toBe(false);
  });

  it("inside the window the invite door still accepts the account's own password", async () => {
    const w = world();
    const victim = await registered(w, 2 * DAY);
    const code = await w.invite();

    await expect(
      w.join(code, VICTIM, ATTACKER_PASSWORD),
    ).resolves.toHaveProperty("accessToken");
    expect(
      w.db.tables.user_restaurant_access.some(
        (a) => a.user_id === victim.user_id && a.restaurant_id === HOUSE,
      ),
    ).toBe(true);
  });
});

describe("the two rules, at their edges", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();

  it("the window is seven days, exclusive", () => {
    expect(UNPROVEN_PASSWORD_WINDOW_MS).toBe(7 * DAY);
    expect(
      unprovenPasswordHasLapsed(
        { email_verified: false, created_at: at(7 * DAY) },
        now,
      ),
    ).toBe(false);
    expect(
      unprovenPasswordHasLapsed(
        { email_verified: false, created_at: at(7 * DAY + 1) },
        now,
      ),
    ).toBe(true);
  });

  it("an unverified account with no readable registration time has lapsed (fails closed); a verified one never has", () => {
    for (const created_at of [null, undefined, "", "not a date", 12345]) {
      expect(
        unprovenPasswordHasLapsed({ email_verified: false, created_at }, now),
      ).toBe(true);
      expect(
        unprovenPasswordHasLapsed({ email_verified: true, created_at }, now),
      ).toBe(false);
    }
    // A missing flag is not "verified".
    expect(unprovenPasswordHasLapsed({ created_at: at(8 * DAY) }, now)).toBe(
      true,
    );
  });

  it("an address matches only a non-empty invite address, trimmed and case-insensitive", () => {
    expect(inviteVerifiesAddress(" A@B.co ", "a@b.CO")).toBe(true);
    expect(inviteVerifiesAddress("a@b.co", "a@b.com")).toBe(false);
    expect(inviteVerifiesAddress(null, "a@b.co")).toBe(false);
    expect(inviteVerifiesAddress("", "")).toBe(false);
    expect(inviteVerifiesAddress("   ", "   ")).toBe(false);
    expect(inviteVerifiesAddress(undefined, undefined)).toBe(false);
  });
});
