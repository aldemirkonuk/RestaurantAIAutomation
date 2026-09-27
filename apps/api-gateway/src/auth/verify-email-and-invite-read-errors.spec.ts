import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";

/**
 * A failed read is never an empty one.
 *
 * supabase-js RESOLVES with { data, error }; it does not throw. Both methods
 * below destructured only `data`, so a database failure became `data: null`
 * and was answered as if the row did not exist:
 *
 *   getInvitePreview  -> { valid: false, reason: "not_found" }, which the web
 *                        invite page renders as "This invite has expired".
 *   verifyEmail       -> 400 "Invalid verification token", which tells the
 *                        person their link is bad while the database is down.
 *
 * Each "database error" case below FAILS on that code and passes once the
 * error is checked. Every other case pins behaviour that must not move.
 */

type Result = { data: any; error: any };

const DB_DOWN: Result = {
  data: null,
  error: {
    message: "connection to server was lost",
    code: "08006",
    details: "internal-host-10.0.0.7",
    hint: null,
  },
};

function chain(result: Result) {
  const c: any = {};
  for (const m of ["select", "eq", "update", "is", "order", "limit"]) {
    c[m] = jest.fn(() => c);
  }
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  c.single = jest.fn().mockResolvedValue(result);
  // A bare `await ...update().eq()` resolves the chain itself.
  c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return c;
}

/** `tables[name]` is the queue of results for successive `.from(name)` calls. */
function makeService(tables: Record<string, Result[]>) {
  const seen: Record<string, number> = {};
  const chains: Record<string, any[]> = {};
  const from = jest.fn((table: string) => {
    const i = seen[table] ?? 0;
    seen[table] = i + 1;
    const c = chain(tables[table]?.[i] ?? { data: null, error: null });
    (chains[table] ??= []).push(c);
    return c;
  });

  const svc = new AuthService(
    { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
    { get: jest.fn().mockReturnValue(undefined) } as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    { sendEmail: jest.fn() } as any,
  );
  // Keep test output quiet; the logging itself is asserted where it matters.
  const logError = jest
    .spyOn((svc as any).logger, "error")
    .mockImplementation(() => undefined);
  return { svc, from, chains, logError };
}

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe("AuthService#getInvitePreview — a failed read is not a missing invite", () => {
  it("database error: surfaces as 503, never as { valid: false, reason: 'not_found' }", async () => {
    const { svc } = makeService({ organization_invites: [DB_DOWN] });
    await expect(svc.getInvitePreview("abcd2345")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("database error: does not leak the database's own words to a public caller, and logs them", async () => {
    const { svc, logError } = makeService({ organization_invites: [DB_DOWN] });
    let caught: any;
    try {
      await svc.getInvitePreview("abcd2345");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const body = JSON.stringify(caught.getResponse());
    expect(body).not.toContain("internal-host");
    expect(body).not.toContain("connection to server was lost");
    expect(logError).toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).toContain(
      "connection to server was lost",
    );
  });

  it("no row and no error: still answers not_found", async () => {
    const { svc } = makeService({
      organization_invites: [{ data: null, error: null }],
    });
    await expect(svc.getInvitePreview("abcd2345")).resolves.toEqual({
      valid: false,
      reason: "not_found",
    });
  });

  it("looks the code up upper-cased, as before", async () => {
    const { svc, chains } = makeService({
      organization_invites: [{ data: null, error: null }],
    });
    await svc.getInvitePreview("abcd2345");
    expect(chains.organization_invites[0].eq).toHaveBeenCalledWith(
      "code",
      "ABCD2345",
    );
  });

  it("a used invite: still answers used", async () => {
    const { svc } = makeService({
      organization_invites: [
        {
          data: { id: "i1", role: "staff", expires_at: future(), used_at: past() },
          error: null,
        },
      ],
    });
    await expect(svc.getInvitePreview("ABCD2345")).resolves.toEqual({
      valid: false,
      reason: "used",
    });
  });

  it("an expired invite: still answers expired", async () => {
    const { svc } = makeService({
      organization_invites: [
        {
          data: { id: "i1", role: "staff", expires_at: past(), used_at: null },
          error: null,
        },
      ],
    });
    await expect(svc.getInvitePreview("ABCD2345")).resolves.toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("a live invite: still answers the same preview shape", async () => {
    const { svc } = makeService({
      organization_invites: [
        {
          data: {
            id: "i1",
            role: "manager",
            expires_at: future(),
            used_at: null,
            organizations: { name: "Org" },
            restaurants: { name: "House", city: "Antalya" },
            users: { name: "Inviter" },
          },
          error: null,
        },
      ],
    });
    await expect(svc.getInvitePreview("ABCD2345")).resolves.toEqual({
      valid: true,
      organization: "Org",
      restaurant: "House",
      city: "Antalya",
      inviter: "Inviter",
      role: "manager",
    });
  });
});

describe("AuthService#verifyEmail — a failed read is not an invalid link", () => {
  const TOKEN = "3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f";

  it("database error on the token lookup: surfaces as 503, never as 400 'Invalid verification token'", async () => {
    const { svc, from } = makeService({ email_verifications: [DB_DOWN] });
    await expect(svc.verifyEmail(TOKEN)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Nothing was written on the back of a read that did not happen.
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("database error: does not leak the database's own words, and logs them", async () => {
    const { svc, logError } = makeService({ email_verifications: [DB_DOWN] });
    let caught: any;
    try {
      await svc.verifyEmail(TOKEN);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    const body = JSON.stringify(caught.getResponse());
    expect(body).not.toContain("internal-host");
    expect(body).not.toContain("connection to server was lost");
    expect(JSON.stringify(logError.mock.calls)).toContain(
      "connection to server was lost",
    );
  });

  it("no row and no error: still 400 'Invalid verification token'", async () => {
    const { svc } = makeService({
      email_verifications: [{ data: null, error: null }],
    });
    const p = svc.verifyEmail(TOKEN);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow("Invalid verification token");
  });

  it("an already-used link: still 400 'Email already verified'", async () => {
    const { svc } = makeService({
      email_verifications: [
        {
          data: {
            id: "v1",
            user_id: "u1",
            expires_at: future(),
            verified_at: past(),
          },
          error: null,
        },
      ],
    });
    await expect(svc.verifyEmail(TOKEN)).rejects.toThrow(
      "Email already verified",
    );
  });

  it("an expired link: still 400 expired", async () => {
    const { svc } = makeService({
      email_verifications: [
        {
          data: { id: "v1", user_id: "u1", expires_at: past(), verified_at: null },
          error: null,
        },
      ],
    });
    await expect(svc.verifyEmail(TOKEN)).rejects.toThrow(
      "Verification token expired. Please resend.",
    );
  });

  it("a live link: still marks it, verifies the user and returns tokens", async () => {
    const { svc, chains } = makeService({
      email_verifications: [
        {
          data: { id: "v1", user_id: "u1", expires_at: future(), verified_at: null },
          error: null,
        },
        { data: null, error: null },
      ],
      users: [{ data: { user_id: "u1", email_verified: true }, error: null }],
    });
    const gen = jest
      .spyOn(svc as any, "generateTokens")
      .mockResolvedValue({ accessToken: "a", refreshToken: "r" });

    await expect(svc.verifyEmail(TOKEN)).resolves.toEqual({
      accessToken: "a",
      refreshToken: "r",
    });
    expect(chains.email_verifications[0].eq).toHaveBeenCalledWith(
      "token",
      TOKEN,
    );
    expect(chains.email_verifications[1].update).toHaveBeenCalled();
    expect(chains.users[0].update).toHaveBeenCalledWith({
      email_verified: true,
    });
    // ADR 0164: every mint names its house explicitly, membership-checked
    // inside generateTokens; this users row names none.
    expect(gen).toHaveBeenCalledWith(
      { user_id: "u1", email_verified: true },
      false,
      null,
    );
  });
});
