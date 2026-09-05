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
    text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { text, attachmentRefs };
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
