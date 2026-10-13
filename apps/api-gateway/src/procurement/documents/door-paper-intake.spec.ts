import { DocumentIntakeService } from "./document-intake.service";
import { ParsedDocument } from "./parsed-document";

/**
 * The door photo (F-745, F-746, F-747). All ids, names and numbers are
 * SYNTHETIC. The client below answers by table, and records every write, so a
 * test can say which rows were — and were not — written.
 */

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type Op = {
  table: string;
  verb: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: [string, string, unknown][];
};

const HOUSE = "11111111-1111-1111-1111-111111111111";
const ORDER = "00000000-0000-0000-0000-0000000000a2";
/** A checksum-valid VKN (synthetic vendor). */
const VKN = "1234567890";

function fakeDb(respond: (op: Op) => Answer) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, verb: "select", filters: [] };
    const run = () => {
      if (!ops.includes(op)) ops.push(op);
      return Promise.resolve(respond(op));
    };
    const chain: any = {
      select: () => chain,
      insert: (p: Record<string, unknown>) => {
        op.verb = "insert";
        op.payload = p;
        return chain;
      },
      update: (p: Record<string, unknown>) => {
        op.verb = "update";
        op.payload = p;
        return chain;
      },
      eq: (c: string, v: unknown) => (op.filters.push(["eq", c, v]), chain),
      neq: (c: string, v: unknown) => (op.filters.push(["neq", c, v]), chain),
      is: (c: string, v: unknown) => (op.filters.push(["is", c, v]), chain),
      in: (c: string, v: unknown) => (op.filters.push(["in", c, v]), chain),
      single: run,
      maybeSingle: run,
      then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) =>
        run().then(r, j),
    };
    return chain;
  };
  return { ops, db: { getClient: () => ({ from }) } };
}

const has = (op: Op, col: string, val?: unknown) =>
  op.filters.some(([, c, v]) => c === col && (val === undefined || v === val));

function parse(over: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    docType: "invoice",
    docNumber: "INV-1001",
    poNumber: null,
    vendorName: "SENTETİK ŞARAP A.Ş.",
    vendorTaxId: VKN,
    vendorCountry: "TR",
    currency: "TRY",
    lines: [],
    computedLinesTotal: null,
    tieOutDelta: null,
    tiesOut: null,
    confidence: 0.9,
    warnings: [],
    ...over,
  } as unknown as ParsedDocument;
}

function build(opts: {
  parsed?: ParsedDocument;
  respond: (op: Op) => Answer | undefined;
  vendor?: { state: string; providerId: string | null };
  applyError?: string;
}) {
  const { ops, db } = fakeDb(
    (op) => opts.respond(op) ?? { data: null, error: null },
  );
  const vendorResolution = {
    resolveVendor: jest.fn(async () => ({
      source: null,
      identity: null,
      reason: "SYNTHETIC",
      ...(opts.vendor ?? { state: "unresolved", providerId: null }),
    })),
    applyToDocument: jest.fn(async () => opts.applyError),
  };
  const service = new DocumentIntakeService(
    db as never,
    {} as never,
    {} as never,
    vendorResolution as never,
  );
  jest.spyOn(service as any, "route").mockResolvedValue(opts.parsed ?? parse());
  jest
    .spyOn(service as any, "persistOriginalBytes")
    .mockResolvedValue({ path: "p", failure: null });
  jest.spyOn(service, "matchDocumentLines").mockResolvedValue({
    applied: [],
    suggested: [],
    unmatchedDocumentLineIds: [],
    unmatchedOrderLineIds: [],
  });
  return { service, ops };
}

const photo = (over: Record<string, unknown> = {}) => ({
  restaurantId: HOUSE,
  source: "photo" as const,
  buffer: Buffer.from("SYNTHETIC photo bytes"),
  filename: "door.jpg",
  mimeType: "image/jpeg",
  orderId: ORDER,
  ...over,
});

/** The order 0042, with vendor A. */
const orderRow = (op: Op): Answer | undefined =>
  op.table === "procurement_orders"
    ? {
        data: { id: ORDER, order_number: "PO-0042", provider_id: "prov-A" },
        error: null,
      }
    : undefined;

/** A fresh insert: no earlier copy by bytes or by number. */
const freshInsert = (op: Op): Answer | undefined => {
  if (op.table !== "procurement_documents") return undefined;
  if (op.verb === "insert") return { data: { id: "doc-new" }, error: null };
  if (op.verb === "select" && has(op, "sha256"))
    return { data: null, error: null };
  if (op.verb === "select" && has(op, "doc_number"))
    return { data: [], error: null };
  if (op.verb === "select")
    return { data: { notes: null, status: "received" }, error: null };
  return undefined;
};

const links = (ops: Op[]) =>
  ops.filter(
    (o) => o.table === "procurement_document_links" && o.verb === "insert",
  );

describe("F-745 — a door photo is filed to its order only when the paper fits", () => {
  it("does not file a paper that prints another order's number, and says so", async () => {
    const { service, ops } = build({
      parsed: parse({ poNumber: "PO-0043" }),
      respond: (op) => orderRow(op) ?? freshInsert(op),
    });
    const r = await service.ingest(photo());
    expect(links(ops)).toHaveLength(0);
    expect(r.orderLink).toMatchObject({ orderId: ORDER, linked: false });
    expect(r.orderLink?.conflict).toMatch(/prints order PO-0043, not PO-0042/);
    const note = ops.find(
      (o) => o.table === "procurement_documents" && o.verb === "update",
    );
    expect(note?.payload).toMatchObject({ status: "needs_review" });
    expect(String(note?.payload?.notes)).toMatch(/PO-0043/);
  });

  it.each(["verified", "rejected", "superseded"])(
    "notes the conflict on a %s paper on file without reopening it for review",
    async (status) => {
      const { service, ops } = build({
        respond: (op) => {
          const order = orderRow(op);
          if (order) return order;
          if (op.table !== "procurement_documents" || op.verb !== "select")
            return undefined;
          if (has(op, "sha256"))
            return {
              data: {
                id: "doc-first",
                provider_id: "prov-A",
                extracted: {
                  docType: "invoice",
                  poNumber: "PO-0043",
                  lines: [],
                },
              },
              error: null,
            };
          return { data: { notes: null, status }, error: null };
        },
      });
      const r = await service.ingest(photo());
      expect(r).toMatchObject({ documentId: "doc-first", duplicate: true });
      expect(r.orderLink?.linked).toBe(false);
      expect(links(ops)).toHaveLength(0);
      const note = ops.find(
        (o) => o.table === "procurement_documents" && o.verb === "update",
      );
      expect(String(note?.payload?.notes)).toMatch(/PO-0043/);
      // What reaches the database: postgrest-js sends JSON.stringify(values),
      // which leaves an undefined status out of the request.
      expect(JSON.parse(JSON.stringify(note?.payload))).not.toHaveProperty(
        "status",
      );
    },
  );

  it("moves a paper to needs_review only while it still awaits review", async () => {
    const { service, ops } = build({
      parsed: parse({ poNumber: "PO-0043" }),
      respond: (op) => orderRow(op) ?? freshInsert(op),
    });
    await service.ingest(photo());
    const note = ops.find(
      (o) => o.table === "procurement_documents" && o.verb === "update",
    )!;
    expect(note.filters).toContainEqual([
      "in",
      "status",
      ["received", "needs_review"],
    ]);
  });

  it("does not file a paper whose printed vendor is another vendor on file", async () => {
    const { service, ops } = build({
      vendor: { state: "matched", providerId: "prov-B" },
      respond: (op) => orderRow(op) ?? freshInsert(op),
    });
    const r = await service.ingest(photo());
    expect(links(ops)).toHaveLength(0);
    expect(r.orderLink?.linked).toBe(false);
    expect(r.orderLink?.conflict).toMatch(/different vendor/);
  });

  it("files a paper that prints this order's number, from this order's vendor", async () => {
    const { service, ops } = build({
      parsed: parse({ poNumber: "po-0042" }),
      vendor: { state: "matched", providerId: "prov-A" },
      respond: (op) => orderRow(op) ?? freshInsert(op),
    });
    const r = await service.ingest(photo());
    expect(links(ops)).toHaveLength(1);
    expect(links(ops)[0].payload).toMatchObject({
      order_id: ORDER,
      link_method: "manual",
      confidence: 1,
    });
    expect(r.orderLink).toEqual({
      orderId: ORDER,
      linked: true,
      conflict: null,
    });
  });
});

describe("F-746 — a second photo of a paper already on file", () => {
  /** INV-1001 is on file, filed under vendor A, whose tax id is VKN. */
  const onFile = (op: Op): Answer | undefined => {
    if (op.table === "providers")
      return { data: [{ id: "prov-A" }], error: null };
    if (op.table !== "procurement_documents") return undefined;
    if (op.verb === "select" && has(op, "sha256"))
      return { data: null, error: null };
    if (op.verb === "select" && has(op, "doc_number"))
      return {
        data: [
          {
            id: "doc-first",
            provider_id: "prov-A",
            extracted: { docType: "invoice", docNumber: "INV-1001", lines: [] },
          },
        ],
        error: null,
      };
    if (op.verb === "insert")
      return { data: { id: "doc-second" }, error: null };
    return undefined;
  };

  it("answers duplicate with the first document's id and writes no second one", async () => {
    const { service, ops } = build({
      respond: (op) => orderRow(op) ?? onFile(op),
    });
    const r = await service.ingest(photo());
    expect(r).toMatchObject({ documentId: "doc-first", duplicate: true });
    expect(
      ops.filter(
        (o) => o.table === "procurement_documents" && o.verb === "insert",
      ),
    ).toHaveLength(0);
    const lookup = ops.find(
      (o) => o.table === "procurement_documents" && has(o, "doc_number"),
    )!;
    expect(has(lookup, "doc_type", "invoice")).toBe(true);
    expect(has(lookup, "restaurant_id", HOUSE)).toBe(true);
  });

  it("does not count a superseded copy as the paper on file", async () => {
    const { service } = build({
      respond: (op) => {
        if (op.table === "procurement_documents" && has(op, "doc_number")) {
          const a = onFile(op)!;
          return {
            data: (a.data as object[]).map((r) => ({
              ...r,
              status: "superseded",
            })),
            error: null,
          };
        }
        return orderRow(op) ?? onFile(op);
      },
    });
    const r = await service.ingest(photo({ orderId: null }));
    expect(r).toMatchObject({ documentId: "doc-second", duplicate: false });
  });

  it("is not fooled by the same number from another vendor", async () => {
    const { service, ops } = build({
      parsed: parse({ vendorTaxId: "1111111111" }),
      respond: (op) =>
        orderRow(op) ??
        (op.table === "providers" ? { data: [], error: null } : undefined) ??
        (op.table === "procurement_documents" &&
        op.verb === "select" &&
        has(op, "doc_number")
          ? {
              data: [
                {
                  id: "doc-first",
                  provider_id: "prov-A",
                  extracted: { vendorTaxId: VKN, vendorCountry: "TR" },
                },
              ],
              error: null,
            }
          : freshInsert(op)),
    });
    const r = await service.ingest(photo({ orderId: null }));
    expect(r).toMatchObject({ documentId: "doc-new", duplicate: false });
    expect(
      ops.filter(
        (o) => o.table === "procurement_documents" && o.verb === "insert",
      ),
    ).toHaveLength(1);
  });

  describe("F-1565 — a US invoice that prints no tax id", () => {
    /** INV-1001 from a US vendor: no EIN printed, so no vendor was resolved. */
    const usPaper = (over: Partial<ParsedDocument> = {}) =>
      parse({
        vendorName: "SYNTHETIC WINE DISTRIBUTORS LLC",
        vendorTaxId: null,
        vendorCountry: "US",
        currency: "EUR",
        docDate: "2026-09-14",
        total: 1240.5,
        ...over,
      });
    const earlier =
      (row: Record<string, unknown>, linkedTo: string[]) =>
      (op: Op): Answer | undefined => {
        if (op.table === "procurement_document_links" && op.verb === "select")
          return {
            data: linkedTo.map((document_id) => ({ document_id })),
            error: null,
          };
        if (
          op.table === "procurement_documents" &&
          op.verb === "select" &&
          has(op, "doc_number")
        )
          return {
            data: [
              {
                id: "doc-first",
                provider_id: null,
                status: "needs_review",
                extracted: {
                  docType: "invoice",
                  docNumber: "INV-1001",
                  docDate: "2026-09-14",
                  total: 1240.5,
                  vendorTaxId: null,
                  vendorCountry: "US",
                },
                ...row,
              },
            ],
            error: null,
          };
        return freshInsert(op);
      };
    const inserts = (ops: Op[]) =>
      ops.filter(
        (o) => o.table === "procurement_documents" && o.verb === "insert",
      );

    it("knows a second photo of a paper already filed to the same order", async () => {
      const { service, ops } = build({
        parsed: usPaper(),
        respond: (op) => orderRow(op) ?? earlier({}, ["doc-first"])(op),
      });
      const r = await service.ingest(photo());
      expect(r).toMatchObject({ documentId: "doc-first", duplicate: true });
      expect(inserts(ops)).toHaveLength(0);
      const lookup = ops.find(
        (o) => o.table === "procurement_document_links" && o.verb === "select",
      )!;
      expect(has(lookup, "order_id", ORDER)).toBe(true);
      expect(has(lookup, "restaurant_id", HOUSE)).toBe(true);
    });

    it("knows it by the order's vendor when the first copy was filed under it", async () => {
      const { service, ops } = build({
        parsed: usPaper(),
        respond: (op) =>
          orderRow(op) ?? earlier({ provider_id: "prov-A" }, [])(op),
      });
      const r = await service.ingest(photo());
      expect(r).toMatchObject({ documentId: "doc-first", duplicate: true });
      expect(inserts(ops)).toHaveLength(0);
    });

    it("keeps a paper with the same number but another total as its own", async () => {
      const { service, ops } = build({
        parsed: usPaper({ total: 980 }),
        respond: (op) => orderRow(op) ?? earlier({}, ["doc-first"])(op),
      });
      const r = await service.ingest(photo());
      expect(r).toMatchObject({ documentId: "doc-new", duplicate: false });
      expect(inserts(ops)).toHaveLength(1);
    });

    it("keeps a paper with the same number but another date as its own", async () => {
      const { service } = build({
        parsed: usPaper({ docDate: "2026-10-02" }),
        respond: (op) => orderRow(op) ?? earlier({}, ["doc-first"])(op),
      });
      const r = await service.ingest(photo());
      expect(r).toMatchObject({ documentId: "doc-new", duplicate: false });
    });

    it("does not count a copy filed to another order, or another vendor's copy", async () => {
      const notLinked = build({
        parsed: usPaper(),
        respond: (op) => orderRow(op) ?? earlier({}, [])(op),
      });
      expect(await notLinked.service.ingest(photo())).toMatchObject({
        documentId: "doc-new",
        duplicate: false,
      });
      const otherVendor = build({
        parsed: usPaper(),
        respond: (op) =>
          orderRow(op) ?? earlier({ provider_id: "prov-B" }, ["doc-first"])(op),
      });
      expect(await otherVendor.service.ingest(photo())).toMatchObject({
        documentId: "doc-new",
        duplicate: false,
      });
    });
  });

  it("does not report `matched` when the vendor could not be written onto the document", async () => {
    const { service } = build({
      vendor: { state: "matched", providerId: "prov-A" },
      applyError: "duplicate key value violates unique constraint",
      respond: (op) => orderRow(op) ?? freshInsert(op),
    });
    const r = await service.ingest(photo({ orderId: null }));
    expect(r.vendor?.state).toBe("unavailable");
    expect(r.vendor?.providerId).toBeNull();
    expect(r.vendor?.reason).toMatch(/could not be filed under it/);
  });
});

describe("F-747 — the same bytes again", () => {
  it("files the paper on file to the order it was sent with, and answers with the first reading", async () => {
    const stored = {
      docType: "invoice",
      docNumber: "INV-1001",
      poNumber: "PO-0042",
      lines: [{ lineNo: 1, qty: 3, uom: "case" }],
      warnings: [],
    };
    const { service, ops } = build({
      respond: (op) =>
        orderRow(op) ??
        (op.table === "procurement_documents" && has(op, "sha256")
          ? {
              data: {
                id: "doc-first",
                provider_id: "prov-A",
                extracted: stored,
              },
              error: null,
            }
          : undefined),
    });
    const r = await service.ingest(photo());
    expect(r).toMatchObject({
      documentId: "doc-first",
      duplicate: true,
      parsed: stored,
      orderLink: { orderId: ORDER, linked: true, conflict: null },
    });
    expect(links(ops)).toHaveLength(1);
    expect(links(ops)[0].payload).toMatchObject({
      document_id: "doc-first",
      order_id: ORDER,
    });
  });

  it("links nothing when no order came with it", async () => {
    const { service, ops } = build({
      respond: (op) =>
        op.table === "procurement_documents" && has(op, "sha256")
          ? {
              data: { id: "doc-first", provider_id: null, extracted: null },
              error: null,
            }
          : undefined,
    });
    const r = await service.ingest(photo({ orderId: null }));
    expect(r).toMatchObject({
      documentId: "doc-first",
      duplicate: true,
      parsed: null,
    });
    expect(r.orderLink).toBeUndefined();
    expect(links(ops)).toHaveLength(0);
  });
});
