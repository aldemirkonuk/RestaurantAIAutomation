/**
 * A house letter that did not arrive says so (r109 mail-gap g1).
 *
 * The reader's query names the vendor book only (`buildQuery`), so a delivery
 * status notice (RFC 3464) about a house letter was never read. A second,
 * equally bounded query asks for notices only: `from:(mailer-daemon OR
 * postmaster) after:<cursor>`. A notice is kept only when all three hold:
 *
 *   (a) it arrived in this house's mailbox: it was listed through the house's
 *       own reading grant, and nothing else is ever asked;
 *   (b) it passed the g8 sender check: Gmail's topmost Authentication-Results
 *       (`senderAuthOf`, authserv-id mx.google.com) gives a passing verdict,
 *       and its From is a mailer-daemon or postmaster address;
 *   (c) the Message-ID of the letter it is about equals the stored message_id
 *       of an outbound letter of the same restaurant_id.
 *
 * Anything else is dropped unrecorded: a stranger's notice never enters the
 * book. A kept notice is not filed as a letter. It marks the house's own
 * letter: `email_headers.delivery = {state, at, recipient, status, said}`.
 *
 * Everything here is pure: the service lists, fetches and writes.
 */

import { senderAuthOf, signerSpeaksFor } from "../../common/orchestrator/email-triage";
import { addressInFromHeader, inboundHeaderMap, type GmailPayloadPart } from "../gmail-mime";

/** The second query's sender bound. A filter only: the From is checked exactly after the fetch. */
export const NOTICE_FROM = "from:(mailer-daemon OR postmaster)";

export function noticeQuery(sinceMs: number): string {
  return `${NOTICE_FROM} after:${Math.floor(sinceMs / 1000)}`;
}

type Header = { name?: string | null; value?: string | null };
export type NoticePart = GmailPayloadPart & { headers?: Header[] | null; parts?: NoticePart[] | null };

export type DeliveryState = "did_not_arrive" | "delayed";

/** What is written on the house letter. `said` is the receiving server's own words, kept for Details. */
export interface DeliveryMark {
  state: DeliveryState;
  at: string;
  recipient: string;
  status: string;
  said: string | null;
}

/** A mailer-daemon or postmaster address: the only senders a notice is believed from. */
export function isNoticeSender(address: string | null | undefined): boolean {
  const local = (address ?? "").toLowerCase().split("@")[0] ?? "";
  return local === "mailer-daemon" || local === "postmaster";
}

/**
 * (b) The g8 sender check for a notice. Gmail's topmost Authentication-Results
 * must name mx.google.com and pass the notice: DMARC passes, or DKIM passes by
 * a domain that speaks for the From, or SPF passes (a notice is sent with an
 * empty envelope sender, so its SPF is the sending host's, and a remote
 * server's notice is seldom signed).
 */
export function noticeSenderChecked(headers: Header[] | null | undefined): boolean {
  const map = inboundHeaderMap(headers);
  const from = addressInFromHeader(map["from"] ?? "");
  if (!from || !isNoticeSender(from)) return false;
  const auth = senderAuthOf(map, map["from"]);
  if (!auth) return false;
  return auth.dmarc === true || (auth.dkim === true && signerSpeaksFor(auth.signedBy, from)) || auth.spf === true;
}

function decode(data: string | null | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

/** A header block as name -> values, with folded lines joined (RFC 5322 2.2.3). */
function fieldGroups(text: string): Array<Record<string, string>> {
  const groups: Array<Record<string, string>> = [];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n[ \t]*\n/)) {
    const fields: Record<string, string> = {};
    let last = "";
    for (const line of block.split("\n")) {
      if (/^[ \t]/.test(line) && last) {
        fields[last] += ` ${line.trim()}`;
        continue;
      }
      const m = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      last = m[1].toLowerCase();
      if (!(last in fields)) fields[last] = m[2].trim();
      else last = "";
    }
    if (Object.keys(fields).length) groups.push(fields);
  }
  return groups;
}

function walk(part: NoticePart | null | undefined, out: NoticePart[] = []): NoticePart[] {
  if (!part) return out;
  out.push(part);
  for (const p of part.parts ?? []) walk(p, out);
  return out;
}

const mime = (p: NoticePart) => (p.mimeType ?? "").toLowerCase();
const bracketedIds = (value: string | null | undefined) => (value ?? "").match(/<[^<>\s]+>/g) ?? [];

export interface NoticeRecipient {
  recipient: string;
  action: string;
  status: string;
  diagnostic: string | null;
}

export interface ParsedNotice {
  /** The Message-ID of the letter the notice is about, most trusted first. */
  originalIds: string[];
  recipients: NoticeRecipient[];
}

/**
 * Parse an RFC 3464 notice. Null when it is not one: no message/delivery-status
 * part, or no recipient in it.
 */
export function parseNotice(payload: NoticePart | null | undefined, headers: Header[] | null | undefined): ParsedNotice | null {
  const parts = walk(payload);
  const status = parts.find((p) => mime(p) === "message/delivery-status");
  if (!status) return null;
  const recipients: NoticeRecipient[] = [];
  for (const g of fieldGroups(decode(status.body?.data)).slice(1)) {
    const recipient = (g["final-recipient"] ?? g["original-recipient"] ?? "").replace(/^[^;]*;\s*/, "").trim().toLowerCase();
    const st = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(g["status"] ?? "");
    if (!recipient || !st) continue;
    recipients.push({
      recipient,
      action: (g["action"] ?? "").trim().toLowerCase(),
      status: `${st[1]}.${st[2]}.${st[3]}`,
      diagnostic: g["diagnostic-code"] ? g["diagnostic-code"].replace(/^[^;]*;\s*/, "").replace(/\s+/g, " ").slice(0, 300) : null,
    });
  }
  if (!recipients.length) return null;

  const ids: string[] = [];
  // The returned letter's own headers: a text/rfc822-headers block, or a
  // message/rfc822 part (Gmail gives its inner headers as a part, or its bytes).
  for (const p of parts) {
    const m = mime(p);
    if (p === payload || (m !== "text/rfc822-headers" && m !== "message/rfc822" && !p.headers?.length)) continue;
    const own = (p.headers ?? []).find((h) => (h.name ?? "").toLowerCase() === "message-id")?.value;
    ids.push(...bracketedIds(own));
    if (m === "text/rfc822-headers" || m === "message/rfc822") {
      ids.push(...bracketedIds(fieldGroups(decode(p.body?.data))[0]?.["message-id"]));
    }
  }
  const top = (name: string) => (headers ?? []).find((h) => (h.name ?? "").toLowerCase() === name)?.value;
  ids.push(...bracketedIds(top("in-reply-to")));
  // References ends with the letter answered, so it is read from the end.
  ids.push(...bracketedIds(top("references")).reverse());
  return { originalIds: [...new Set(ids)], recipients };
}

/**
 * The mark a notice makes. A failure (Action failed, or a 5.x.x status) wins
 * over a delay (Action delayed, or a 4.x.x status); a delivered, relayed or
 * expanded report makes none.
 */
export function deliveryMark(notice: ParsedNotice, atMs: number): DeliveryMark | null {
  const failed = notice.recipients.find((r) => r.action === "failed" || (r.action !== "delayed" && r.status.startsWith("5.")));
  const delayed = notice.recipients.find((r) => r.action === "delayed" || (r.action !== "failed" && r.status.startsWith("4.")));
  const r = failed ?? delayed;
  if (!r || ["delivered", "relayed", "expanded"].includes(r.action)) return null;
  return {
    state: failed ? "did_not_arrive" : "delayed",
    at: new Date(atMs).toISOString(),
    recipient: r.recipient,
    status: r.status,
    said: r.diagnostic,
  };
}

/** Whether a new mark replaces the one a letter carries: a delay never undoes a failure, and the same mark is not written twice. */
export function replacesMark(was: unknown, next: DeliveryMark): boolean {
  if (!was || typeof was !== "object") return true;
  const w = was as Partial<DeliveryMark>;
  if (w.state === "did_not_arrive" && next.state === "delayed") return false;
  return !(w.state === next.state && w.status === next.status && w.recipient === next.recipient && w.at === next.at);
}
