import { baseTemplate } from "./base-template";

interface PasskeyAddedEmailData {
  name: string | null;
  /** The name the person gave the passkey, or null when they gave none. */
  nickname: string | null;
  /** 'multiDevice' is a synced passkey (iCloud Keychain, Google Password Manager). */
  deviceType: "singleDevice" | "multiDevice";
  /** The address the passkey was added on, e.g. https://mudavym.com. */
  origin: string;
  /** When it was added, ISO 8601. Rendered in UTC so it reads the same anywhere. */
  addedAt: string;
}

/**
 * "A passkey was added to your account" (ADR 0229; the founder, 2026-09-26,
 * round 6, item 37: every new passkey emails the account).
 *
 * Why a mail and not only the in-app notice: a passkey is a sign-in method, so
 * someone who took over a session can plant one and come back later. The
 * in-app notice lands in the same account they are in; the mailbox is the one
 * place the owner hears about it that the intruder does not control.
 *
 * Carries no secret: no credential id, no public key, no code, no link. It
 * names the passkey, the kind, the address and the time, and says what to do
 * if it was not you (reset the password -- a reset retires every passkey --
 * and remove it on the profile).
 */
export function passkeyAddedEmailTemplate(data: PasskeyAddedEmailData): string {
  const firstName = (data.name ?? "").trim().split(" ")[0];
  const hello = firstName ? `Hi ${escapeHtml(firstName)}, ` : "";
  const which = data.nickname
    ? `a passkey named <strong>${escapeHtml(data.nickname)}</strong>`
    : "a passkey";
  const kind =
    data.deviceType === "multiDevice"
      ? "It is a synced passkey, so it works on every device that shares that password manager."
      : "It works only on the device that made it.";
  const when = formatUtc(data.addedAt);

  const content = `
    <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
      ${hello}${which} was added to your Mudavym account on ${escapeHtml(data.origin)} at ${escapeHtml(when)}. It can now sign you in without a password. ${kind}
    </p>
    <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
      If this was you, there is nothing to do.
    </p>
    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px;">
      Not you? Reset your password from the sign-in page on mudavym.com — a reset removes every passkey on the account — then check the passkeys on your profile.
      <br>— The Mudavym team
    </p>
  `;

  return baseTemplate({
    title: "A passkey was added to your account",
    preheader: `A passkey was added on ${data.origin}. Not you? Reset your password.`,
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
