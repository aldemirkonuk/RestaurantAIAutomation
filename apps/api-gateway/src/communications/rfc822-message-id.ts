/**
 * One stored shape for an RFC 5322 Message-ID: `<id-left@id-right>`, angle
 * brackets kept, white space dropped, case kept.
 *
 * Why the brackets stay (the session's call, 2026-11-11):
 *  - The wire needs them. RFC 5322 §3.6.4 writes a msg-id as `"<" id-left "@"
 *    id-right ">"`, and `threadingHeader` (mime-headers.ts) keeps only `<...>`
 *    tokens. A bare id stored on an inbound row and handed to a reply as its
 *    In-Reply-To was dropped there, so the reply left without threading.
 *  - Every source already speaks it: Gmail's API returns the Message-ID,
 *    In-Reply-To and References headers with brackets, nodemailer's
 *    `info.messageId` has them, Postmark's `Message-ID` header has them, and
 *    both minting functions (gateway and orchestrator) write them.
 *  - Case is kept: the id is echoed back to the vendor's mail client, which
 *    compares it as written.
 *
 * The orchestrator has the same rule in
 * `services/agent-orchestrator/services/rfc822_message_id.py` and
 * the backfill `20270625100000` has it in SQL (both land in the stacked
 * follow-up branch fix/mail-message-id-backfill). Change all three together.
 */

/** The first `<...>` token holding more than white space. */
const BRACKETED = /<([^<>]*[^<>\s][^<>]*)>/;
/** White space at either end (of the value, or inside the brackets). */
const OUTER_SPACE = /^\s+|\s+$/g;
/** Leading and trailing white space or stray brackets. */
const EDGES = /^[\s<>]+|[\s<>]+$/g;
/** The first run with no white space and no bracket. */
const FIRST_TOKEN = /^[^<>\s]+/;

/**
 * The stored shape of a Message-ID header value, or null when the value holds
 * no id. `<a@b>`, ` a@b `, `<a@b` and `x <a@b> <c@d>` all give `<a@b>`.
 * White space inside the brackets is kept except at the ends: an obsolete
 * quoted id-left (`<"a b"@x>`) stays whole, never cut to `<"a>`.
 */
export function canonicalMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bracketed = value.match(BRACKETED);
  if (bracketed) return `<${bracketed[1].replace(OUTER_SPACE, "")}>`;
  const bare = value.replace(EDGES, "").match(FIRST_TOKEN);
  return bare ? `<${bare[0]}>` : null;
}
