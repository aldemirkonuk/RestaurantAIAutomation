import { baseTemplate } from "./base-template";

interface PasswordResetEmailData {
  name: string;
  resetUrl: string;
}

/**
 * Deliberately does not confirm anything about the account in the body copy —
 * no "here is your reset link for the account you don't have" branch exists
 * because this template is only ever rendered for an email that matched a real
 * user. The controller sends an identical generic response either way; see
 * auth.controller.ts#requestPasswordReset.
 */
export function passwordResetEmailTemplate(
  data: PasswordResetEmailData,
): string {
  const { name, resetUrl } = data;
  const firstName = name.split(" ")[0];

  const content = `
    <h2 style="margin: 0 0 8px; color: #111827; font-size: 22px; font-weight: 700;">
      Reset your password
    </h2>
    <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      Hi ${firstName}, we received a request to reset the password on your WineOps AI account.
      This link is valid for <strong>1 hour</strong>.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 24px;">
      <tr>
        <td>
          <a href="${resetUrl}" style="display: block; padding: 14px; background-color: #7c2d12; color: #fff; text-align: center; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 8px; color: #9ca3af; font-size: 13px; line-height: 1.6;">
      If the button doesn't work, copy and paste this link into your browser:
      <br>
      <a href="${resetUrl}" style="color: #7c2d12; word-break: break-all;">${resetUrl}</a>
    </p>

    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px; margin-top: 16px;">
      Didn't request this? You can safely ignore this email — your password will not change
      unless you open the link above and choose a new one.
      <br>— The WineOps AI team
    </p>
  `;

  return baseTemplate({
    title: "Reset your WineOps AI password",
    preheader: "This link expires in 1 hour.",
    content,
    showFooter: true,
  });
}
