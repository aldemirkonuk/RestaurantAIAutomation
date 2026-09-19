import { passwordResetEmailTemplate } from "./password-reset.template";
import { studioInviteEmailTemplate } from "./studio-invite.template";
import { baseTemplate } from "./base-template";
describe("public account email identity", () => {
  it("uses Mudavym throughout reset mail while preserving its recovery link", () => {
    const html = passwordResetEmailTemplate({
      name: "Reader",
      resetUrl: "https://mudavym.com/reset-password?token=example",
    });
    expect(html).toContain("Mudavym");
    expect(html).not.toContain("WineOps");
    expect(html).toContain("https://mudavym.com/reset-password?token=example");
    expect(html).toContain("1 hour");
  });
  it("uses Mudavym for Studio invitations, preserving recipient and role details", () => {
    const html = studioInviteEmailTemplate({
      roleLabel: "Reviewer",
      inviteUrl: "https://mudavym.com/studio/invite/example",
      invitedEmail: "reader@example.test",
      expiresOn: "Sep 20, 2026",
    });
    expect(html).not.toContain("WineOps");
    expect(html).toContain("Mudavym Studio");
    expect(html).toContain("reader@example.test");
    expect(html).toContain("Reviewer");
  });
  it("preserves unrelated message defaults", () => {
    expect(
      baseTemplate({ title: "Example", content: "<p>Example</p>" }),
    ).toContain("WineOps AI");
  });
});
