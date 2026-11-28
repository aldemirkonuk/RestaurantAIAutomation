/**
 * A house's own owner or manager forwards an invoice to the house's inbound
 * address, and it lands on Receipts (onboarding-r110-g1).
 *
 * The bridge hands a forward to the sink only when ALL hold:
 *  - the event came from the dedicated-domain webhook (`source` is
 *    `inbound-domain`) and its house was resolved from the address;
 *  - the sender is authenticated for its own domain (`senderAuthenticated`);
 *  - the sender's parsed address is the verified email of a live owner or
 *    manager of THAT house (checked by the bridge against the database).
 *
 * Why the authentication is ALIGNED and not a bare pass (the session's call,
 * r110): a bare `spf=pass` proves only that the envelope sender's domain let
 * this server send, and a bare `dkim=pass` proves only that SOME domain signed
 * it. Anyone with a domain of their own gets both while writing the owner's
 * address in `From`. So a pass counts only when the domain it vouches for is
 * the `From` domain (or a subdomain of it): DMARC pass, DKIM pass with an
 * aligned `header.d`, SpamAssassin's `DKIM_VALID_AU` (valid DKIM from the
 * author's domain, which is what Postmark reports; it sends no
 * Authentication-Results), or SPF pass with an aligned envelope sender.
 *
 * Procurement registers the sink (`MemberForwardIntakeService`): the bridge
 * injecting intake would be a module cycle.
 */

export interface MemberForwardAttachment {
  filename: string;
  mime_type: string;
  /** Base64, as the inbound webhook publishes it. */
  data: string;
}

export interface MemberForward {
  restaurantId: string;
  /** The message's own id, for each document's `sourceRef`. */
  messageId: string;
  senderEmail: string;
  attachments: MemberForwardAttachment[];
}

export interface MemberForwardResult {
  /** Documents handed to intake (new or already on file). */
  taken: number;
  /** Attachments left out: not document-like, over 10 MB, or past 10. */
  skipped: number;
}

export type MemberForwardSink = (
  forward: MemberForward,
) => Promise<MemberForwardResult>;

/** At most this many documents from one message. */
export const MAX_FORWARDED_DOCUMENTS = 10;
/** At most this many bytes per document. */
export const MAX_FORWARDED_BYTES = 10 * 1024 * 1024;

type HeaderMap = Record<string, unknown> | null | undefined;

function header(headers: HeaderMap, name: string): string {
  if (!headers || typeof headers !== "object") return "";
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name && v != null) return String(v);
  }
  return "";
}

function domainOf(value: string): string {
  const s = value.trim().toLowerCase().replace(/^["'<]+|["'>]+$/g, "");
  const at = s.lastIndexOf("@");
  return (at >= 0 ? s.slice(at + 1) : s).replace(/[;>\s].*$/, "");
}

/** `id` vouches for `from` when it is the same domain or a subdomain of it. */
export function aligned(id: string, from: string): boolean {
  if (!id || !from || !from.includes(".")) return false;
  return id === from || id.endsWith(`.${from}`);
}

function propertyOf(segment: string, key: string): string {
  const m = segment.match(new RegExp(`\\b${key.replace(".", "\\.")}=([^\\s;]+)`, "i"));
  return m ? m[1] : "";
}

/**
 * Is `senderEmail` authenticated for its own domain, by the trace headers the
 * receiving server wrote? Reads the FIRST occurrence of each trace header
 * (the inbound webhook keeps the first, which the receiving server prepends;
 * a copy the sender wrote further down cannot override it).
 */
export function senderAuthenticated(
  headers: HeaderMap,
  senderEmail: string,
): boolean {
  const from = domainOf(senderEmail);
  if (!from) return false;

  // An Authentication-Results line vouches only when its authserv-id (the
  // token before the first `;`) is OUR receiving server's. Postmark writes no
  // A-R, so on that provider the only one present came from the sender; with
  // INBOUND_AUTHSERV_ID unset the line is ignored.
  const ar = header(headers, "authentication-results");
  const want = (process.env.INBOUND_AUTHSERV_ID ?? "").trim().toLowerCase();
  const servId = ar.split(";")[0].trim().toLowerCase();
  for (const segment of want && servId === want ? ar.split(";") : []) {
    const s = segment.trim();
    if (/\bdmarc=pass\b/i.test(s)) {
      const hf = propertyOf(s, "header.from");
      if (!hf || aligned(domainOf(hf), from)) return true;
    }
    if (/\bdkim=pass\b/i.test(s)) {
      const d = propertyOf(s, "header.d") || domainOf(propertyOf(s, "header.i"));
      if (aligned(d.toLowerCase(), from)) return true;
    }
    if (/\bspf=pass\b/i.test(s)) {
      const mf = propertyOf(s, "smtp.mailfrom");
      if (mf && aligned(domainOf(mf), from)) return true;
    }
  }

  const spamTests = header(headers, "x-spam-tests");
  if (
    spamTests
      .split(/[,\s]+/)
      .some((t) => t.trim().toUpperCase() === "DKIM_VALID_AU")
  )
    return true;

  const receivedSpf = header(headers, "received-spf").trim();
  if (/^pass\b/i.test(receivedSpf)) {
    const env =
      propertyOf(receivedSpf, "envelope-from") ||
      propertyOf(receivedSpf, "smtp.mailfrom");
    if (env && aligned(domainOf(env), from)) return true;
  }

  return false;
}

/** Escape LIKE wildcards so a sender's address matches only itself. */
export function exactLikePattern(email: string): string {
  return email.replace(/[\\%_*]/g, (c) => `\\${c}`);
}
