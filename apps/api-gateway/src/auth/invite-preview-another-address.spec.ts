import { ServiceUnavailableException } from "@nestjs/common";
import { AuthService } from "./auth.service";

/**
 * F-275: the invite page could not warn that an invite was made for another
 * address, because the public preview never looked at the caller. With a
 * session it now answers `madeForAnotherAddress` (a yes/no, never the
 * address); signed out, or with a session it cannot confirm, the answer is
 * exactly the old preview.
 */

type Result = { data: any; error: any };

function chain(result: Result) {
  const c: any = {};
  for (const m of ["select", "eq", "is"]) c[m] = jest.fn(() => c);
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  return c;
}

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

const EXPIRES_AT = future();

const LIVE_INVITE = {
  id: "i1",
  role: "staff",
  expires_at: EXPIRES_AT,
  used_at: null,
  target_email: "Invitee@Example.com",
  organizations: { name: "Org" },
  restaurants: { name: "House", city: "Antalya" },
  users: { name: "Inviter" },
};

const PREVIEW = {
  valid: true,
  organization: "Org",
  restaurant: "House",
  city: "Antalya",
  inviter: "Inviter",
  role: "staff",
  expiresAt: EXPIRES_AT,
};

function makeService(opts: {
  invite?: any;
  caller?: any;
  issuer?: Result;
  verify?: jest.Mock;
  blacklisted?: boolean;
}) {
  const from = jest.fn((table: string) =>
    chain(
      table === "organization_invites"
        ? { data: opts.invite ?? LIVE_INVITE, error: null }
        : table === "user_restaurant_access"
          ? (opts.issuer ?? { data: { role: "owner" }, error: null })
          : { data: opts.caller ?? null, error: null },
    ),
  );
  const verify = opts.verify ?? jest.fn().mockReturnValue({ sub: "u1", sv: 0 });
  const svc = new AuthService(
    { sign: jest.fn(), verify, decode: jest.fn() } as any,
    { get: jest.fn().mockReturnValue(undefined) } as any,
    { supabase: { from } } as any,
    {
      blacklistToken: jest.fn(),
      isBlacklisted: jest.fn().mockResolvedValue(opts.blacklisted ?? false),
    } as any,
    { sendEmail: jest.fn() } as any,
  );
  jest.spyOn((svc as any).logger, "error").mockImplementation(() => undefined);
  return { svc, from, verify };
}

describe("AuthService#getInvitePreview — made for another address (F-275)", () => {
  it("signed out: the preview is unchanged and reads no account", async () => {
    const { svc, from, verify } = makeService({});
    const out = await svc.getInvitePreview("ABCD2345");
    expect(out).toEqual(PREVIEW);
    expect(verify).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("users");
  });

  it("signed in as another address: says so, and never names the invite's address", async () => {
    const { svc } = makeService({
      caller: { user_id: "u1", email: "someone.else@example.com" },
    });
    const out = await svc.getInvitePreview("ABCD2345", "tok");
    expect(out).toEqual({ ...PREVIEW, madeForAnotherAddress: true });
    expect(JSON.stringify(out).toLowerCase()).not.toContain("invitee@");
  });

  it("signed in as the invited address (any case): no warning", async () => {
    const { svc } = makeService({
      caller: { user_id: "u1", email: " invitee@example.COM " },
    });
    await expect(svc.getInvitePreview("ABCD2345", "tok")).resolves.toEqual({
      ...PREVIEW,
      madeForAnotherAddress: false,
    });
  });

  it("an invite made for no address: no warning", async () => {
    const { svc } = makeService({
      invite: { ...LIVE_INVITE, target_email: null },
      caller: { user_id: "u1", email: "anyone@example.com" },
    });
    await expect(svc.getInvitePreview("ABCD2345", "tok")).resolves.toEqual({
      ...PREVIEW,
      madeForAnotherAddress: false,
    });
  });

  it("a token that does not verify reads as signed out", async () => {
    const { svc } = makeService({
      verify: jest.fn(() => {
        throw new Error("invalid signature");
      }),
    });
    await expect(svc.getInvitePreview("ABCD2345", "bad")).resolves.toEqual(
      PREVIEW,
    );
  });

  it("a signed-out (blacklisted) token reads as signed out", async () => {
    const { svc } = makeService({
      blacklisted: true,
      caller: { user_id: "u1", email: "someone.else@example.com" },
    });
    await expect(svc.getInvitePreview("ABCD2345", "tok")).resolves.toEqual(
      PREVIEW,
    );
  });

  it("a session a password reset ended reads as signed out", async () => {
    const { svc } = makeService({
      caller: {
        user_id: "u1",
        email: "someone.else@example.com",
        session_version: 3,
      },
    });
    await expect(svc.getInvitePreview("ABCD2345", "tok")).resolves.toEqual(
      PREVIEW,
    );
  });
});

/**
 * F-1087: the preview asked only whether the code was used or past its date,
 * so an invite whose issuer could no longer give it (demoted or removed
 * since) showed as live on /invite/:code and was refused only at Join. It
 * now asks the same issuer question acceptance asks, first.
 */
describe("AuthService#getInvitePreview — the issuer can still give it (F-1087)", () => {
  const ISSUED = {
    ...LIVE_INVITE,
    role: "manager",
    invited_by: "u-issuer",
    restaurant_id: "h1",
  };

  it("an issuer demoted below the role they gave: valid false, reason issuer, nothing about the house", async () => {
    const { svc, from } = makeService({
      invite: ISSUED,
      issuer: { data: { role: "staff" }, error: null },
    });
    await expect(svc.getInvitePreview("ABCD2345")).resolves.toEqual({
      valid: false,
      reason: "issuer",
    });
    const read = from.mock.results.find(
      (_r, i) => from.mock.calls[i][0] === "user_restaurant_access",
    )!.value;
    expect(read.eq).toHaveBeenCalledWith("user_id", "u-issuer");
    expect(read.eq).toHaveBeenCalledWith("restaurant_id", "h1");
    expect(read.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("an issuer no longer in the house: reason issuer", async () => {
    const { svc } = makeService({
      invite: ISSUED,
      issuer: { data: null, error: null },
    });
    await expect(svc.getInvitePreview("ABCD2345")).resolves.toEqual({
      valid: false,
      reason: "issuer",
    });
  });

  it("a manager's staff invite stays live", async () => {
    const { svc } = makeService({
      invite: { ...ISSUED, role: "staff" },
      issuer: { data: { role: "manager" }, error: null },
    });
    await expect(svc.getInvitePreview("ABCD2345")).resolves.toMatchObject({
      valid: true,
      role: "staff",
    });
  });

  it("an issuer read that fails is a 503, never a dead invite", async () => {
    const { svc } = makeService({
      invite: ISSUED,
      issuer: { data: null, error: { message: "connection reset" } },
    });
    await expect(svc.getInvitePreview("ABCD2345")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
