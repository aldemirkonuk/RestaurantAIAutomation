import { baseTemplate } from "./base-template";

interface SignInCodeEmailData {
  name: string | null;
  code: string;
  purpose: "sign_in" | "step_up";
  /** Sign-in mails only (QA round 23). */
  link?: string;
}

/**
 * The emailed one-time code (ADR 0229, Locked 2026-09-27; founder 2026-09-25 item 29).
 * Rendered only for an address that has an account -- the sign-in route sends
 * the same response either way and mails nobody when there is no account.
 *
 * The code is the subject's first word too, so a phone can offer it from the
 * notification without opening the mail. A sign-in mail also carries a
 * single-use link that the daily guess lock cannot close (QA round 23).
 */
export function signInCodeEmailTemplate(data: SignInCodeEmailData): string {
  const firstName = (data.name ?? "").trim().split(" ")[0];
  const hello = firstName ? `Hi ${escapeHtml(firstName)}, ` : "";
  const what =
    data.purpose === "sign_in"
      ? "Use this code to sign in to Mudavym."
      : "Use this code to confirm it is you before a passkey is added to your account.";
  const ignore =
    data.purpose === "sign_in"
      ? "Didn't ask for it? Someone typed your address on the sign-in page. Nobody can sign in without this code or link, so you can ignore this email."
      : "Didn't ask for it? Someone signed in to your account is trying to add a passkey. Change your password and remove any passkey you do not recognise on your profile.";

  const content = `
    <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
      ${hello}${what} It works once, for <strong>10 minutes</strong>.
    </p>
    <p style="margin: 0 0 24px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827; font-family: 'SFMono-Regular', Menlo, Consolas, monospace;">
      ${escapeHtml(data.code)}
    </p>
    ${data.link ? `<p style="margin: 0 0 24px; text-align: center; color: #374151; font-size: 14px;">Or <a href="${escapeHtml(data.link)}" style="color: #111827; font-weight: 600;">sign in with this link</a>. It works once, on any device.</p>` : ""}
    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px;">
      ${ignore}
      <br>— The Mudavym team
    </p>
  `;

  return baseTemplate({
    title:
      data.purpose === "sign_in"
        ? "Your Mudavym sign-in code"
        : "Your Mudavym confirmation code",
    preheader: `${data.code} — works once, for 10 minutes.`,
    content,
    showFooter: true,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
