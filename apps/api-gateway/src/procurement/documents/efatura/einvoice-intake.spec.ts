import { DocumentIntakeService, isDocumentLike } from "../document-intake.service";

/**
 * Proposal-receipt rows 2.3 and 3.3 at the intake: the e-invoice is routed to
 * its own reader, and the same ETTN is the same paper. All ids SYNTHETIC.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const EARLIER = "44444444-4444-4444-8444-444444444444";
const ETTN = "0f0e0d0c-0000-4000-8000-synthetic001";

const UBL = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="c" xmlns:cac="a">
  <cbc:ProfileID>TEMELFATURA</cbc:ProfileID><cbc:ID>SYN1</cbc:ID><cbc:UUID>${ETTN.toUpperCase()}</cbc:UUID>
  <cbc:IssueDate>2027-07-01</cbc:IssueDate><cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount>100</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>100</cbc:LineExtensionAmount><cac:Item><cbc:Name>SYN</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;

function intake(opts: {
  reads: Array<{ data: unknown; error: unknown }>;
  insert?: { data: unknown; error: unknown };
}) {
  const eqs: Array<[string, unknown]> = [];
  const chain: Record<string, jest.Mock> = {};
  for (const verb of ["from", "select", "insert", "neq", "limit", "order"])
    chain[verb] = jest.fn(() => chain);
  chain.eq = jest.fn((k: string, v: unknown) => {
    eqs.push([k, v]);
    return chain;
  });
  const queue = [...opts.reads];
  chain.maybeSingle = jest.fn(async () => queue.shift() ?? { data: null, error: null });
  chain.single = jest.fn(async () => opts.insert ?? { data: { id: "new-doc" }, error: null });
  const service = new DocumentIntakeService(
    { getClient: () => chain } as never,
    { available: () => false } as never,
    {} as never,
    {
      resolveVendor: jest.fn(async () => null),
      applyToDocument: jest.fn(),
      findSameNumberPaper: jest.fn(),
    } as never,
  );
  const s = service as unknown as Record<string, jest.Mock>;
  s.persistOriginalBytes = jest.fn(async () => ({ path: "p", failure: null }));
  s.houseCurrency = jest.fn(async () => ({ code: "TRY", failure: null }));
  s.matchedOrderCurrency = jest.fn(async () => ({
    code: null,
    matched: false,
    label: null,
    failure: null,
  }));
  s.insertDocumentLines = jest.fn(async () => null);
  s.linkAndMatch = jest.fn(async () => undefined);
  return { service, chain, eqs };
}

const INPUT = {
  restaurantId: HOUSE,
  source: "upload" as const,
  buffer: Buffer.from(UBL),
  filename: "SYN1.xml",
  mimeType: "application/xml",
};

describe("an e-invoice file at the intake", () => {
  it("is read by the UBL reader, never the model, and filed with its ETTN", async () => {
    const h = intake({ reads: [] });
    const out = await h.service.ingest(INPUT as never);
    expect(out.duplicate).toBeFalsy();
    expect(out.parsed?.ettn).toBe(ETTN);
    expect(out.parsed?.extractionModel).toBeNull();
    const inserted = h.chain.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.ettn).toBe(ETTN);
    expect(inserted.currency).toBe("TRY");
  });

  it("the same ETTN already on file answers with that paper, unfiled", async () => {
    const h = intake({
      reads: [
        { data: null, error: null }, // the bytes are new
        { data: { id: EARLIER, doc_number: "SYN1" }, error: null }, // the ETTN is not
      ],
    });
    const out = await h.service.ingest(INPUT as never);
    expect(out.duplicate).toBe(true);
    expect(out.documentId).toBe(EARLIER);
    expect(out.duplicateOf?.reason).toMatch(new RegExp(`ETTN ${ETTN}`));
    expect(h.eqs).toContainEqual(["ettn", ETTN]);
    expect(h.chain.insert).not.toHaveBeenCalled();
  });

  it("an ETTN read that fails stops the filing in words", async () => {
    const h = intake({
      reads: [
        { data: null, error: null },
        { data: null, error: { code: "08006", message: "SYNTHETIC down" } },
      ],
    });
    const out = await h.service.ingest(INPUT as never);
    expect(out.documentId).toBeNull();
    expect(String(out.error)).toMatch(/could not be read: SYNTHETIC down/);
    expect(h.chain.insert).not.toHaveBeenCalled();
  });

  it("an ETTN race lost at the insert is the winner's paper", async () => {
    const h = intake({
      reads: [
        { data: null, error: null },
        { data: null, error: null },
        { data: { id: EARLIER, doc_number: "SYN1" }, error: null },
      ],
      insert: {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "uq_pd_restaurant_ettn"',
        },
      },
    });
    const out = await h.service.ingest(INPUT as never);
    expect(out.duplicate).toBe(true);
    expect(out.documentId).toBe(EARLIER);
  });

  it("an XML that is not an e-invoice is stored unread with the reason", async () => {
    const h = intake({ reads: [] });
    const out = await h.service.ingest({
      ...INPUT,
      buffer: Buffer.from("<note>SYNTHETIC</note>"),
    } as never);
    expect(out.parsed?.warnings.join(" ")).toMatch(/not an e-invoice/);
  });
});

describe("isDocumentLike admits the e-invoice file", () => {
  it("any XML, and a zip whose name says invoice; not a zip of anything", () => {
    expect(isDocumentLike("application/xml", "SYN1.xml")).toBe(true);
    expect(isDocumentLike("application/zip", "efatura_SYN1.zip")).toBe(true);
    expect(isDocumentLike("application/zip", "e-arşiv.zip")).toBe(true);
    expect(isDocumentLike("application/zip", "archive.zip")).toBe(false);
    expect(isDocumentLike("application/zip", "photos.zip")).toBe(false);
  });
});
