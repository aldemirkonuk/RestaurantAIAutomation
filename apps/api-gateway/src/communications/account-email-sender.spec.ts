// The SMTP fallback builds its own transport; the mock captures what it is
// handed without opening a socket. Hoisted above the import by jest.
jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));
import * as nodemailer from "nodemailer";
import { GmailService } from "./gmail.service";
it("keeps the configured sender address while identifying account mail as Mudavym", () => {
  // Since the one-pass rename (PR #391) every caller's From name defaults to
  // Mudavym; account mail passes no override and goes RAW to ADR 0172's
  // mailboxHeader like every other message.
  const service: any = new GmailService({ get: jest.fn() } as any);
  service.senderEmail = "configured@example.test";
  const input = {
    to: ["reader@example.test"],
    subject: "Account access",
    html: "<p>Example</p>",
  };
  expect(service.createMimeMessage(input)).toContain(
    "From: Mudavym <configured@example.test>",
  );
  expect(service.createMimeMessage(input)).not.toContain("WineOps");
});
it("carries the account identity through the Studio invitation sender without sending mail", async () => {
  const service = new GmailService({ get: jest.fn() } as any);
  const send = jest
    .spyOn(service, "sendEmail")
    .mockResolvedValue({ success: true });
  await service.sendStudioInviteEmail({
    to: "reader@example.test",
    roleLabel: "Reviewer",
    inviteUrl: "https://mudavym.com/studio/invite/example",
    expiresOn: "Sep 20, 2026",
  });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      subject: "You've been invited to Mudavym Studio as Reviewer",
    }),
  );
  // No From override: the invite takes the "Mudavym" default.
  expect(send.mock.calls[0][0].fromName ?? "Mudavym").toBe("Mudavym");
});
it("the SMTP fallback names account mail Mudavym too", async () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: "<id@example.test>" });
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  const config: Record<string, string> = {
    GMAIL_USER: "smtp-user@example.test",
    GMAIL_APP_PASSWORD: "not-a-real-password",
  };
  const service: any = new GmailService({ get: (k: string) => config[k] } as any);
  service.senderEmail = "configured@example.test";
  const input = {
    to: ["reader@example.test"],
    subject: "Account access",
    html: "<p>Example</p>",
  };
  await service.smtpSendEmail(input);
  expect(sendMail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      from: '"Mudavym" <configured@example.test>',
    }),
  );
});
