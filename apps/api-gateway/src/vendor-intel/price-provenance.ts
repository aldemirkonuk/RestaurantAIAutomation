/**
 * Where a price came from — the paper, its line, the message and the person
 * (ADR 0160 §112 fork 6(a)).
 *
 * The founder's words (ADR 0160 §112): *"And all of the invoices we we
 * receive, that's perfect as well. And also the where we got it from. Let's
 * say if we find from WhatsApp or who did we Whoever did we communicate with,
 * I want to see that in the report as well."* His fork 6 answer (2026-09-18):
 * "Always on the record, loaded fresh" — so none of this is stored on the
 * sighting beyond four ids. Every name, number, date and excerpt is READ
 * FRESH from its own table each time the record opens: a renamed contact, a
 * corrected invoice number, or a message whose raw mail the house's retention
 * window has since deleted shows as it is now, never as it was cached.
 *
 * This file is the pure half: shapes and the sentences. The reads are
 * `vendor-comparison.service.ts` `loadProvenance`, and every one of them is
 * house-scoped on its own table (`restaurant_id`, or the contact's vendor's
 * `restaurant_id`), on top of the database's own composite keys
 * (`20260927130000_a_price_names_its_paper_and_its_messenger.sql`).
 */

/** What a person can read about the paper a price was read from. */
export interface ProvenanceDocument {
  id: string;
  docType: string | null;
  docNumber: string | null;
  docDate: string | null;
  sourceChannel: string | null;
  status: string | null;
}

export interface ProvenanceDocumentLine {
  id: string;
  lineNo: number | null;
  description: string | null;
  unitPrice: number | null;
  qty: number | null;
  uom: string | null;
}

export interface ProvenanceMessage {
  id: string;
  channel: string | null;
  direction: string | null;
  /** When the message was received (inbound) or sent (outbound), else written. */
  at: string | null;
  subject: string | null;
  /**
   * The first words of the message, or null when the house's retention window
   * has deleted the raw mail (`textDeletedAt` then says when).
   */
  excerpt: string | null;
  textDeletedAt: string | null;
  orderId: string | null;
}

export type PersonBasis = "named_contact" | "message_sender" | "message_recipient";

export interface ProvenancePerson {
  name: string | null;
  address: string | null;
  role: string | null;
  /**
   * How the person is known: a contact a person NAMED when recording the
   * price, or read off the message's own From/To header at read time.
   */
  basis: PersonBasis;
}

export interface ObservationProvenance {
  document: ProvenanceDocument | null;
  documentLine: ProvenanceDocumentLine | null;
  message: ProvenanceMessage | null;
  person: ProvenancePerson | null;
  /**
   * Sentences for everything the four fields above cannot say themselves: the
   * writer's own note on what it found, a paper or message deleted since, a
   * read that failed. Empty means there is nothing to add — never "unknown".
   */
  sentences: string[];
}

export const EMPTY_PROVENANCE: ObservationProvenance = Object.freeze({
  document: null,
  documentLine: null,
  message: null,
  person: null,
  sentences: [],
}) as ObservationProvenance;

/** How many characters of a message the record shows. */
export const EXCERPT_CHARS = 240;

/**
 * `"Ayşe Demir <ayse@vendor.test>"` → name + address; a bare address → address
 * only. Only the FIRST mailbox of a list is read: a price is attributed to one
 * person, and the header's first mailbox is the one the mail client shows.
 */
export function parseMailbox(header: unknown): { name: string | null; address: string | null } {
  if (typeof header !== "string") return { name: null, address: null };
  const first = firstMailbox(header);
  if (!first) return { name: null, address: null };
  const angle = first.match(/^(.*?)<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return { name: name || null, address: angle[2].toLowerCase() };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(first)) return { name: null, address: first.toLowerCase() };
  return { name: first, address: null };
}

/** The first mailbox of an address list — a comma inside quotes or angle
 * brackets ("Demir, Ayşe" <a@b>) does not end it. */
function firstMailbox(header: string): string {
  let quoted = false;
  let angle = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle = true;
    else if (ch === ">" && !quoted) angle = false;
    else if (ch === "," && !quoted && !angle) return header.slice(0, i).trim();
  }
  return header.trim();
}

export interface MessageRow {
  id: string;
  provider_id: string | null;
  order_id: string | null;
  channel: string | null;
  direction: string | null;
  message_text: string | null;
  email_headers: Record<string, unknown> | null;
  received_at: string | null;
  sent_at: string | null;
  created_at: string | null;
  raw_deleted_at: string | null;
}

export interface ContactRow {
  id: string;
  provider_id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
}

export function messageOf(m: MessageRow): ProvenanceMessage {
  const deleted = m.raw_deleted_at ?? null;
  const text = typeof m.message_text === "string" ? m.message_text.trim() : "";
  const subject = m.email_headers && typeof m.email_headers.subject === "string"
    ? (m.email_headers.subject as string)
    : null;
  const inbound = String(m.direction ?? "").toLowerCase() === "inbound";
  return {
    id: m.id,
    channel: m.channel ?? null,
    direction: m.direction ? String(m.direction).toLowerCase() : null,
    at: (inbound ? m.received_at : m.sent_at) ?? m.created_at ?? null,
    subject,
    excerpt:
      deleted || !text
        ? null
        : text.length > EXCERPT_CHARS
          ? `${text.slice(0, EXCERPT_CHARS).trimEnd()}…`
          : text,
    textDeletedAt: deleted,
    orderId: m.order_id ?? null,
  };
}

/**
 * The person a price came from.
 *
 * A contact a person NAMED wins — that is a statement someone made. Otherwise
 * the message's own header names them: an inbound message's sender, an
 * outbound message's recipient (the person the house wrote to). The address
 * is matched against the vendor's contacts, read fresh, to put a name and a
 * role to it; an address no contact carries is still shown, as an address.
 */
export function personFor(args: {
  namedContact: ContactRow | null;
  message: MessageRow | null;
  vendorContacts: readonly ContactRow[];
}): ProvenancePerson | null {
  if (args.namedContact) {
    return {
      name: args.namedContact.name ?? null,
      address: args.namedContact.email ?? null,
      role: args.namedContact.role ?? null,
      basis: "named_contact",
    };
  }
  const m = args.message;
  if (!m || m.raw_deleted_at) return null;
  const inbound = String(m.direction ?? "").toLowerCase() === "inbound";
  const headers = m.email_headers ?? {};
  const mailbox = parseMailbox(inbound ? headers.from : headers.to);
  if (!mailbox.address && !mailbox.name) return null;
  const match = mailbox.address
    ? args.vendorContacts.find(
        (c) =>
          c.provider_id === m.provider_id &&
          typeof c.email === "string" &&
          c.email.trim().toLowerCase() === mailbox.address,
      )
    : undefined;
  return {
    name: match?.name ?? mailbox.name,
    address: mailbox.address,
    role: match?.role ?? null,
    basis: inbound ? "message_sender" : "message_recipient",
  };
}

/** The ids a sighting carries, from its columns and its `raw.provenance` copy. */
export interface ProvenanceIds {
  documentId: string | null;
  documentLineId: string | null;
  conversationMessageId: string | null;
  sourceContactId: string | null;
  /** What the writer recorded, kept so a deleted paper can still be named. */
  recorded: {
    documentId: string | null;
    conversationMessageId: string | null;
    contactId: string | null;
    sentence: string | null;
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function provenanceIdsOf(row: {
  document_id?: string | null;
  document_line_id?: string | null;
  conversation_message_id?: string | null;
  source_contact_id?: string | null;
  raw?: Record<string, any> | null;
}): ProvenanceIds {
  const p = (row.raw?.provenance ?? {}) as Record<string, unknown>;
  return {
    documentId: row.document_id ?? null,
    documentLineId: row.document_line_id ?? null,
    conversationMessageId: row.conversation_message_id ?? null,
    sourceContactId: row.source_contact_id ?? null,
    recorded: {
      documentId: str(p.documentId),
      conversationMessageId: str(p.conversationMessageId),
      contactId: str(p.contactId),
      sentence: str(p.sentence),
    },
  };
}

export interface ProvenanceReads {
  documents: ReadonlyMap<string, ProvenanceDocument>;
  lines: ReadonlyMap<string, ProvenanceDocumentLine & { documentId: string }>;
  messages: ReadonlyMap<string, MessageRow>;
  contacts: ReadonlyMap<string, ContactRow>;
  vendorContacts: readonly ContactRow[];
  /** A read that failed, by table — its absence is then not evidence. */
  failed: {
    documents?: string;
    lines?: string;
    messages?: string;
    contacts?: string;
  };
}

/**
 * One sighting's provenance, from its ids and the fresh reads.
 *
 * Every absence is said in a sentence that is TRUE of that absence: a failed
 * read is never reported as a missing paper, and a paper deleted after the
 * price was recorded is never reported as "no paper attached".
 */
export function provenanceFor(ids: ProvenanceIds, reads: ProvenanceReads): ObservationProvenance {
  const sentences: string[] = [];
  if (ids.recorded.sentence) sentences.push(ids.recorded.sentence);

  let document: ProvenanceDocument | null = null;
  let documentLine: ProvenanceDocumentLine | null = null;
  if (ids.documentId) {
    if (reads.failed.documents) {
      sentences.push(
        `The paper could not be read just now (${reads.failed.documents}). This is a failed read, not a missing paper.`,
      );
    } else {
      document = reads.documents.get(ids.documentId) ?? null;
      if (!document)
        sentences.push("The paper this row names is not among this house's documents.");
    }
    if (document && ids.documentLineId) {
      if (reads.failed.lines) {
        sentences.push(
          `The line on the paper could not be read just now (${reads.failed.lines}). This is a failed read, not a missing line.`,
        );
      } else {
        const line = reads.lines.get(ids.documentLineId);
        if (line && line.documentId === document.id) {
          const { documentId: _d, ...rest } = line;
          documentLine = rest;
        } else {
          sentences.push("The line this row names is no longer on the paper.");
        }
      }
    }
  } else if (ids.recorded.documentId) {
    sentences.push(
      "The paper this price was read from was deleted after the price was recorded; the price is kept, the link is gone.",
    );
  }

  let messageRow: MessageRow | null = null;
  if (ids.conversationMessageId) {
    if (reads.failed.messages) {
      sentences.push(
        `The message could not be read just now (${reads.failed.messages}). This is a failed read, not a missing message.`,
      );
    } else {
      messageRow = reads.messages.get(ids.conversationMessageId) ?? null;
      if (!messageRow)
        sentences.push("The message this row names is not among this house's conversations.");
      else if (messageRow.raw_deleted_at)
        sentences.push(
          `The message's own words were deleted on ${messageRow.raw_deleted_at.slice(0, 10)} under this house's mail retention; the price and the fact that it came from this message are kept.`,
        );
    }
  } else if (ids.recorded.conversationMessageId) {
    sentences.push(
      "The message this price came from was deleted after the price was recorded; the price is kept, the link is gone.",
    );
  }

  let namedContact: ContactRow | null = null;
  if (ids.sourceContactId) {
    if (reads.failed.contacts) {
      sentences.push(
        `The person could not be read just now (${reads.failed.contacts}). This is a failed read, not an unnamed person.`,
      );
    } else {
      namedContact = reads.contacts.get(ids.sourceContactId) ?? null;
      if (!namedContact)
        sentences.push("The person this row names is not among this house's vendor contacts.");
    }
  } else if (ids.recorded.contactId) {
    sentences.push(
      "The person this price was recorded from was removed from the vendor's contacts after the price was recorded.",
    );
  }

  const person = personFor({
    namedContact,
    message: messageRow,
    vendorContacts: reads.failed.contacts ? [] : reads.vendorContacts,
  });
  if (!person && messageRow && !messageRow.raw_deleted_at && !namedContact) {
    sentences.push("The message names no sender or recipient this page can read.");
  }

  return {
    document,
    documentLine,
    message: messageRow ? messageOf(messageRow) : null,
    person,
    sentences,
  };
}
