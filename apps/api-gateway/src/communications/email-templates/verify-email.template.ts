/**
 * The verification mail (onboarding OB-3; founder /goal 2026-11-07, proposal
 * §4 F3: "the mail carries a six-digit code and the link").
 *
 * WHY A CODE AND A LINK. The link alone verified only in the browser that
 * opened the mail, and it needs that browser to be signed in (ADR 0229 fork
 * 12). Someone who signed up on a laptop and reads mail on a phone had no way
 * through but to sign in again on the phone. The code is typed on the page
 * that asked for it, in the session that is already open, so it works across
 * devices. Both stay: the link is one tap for the person reading mail where
 * they signed up.
 *
 * THE LOOK (ADR 0174 D1 and D3, decided for this mail as the session's call
 * under the founder's /goal 2026-11-07): a light paper sheet, one teal (the
 * İznik seal, `--seal` in apps/web/src/styles/mudavym.css), no banner, and
 * Mudavym at the top because this is account mail. Where a client honours
 * `prefers-color-scheme`, the same sheet renders on the charcoal pair of the
 * same tokens. The paper value is `--paper-0` (#fffdf8, ADR 0104 D9's sheet),
 * the fork ADR 0174 left open. This replaces the inline wine-banner sheet
 * `AuthService.buildVerificationEmailHtml` used to build: the old wine banner
 * is exactly what ADR 0174 D1 retires ("no banners"). It deliberately does not
 * use `baseTemplate`, whose header is that banner.
 *
 * `code` is null only when no code could be stored (the address is busy or
 * locked for the day, or the store failed): the mail then carries the link
 * alone and says nothing about a code, rather than not being sent at all.
 */

export interface VerifyEmailTemplateData {
  code: string | null;
  verifyUrl: string;
}

/** ADR 0174's paper sheet and its charcoal pair, from mudavym.css. */
const PAPER = {
  ground: "#f3efe6", // --paper-1
  sheet: "#fffdf8", // --paper-0
  rule: "#eae4d8", // --paper-2
  ink: "#211c16", // --ink-1
  inkSoft: "#4f473c", // --ink-2
  inkQuiet: "#7c7365", // --ink-3
  seal: "#1a5e6b", // --seal (İznik, light ground)
};
const CHARCOAL = {
  ground: "#15130F",
  sheet: "#1D1813",
  rule: "#262019",
  ink: "#EFE7D9",
  inkSoft: "#C0B6A5",
  inkQuiet: "#8E8576",
  seal: "#5FB0BC",
};

export const VERIFY_EMAIL_SUBJECT = "Verify your Mudavym account";

export function verifyEmailTemplate(data: VerifyEmailTemplateData): string {
  const url = escapeHtml(data.verifyUrl);
  const code = data.code ? escapeHtml(data.code) : null;
  const preheader = code
    ? `${code} — your Mudavym code. It works once, for 10 minutes.`
    : "Confirm your email address to finish setting up Mudavym.";

  const codeBlock = code
    ? `
          <p class="mv-soft" style="margin:0 0 12px;color:${PAPER.inkSoft};font-size:15px;line-height:1.6;">
            Type this code on the page that asked for it. It works once, for <strong>10 minutes</strong>.
          </p>
          <p class="mv-ink mv-code" style="margin:0 0 28px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:${PAPER.ink};font-family:'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace;">${code}</p>
          <p class="mv-soft" style="margin:0 0 16px;color:${PAPER.inkSoft};font-size:15px;line-height:1.6;">
            Or open this link where you are signed in to Mudavym. It works for <strong>24 hours</strong>.
          </p>`
    : `
          <p class="mv-soft" style="margin:0 0 16px;color:${PAPER.inkSoft};font-size:15px;line-height:1.6;">
            Open this link where you are signed in to Mudavym. It works for <strong>24 hours</strong>.
          </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${VERIFY_EMAIL_SUBJECT}</title>
  <style>
    @media (prefers-color-scheme: dark) {
      .mv-ground { background:${CHARCOAL.ground} !important; }
      .mv-sheet { background:${CHARCOAL.sheet} !important; border-color:${CHARCOAL.rule} !important; }
      .mv-ink { color:${CHARCOAL.ink} !important; }
      .mv-soft { color:${CHARCOAL.inkSoft} !important; }
      .mv-quiet { color:${CHARCOAL.inkQuiet} !important; border-color:${CHARCOAL.rule} !important; }
      .mv-seal { color:${CHARCOAL.seal} !important; }
      .mv-seal-button { background:${CHARCOAL.seal} !important; color:${CHARCOAL.ground} !important; }
    }
  </style>
</head>
<body class="mv-ground" style="margin:0;padding:0;background:${PAPER.ground};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="mv-ground" style="background:${PAPER.ground};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <div class="mv-sheet" style="max-width:560px;margin:0 auto;background:${PAPER.sheet};border:1px solid ${PAPER.rule};border-radius:12px;padding:32px;text-align:left;">
          <p class="mv-ink" style="margin:0 0 24px;color:${PAPER.ink};font-size:15px;font-weight:700;letter-spacing:0.02em;">Mudavym</p>
          <h1 class="mv-ink" style="margin:0 0 16px;color:${PAPER.ink};font-size:22px;font-weight:700;line-height:1.3;">Confirm your email address</h1>${codeBlock}
          <p style="margin:0 0 24px;">
            <a href="${url}" class="mv-seal-button" style="display:inline-block;padding:12px 28px;background:${PAPER.seal};color:${PAPER.sheet};text-decoration:none;font-weight:600;border-radius:8px;font-size:15px;">Confirm my email</a>
          </p>
          <p class="mv-quiet" style="margin:0 0 16px;color:${PAPER.inkQuiet};font-size:13px;line-height:1.6;">
            If the button does not work, copy this link into your browser:<br>
            <a href="${url}" class="mv-seal" style="color:${PAPER.seal};word-break:break-all;">${url}</a>
          </p>
          <p class="mv-quiet" style="margin:0;padding-top:16px;border-top:1px solid ${PAPER.rule};color:${PAPER.inkQuiet};font-size:13px;line-height:1.6;">
            If you did not choose this account's password, do not use this mail: sign in with a code emailed to this address instead. That confirms the address and removes any password you did not set.
            If you did not create a Mudavym account, you can ignore this email.
            <br>Automated message — please do not reply.
          </p>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
