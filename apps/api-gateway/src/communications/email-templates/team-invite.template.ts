import { baseTemplate } from "./base-template";

interface TeamInviteEmailData {
  /**
   * The link to `/invite/<code>#k=<secret>`. The fragment carries the one
   * secret that exists only in this mail (ADR 0229 fork 9); the fragment is
   * never sent to a server by the browser.
   */
  inviteUrl: string;
  /** The role the invite grants: one of owner, manager, staff. */
  role: string;
  /** When the invite stops working, ISO 8601. */
  expiresAt: string;
}

/** The only role words this mail will print; anything else prints nothing. */
const ROLE_WORDS: Record<string, string> = {
  owner: "an owner",
  manager: "a manager",
  staff: "a member of staff",
};

/**
 * "You have been invited to join a team on Mudavym" (ADR 0229 fork 9; the
 * founder, 2026-09-27, item 77, "Email invite + (c) interim (Recommended)").
 *
 * The gateway sends this to the address an invite was made for. Its link
 * carries a second secret, stored only as a hash on the invite, so a join
 * from this mail proves the joiner reads this mailbox, and only such a join
 * creates a verified account.
 *
 * It carries no secret beyond the link, and no word anyone typed: not the
 * house's name, not the inviter's name, not the address. Whoever mints an
 * invite chooses those words, and this mail can reach an address that never
 * asked for it, so it must not carry a stranger's words (the same rule as
 * `unprovenPasswordRemovedEmailTemplate`). The invite page names the house
 * once the person chooses to open it.
 */
export function teamInviteEmailTemplate(data: TeamInviteEmailData): string {
  const role = ROLE_WORDS[data.role];
  const until = formatUtc(data.expiresAt);
  const p = (html: string) =>
    `<p style="margin: 0 0 20px; color: #374151; font-size: 15px; line-height: 1.6;">${html}</p>`;

  const content = `
    ${p(
      role
        ? `You have been invited to join a restaurant team on Mudavym as ${role}.`
        : "You have been invited to join a restaurant team on Mudavym.",
    )}
    ${p(
      "Open the invite from this email to see which team it is and to join. Joining from this email with this address also confirms the address, so you will not be asked to confirm it again.",
    )}
    ${p(`The invite works once and stops working at ${escapeHtml(until)}.`)}
    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px;">
      If you did not expect this, ignore it: nothing happens unless you open the invite and join.
      <br>— The Mudavym team
    </p>
  `;

  const title = "You have been invited to a team on Mudavym";
  return baseTemplate({
    title,
    preheader: `${title}.`,
    content,
    ctaButton: { text: "Open the invite", url: data.inviteUrl },
    showFooter: true,
  });
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "the end of its seven days";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
