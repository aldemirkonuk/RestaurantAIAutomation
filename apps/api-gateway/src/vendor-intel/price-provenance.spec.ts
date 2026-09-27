/**
 * ADR 0160 §112 fork 6(a) — the sentences a price's provenance says.
 *
 * The rule under test is that every absence is said TRULY: a failed read is
 * never a missing paper, a paper deleted since is never "no paper", and a
 * message whose raw mail the retention window deleted names no person it can
 * no longer read.
 */
import {
  ContactRow,
  MessageRow,
  ProvenanceReads,
  messageOf,
  parseMailbox,
  personFor,
  provenanceFor,
  provenanceIdsOf,
} from "./price-provenance";

const msg = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: "m1",
  provider_id: "p1",
  order_id: "o1",
  channel: "email",
  direction: "inbound",
  message_text: "We can do 28.50 a bottle on three cases.",
  email_headers: { from: "Ayşe Demir <AYSE@vendor.test>", subject: "Re: Barolo" },
  received_at: "2026-09-20T09:00:00Z",
  sent_at: null,
  created_at: "2026-09-20T09:00:05Z",
  raw_deleted_at: null,
  ...over,
});

const contact = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: "c1",
  provider_id: "p1",
  name: "Ayşe Demir",
  email: "ayse@vendor.test",
  role: "Sales rep",
  ...over,
});

const reads = (over: Partial<ProvenanceReads> = {}): ProvenanceReads => ({
  documents: new Map(),
  lines: new Map(),
  messages: new Map(),
  contacts: new Map(),
  vendorContacts: [],
  failed: {},
  ...over,
});

describe("parseMailbox", () => {
  it("reads a name and an address, lower-casing the address", () => {
    expect(parseMailbox('"Demir, Ayşe" <AYSE@Vendor.test>, x@y.test')).toEqual({
      name: "Demir, Ayşe",
      address: "ayse@vendor.test",
    });
    expect(parseMailbox("Ayşe Demir <AYSE@Vendor.test>")).toEqual({
      name: "Ayşe Demir",
      address: "ayse@vendor.test",
    });
    expect(parseMailbox("ayse@vendor.test, other@vendor.test")).toEqual({
      name: null,
      address: "ayse@vendor.test",
    });
    expect(parseMailbox(undefined)).toEqual({ name: null, address: null });
  });
});

describe("personFor", () => {
  it("prefers a contact a person named over the message's header", () => {
    const p = personFor({
      namedContact: contact({ name: "Mehmet", email: "m@vendor.test" }),
      message: msg(),
      vendorContacts: [contact()],
    });
    expect(p).toEqual({ name: "Mehmet", address: "m@vendor.test", role: "Sales rep", basis: "named_contact" });
  });
  it("reads an inbound message's sender and puts the vendor contact's name and role to it", () => {
    expect(personFor({ namedContact: null, message: msg(), vendorContacts: [contact()] })).toEqual({
      name: "Ayşe Demir",
      address: "ayse@vendor.test",
      role: "Sales rep",
      basis: "message_sender",
    });
  });
  it("never matches a contact of a different vendor", () => {
    const p = personFor({
      namedContact: null,
      message: msg(),
      vendorContacts: [contact({ provider_id: "someone-else", role: "Wrong" })],
    });
    expect(p?.role).toBeNull();
  });
  it("reads an outbound message's recipient", () => {
    const p = personFor({
      namedContact: null,
      message: msg({ direction: "outbound", email_headers: { to: "rep@vendor.test" } }),
      vendorContacts: [],
    });
    expect(p).toEqual({ name: null, address: "rep@vendor.test", role: null, basis: "message_recipient" });
  });
  it("names nobody off a message whose raw mail was deleted", () => {
    expect(
      personFor({ namedContact: null, message: msg({ raw_deleted_at: "2026-09-22T00:00:00Z" }), vendorContacts: [contact()] }),
    ).toBeNull();
  });
});

describe("messageOf", () => {
  it("shows no excerpt once the retention window deleted the words", () => {
    const m = messageOf(msg({ raw_deleted_at: "2026-09-22T00:00:00Z", message_text: "[The raw mail was deleted …]" }));
    expect(m.excerpt).toBeNull();
    expect(m.textDeletedAt).toBe("2026-09-22T00:00:00Z");
  });
  it("cuts a long message and keeps the received moment for inbound", () => {
    const m = messageOf(msg({ message_text: "x".repeat(500) }));
    expect(m.excerpt?.length).toBe(241);
    expect(m.at).toBe("2026-09-20T09:00:00Z");
    expect(m.subject).toBe("Re: Barolo");
  });
});

describe("provenanceFor", () => {
  const doc = { id: "d1", docType: "invoice", docNumber: "F-1", docDate: "2026-09-19", sourceChannel: "upload", status: "verified" };

  it("draws the paper, its line, the message and the person together", () => {
    const ids = provenanceIdsOf({
      document_id: "d1",
      document_line_id: "l1",
      conversation_message_id: "m1",
      raw: { provenance: { sentence: "Read from invoice F-1, line 2." } },
    });
    const p = provenanceFor(
      ids,
      reads({
        documents: new Map([["d1", doc]]),
        lines: new Map([["l1", { id: "l1", documentId: "d1", lineNo: 2, description: "Barolo", unitPrice: 28.5, qty: 36, uom: "bottle" }]]),
        messages: new Map([["m1", msg()]]),
        vendorContacts: [contact()],
      }),
    );
    expect(p.document).toEqual(doc);
    expect(p.documentLine).toEqual({ id: "l1", lineNo: 2, description: "Barolo", unitPrice: 28.5, qty: 36, uom: "bottle" });
    expect(p.message?.excerpt).toBe("We can do 28.50 a bottle on three cases.");
    expect(p.person?.name).toBe("Ayşe Demir");
    expect(p.sentences).toEqual(["Read from invoice F-1, line 2."]);
  });

  it("says a failed read is a failed read, never a missing paper", () => {
    const p = provenanceFor(
      provenanceIdsOf({ document_id: "d1", conversation_message_id: "m1" }),
      reads({ failed: { documents: "timeout", messages: "timeout" } }),
    );
    expect(p.document).toBeNull();
    expect(p.message).toBeNull();
    expect(p.sentences).toEqual([
      "The paper could not be read just now (timeout). This is a failed read, not a missing paper.",
      "The message could not be read just now (timeout). This is a failed read, not a missing message.",
    ]);
  });

  it("says a paper, message or person deleted since was deleted, not that there never was one", () => {
    const p = provenanceFor(
      provenanceIdsOf({
        document_id: null,
        conversation_message_id: null,
        source_contact_id: null,
        raw: { provenance: { documentId: "d1", conversationMessageId: "m1", contactId: "c1" } },
      }),
      reads(),
    );
    expect(p.sentences).toEqual([
      "The paper this price was read from was deleted after the price was recorded; the price is kept, the link is gone.",
      "The message this price came from was deleted after the price was recorded; the price is kept, the link is gone.",
      "The person this price was recorded from was removed from the vendor's contacts after the price was recorded.",
    ]);
  });

  it("names a retention-deleted message as such, and no person off it", () => {
    const p = provenanceFor(
      provenanceIdsOf({ conversation_message_id: "m1" }),
      reads({ messages: new Map([["m1", msg({ raw_deleted_at: "2026-09-22T00:00:00Z" })]]), vendorContacts: [contact()] }),
    );
    expect(p.person).toBeNull();
    expect(p.message?.excerpt).toBeNull();
    expect(p.sentences[0]).toMatch(/^The message's own words were deleted on 2026-09-22 under this house's mail retention/);
  });

  it("never shows a line that is not on the paper shown", () => {
    const p = provenanceFor(
      provenanceIdsOf({ document_id: "d1", document_line_id: "l1" }),
      reads({
        documents: new Map([["d1", doc]]),
        lines: new Map([["l1", { id: "l1", documentId: "d-other", lineNo: 1, description: null, unitPrice: null, qty: null, uom: null }]]),
      }),
    );
    expect(p.documentLine).toBeNull();
    expect(p.sentences).toContain("The line this row names is no longer on the paper.");
  });

  it("has nothing to say about a row with no provenance at all", () => {
    expect(provenanceFor(provenanceIdsOf({}), reads())).toEqual({
      document: null,
      documentLine: null,
      message: null,
      person: null,
      sentences: [],
    });
  });
});
