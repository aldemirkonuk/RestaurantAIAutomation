import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";

/**
 * r104 onboarding gap 2: a typo in the sign-up address was a dead end. The
 * owner of an UNVERIFIED account can move it to the address they meant; the
 * mail link sent to the old address must die with the change, a verified or
 * taken address is refused, and the route is rate-limited.
 *
 * The fake database is stateful and honours the filters, so each test reads
 * the rows back instead of trusting a call was made.
 */
type Row = Record<string, any>;

function makeDb(opts: {
  users: Row[];
  verifs: Row[];
  resets: Row[];
  failVoid?: boolean;
  failResetVoid?: boolean;
  clashOnWrite?: boolean;
}) {
  const tables: Record<string, Row[]> = {
    users: opts.users,
    email_verifications: opts.verifs,
    password_resets: opts.resets,
  };
  const from = (name: string) => {
    const rows = tables[name];
    const make = (op: string, patch?: Row) => {
      const filters: Array<(r: Row) => boolean> = [];
      let returning = false;
      const run = () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "delete") {
          if (opts.failVoid && name === "email_verifications") {
            return { data: null, error: { message: "down" } };
          }
          for (const r of hit) rows.splice(rows.indexOf(r), 1);
          return { data: null, error: null };
        }
        if (op === "update") {
          if (opts.failResetVoid && name === "password_resets") {
            return { data: null, error: { message: "down" } };
          }
          if (opts.clashOnWrite && name === "users") {
            return { data: null, error: { code: "23505", message: "dup" } };
          }
          for (const r of hit) Object.assign(r, patch);
          return { data: returning ? (hit[0] ?? null) : null, error: null };
        }
        return { data: hit[0] ?? null, error: null };
      };
      const q: any = {
        eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
        is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), q),
        select: () => ((returning = true), q),
        maybeSingle: async () => run(),
        single: async () => run(),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    };
    return {
      select: () => make("select"),
      update: (p: Row) => make("update", p),
      delete: () => make("delete"),
    };
  };
  return { supabase: { from } } as any;
}

function setup(over: Partial<Parameters<typeof makeDb>[0]> = {}) {
  const users: Row[] = over.users ?? [
    { user_id: "u1", email: "selin@typo.test", email_verified: false, restaurant_id: "h1", session_version: 0 },
    { user_id: "u2", email: "taken@house.test", email_verified: true, session_version: 0 },
  ];
  const verifs: Row[] = over.verifs ?? [
    { id: "v-old", user_id: "u1", email: "selin@typo.test", token: "old-token", verified_at: null },
  ];
  const resets: Row[] = over.resets ?? [
    { id: "r-old", user_id: "u1", email: "selin@typo.test", token: "reset-old", expires_at: "2999-01-01T00:00:00Z", used_at: null },
  ];
  const sent: any[] = [];
  const service = new AuthService(
    { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
    { get: jest.fn() } as any,
    makeDb({ users, verifs, resets, failVoid: over.failVoid, failResetVoid: over.failResetVoid, clashOnWrite: over.clashOnWrite }),
    { blacklistToken: jest.fn() } as any,
    {
      sendEmail: async (m: any) => {
        sent.push(m);
        return { success: true, messageId: "m1" };
      },
    } as any,
  );
  // The pair is minted by the one signing helper; its output is not the point.
  (service as any).generateTokens = jest.fn(async (u: Row) => ({
    accessToken: `access-for-${u.email}`,
    refreshToken: "refresh",
  }));
  // A fresh pending row, as the real insert would make.
  (service as any).queueEmailVerification = jest.fn(async (id: string, email: string) => {
    verifs.push({ id: "v-new", user_id: id, email, token: "new-token", verified_at: null });
    sent.push({ to: [email] });
  });
  return { service, users, verifs, resets, sent };
}

describe("changeUnverifiedEmail", () => {
  it("moves an unverified account to the new address, mails it, and returns a session for it", async () => {
    const { service, users, sent } = setup();
    const out = await service.changeUnverifiedEmail("u1", "  Selin@House.Test ", "h1");
    expect(users[0].email).toBe("selin@house.test");
    expect(sent).toEqual([{ to: ["selin@house.test"] }]);
    expect(out).toEqual({
      accessToken: "access-for-selin@house.test",
      refreshToken: "refresh",
      email: "selin@house.test",
    });
  });

  it("a verified account is refused and nothing is written or mailed", async () => {
    const { service, users, verifs, sent } = setup({
      users: [{ user_id: "u1", email: "a@house.test", email_verified: true, session_version: 0 }],
    });
    await expect(service.changeUnverifiedEmail("u1", "b@house.test")).rejects.toMatchObject({
      response: { code: "EMAIL_ALREADY_VERIFIED" },
    });
    expect(verifs).toHaveLength(1); // refused before anything was voided
    expect(users[0].email).toBe("a@house.test");
    expect(sent).toHaveLength(0);
  });

  it("an address that already has an account is refused", async () => {
    const { service, users, sent } = setup();
    await expect(service.changeUnverifiedEmail("u1", "Taken@House.test")).rejects.toMatchObject({
      response: { code: "EMAIL_TAKEN" },
    });
    expect(users[0].email).toBe("selin@typo.test");
    expect(sent).toHaveLength(0);
  });

  it("the old link is dead after the change: it no longer verifies anyone", async () => {
    const { service, verifs } = setup();
    await service.changeUnverifiedEmail("u1", "selin@house.test");
    expect(verifs.find((v) => v.token === "old-token")).toBeUndefined();
    await expect(service.verifyEmail("old-token", "u1")).rejects.toThrow("Invalid verification token");
  });

  it("the third attempt inside a minute is refused with 429", async () => {
    const { service } = setup();
    await service.changeUnverifiedEmail("u1", "one@house.test");
    await service.changeUnverifiedEmail("u1", "two@house.test");
    const third = service.changeUnverifiedEmail("u1", "three@house.test");
    await expect(third).rejects.toBeInstanceOf(HttpException);
    await expect(third).rejects.toMatchObject({ status: 429 });
  });

  it("the same address is a plain 400, not a send", async () => {
    const { service, sent } = setup();
    await expect(service.changeUnverifiedEmail("u1", "SELIN@typo.test")).rejects.toBeInstanceOf(BadRequestException);
    expect(sent).toHaveLength(0);
  });

  it("if the old links cannot be voided, nothing else is written (503)", async () => {
    const { service, users, sent } = setup({ failVoid: true });
    await expect(service.changeUnverifiedEmail("u1", "selin@house.test")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(users[0].email).toBe("selin@typo.test");
    expect(sent).toHaveLength(0);
  });

  it("a unique-address clash at the write answers 409, not 500", async () => {
    const { service, sent } = setup({ clashOnWrite: true });
    await expect(service.changeUnverifiedEmail("u1", "selin@house.test")).rejects.toMatchObject({
      response: { code: "EMAIL_TAKEN" },
    });
    expect(sent).toHaveLength(0);
  });

  it("a reset link mailed to the old address is dead after the change: it no longer sets the password", async () => {
    const { service, users, resets } = setup();
    users[0].password_hash = "old-hash";
    await service.changeUnverifiedEmail("u1", "selin@house.test");
    expect(resets.find((r) => r.token === "reset-old")?.used_at).toBeTruthy();
    await expect(service.resetPassword("reset-old", "NewPassw0rd!x")).rejects.toThrow(
      "already been used",
    );
    expect(users[0].password_hash).toBe("old-hash");
  });

  it("a reset row that slips in for the old address after the move is still refused (the address no longer matches)", async () => {
    const { service, users, resets } = setup();
    users[0].password_hash = "old-hash";
    await service.changeUnverifiedEmail("u1", "selin@house.test");
    // The race: a reset requested for the typo mailbox lands after the void.
    resets.push({
      id: "r-late",
      user_id: "u1",
      email: "selin@typo.test",
      token: "reset-late",
      expires_at: "2999-01-01T00:00:00Z",
      used_at: null,
    });
    await expect(service.resetPassword("reset-late", "NewPassw0rd!x")).rejects.toThrow(
      "Invalid or expired reset link",
    );
    expect(users[0].password_hash).toBe("old-hash");
    expect(users[0].session_version).toBe(1);
  });

  it("the move ends the old sessions: the version goes up and the new pair is minted under it", async () => {
    const { service, users } = setup();
    await service.changeUnverifiedEmail("u1", "selin@house.test", "h1");
    expect(users[0].session_version).toBe(1);
    const minted = ((service as any).generateTokens as jest.Mock).mock.calls[0][0];
    expect(minted.session_version).toBe(1);
  });

  it("if the old reset links cannot be voided, nothing else is written (503)", async () => {
    const { service, users, sent } = setup({ failResetVoid: true });
    await expect(service.changeUnverifiedEmail("u1", "selin@house.test")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(users[0].email).toBe("selin@typo.test");
    expect(sent).toHaveLength(0);
  });
});
