/**
 * ADR 0143's mail rename covers three emails: verification, password reset,
 * and the Studio invite. `account-email-sender.spec.ts` and
 * `email-templates/account-email-brand.spec.ts` already pin the reset and
 * Studio-invite identity (From name, subject). Neither covered the
 * verification email — the first of the three, and the one every new
 * account actually receives — so its From name, `subject` and body were
 * free to drift back to "WineOps" with nothing failing (Lane C judge D5d/F10).
 *
 * This pins `queueEmailVerification`'s call into `GmailService.sendEmail`:
 * the identity fields, and that the body carries the Mudavym heading and the
 * verify link built from the inserted token — never a WineOps string.
 */
import { AuthService } from "./auth.service";

function makeAuthService(opts: {
  token: string;
  sendEmail: jest.Mock;
  frontendUrl?: string;
}) {
  const emailVerificationsChain: any = {
    insert: () => ({
      select: () => ({
        single: async () => ({ data: { token: opts.token }, error: null }),
      }),
    }),
  };

  const from = jest.fn((table: string) => {
    if (table === "email_verifications") return emailVerificationsChain;
    throw new Error(`verification-email-identity.spec: unexpected table "${table}"`);
  });

  const configService = {
    get: jest.fn((key: string) =>
      key === "FRONTEND_URL" ? opts.frontendUrl : undefined,
    ),
  };

  const gmailService = { sendEmail: opts.sendEmail };

  return new AuthService(
    { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
    configService as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    gmailService as any,
  );
}

describe("queueEmailVerification — account mail identity (ADR 0143)", () => {
  it("sends as Mudavym, with the Mudavym subject and a body free of WineOps strings", async () => {
    const sendEmail = jest.fn().mockResolvedValue({ success: true, messageId: "m1" });
    const service = makeAuthService({
      token: "tok-abc123",
      sendEmail,
      frontendUrl: "https://mudavym.com",
    });

    await (service as any).queueEmailVerification("u1", "reader@example.test");

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];

    expect(call.to).toEqual(["reader@example.test"]);
    // No From override: absent means gmail.service's "Mudavym" default.
    expect(call.fromName ?? "Mudavym").toBe("Mudavym");
    expect(call.subject).toBe("Verify your Mudavym account");
    expect(call.html).toContain("https://mudavym.com/verify-email?token=tok-abc123");
    expect(call.html).toContain("Mudavym");
    expect(call.html.toLowerCase()).not.toContain("wineops");
  });

  it("falls back to the production frontend URL when FRONTEND_URL is unset", async () => {
    const sendEmail = jest.fn().mockResolvedValue({ success: true, messageId: "m2" });
    const service = makeAuthService({ token: "tok-xyz", sendEmail });

    await (service as any).queueEmailVerification("u2", "second@example.test");

    const call = sendEmail.mock.calls[0][0];
    expect(call.html).toContain(
      "https://restaurant-ai-automation-web.vercel.app/verify-email?token=tok-xyz",
    );
  });

  it("logs a warning and does not throw when the send fails", async () => {
    const sendEmail = jest.fn().mockResolvedValue({ success: false, error: "SMTP down" });
    const service = makeAuthService({ token: "tok-fail", sendEmail, frontendUrl: "https://mudavym.com" });
    const warn = jest.spyOn((service as any).logger, "warn").mockImplementation(() => {});

    await expect(
      (service as any).queueEmailVerification("u3", "third@example.test"),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Verification email not delivered to third@example.test"),
    );
  });
});
