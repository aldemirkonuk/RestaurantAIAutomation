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
