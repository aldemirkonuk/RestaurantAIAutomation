import { AuthService } from "./auth.service";
import { BadRequestException } from "@nestjs/common";

/**
 * The lockout this closes was found in a stalled agent's uncommitted work and
 * then measured against production: enforcement (ADR 0023) bounces an
 * unverified account to `/verify-email`, whose only control calls
 * `resendVerification` — which threw for any account with no
 * `email_verifications` row. Two of the three unverified production accounts
 * were in exactly that state, with no self-serve way back in.
 *
 * Every test here asserts a SEND or a REJECTION, so deleting the fix fails
 * them. The bug was an absence, which is the kind a test can silently agree
 * with.
 */
function makeService(
  rows: Array<Record<string, unknown>>,
  configOverrides: Record<string, unknown> = {},
) {
  const ordered = [...rows];
  const chain: any = {
    _pendingOnly: false,
    select: () => chain,
    eq: () => chain,
    is: () => {
      chain._pendingOnly = true;
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: (row: any) => {
      inserted.push(row);
      return {
        select: () => ({
          single: async () => ({ data: { token: "fresh-token" }, error: null }),
        }),
      };
    },
    maybeSingle: async () => {
      const pool = chain._pendingOnly
        ? ordered.filter((r) => r.verified_at == null)
        : ordered;
      chain._pendingOnly = false;
      return { data: pool[0] ?? null, error: null };
    },
  };

  const inserted: any[] = [];
  const databaseService = { supabase: { from: () => chain } } as any;
  const sent: any[] = [];
  const gmail = {
    sendEmail: async (m: any) => {
      sent.push(m);
      return { success: true, messageId: "m1" };
    },
  } as any;

  const service = new AuthService(
    { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
    { get: jest.fn((key: string) => configOverrides[key]) } as any,
    databaseService,
    { blacklistToken: jest.fn() } as any,
    gmail,
  );
  return { service, sent, inserted };
}

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();

describe("resendVerification — an account with no verification row", () => {
  it("sends instead of throwing when no row has ever existed", async () => {
    const { service, sent } = makeService([]);

    await expect(
      service.resendVerification("u1", "a@b.com"),
    ).resolves.toEqual({ sent: true });
    expect(sent).toHaveLength(1);
  });

  it("sends when every existing row is already used", async () => {
    // The shape that locked out two production accounts: rows exist, but all
    // are verified, so the `.is("verified_at", null)` lookup finds nothing.
    const { service, sent } = makeService([
      { id: "v0", verified_at: minutesAgo(600), created_at: minutesAgo(600) },
    ]);

    await expect(
      service.resendVerification("u1", "a@b.com"),
    ).resolves.toEqual({ sent: true });
    expect(sent).toHaveLength(1);
  });

  it("uses only the first origin when FRONTEND_URL is a comma-separated allow-list (R1/F5)", async () => {
    // `this.configService.get("FRONTEND_URL")` hands back the whole
    // CORS allow-list (cors-origins.ts's shape); before this test, an
    // AuthService that read it raw here still passed every resend test in
    // this file (they all leave configService.get returning undefined).
    const { service, sent } = makeService([], {
      FRONTEND_URL: "https://mudavym.com,https://www.mudavym.com",
    });

    await service.resendVerification("u1", "a@b.com");

    expect(sent).toHaveLength(1);
    const html = sent[0].html as string;
    expect(html).toContain('href="https://mudavym.com/verify-email?token=fresh-token"');
    // The raw comma-joined string must never leak into a mailed verify link.
    expect(html).not.toContain(",https://www.mudavym.com");
  });

  it("still honours the cooldown when the last row is recent", async () => {
    // Minting a row on every call would turn "no pending row" into an
    // unlimited send button. It must not.
    const { service, sent } = makeService([
      { id: "v0", verified_at: minutesAgo(0.2), created_at: minutesAgo(0.2) },
    ]);

    await expect(
      service.resendVerification("u1", "a@b.com"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sent).toHaveLength(0);
  });

  it("still resends normally when a pending row exists", async () => {
    const { service, sent } = makeService([
      {
        id: "v1",
        verified_at: null,
        resend_count: 0,
        last_resent_at: null,
        created_at: minutesAgo(30),
      },
    ]);

    await expect(
      service.resendVerification("u1", "a@b.com"),
    ).resolves.toEqual({ sent: true });
    expect(sent).toHaveLength(1);
  });

  it("still throttles a pending row resent less than a minute ago", async () => {
    const { service, sent } = makeService([
      {
        id: "v1",
        verified_at: null,
        resend_count: 3,
        last_resent_at: minutesAgo(0.1),
        created_at: minutesAgo(30),
      },
    ]);

    await expect(
      service.resendVerification("u1", "a@b.com"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sent).toHaveLength(0);
  });
});
