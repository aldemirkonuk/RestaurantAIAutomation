import { baseTemplate } from "./base-template";

/** One passkey that still signs the account in, as the notice lists it. */
export interface PasskeyStillLive {
  /** The name the person gave it, or null when they gave none. */
  nickname: string | null;
  /** 'multiDevice' is a synced passkey (iCloud Keychain, Google Password Manager). */
  deviceType: "singleDevice" | "multiDevice";
  /** When it was added, ISO 8601. Rendered in UTC so it reads the same anywhere. */
  createdAt: string;
}

interface PasswordChangedEmailData {
  name: string | null;
  /** 'reset' = through the emailed link; 'change' = while signed in, on /profile. */
  how: "reset" | "change";
  /** When it happened, ISO 8601. */
  at: string;
  /**
   * The passkeys that still sign the account in. Null when they could not be
   * read -- the mail then says so instead of claiming there are none.
   */
  passkeys: PasskeyStillLive[] | null;
}

/**
 * "Your Mudavym password was reset / changed" (ADR 0229, founder 2026-09-26,
 * round 7, item 44: follow industry practice for both a reset and a change).
 *
 * What industry does on a reset or a change is keep the account's passkeys and
 * TELL the owner (Google, Apple, Microsoft, GitHub, Okta; NIST SP 800-63B-4
 * §4.2: an account-recovery event always notifies the subscriber). So this
 * mail is where the owner reviews them: it lists every passkey that still signs
 * the account in -- name, kind, the day it was added -- because a passkey
 * outlives a password by design, and one the owner does not recognise is the
 * thing to remove.
 *
 * Carries no secret and no link (the rule the sign-in-code and passkey-added
 * mails already follow): no credential id, no public key, no reset token. It
 * does not say other devices were signed out -- that sentence belongs to ADR
 * 0225 (PR #477) and is written where that mechanism is built.
 */
export function passwordChangedEmailTemplate(
  data: PasswordChangedEmailData,
): string {
  const firstName = (data.name ?? "").trim().split(" ")[0];
  const hello = firstName ? `Hi ${escapeHtml(firstName)}, ` : "";
  const what =
    data.how === "reset"
      ? "the password on your Mudavym account was reset through the link we emailed you"
      : "the password on your Mudavym account was changed from your profile";
  const when = formatUtc(data.at);

  const content = `
    <p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">
      ${hello}${what} at ${escapeHtml(when)}.
    </p>
    ${passkeyParagraph(data.passkeys)}
    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px;">
      Not you? Reset your password from the sign-in page on mudavym.com, then open your profile and remove any passkey you do not recognise.
      <br>— The Mudavym team
    </p>
  `;

  const title =
    data.how === "reset"
      ? "Your password was reset"
      : "Your password was changed";
  return baseTemplate({
    title,
    preheader: `${title}. Check the passkeys that still sign you in.`,
    content,
    showFooter: true,
  });
}

function passkeyParagraph(passkeys: PasskeyStillLive[] | null): string {
  const p = (html: string) =>
    `<p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">${html}</p>`;
  if (passkeys === null) {
    return p(
      "Your passkeys are kept — a new password does not remove them — but we could not read them just now to list them here. Check them on your profile.",
    );
  }
  if (passkeys.length === 0) {
    return p("There are no passkeys on your account.");
  }
  const items = passkeys
    .map((k) => {
      const name = k.nickname ? escapeHtml(k.nickname) : "Unnamed passkey";
      const kind =
        k.deviceType === "multiDevice" ? "synced passkey" : "on one device";
      return `<li style="margin: 0 0 6px;"><strong>${name}</strong> · ${kind} · added ${escapeHtml(formatDay(k.createdAt))}</li>`;
    })
    .join("");
  const count =
    passkeys.length === 1
      ? "This passkey still signs you in"
      : `These ${passkeys.length} passkeys still sign you in`;
  return `${p(`${count} — a new password does not remove them:`)}
    <ul style="margin: 0 0 20px; padding-left: 20px; color: #374151; font-size: 15px; line-height: 1.6;">${items}</ul>
    ${p("If you do not recognise one, remove it on your profile.")}`;
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
