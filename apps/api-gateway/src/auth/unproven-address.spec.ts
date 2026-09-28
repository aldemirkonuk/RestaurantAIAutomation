import "reflect-metadata";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService, JwtPayload } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SESSION_ENDED } from "./session-version";
import {
  INVITE_EMAILS_PER_HOUSE,
  INVITE_EMAIL_WINDOW_MS,
  UNPROVEN_PASSWORD_WINDOW_MS,
  hashInviteEmailSecret,
  holdsUnprovenPassword,
  inviteEmailSecretMatches,
  inviteVerifiesAddress,
  unprovenPasswordHasLapsed,
} from "./unproven-address";
import { SignInController } from "../passkeys/sign-in.controller";
import { SignInCodesService } from "../passkeys/sign-in-codes.service";
import { FakeDb } from "../passkeys/testing/passkey-harness";
import { teamInviteEmailTemplate } from "../communications/email-templates/team-invite.template";

/**
 * ADR 0229 forks 7, 8, 9 and 10 -- the founder, 2026-09-27:
 *   item 72, "Bind invite to address (Recommended)": an invitation verifies
 *     the account it creates only when the joiner's address is the one the
 *     invite was made for; otherwise the account starts unverified.
 *   item 73, "Expire the password, 7 days (Recommended)": an account still
 *     unverified seven days after registration keeps its row, but its
 *     unproven password no longer signs in -- with the wrong-password answer;
 *     the emailed code still does.
 *   item 77, "Email invite + (c) interim (Recommended)": the gateway mails the
 *     invite to its address with a second secret only that mail carries; a
 *     join verifies only with that secret and that address; the minter's
 *     copied link joins unverified.
 *   item 78, "Refresh refuses lapsed (Recommended)": a refresh refuses an
 *     account whose unproven password has lapsed.
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
  // Both the house's name and the minter's name are typed by whoever opened
  // the house: the invite mail must carry neither (item 77).
  db.tables.restaurants = [
    { id: HOUSE, organization_id: ORG, name: "Evil <b>House</b> Pay Here" },
  ];
  db.tables.users = [
    {
      user_id: MINTER,
      email: "minter@example.com",
      name: "Mallory Phisher",
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

  async function mint(targetEmail?: string, house = HOUSE, by = MINTER) {
    const made = (await auth.generateInvite(by, house, {
      restaurantId: house,
      role: "staff",
      ...(targetEmail !== undefined ? { targetEmail } : {}),
    } as any)) as {
      code: string;
      inviteUrl: string;
      invitationEmail: string;
    };
    // The column default the baseline declares (`now() + '7 days'`), which
    // the in-memory table does not apply by itself.
    const minted = db.tables.organization_invites.find(
      (i) => i.code === made.code,
    )!;
    minted.expires_at ??= new Date(Date.now() + 7 * DAY).toISOString();
    minted.used_at ??= null;
    return made;
  }
  const invite = async (targetEmail?: string) => (await mint(targetEmail)).code;

  /** Every invite mail sent, with the secret read back out of its link. */
  const inviteMails = () =>
    authMail.sendEmail.mock.calls
      .map((c) => c[0])
      .filter((m) => /invited to a team on Mudavym/.test(m.subject))
      .map((m) => {
        const link = /href="([^"]*\/invite\/[A-Z0-9]{8}#k=[^"]+)"/.exec(m.html);
        const url = link ? link[1] : "";
        return {
          ...m,
          url,
          code: /\/invite\/([A-Z0-9]{8})#/.exec(url)?.[1] ?? "",
          secret: url.split("#k=")[1] ?? "",
        };
      });

  const join = (
    code: string,
    email: string,
    password = ATTACKER_PASSWORD,
    emailSecret?: string,
  ) =>
    auth.joinViaInvite({
      code,
      email,
      name: "Joiner",
      password,
      ...(emailSecret !== undefined ? { emailSecret } : {}),
    } as any);

  const row = (email: string) => db.tables.users.find((u) => u.email === email);
  const verificationMails = () =>
    authMail.sendEmail.mock.calls
      .map((c) => c[0])
      .filter((m) => /Verify your Mudavym account/.test(m.subject));
  const settle = () => new Promise((r) => setImmediate(r));

  return {
    db,
    auth,
    jwt,
    authMail,
    guard,
    codeSignIn,
    mint,
    invite,
    inviteMails,
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

  it("a join from the invite mail with the invited address (any case, any spacing) is verified at once, and no verification mail goes out", async () => {
    const w = world();
    const code = await w.invite("Alice@Example.com");
    const [mail] = w.inviteMails();

    const s = await w.join(
      code,
      "  alice@EXAMPLE.com ",
      "alice's password",
      mail.secret,
    );
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

/* ── fork 9 ─────────────────────────────────────────────────────────────── */

describe("fork 9 (item 77): the invite is mailed with a secret, and only a join carrying it verifies", () => {
  it("an invite with an address is mailed once, to that address, with a link whose secret is stored only as its hash", async () => {
    const w = world();
    const made = await w.mint("Alice@Example.com");
    await w.settle();

    expect(made.invitationEmail).toBe("sent");
    const mails = w.inviteMails();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(["alice@example.com"]);
    expect(mails[0].code).toBe(made.code);
    expect(mails[0].secret).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits

    const row = w.db.tables.organization_invites[0];
    expect(row.email_secret_hash).toBe(hashInviteEmailSecret(mails[0].secret));
    expect(row.emailed_at).toEqual(expect.any(String));
    // The secret leaves only in the mail: not in the response, not in the row.
    expect(JSON.stringify(made)).not.toContain(mails[0].secret);
    expect(made.inviteUrl).not.toContain("#");
    expect(JSON.stringify(w.db.tables)).not.toContain(mails[0].secret);
  });

  it("the mail carries no word anyone typed: not the house, not the inviter, not the address", async () => {
    const w = world();
    await w.mint("alice@example.com");
    const [mail] = w.inviteMails();

    for (const typed of [
      "Evil",
      "House",
      "Pay Here",
      "Mallory",
      "Phisher",
      "alice@example.com",
    ]) {
      expect(mail.html).not.toContain(typed);
      expect(mail.subject).not.toContain(typed);
    }
    // Its one link is the invite; no other href carries a secret.
    const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const withSecret = hrefs.filter((h) => h.includes("#k="));
    expect(withSecret.length).toBeGreaterThan(0);
    for (const h of withSecret) expect(h).toBe(mail.url);
    expect(mail.html).toContain("a member of staff");
  });

  it("an invite with no address mails nothing and says so", async () => {
    const w = world();
    const made = await w.mint();
    expect(made.invitationEmail).toBe("no_address");
    expect(w.inviteMails()).toHaveLength(0);
    const row = w.db.tables.organization_invites[0];
    expect(row.email_secret_hash).toBeNull();
    expect(row.emailed_at).toBeNull();
  });

  it("the minter's copied link, with the right address, joins UNVERIFIED and mails the verification link", async () => {
    const w = world();
    const code = await w.invite("alice@example.com");

    const s = await w.join(code, "alice@example.com", "alice's password");
    await w.settle();

    expect(w.row("alice@example.com")!.email_verified).toBe(false);
    expect((await w.guard(s.accessToken)).emailVerified).toBe(false);
    expect(w.verificationMails().map((m) => m.to)).toEqual([
      ["alice@example.com"],
    ]);
  });

  it("the mailed secret with another address, a wrong secret, or another invite's secret, all join unverified", async () => {
    const w = world();
    const a = await w.invite("alice@example.com");
    const b = await w.invite("bob@example.com");
    const c = await w.invite("carol@example.com");
    const [ma, mb] = w.inviteMails();

    await w.join(a, "mallory@example.com", "p4ssword!", ma.secret);
    await w.join(b, "bob@example.com", "p4ssword!", ma.secret); // a's secret on b
    await w.join(c, "carol@example.com", "p4ssword!", "not-the-secret");

    expect(w.row("mallory@example.com")!.email_verified).toBe(false);
    expect(w.row("bob@example.com")!.email_verified).toBe(false);
    expect(w.row("carol@example.com")!.email_verified).toBe(false);
    expect(mb.secret).not.toBe(ma.secret);
  });

  it("an invite that names an address but has no stored hash (minted before item 77) verifies nobody, whatever secret is sent", async () => {
    const w = world();
    const code = await w.invite("alice@example.com");
    const [mail] = w.inviteMails();
    w.db.tables.organization_invites[0].email_secret_hash = null;

    await w.join(code, "alice@example.com", "alice's password", mail.secret);
    expect(w.row("alice@example.com")!.email_verified).toBe(false);
  });

  it("the attack end to end: a minter types the victim's address, joins with it from the copied link and their own password -- unverified, and the victim's first code takes the account back", async () => {
    const w = world();
    // The attacker opened a house (anyone can) and mints an invite naming the
    // victim. The gateway mails the victim; the attacker never sees that mail.
    const made = await w.mint(VICTIM);
    expect(made.invitationEmail).toBe("sent");

    // Everything the attacker holds: the code and the copied link.
    const attacker = await w.join(made.code, VICTIM, ATTACKER_PASSWORD);
    await w.settle();

    expect(w.row(VICTIM)!.email_verified).toBe(false); // verified, before item 77
    expect((await w.guard(attacker.accessToken)).emailVerified).toBe(false);

    // The victim asks for a code: fork 6 fires because the address is unproven.
    const owner = await w.codeSignIn(VICTIM);
    expect(w.row(VICTIM)!.password_hash).toBeNull();
    expect(
      (await refusal(w.auth.refreshAccessToken(attacker.refreshToken))).body,
    ).toMatchObject({ code: SESSION_ENDED });
    await expect(
      w.auth.login({ email: VICTIM, password: ATTACKER_PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
  });

  it("the addressed person, joining from the mail, is verified with their own password and nobody else's", async () => {
    const w = world();
    await w.mint(VICTIM);
    const [mail] = w.inviteMails();

    const s = await w.join(
      mail.code,
      VICTIM,
      "the owner's password",
      mail.secret,
    );
    expect(w.row(VICTIM)!.email_verified).toBe(true);
    expect((await w.guard(s.accessToken)).emailVerified).toBe(true);
    await expect(
      w.auth.login({ email: VICTIM, password: "the owner's password" }),
    ).resolves.toHaveProperty("accessToken");
  });
});

describe("fork 9 (item 77): the invite mail template", () => {
  const url = "https://mudavym.com/invite/ABCDEFGH#k=secret-secret-secret";
  it("prints the role only from its own words, and nothing for a role it does not know", () => {
    const html = teamInviteEmailTemplate({
      inviteUrl: url,
      role: "manager",
      expiresAt: "2026-10-04T12:00:00.000Z",
    });
    expect(html).toContain("on Mudavym as a manager.");
    expect(html).toContain("2026-10-04 12:00 UTC");
    expect(html).toContain(url);
    const odd = teamInviteEmailTemplate({
      inviteUrl: url,
      role: "<b>Pay Here</b>",
      expiresAt: "not a date",
    });
    expect(odd).not.toContain("Pay Here");
    expect(odd).toContain("join a restaurant team on Mudavym.");
  });
});

describe("fork 9 (item 77): invite mails are rate-limited per house", () => {
  const OTHER_HOUSE = "44444444-4444-4444-8444-444444444444";
  function twoHouses() {
    const w = world();
    w.db.tables.restaurants.push({
      id: OTHER_HOUSE,
      organization_id: ORG,
      name: "O",
    });
    w.db.tables.user_restaurant_access.push({
      user_id: MINTER,
      restaurant_id: OTHER_HOUSE,
      role: "owner",
      is_active: true,
    });
    return w;
  }

  it(`a house mails at most ${INVITE_EMAILS_PER_HOUSE} invites a day; the next is made, not mailed, and can never verify`, async () => {
    const w = twoHouses();
    for (let i = 0; i < INVITE_EMAILS_PER_HOUSE; i++) {
      expect((await w.mint(`p${i}@example.com`)).invitationEmail).toBe("sent");
    }
    const over = await w.mint("late@example.com");
    expect(over.invitationEmail).toBe("rate_limited");
    expect(w.inviteMails()).toHaveLength(INVITE_EMAILS_PER_HOUSE);
    const row = w.db.tables.organization_invites.find(
      (i) => i.code === over.code,
    )!;
    expect(row.email_secret_hash).toBeNull();
    expect(row.emailed_at).toBeNull();

    // Its copied link still joins, unverified.
    await w.join(over.code, "late@example.com", "p4ssword!");
    expect(w.row("late@example.com")!.email_verified).toBe(false);

    // Another house has its own allowance.
    expect((await w.mint("x@example.com", OTHER_HOUSE)).invitationEmail).toBe(
      "sent",
    );
    // An invite with no address is not a mail and is not refused.
    expect((await w.mint()).invitationEmail).toBe("no_address");
  });

  it("mails older than the window do not count", async () => {
    const w = world();
    for (let i = 0; i < INVITE_EMAILS_PER_HOUSE; i++)
      await w.mint(`p${i}@example.com`);
    const old = new Date(
      Date.now() - INVITE_EMAIL_WINDOW_MS - 60_000,
    ).toISOString();
    w.db.tables.organization_invites[0].emailed_at = old;
    expect((await w.mint("next@example.com")).invitationEmail).toBe("sent");
    expect((await w.mint("after@example.com")).invitationEmail).toBe(
      "rate_limited",
    );
  });

  it("parallel mints cannot squeeze past the limit", async () => {
    const w = world();
    const made = await Promise.all(
      Array.from({ length: INVITE_EMAILS_PER_HOUSE + 10 }, (_, i) =>
        w.mint(`q${i}@example.com`),
      ),
    );
    const sent = made.filter((m) => m.invitationEmail === "sent").length;
    expect(sent).toBeLessThanOrEqual(INVITE_EMAILS_PER_HOUSE);
    expect(w.inviteMails()).toHaveLength(sent);
    // Every invite that was not mailed holds no hash.
    for (const m of made.filter((x) => x.invitationEmail !== "sent")) {
      const row = w.db.tables.organization_invites.find(
        (i) => i.code === m.code,
      )!;
      expect(row.email_secret_hash).toBeNull();
    }
  });

  it("a count that cannot be read mails nothing and clears the hash (fails closed)", async () => {
    const w = world();
    const from = w.db.from.bind(w.db);
    w.db.from = ((t: string) => {
      const q: any = from(t);
      if (t !== "organization_invites") return q;
      const gte = q.gte.bind(q);
      q.gte = (k: string, v: string) => {
        const r = gte(k, v);
        r.then = (ok: any) =>
          Promise.resolve({ data: null, error: { message: "down" } }).then(ok);
        return r;
      };
      return q;
    }) as any;
    const made = await w.mint("alice@example.com");
    expect(made.invitationEmail).toBe("not_sent");
    expect(w.inviteMails()).toHaveLength(0);
    expect(w.db.tables.organization_invites[0].email_secret_hash).toBeNull();
  });

  it("a mailer that fails says not_sent, and the claim still counts", async () => {
    const w = world();
    w.authMail.sendEmail.mockImplementationOnce(async () => ({
      success: false,
      error: "smtp down",
    }));
    const made = await w.mint("alice@example.com");
    expect(made.invitationEmail).toBe("not_sent");
    expect(w.db.tables.organization_invites[0].emailed_at).toEqual(
      expect.any(String),
    );
  });
});

/* ── fork 10 ────────────────────────────────────────────────────────────── */

describe("fork 10 (item 78): a refresh refuses an account whose unproven password has lapsed", () => {
  async function signedInRegistrant(w: ReturnType<typeof world>) {
    await w.auth.registerAccount({
      email: VICTIM,
      password: ATTACKER_PASSWORD,
      name: "Not the owner",
    } as any);
    const s = await w.auth.login({
      email: VICTIM,
      password: ATTACKER_PASSWORD,
    });
    return s as { accessToken: string; refreshToken: string };
  }
  const age = (w: ReturnType<typeof world>, ms: number) => {
    w.row(VICTIM)!.created_at = new Date(Date.now() - ms).toISOString();
  };

  it("inside the seven days the session refreshes", async () => {
    const w = world();
    const s = await signedInRegistrant(w);
    age(w, 7 * DAY - 60_000);
    await expect(
      w.auth.refreshAccessToken(s.refreshToken),
    ).resolves.toHaveProperty("accessToken");
  });

  it("the attack end to end: a pre-registrant who signed in on day one keeps refreshing -- past day seven the refresh is refused, and nothing is minted", async () => {
    const w = world();
    const s = await signedInRegistrant(w);
    // Day 6: still refreshing, each refresh handing back a new refresh token.
    age(w, 6 * DAY);
    const again = await w.auth.refreshAccessToken(s.refreshToken);
    // Day 8: the password has lapsed, and so has every session it made.
    age(w, 8 * DAY);
    for (const token of [s.refreshToken, again.refreshToken]) {
      const r = await refusal(w.auth.refreshAccessToken(token));
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: SESSION_ENDED });
    }
    // The row is kept, and the owner's emailed code still signs in.
    expect(w.row(VICTIM)!.password_hash).toEqual(expect.any(String));
    const owner = await w.codeSignIn(VICTIM);
    expect((await w.guard(owner.accessToken)).emailVerified).toBe(true);
    await expect(
      w.auth.refreshAccessToken(owner.refreshToken),
    ).resolves.toHaveProperty("accessToken");
  });

  it("a verified account refreshes however old it is", async () => {
    const w = world();
    const s = await signedInRegistrant(w);
    w.row(VICTIM)!.email_verified = true;
    age(w, 400 * DAY);
    await expect(
      w.auth.refreshAccessToken(s.refreshToken),
    ).resolves.toHaveProperty("accessToken");
  });

  it("an unverified account with no password has no unproven password to lapse", async () => {
    const w = world();
    const s = await signedInRegistrant(w);
    w.row(VICTIM)!.password_hash = null;
    age(w, 30 * DAY);
    await expect(
      w.auth.refreshAccessToken(s.refreshToken),
    ).resolves.toHaveProperty("accessToken");
  });

  it("a dev-bypass session refreshes only where dev bypass is on; anywhere else it is refused like any other", async () => {
    const w = world();
    await signedInRegistrant(w);
    age(w, 30 * DAY);
    const u = w.row(VICTIM)!;
    const token = w.jwt.sign(
      { sub: u.user_id, email: VICTIM, devBypass: true, sv: 0 },
      { secret: SECRETS.JWT_REFRESH_SECRET, expiresIn: "7d" },
    );
    const env = { ...process.env };
    try {
      process.env.NODE_ENV = "test";
      process.env.DEV_AUTH_BYPASS = "true";
      await expect(w.auth.refreshAccessToken(token)).resolves.toHaveProperty(
        "accessToken",
      );
      process.env.NODE_ENV = "production";
      expect(
        (await refusal(w.auth.refreshAccessToken(token))).body,
      ).toMatchObject({
        code: SESSION_ENDED,
      });
    } finally {
      process.env = env;
    }
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

  it("an address matches only a non-empty invite address, trimmed and case-insensitive, and only with the mailed secret", () => {
    const k = "the-secret";
    const h = hashInviteEmailSecret(k);
    const v = (t: unknown, e: unknown, ...rest: unknown[]) =>
      inviteVerifiesAddress(
        { targetEmail: t, emailSecretHash: rest.length > 0 ? rest[0] : h },
        { email: e, emailSecret: rest.length > 1 ? rest[1] : k },
      );
    expect(v(" A@B.co ", "a@b.CO")).toBe(true);
    expect(v("a@b.co", "a@b.com")).toBe(false);
    expect(v(null, "a@b.co")).toBe(false);
    expect(v("", "")).toBe(false);
    expect(v("   ", "   ")).toBe(false);
    expect(v(undefined, undefined)).toBe(false);
    // item 77: the address alone is not enough
    expect(v("a@b.co", "a@b.co", h, undefined)).toBe(false);
    expect(v("a@b.co", "a@b.co", h, "")).toBe(false);
    expect(v("a@b.co", "a@b.co", h, "another-secret")).toBe(false);
    expect(v("a@b.co", "a@b.co", null, k)).toBe(false);
    expect(v("a@b.co", "a@b.co", "", "")).toBe(false);
    expect(v("a@b.co", "a@b.co", k, k)).toBe(false); // the secret is not its own hash
    expect(v("a@b.co", "a@b.co", h.toUpperCase(), k)).toBe(false);
  });

  it("the stored hash is the SHA-256 of the secret, and a match is exact", () => {
    expect(hashInviteEmailSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(inviteEmailSecretMatches(hashInviteEmailSecret("abc"), "abc")).toBe(
      true,
    );
    expect(inviteEmailSecretMatches(hashInviteEmailSecret("abc"), "abd")).toBe(
      false,
    );
    expect(inviteEmailSecretMatches(hashInviteEmailSecret("abc"), 42)).toBe(
      false,
    );
  });

  it("only an unverified account that holds a password holds an unproven one", () => {
    expect(
      holdsUnprovenPassword({ email_verified: false, password_hash: "h" }),
    ).toBe(true);
    expect(holdsUnprovenPassword({ password_hash: "h" })).toBe(true);
    expect(
      holdsUnprovenPassword({ email_verified: true, password_hash: "h" }),
    ).toBe(false);
    expect(
      holdsUnprovenPassword({ email_verified: false, password_hash: null }),
    ).toBe(false);
    expect(
      holdsUnprovenPassword({ email_verified: false, password_hash: "" }),
    ).toBe(false);
  });
});
