import { baseTemplate } from "./base-template";

interface StudioInviteEmailData {
  /** The role being granted — shown so the recipient knows what they are accepting. */
  roleLabel: string;
  /** Full URL to /studio/invite/:token. */
  inviteUrl: string;
  /** Formatted expiry date, e.g. "Sep 2, 2026". */
  expiresOn: string;
  /** The address the invite is bound to — repeated because redemption fails if it differs. */
  invitedEmail: string;
}

export function studioInviteEmailTemplate(data: StudioInviteEmailData): string {
  const { roleLabel, inviteUrl, expiresOn, invitedEmail } = data;

  const content = `
    <h2 style="margin: 0 0 8px; color: #111827; font-size: 22px; font-weight: 700;">
      You've been invited to WineOps Studio 🍷
    </h2>
    <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      Studio is where our wine data is built and reviewed. You're being given the
      <strong>${roleLabel}</strong> role.
    </p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 16px; background-color: #fdf4ff; border-left: 4px solid #7c2d12; border-radius: 0 8px 8px 0;">
          <p style="margin: 0 0 6px; color: #111827; font-size: 14px; font-weight: 700;">Before you click</p>
          <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">
            This invite is tied to <strong>${invitedEmail}</strong>. Sign in with that account
            or it won't be accepted. If you don't have a WineOps account yet, create one with
            that address first, then come back to this email.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 24px; color: #6b7280; font-size: 13px; line-height: 1.5;">
      The link works once and expires on <strong>${expiresOn}</strong>. If it expires, ask for a new one.
    </p>
  `;

  return baseTemplate({
    title: "Your WineOps Studio invite",
    preheader: `You've been invited to WineOps Studio as ${roleLabel}.`,
    content,
    ctaButton: {
      text: "Accept invite",
      url: inviteUrl,
    },
  });
}
