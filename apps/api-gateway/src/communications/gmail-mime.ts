/**
 * Reading a Gmail message payload — the one implementation, shared.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `extractEmailContent` was a private method on `CommunicationsController`
 * (:1516 before this change) that used no `this`. The house-inbox reader
 * (`inbox/house-inbox.service.ts`, ADR 0118 receive half) fetches messages
 * through a HOUSE's own `gmail_read` grant rather than through the deployment's
 * shared mailbox, and it needs the same parse.
 *
 * Copying it would have been two MIME walkers that agree today. They would not
 * have agreed for long, and the way they would have disagreed is the worst
 * available: a vendor's reply that arrives on the house's mailbox would show a
 * DIFFERENT body in the book from the same reply arriving on the shared one,
 * and nothing would report the difference. So it moved here verbatim and both
 * callers import it. The behaviour is unchanged — there is no second parse to
 * drift from.
 */

/** Gmail's MIME tree; only the fields these walkers touch. */
export interface GmailPayloadPart {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null } | null;
  parts?: GmailPayloadPart[] | null;
}

export interface AttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

/**
 * At most three attachments per message, at most ~5 MB each.
 *
 * Exported so the house-inbox reader uses the SAME caps as the shared-mailbox
 * path rather than picking its own: two different ceilings would mean the same
 * vendor's receipt reaches the AI on one path and is dropped on the other.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ATTACHMENT_B64_LEN = 7_000_000; // ~5 MB raw

/**
 * Recursively walk a Gmail MIME tree to pull the best text body and list any
 * image/PDF attachments. When an email carries an attachment the text nests one
 * or more levels deep (multipart/mixed -> multipart/alternative -> text/plain), so
 * a flat scan of the top-level parts misses it and yields an empty body — which
 * is what broke inbound emails that included a confirmation/receipt image.
 */
export function extractEmailContent(payload: GmailPayloadPart | null | undefined): {
  text: string;
  attachmentRefs: AttachmentRef[];
} {
  let text = "";
  let html = "";
  const attachmentRefs: AttachmentRef[] = [];

  const walk = (part: GmailPayloadPart | null | undefined): void => {
    if (!part) return;
    const mimeType: string = part.mimeType || "";
    const data = part.body?.data;
    if (mimeType === "text/plain" && data && !text) {
      text = Buffer.from(data, "base64url").toString("utf-8");
    } else if (mimeType === "text/html" && data && !html) {
      html = Buffer.from(data, "base64url").toString("utf-8");
    } else if (
      (mimeType.startsWith("image/") || mimeType === "application/pdf") &&
      part.body?.attachmentId
    ) {
      attachmentRefs.push({
        filename: part.filename || "attachment",
        mimeType,
        attachmentId: part.body.attachmentId,
      });
    }
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);

  // No text/plain anywhere -> render the HTML part down to text so we never
  // hand the AI an empty body.
  if (!text && html) {
    text = htmlToText(html);
  }
  return { text, attachmentRefs };
}

/**
 * Named entities this parser recognizes, decoded in a single non-cascading
 * pass (see the audit note on `htmlToText` below for why chained replaces are
 * unsafe here).
 */
const GMAIL_MIME_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

/**
 * HTML -> plain text, keeping the source's line breaks.
 *
 * [Audit of PR #435 at a229848f3, 2026-09-26, security review: the previous
 * version of this function (`.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")`)
 * stripped every tag AND collapsed every newline to a single space. That is
 * fine for a person reading the body, but `vendor-tone/tone-scale.ts`
 * `latestPart()` — the cut that keeps a quoted thread's earlier turns (the
 * house's own prior words) out of what `vendor-tone/tone-egress.ts` sends to
 * Jev — works ENTIRELY by matching header/"wrote:"/separator lines at line
 * boundaries. A vendor message with no `text/plain` part (common for ERP,
 * webmail and ticketing senders) has no boundaries left once flattened to one
 * line, so the whole quoted thread — including the house's own negotiation —
 * went out whole. This walks the same MIME tree the plain-text path already
 * feeds `latestPart()` with, so an HTML-only message gets the same
 * newline-delimited shape a plain-text one always had, and the existing cut
 * logic applies unchanged. See `gmail-mime.spec.ts` for the reproduction.]
 *
 * [Audit of PR #435 at ca5b82d9b, round 2, 2026-09-26, both reviewers BLOCK:
 * the entity decode used to be five chained `.replace()` calls run in a fixed
 * order (`&amp;` first, then `&lt;`/`&gt;`/`&quot;`/`&#39;`). That is exactly
 * the anti-pattern `common/html/html-to-text.ts`'s own docstring names and was
 * written to retire: decoding `&amp;` before `&lt;` turns the literal,
 * doubly-escaped text `&amp;lt;` into `&lt;` and then into an actual `<` — a
 * tag character that was never in the source. CodeQL's `js/double-escaping`
 * flagged this line by line number. The decode below is ONE regex pass with a
 * replacer callback: every entity is matched against the ORIGINAL string in a
 * single left-to-right scan, so a character produced by decoding one entity is
 * never re-offered to the regex as the start of another. `&amp;lt;` now stays
 * `&lt;` (a literal, safe string), never resolving to `<`. See the
 * "double-escaping" describe block in `gmail-mime.spec.ts` for the pin.]
 */
export function htmlToText(html: string): string {
  return html
    // Block boundaries become a line break BEFORE tags are stripped, so the
    // cut logic downstream still has lines to match against.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote|table|title)>/gi, "\n")
    // Every remaining tag (including opening tags with attributes) becomes a
    // space, not nothing — "Hello<b>world</b>" must not become "Helloworld".
    .replace(/<[^>]+>/g, " ")
    // Single non-cascading pass — see the audit note above.
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39);/g,
      (_match, name: string) => GMAIL_MIME_ENTITIES[name],
    )
    // Collapse horizontal whitespace only — newlines are load-bearing here.
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The address inside a `From:` header, lowercased — `"Acme Wines"
 * <sales@acme.example>` becomes `sales@acme.example`.
 *
 * The bridge does this inline (`rabbitmq-bridge.service.ts:560-562`) to find the
 * provider. The reader needs the identical answer to decide whether a message
 * is admissible AT ALL, so the two must not be two regexes: an address the
 * reader admitted and the bridge then parsed differently would be a message let
 * through one gate and matched to the wrong vendor at the next.
 *
 * Returns null rather than a guess when there is no address to find.
 */
export function addressInFromHeader(from: string | null | undefined): string | null {
  const raw = (from ?? "").trim();
  if (!raw) return null;
  const angled = /<([^>]+)>/.exec(raw);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  return candidate.includes("@") ? candidate : null;
}

/** Case-insensitive header lookup over Gmail's `payload.headers` array. */
export function headerValue(
  headers: Array<{ name?: string | null; value?: string | null }> | null | undefined,
  name: string,
): string {
  const wanted = name.toLowerCase();
  for (const h of headers ?? []) {
    if ((h?.name ?? "").toLowerCase() === wanted) return h?.value ?? "";
  }
  return "";
}
