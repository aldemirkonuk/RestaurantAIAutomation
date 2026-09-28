import { baseTemplate } from "./base-template";

interface UnprovenPasswordRemovedEmailData {
  /** When the password was removed, ISO 8601. */
  at: string;
  /**
   * What proved the address: an emailed code (fork 6, the default) or the
   * verification link, clicked after the unproven password had lapsed (fork 8
   * completed, `AuthService.verifyEmailProvedByLink`).
   */
  by?: "code" | "link";
}

/**
 * "We removed a password nobody had confirmed" (ADR 0229 fork 6, the founder,
 * 2026-09-27, item 67: "option 1 + do what industry do for these").
 *
 * Sent to the address an emailed code just proved, the first time that
 * address is proved, when the account held a password set before anyone had
 * shown the address was theirs. That password is gone and every other session
 * of the account is signed out (`AuthService.verifyEmailProvedByCode`). Also
 * sent, worded for the link, when the verification link proves the address
 * after that password had already lapsed (fork 8;
 * `AuthService.verifyEmailProvedByLink`). The
 * mail is the notice OWASP ASVS 5.0 6.3.7 asks for after a change to the
 * account's authentication details, and the one thing the real owner of an
 * address someone else registered needs to read: the stranger's password no
 * longer opens it.
 *
 * Carries no secret and no link, like every other account mail in ADR 0229:
 * it names where to set a password, it does not hand one out. It greets
 * nobody by name: the account's name was typed by the same unproven
 * registrant as the password, and a mail to the real owner must not carry a
 * stranger's words.
 */
export function unprovenPasswordRemovedEmailTemplate(
  data: UnprovenPasswordRemovedEmailData,
): string {
  const when = formatUtc(data.at);
  const p = (html: string) =>
    `<p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">${html}</p>`;

  const how =
    data.by === "link"
      ? `You confirmed this address for Mudavym with the link we emailed to it, at ${escapeHtml(when)}.`
      : `You signed in to Mudavym with a code we emailed to this address at ${escapeHtml(when)}.`;
  const content = `
    ${p(`${how} That was the first time this address was confirmed.`)}
    ${p(
      "The account had been created with a password, and until now nobody had shown that this address was theirs. So we removed that password and signed out every other session on the account.",
    )}
    ${p(
      "If you created the account yourself, set a new password on your profile, or with “Forgot password?” on the sign-in page.",
    )}
    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px;">
      If you did not create it, you need do nothing more: whoever chose that password can no longer sign in with it.
      <br>— The Mudavym team
    </p>
  `;

  const title = "A password nobody confirmed was removed";
  return baseTemplate({
    title,
    preheader: `${title}. Every other session was signed out.`,
    content,
    showFooter: true,
  });
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
