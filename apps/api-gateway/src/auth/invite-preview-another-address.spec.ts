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
  verify?: jest.Mock;
  blacklisted?: boolean;
}) {
  const from = jest.fn((table: string) =>
    chain(
      table === "organization_invites"
        ? { data: opts.invite ?? LIVE_INVITE, error: null }
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
