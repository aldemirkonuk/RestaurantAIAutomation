import { DocumentIntakeService } from "./document-intake.service";
import { DocumentsController } from "./documents.controller";

/**
 * Proposal-receipt §3, Phase 1A row 1.4 — QA round 3 on PR #775, items 1 and 2.
 * All ids and numbers are SYNTHETIC.
 *
 *   1. When the vendor stamp collides on the number index, the intake answer
 *      says `duplicate: true` and names the earlier paper. Never "vendor
 *      matched, duplicate false".
 *   2. When the INSERT itself collides (the caller named the vendor), the
 *      answer is the earlier paper's id with a duplicate verdict. Never a null
 *      id under a 200.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const VENDOR_ID = "22222222-2222-4222-8222-222222222222";
const THIS_DOC = "33333333-3333-4333-8333-333333333333";
const EARLIER = "44444444-4444-4444-8444-444444444444";

const PARSED = {
  docType: "invoice",
  docNumber: "SYN-0042",
  lines: [],
  warnings: [],
  tiesOut: true,
};

const MATCHED = {
  state: "matched",
  providerId: VENDOR_ID,
  source: "matched_tax_id",
  identity: null,
  reason: "SYNTHETIC: matched by tax id.",
};

const NUMBER_COLLISION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "uq_pd_restaurant_provider_type_number"',
};

/**
 * A client enough for the sha pre-check (maybeSingle, no match) and the
 * insert (single, answering `insertAnswer`).
 */
function client(insertAnswer: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  for (const verb of ["from", "select", "insert", "eq", "neq", "limit"])
    chain[verb] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
  chain.single = jest.fn(async () => insertAnswer);
  return chain;
}

function intake(opts: {
  insert: { data: unknown; error: unknown };
  stamp?: unknown;
  find?: unknown;
}) {
  const db = client(opts.insert);
  const vendorResolution = {
    resolveVendor: jest.fn(async () => MATCHED),
    applyToDocument: jest.fn(async () => opts.stamp ?? { kind: "stamped" }),
    findSameNumberPaper: jest.fn(async () => opts.find),
  };
  const service = new DocumentIntakeService(
    { getClient: () => db } as never,
    { available: () => false } as never,
    {} as never,
    vendorResolution as never,
  );
  // The reading and the tail are not what this file is about.
  const s = service as unknown as Record<string, jest.Mock>;
  s.persistOriginalBytes = jest.fn(async () => ({ path: "p", failure: null }));
  s.route = jest.fn(async () => PARSED);
  s.insertDocumentLines = jest.fn(async () => null);
  s.linkAndMatch = jest.fn(async () => undefined);
  return { service, vendorResolution };
}

const INPUT = {
  restaurantId: HOUSE,
  source: "upload" as const,
  buffer: Buffer.from("SYNTHETIC invoice bytes"),
  filename: "inv.pdf",
  mimeType: "application/pdf",
};

describe("intake answers a vendor-stamp collision as a duplicate (item 1)", () => {
  it("says duplicate: true and names the earlier paper", async () => {
    const { service } = intake({
      insert: { data: { id: THIS_DOC }, error: null },
      stamp: {
        kind: "duplicate",
        earlier: { documentId: EARLIER, docNumber: "SYN-0042" },
        reason: `SYNTHETIC reason naming ${EARLIER}`,
      },
    });
    const out = await service.ingest(INPUT);
    expect(out.documentId).toBe(THIS_DOC);
    expect(out.duplicate).toBe(true);
    expect(out.duplicateOf).toEqual({
      documentId: EARLIER,
      docNumber: "SYN-0042",
      reason: `SYNTHETIC reason naming ${EARLIER}`,
    });
    expect(out.vendorStampError).toBeUndefined();
  });

  it("carries a kept page verdict and a record that did not land", async () => {
    const { service } = intake({
      insert: { data: { id: THIS_DOC }, error: null },
      stamp: {
        kind: "duplicate",
        earlier: { documentId: EARLIER, docNumber: "SYN-0042" },
        reason: "r",
        keptVerdict: "blank_page",
        recordError: "SYNTHETIC: not written",
      },
    });
    const out = await service.ingest(INPUT);
    expect(out.duplicate).toBe(true);
    expect(out.duplicateOf?.keptVerdict).toBe("blank_page");
    expect(out.vendorStampError).toBe("SYNTHETIC: not written");
  });

  it("a stamp that failed is said, and is not a duplicate", async () => {
    const { service } = intake({
      insert: { data: { id: THIS_DOC }, error: null },
      stamp: { kind: "failed", error: "SYNTHETIC: refused" },
    });
    const out = await service.ingest(INPUT);
    expect(out.duplicate).toBe(false);
    expect(out.duplicateOf).toBeUndefined();
    expect(out.vendorStampError).toBe("SYNTHETIC: refused");
  });

  it("a clean stamp adds nothing", async () => {
    const { service } = intake({
      insert: { data: { id: THIS_DOC }, error: null },
    });
    const out = await service.ingest(INPUT);
    expect(out).toMatchObject({ documentId: THIS_DOC, duplicate: false });
    expect(out).not.toHaveProperty("duplicateOf");
    expect(out).not.toHaveProperty("vendorStampError");
  });
});

describe("an insert that collides on the number index (item 2)", () => {
  it("answers with the earlier paper's id and a duplicate verdict", async () => {
    const { service, vendorResolution } = intake({
      insert: { data: null, error: NUMBER_COLLISION },
      find: {
        ok: true,
        paper: { documentId: EARLIER, docNumber: "SYN-0042" },
      },
    });
    const out = await service.ingest({ ...INPUT, providerId: VENDOR_ID });
    expect(out.error).toBeUndefined();
    expect(out.documentId).toBe(EARLIER);
    expect(out.duplicate).toBe(true);
    expect(out.duplicateOf?.documentId).toBe(EARLIER);
    expect(out.duplicateOf?.reason).toContain("SYN-0042");
    expect(out.duplicateOf?.reason).toContain(EARLIER);
    expect(vendorResolution.findSameNumberPaper).toHaveBeenCalledWith(
      HOUSE,
      VENDOR_ID,
      "invoice",
      "SYN-0042",
      null,
    );
    // No second row exists, so nothing is resolved or stamped onto one.
    expect(vendorResolution.resolveVendor).not.toHaveBeenCalled();
    expect(vendorResolution.applyToDocument).not.toHaveBeenCalled();
  });

  it("a look-up that fails is an error, never a null id", async () => {
    const { service } = intake({
      insert: { data: null, error: NUMBER_COLLISION },
      find: { ok: false, error: "SYNTHETIC boom" },
    });
    const out = await service.ingest({ ...INPUT, providerId: VENDOR_ID });
    expect(out.documentId).toBeNull();
    expect(out.error).toMatch(
      /paper no\. SYN-0042 is already on file.*could not be read: SYNTHETIC boom/,
    );
  });

  it("an earlier paper missing on the second read is an error too", async () => {
    const { service } = intake({
      insert: { data: null, error: NUMBER_COLLISION },
      find: { ok: true, paper: null },
    });
    const out = await service.ingest({ ...INPUT, providerId: VENDOR_ID });
    expect(out.documentId).toBeNull();
    expect(out.error).toMatch(/no earlier paper holds it/);
  });
});

describe("POST /procurement/documents carries the duplicate answer", () => {
  it("puts duplicateOf and vendorStampError on the reply", async () => {
    const DUP = {
      documentId: EARLIER,
      docNumber: "SYN-0042",
      reason: "SYNTHETIC reason",
    };
    const ingest = jest.fn(async () => ({
      documentId: THIS_DOC,
      duplicate: true,
      parsed: null,
      vendor: MATCHED,
      duplicateOf: DUP,
      vendorStampError: "SYNTHETIC: not written",
    }));
    const unused = {} as never;
    const controller = new DocumentsController(
      { ingest } as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
    const res = (await controller.upload(
      {
        contentBase64: Buffer.from("SYNTHETIC bytes").toString("base64"),
        filename: "inv.pdf",
      } as never,
      { userId: "u", restaurantId: HOUSE, role: "owner" } as never,
    )) as Record<string, unknown>;
    expect(res.duplicate).toBe(true);
    expect(res.duplicateOf).toEqual(DUP);
    expect(res.vendorStampError).toBe("SYNTHETIC: not written");
  });
});
