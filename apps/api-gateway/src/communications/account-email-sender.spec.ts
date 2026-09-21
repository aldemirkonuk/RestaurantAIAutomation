// The SMTP fallback builds its own transport; the mock captures what it is
// handed without opening a socket. Hoisted above the import by jest.
jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));
import * as nodemailer from "nodemailer";
import { GmailService } from "./gmail.service";
it("keeps the configured sender address while identifying account mail as Mudavym", () => {
  const service: any = new GmailService({ get: jest.fn() } as any);
  service.senderEmail = "configured@example.test";
  const input = {
    to: ["reader@example.test"],
    subject: "Account access",
    html: "<p>Example</p>",
  };
  expect(
    service.createMimeMessage({ ...input, senderName: "Mudavym" }),
  ).toContain("From: Mudavym <configured@example.test>");
  expect(service.createMimeMessage(input)).toContain(
    "From: WineOps AI <configured@example.test>",
  );
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
      senderName: "Mudavym",
      subject: "You've been invited to Mudavym Studio as Reviewer",
    }),
  );
});
it("hands the SMTP fallback the sender name raw, for nodemailer to encode", async () => {
  // Measured against nodemailer 8.0.1: an address object's name is quoted or
  // RFC 2047 encoded by nodemailer itself, so no pre-quoted string is built.
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
  await service.smtpSendEmail({ ...input, senderName: "Mudavym" });
  expect(sendMail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      from: { name: "Mudavym", address: "configured@example.test" },
    }),
  );
  await service.smtpSendEmail(input);
  expect(sendMail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      from: { name: "WineOps AI", address: "configured@example.test" },
    }),
  );
});
