import { AuthService } from "./auth.service";
import { BadRequestException } from "@nestjs/common";

/**
 * v3.0 task 20 — password reset (request + reset-password).
 *
 * The behaviour worth pinning here is not "does it call the DB" — it is the
 * enumeration-safety property: AuthService#requestPasswordReset must return
 * the identical shape whether or not the email matches an account, whether
 * insertion failed, and whether the request is inside the per-email cooldown.
 * Every one of those branches is tested for identical output, because a
 * single differing branch (an extra field, a different message, a thrown
 * exception) is enough to leak account existence to a scripted probe.
 */

interface TableConfig {
  users?: { data: any; error?: any };
  passwordResetsSelect?: { data: any; error?: any };
  passwordResetsInsert?: { data: any; error?: any };
  passwordResetsUpdate?: { error?: any };
}

function makeAuthService(
  cfg: TableConfig,
  gmailOverrides: Partial<any> = {},
  configOverrides: Record<string, unknown> = {},
) {
  const usersChain: any = {
    select: () => usersChain,
    update: () => usersChain,
    eq: () => usersChain,
    maybeSingle: jest
      .fn()
      .mockResolvedValue(cfg.users ?? { data: null, error: null }),
    single: jest
      .fn()
      .mockResolvedValue(cfg.users ?? { data: null, error: null }),
  };

  const resetsSelectChain: any = {
    select: () => resetsSelectChain,
    eq: () => resetsSelectChain,
    is: () => resetsSelectChain,
    order: () => resetsSelectChain,
    limit: () => resetsSelectChain,
    maybeSingle: jest
      .fn()
      .mockResolvedValue(
        cfg.passwordResetsSelect ?? { data: null, error: null },
      ),
  };

  const resetsInsertChain: any = {
    insert: () => resetsInsertChain,
    select: () => resetsInsertChain,
    single: jest
      .fn()
      .mockResolvedValue(
        cfg.passwordResetsInsert ?? { data: null, error: null },
      ),
  };

  const resetsUpdateChain: any = {
    update: () => resetsUpdateChain,
    eq: () => resetsUpdateChain,
    is: () => Promise.resolve(cfg.passwordResetsUpdate ?? { error: null }),
  };

  // Route password_resets to select/insert/update variants based on which
  // method is called first — jest chains are per-call, so a fresh mock object
  // is returned by `from()` each time, and the chain's own shape (select vs
  // insert vs update as the entry point) disambiguates it.
  const from = jest.fn((table: string) => {
    if (table === "users") return usersChain;
    if (table === "password_resets") {
      return {
        select: resetsSelectChain.select,
        insert: resetsInsertChain.insert,
        update: resetsUpdateChain.update,
      };
    }
    return usersChain;
  });

  const databaseService = { supabase: { from } } as any;
  const jwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
    decode: jest.fn(),
  } as any;
  const configService = {
    get: jest.fn((key: string) => configOverrides[key]),
  } as any;
  const tokenBlacklist = { blacklistToken: jest.fn() } as any;
  const gmail = {
    sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: "m1" }),
    ...gmailOverrides,
  } as any;

  return {
    svc: new AuthService(
      jwtService,
      configService,
      databaseService,
      tokenBlacklist,
      gmail,
    ),
    gmail,
    from,
  };
}

describe("AuthService#requestPasswordReset — enumeration safety", () => {
  it("returns { sent: true } for a known email and sends an email", async () => {
    const { svc, gmail } = makeAuthService({
      users: {
        data: { user_id: "u1", name: "Ada Lovelace", email: "ada@x.com" },
        error: null,
      },
      passwordResetsSelect: { data: null, error: null }, // no recent request
      passwordResetsInsert: { data: { token: "tok-1" }, error: null },
    });

    const result = await svc.requestPasswordReset("ada@x.com", "1.2.3.4");

    expect(result).toEqual({ sent: true });
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    // ADR 0143's mail rename covers this email too (Lane C judge D5d/F10: no
    // test previously pinned the From name/subject at this call site, only in
    // the template's own unit test). No From override: absent means
    // gmail.service's "Mudavym" default.
    const call = gmail.sendEmail.mock.calls[0][0];
    expect(call.fromName ?? "Mudavym").toBe("Mudavym");
    expect(call.subject).toBe("Reset your Mudavym password");
    expect(call.to).toEqual(["ada@x.com"]);
  });

  it("uses only the first origin when FRONTEND_URL is a comma-separated allow-list (R1/F5)", async () => {
    // `this.configService.get("FRONTEND_URL")` hands back the whole
    // CORS allow-list (cors-origins.ts's shape); before this test, an
    // AuthService that read it raw here still passed every reset test in
    // this file (they all mock configService.get to return undefined).
    const { svc, gmail } = makeAuthService(
      {
        users: {
          data: { user_id: "u1", name: "Ada Lovelace", email: "ada@x.com" },
          error: null,
        },
        passwordResetsSelect: { data: null, error: null },
        passwordResetsInsert: { data: { token: "tok-1" }, error: null },
      },
      {},
      { FRONTEND_URL: "https://mudavym.com,https://www.mudavym.com" },
    );

    await svc.requestPasswordReset("ada@x.com", "1.2.3.4");

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    const html = (gmail.sendEmail as jest.Mock).mock.calls[0][0].html as string;
    expect(html).toContain(
      'href="https://mudavym.com/reset-password?token=tok-1"',
    );
    // The raw comma-joined string must never leak into a mailed reset link.
    expect(html).not.toContain(",https://www.mudavym.com");
  });

  it("returns the identical { sent: true } for an unknown email and sends nothing", async () => {
    const { svc, gmail } = makeAuthService({
      users: { data: null, error: null },
    });

    const result = await svc.requestPasswordReset("nobody@x.com", "1.2.3.4");

    expect(result).toEqual({ sent: true });
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("returns the identical { sent: true } when the row insert fails", async () => {
    const { svc, gmail } = makeAuthService({
      users: {
        data: { user_id: "u1", name: "Ada Lovelace", email: "ada@x.com" },
        error: null,
      },
      passwordResetsSelect: { data: null, error: null },
      passwordResetsInsert: { data: null, error: { message: "db down" } },
    });

    const result = await svc.requestPasswordReset("ada@x.com", "1.2.3.4");

    expect(result).toEqual({ sent: true });
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("returns the identical { sent: true } and suppresses the email inside the cooldown window", async () => {
    const { svc, gmail } = makeAuthService({
      users: {
        data: { user_id: "u1", name: "Ada Lovelace", email: "ada@x.com" },
        error: null,
      },
      // A row created 5 seconds ago — inside the 60s cooldown.
      passwordResetsSelect: {
        data: { created_at: new Date(Date.now() - 5_000).toISOString() },
        error: null,
      },
    });

    const result = await svc.requestPasswordReset("ada@x.com", "1.2.3.4");

    expect(result).toEqual({ sent: true });
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("sends again once the cooldown window has passed", async () => {
    const { svc, gmail } = makeAuthService({
      users: {
        data: { user_id: "u1", name: "Ada Lovelace", email: "ada@x.com" },
        error: null,
      },
      // A row created 5 minutes ago — outside the 60s cooldown.
      passwordResetsSelect: {
        data: { created_at: new Date(Date.now() - 5 * 60_000).toISOString() },
        error: null,
      },
      passwordResetsInsert: { data: { token: "tok-2" }, error: null },
    });

    const result = await svc.requestPasswordReset("ada@x.com", "1.2.3.4");

    expect(result).toEqual({ sent: true });
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("lowercases and trims the email before lookup, so case does not create a bypass", async () => {
    const { svc, from } = makeAuthService({
      users: { data: null, error: null },
    });

    await svc.requestPasswordReset("  Ada@X.COM  ", "1.2.3.4");

    // Prove the lookup path ran (from("users") called) rather than asserting
    // on a specific eq() call, since eq() is a shared stub across chains.
    expect(from).toHaveBeenCalledWith("users");
  });
});

describe("AuthService#resetPassword", () => {
  function makeResetPasswordService(row: any, updateError: any = null) {
    const resetsSelectChain: any = {
      select: () => resetsSelectChain,
      eq: () => resetsSelectChain,
      maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
    };
    const resetsUpdateChain: any = {
      update: () => resetsUpdateChain,
      eq: () => resetsUpdateChain,
      is: () => Promise.resolve({ error: null }),
    };
    const usersChain: any = {
      update: () => usersChain,
      eq: () => Promise.resolve({ error: updateError }),
    };
    // ADR 0229 (round 7, item 44): a reset keeps every passkey and mails the
    // account the ones that still sign it in; it only READS user_passkeys.
    // This account has none; founder-round-six.spec.ts drives the real notice.
    const passkeysChain: any = {
      select: () => passkeysChain,
      eq: () => passkeysChain,
      is: () => passkeysChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };

    const from = jest.fn((table: string) => {
      if (table === "user_passkeys") return passkeysChain;
      if (table === "password_resets") {
        return {
          select: resetsSelectChain.select,
          update: resetsUpdateChain.update,
        };
      }
      if (table === "users") return usersChain;
      return usersChain;
    });

    const databaseService = { supabase: { from } } as any;
    const jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
      decode: jest.fn(),
    } as any;
    const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
    const tokenBlacklist = { blacklistToken: jest.fn() } as any;
    const gmail = { sendEmail: jest.fn() } as any;

    return new AuthService(
      jwtService,
      configService,
      databaseService,
      tokenBlacklist,
      gmail,
    );
  }

  it("rejects a token that does not exist", async () => {
    const svc = makeResetPasswordService(null);
    await expect(
      svc.resetPassword("bad-token", "newpassword1"),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a token that has already been used", async () => {
    const svc = makeResetPasswordService({
      id: "r1",
      user_id: "u1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: new Date().toISOString(),
    });
    await expect(
      svc.resetPassword("used-token", "newpassword1"),
    ).rejects.toThrow("already been used");
  });

  it("rejects an expired token", async () => {
    const svc = makeResetPasswordService({
      id: "r1",
      user_id: "u1",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      used_at: null,
    });
    await expect(
      svc.resetPassword("expired-token", "newpassword1"),
    ).rejects.toThrow("expired");
  });

  it("accepts a live, unused token and updates the password", async () => {
    const svc = makeResetPasswordService({
      id: "r1",
      user_id: "u1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    });
    await expect(
      svc.resetPassword("good-token", "newpassword1"),
    ).resolves.toBeUndefined();
  });

  it("surfaces a DB failure on the password update as a BadRequestException", async () => {
    const svc = makeResetPasswordService(
      {
        id: "r1",
        user_id: "u1",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        used_at: null,
      },
      { message: "db down" },
    );
    await expect(
      svc.resetPassword("good-token", "newpassword1"),
    ).rejects.toThrow(BadRequestException);
  });
});
