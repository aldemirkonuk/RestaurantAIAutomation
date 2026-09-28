/**
 * ADR 0160 §112 fork 6(a) through the service: the attach-a-paper and
 * message/person write is refused for anything not this house's, and the
 * compare read loads the paper, message and person FRESH and house-scoped.
 */
import { BadRequestException, InternalServerErrorException } from "@nestjs/common";
import { VendorComparisonService } from "./vendor-comparison.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-000000000001";
const WINE = "11111111-2222-3333-4444-555555555555";
const DOC = "dddddddd-0000-4000-8000-00000000000a";
const LINE = "eeeeeeee-0000-4000-8000-00000000000a";
const MSG = "ffffffff-0000-4000-8000-00000000000a";
const CONTACT = "99999999-0000-4000-8000-00000000000a";
const VENDOR = "cccccccc-0000-4000-8000-00000000000a";

type Result = { data: any; error: any };
interface Read {
  table: string;
  eq: Array<[string, any]>;
  in: Array<[string, any[]]>;
  or: string[];
  select: string;
}

/** One fake table per name; `answer(read)` decides what the query returns. */
function fakeDb(answer: (r: Read, shape: "one" | "many") => Result) {
  const reads: Read[] = [];
  const inserted: any[] = [];
  const from = (table: string) => {
    const r: Read = { table, eq: [], in: [], or: [], select: "" };
    let inserting: any = null;
    const q: any = {
      select: (cols?: string) => {
        if (typeof cols === "string" && !inserting) r.select = cols;
        return q;
      },
      eq: (c: string, v: any) => (r.eq.push([c, v]), q),
      in: (c: string, v: any[]) => (r.in.push([c, v]), q),
      or: (c: string) => (r.or.push(c), q),
      is: () => q,
      not: () => q,
      gte: () => q,
      order: () => q,
      limit: () => q,
      insert: (payload: any) => {
        inserting = payload;
        inserted.push(payload);
        return q;
      },
      single: async () =>
        inserting ? { data: { id: "obs-new", observed_at: inserting.observed_at }, error: null } : settle("one"),
      maybeSingle: async () => settle("one"),
      then: (res: any, rej: any) => Promise.resolve(settle("many")).then(res, rej),
    };
    const settle = (shape: "one" | "many") => {
      reads.push(r);
      return answer(r, shape);
    };
    return q;
  };
  const svc = new VendorComparisonService({ supabase: { from } } as any);
  return { svc, reads, inserted };
}

const eqOf = (r: Read, col: string) => r.eq.find(([c]) => c === col)?.[1];

describe("recording a price with its paper, message and person", () => {
  const base = { masterWineId: WINE, price: 30, currency: "EUR", restaurantId: HOUSE };

  /** Everything named is this house's unless the test says otherwise. */
  const houseAnswers =
    (not: Partial<Record<string, "missing" | "error">> = {}) =>
    (r: Read, shape: "one" | "many"): Result => {
      if (r.table === "master_wine_library")
        return { data: { producer: "P", name: "N", vintage: 2019 }, error: null };
      if (r.table === "vendor_price_observations") return { data: [], error: null };
      const verdict = not[r.table];
      if (verdict === "error") return { data: null, error: { message: `${r.table} down` } };
      if (verdict === "missing") return { data: null, error: null };
      return { data: shape === "one" ? { id: "ok" } : [], error: null };
    };

  it("writes all four ids and copies them into raw.provenance once each is this house's", async () => {
    const { svc, reads, inserted } = fakeDb(houseAnswers());
    await svc.recordManualObservation({
      ...base,
      documentId: DOC,
      documentLineId: LINE,
      conversationMessageId: MSG,
      contactId: CONTACT,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      restaurant_id: HOUSE,
      document_id: DOC,
      document_line_id: LINE,
      conversation_message_id: MSG,
      source_contact_id: CONTACT,
    });
    expect(inserted[0].raw.provenance).toEqual({
      documentId: DOC,
      documentLineId: LINE,
      conversationMessageId: MSG,
      contactId: CONTACT,
    });
    // Each check is scoped to this house on its own table (the contact
    // through its vendor, since provider_contacts has no restaurant_id).
    const check = (t: string) => reads.find((r) => r.table === t)!;
    expect(eqOf(check("procurement_documents"), "restaurant_id")).toBe(HOUSE);
    expect(eqOf(check("procurement_document_lines"), "restaurant_id")).toBe(HOUSE);
    expect(eqOf(check("procurement_document_lines"), "document_id")).toBe(DOC);
    expect(eqOf(check("procurement_conversations"), "restaurant_id")).toBe(HOUSE);
    expect(eqOf(check("provider_contacts"), "providers.restaurant_id")).toBe(HOUSE);
  });

  it.each([
    ["procurement_documents", { documentId: DOC }, /not one of this house's documents/],
    ["procurement_document_lines", { documentId: DOC, documentLineId: LINE }, /not on the paper/],
    ["procurement_conversations", { conversationMessageId: MSG }, /not one of this house's conversations/],
    ["provider_contacts", { contactId: CONTACT }, /not a contact of one of this house's vendors/],
  ])("refuses a %s row that is not this house's, and writes nothing", async (table, extra, msg) => {
    const { svc, inserted } = fakeDb(houseAnswers({ [table]: "missing" }));
    const p = svc.recordManualObservation({ ...base, ...extra });
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(msg);
    expect(inserted).toHaveLength(0);
  });

  it("refuses a line named without its paper", async () => {
    const { svc, inserted } = fakeDb(houseAnswers());
    await expect(svc.recordManualObservation({ ...base, documentLineId: LINE })).rejects.toThrow(
      /line of a paper was named without the paper itself/,
    );
    expect(inserted).toHaveLength(0);
  });

  it("refuses to write when the check itself could not be made", async () => {
    const { svc, inserted } = fakeDb(houseAnswers({ procurement_documents: "error" }));
    await expect(svc.recordManualObservation({ ...base, documentId: DOC })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(inserted).toHaveLength(0);
  });
});

describe("compare loads provenance fresh and house-scoped", () => {
  const houseRow = {
    id: "obs-house",
    restaurant_id: HOUSE,
    provider_id: VENDOR,
    vendor_name_raw: "Vinos",
    source_type: "quote",
    raw_price: 30,
    currency: "EUR",
    trust_tier: 2,
    pack_size: 1,
    unit_volume_ml: 750,
    observed_at: "2026-09-20T10:00:00Z",
    is_outlier: false,
    document_id: DOC,
    document_line_id: LINE,
    conversation_message_id: MSG,
    source_contact_id: null,
    raw: { provenance: { documentId: DOC, conversationMessageId: MSG } },
  };
  const publicRow = { ...houseRow, id: "obs-public", restaurant_id: null, document_id: null, document_line_id: null, conversation_message_id: null, raw: {} };

  const answers =
    (fail: string | null = null) =>
    (r: Read): Result => {
      if (fail === r.table) return { data: null, error: { message: "down" } };
      switch (r.table) {
        case "master_wine_library":
          return { data: { producer: "P", name: "N", vintage: 2019 }, error: null };
        case "vendor_price_observations":
          return { data: [houseRow, publicRow], error: null };
        case "procurement_documents":
          return { data: [{ id: DOC, doc_type: "invoice", doc_number: "F-9", doc_date: "2026-09-19", source_channel: "upload", status: "received" }], error: null };
        case "procurement_document_lines":
          return { data: [{ id: LINE, document_id: DOC, line_no: 4, description: "Barolo", unit_price: "30.0000", qty: "12", uom: "bottle" }], error: null };
        case "procurement_conversations":
          return {
            data: [{ id: MSG, provider_id: VENDOR, order_id: null, channel: "email", direction: "inbound", message_text: "30 a bottle", email_headers: { from: "Rep <rep@vinos.test>" }, received_at: "2026-09-18T08:00:00Z", sent_at: null, created_at: "2026-09-18T08:00:01Z", raw_deleted_at: null }],
            error: null,
          };
        case "provider_contacts":
          return { data: [{ id: CONTACT, provider_id: VENDOR, name: "Rep Name", email: "rep@vinos.test", role: "Rep" }], error: null };
        default:
          return { data: [], error: null };
      }
    };

  it("attaches the paper, line, message and person to this house's row only", async () => {
    const { svc, reads } = fakeDb(answers());
    const res = await svc.compare({ masterWineId: WINE, restaurantId: HOUSE });
    const house = res.observations.find((o) => o.id === "obs-house")!;
    const pub = res.observations.find((o) => o.id === "obs-public")!;
    expect(house.provenance.document).toMatchObject({ id: DOC, docNumber: "F-9" });
    expect(house.provenance.documentLine).toMatchObject({ lineNo: 4, unitPrice: 30, qty: 12 });
    expect(house.provenance.message).toMatchObject({ id: MSG, excerpt: "30 a bottle" });
    expect(house.provenance.person).toEqual({ name: "Rep Name", address: "rep@vinos.test", role: "Rep", basis: "message_sender" });
    expect(pub.provenance).toEqual({ document: null, documentLine: null, message: null, person: null, sentences: [] });
    for (const t of ["procurement_documents", "procurement_document_lines", "procurement_conversations"]) {
      const r = reads.filter((x) => x.table === t);
      expect(r).toHaveLength(1);
      expect(eqOf(r[0], "restaurant_id")).toBe(HOUSE);
    }
    const contacts = reads.filter((x) => x.table === "provider_contacts");
    expect(contacts).toHaveLength(1);
    expect(eqOf(contacts[0], "providers.restaurant_id")).toBe(HOUSE);
  });

  it("reads again on every compare — nothing is served from a previous read", async () => {
    const { svc, reads } = fakeDb(answers());
    await svc.compare({ masterWineId: WINE, restaurantId: HOUSE });
    await svc.compare({ masterWineId: WINE, restaurantId: HOUSE });
    expect(reads.filter((x) => x.table === "procurement_documents")).toHaveLength(2);
  });

  it("says a failed document read is a failed read and still returns the ladder", async () => {
    const { svc } = fakeDb(answers("procurement_documents"));
    const res = await svc.compare({ masterWineId: WINE, restaurantId: HOUSE });
    const house = res.observations.find((o) => o.id === "obs-house")!;
    expect(house.provenance.document).toBeNull();
    expect(house.provenance.sentences).toContain(
      "The paper could not be read just now (down). This is a failed read, not a missing paper.",
    );
    expect(house.provenance.message).not.toBeNull();
  });
});

describe("observationSources", () => {
  it("refuses a vendor that is not this house's", async () => {
    const { svc } = fakeDb((r) => (r.table === "providers" ? { data: null, error: null } : { data: [], error: null }));
    await expect(svc.observationSources({ restaurantId: HOUSE, providerId: VENDOR })).rejects.toThrow(
      /not one of this house's vendors/,
    );
  });

  it("lists this house's messages with the vendor and the vendor's contacts", async () => {
    const { svc, reads } = fakeDb((r) => {
      if (r.table === "providers") return { data: { id: VENDOR }, error: null };
      if (r.table === "procurement_conversations")
        return {
          data: [{ id: MSG, provider_id: VENDOR, order_id: "o", channel: "whatsapp", direction: "inbound", message_text: "hi", email_headers: {}, received_at: null, sent_at: null, created_at: "2026-09-18T08:00:00Z", raw_deleted_at: null }],
          error: null,
        };
      if (r.table === "provider_contacts") return { data: [{ id: CONTACT, name: "Rep", email: null, role: null }], error: null };
      return { data: [], error: null };
    });
    const res = await svc.observationSources({ restaurantId: HOUSE, providerId: VENDOR });
    expect(res.messages).toEqual([
      expect.objectContaining({ id: MSG, channel: "whatsapp", excerpt: "hi", at: "2026-09-18T08:00:00Z" }),
    ]);
    expect(res.contacts).toEqual([{ id: CONTACT, name: "Rep", email: null, role: null }]);
    const provider = reads.find((x) => x.table === "providers")!;
    expect(eqOf(provider, "restaurant_id")).toBe(HOUSE);
    const msgs = reads.find((x) => x.table === "procurement_conversations")!;
    expect(eqOf(msgs, "restaurant_id")).toBe(HOUSE);
    expect(eqOf(msgs, "provider_id")).toBe(VENDOR);
  });
});
