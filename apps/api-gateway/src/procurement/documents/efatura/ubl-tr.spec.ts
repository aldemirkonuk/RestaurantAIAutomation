import { readEinvoiceFile } from "./index";
import { readUblTr } from "./ubl-tr";
import { zipOf } from "./test-zip.fixture";

/**
 * Proposal-receipt rows 2.3 and 3.3 — the e-invoice file is read as written.
 * Every party, number and ETTN below is SYNTHETIC.
 */

const NS =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';

function invoice(
  opts: { typeCode?: string; withholding?: boolean; extraLine?: string; supplierCountry?: string } = {},
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice ${NS}>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>SYN2027000000001</cbc:ID>
  <cbc:UUID>0F0E0D0C-0000-4000-8000-SYNTHETIC001</cbc:UUID>
  <cbc:IssueDate>2027-07-01</cbc:IssueDate>
  <cbc:InvoiceTypeCode>${opts.typeCode ?? "SATIS"}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:OrderReference><cbc:ID>PO-SYN-7</cbc:ID></cac:OrderReference>
  <cac:DespatchDocumentReference><cbc:ID>IRS-SYN-3</cbc:ID></cac:DespatchDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Sentetik Gıda &amp; Ticaret A.Ş.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:CityName>Antalya</cbc:CityName>${opts.supplierCountry ?? "<cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>"}</cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Muratpaşa</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">9876543210</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Sentetik Lokanta</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">70.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">700.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">70.00</cbc:TaxAmount>
      <cbc:Percent>10</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  ${opts.withholding ? `<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">35.00</cbc:TaxAmount></cac:WithholdingTaxTotal>` : ""}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">700.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">700.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">770.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">${opts.withholding ? "735.00" : "770.00"}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">500.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>SYN Domates 1 kg</cbc:Name><cac:SellersItemIdentification><cbc:ID>SKU-1</cbc:ID></cac:SellersItemIdentification></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">50.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="BX">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">200.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>SYN Zeytinyağı koli</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">100.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  ${opts.extraLine ?? ""}
</Invoice>`;
}

describe("readUblTr — the e-invoice, field by field", () => {
  it("a VKN with no country on the address is a Turkish number", () => {
    const doc = readUblTr(invoice({ supplierCountry: "" }));
    expect(doc.vendorTaxId).toBe("1234567890");
    expect(doc.vendorCountry).toBe("TR");
  });

  it("an address that names another country wins over the scheme", () => {
    const doc = readUblTr(
      invoice({
        supplierCountry:
          "<cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>",
      }),
    );
    expect(doc.vendorCountry).toBe("DE");
  });

  it("reads number, ETTN, parties, lines and money, and ties out", () => {
    const doc = readUblTr(invoice());
    expect(doc.docType).toBe("invoice");
    expect(doc.docNumber).toBe("SYN2027000000001");
    expect(doc.ettn).toBe("0f0e0d0c-0000-4000-8000-synthetic001");
    expect(doc.einvoice).toEqual(
      expect.objectContaining({ kind: "e-fatura", profile: "TICARIFATURA", signatureChecked: false }),
    );
    expect(doc.poNumber).toBe("PO-SYN-7");
    expect(doc.despatchRefs).toEqual(["IRS-SYN-3"]);
    expect(doc.vendorName).toBe("Sentetik Gıda & Ticaret A.Ş.");
    expect(doc.vendorTaxId).toBe("1234567890");
    expect(doc.vendorCountry).toBe("TR");
    expect(doc.currency).toBe("TRY");
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]).toEqual(
      expect.objectContaining({ qty: 10, uom: "each", unitPrice: 50, lineTotal: 500, vendorSku: "SKU-1" }),
    );
    expect(doc.lines[1].uom).toBe("case");
    expect(doc.tax).toBe(70);
    expect(doc.total).toBe(770);
    expect(doc.tiesOut).toBe(true);
    // The only thing said is the box line's pack size (next test).
    expect(doc.warnings).toHaveLength(1);
  });

  it("a line counted in cases says the pack size is not stated, and the paper is not sure of its count", () => {
    const doc = readUblTr(invoice());
    // 2 boxes of an unstated size: the count stays 2, never a guessed 24.
    expect(doc.lines[1]).toEqual(
      expect.objectContaining({ qty: 2, uom: "case", packSize: 1, qtyBottles: 2 }),
    );
    expect(doc.warnings).toEqual([
      expect.stringMatching(/Line 2: the file counts in cases \(BX\) and does not say how many are in one.*before this paper is booked/),
    ]);
    // The money ties out, but a tie-out does not vouch for the count.
    expect(doc.tiesOut).toBe(true);
    expect(doc.confidence).toBeLessThanOrEqual(0.5);
  });

  it("a paper whose every line counts in plain items is as sure as its warnings allow", () => {
    const xml = invoice().replace('unitCode="BX"', 'unitCode="C62"');
    const doc = readUblTr(xml);
    expect(doc.warnings).toEqual([]);
    expect(doc.confidence).toBeCloseTo(0.98);
  });

  it("a line with no quantity says so, rather than reading as delivered empty", () => {
    const extra = `<cac:InvoiceLine><cbc:ID>3</cbc:ID><cbc:InvoicedQuantity unitCode="C62"></cbc:InvoicedQuantity><cbc:LineExtensionAmount>0</cbc:LineExtensionAmount><cac:Item><cbc:Name>SYN</cbc:Name></cac:Item></cac:InvoiceLine>`;
    const doc = readUblTr(invoice({ extraLine: extra }));
    expect(doc.lines[2].qty).toBe(0);
    expect(doc.warnings.join(" ")).toMatch(/Line 3: the file states no quantity/);
    expect(doc.confidence).toBeLessThanOrEqual(0.5);
  });

  it("repeated line numbers are renumbered by position, so no two lines share one", () => {
    const extra = `<cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount>0</cbc:LineExtensionAmount><cac:Item><cbc:Name>SYN</cbc:Name></cac:Item></cac:InvoiceLine>`;
    const doc = readUblTr(invoice({ extraLine: extra }));
    expect(doc.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
    expect(doc.warnings.join(" ")).toMatch(/numbered here by their position/);
  });

  it("says the tevkifat withheld, and still ties out on the tax-inclusive total", () => {
    const doc = readUblTr(invoice({ withholding: true }));
    expect(doc.total).toBe(770);
    expect(doc.tiesOut).toBe(true);
    expect(doc.warnings.join(" ")).toMatch(/35\.00 .*withheld \(tevkifat\)/);
  });

  it("files a return (IADE) as a credit memo, and says so", () => {
    const doc = readUblTr(invoice({ typeCode: "IADE" }));
    expect(doc.docType).toBe("credit_memo");
    expect(doc.warnings.join(" ")).toMatch(/return \(IADE\)/);
  });

  it("an unknown unit is left unconverted with a sentence, never guessed", () => {
    const extra = `<cac:InvoiceLine><cbc:ID>3</cbc:ID><cbc:InvoicedQuantity unitCode="KGM">4</cbc:InvoicedQuantity><cbc:LineExtensionAmount>0</cbc:LineExtensionAmount><cac:Item><cbc:Name>SYN</cbc:Name></cac:Item></cac:InvoiceLine>`;
    const doc = readUblTr(invoice({ extraLine: extra }));
    expect(doc.lines[2].uom).toBe("each");
    expect(doc.warnings.join(" ")).toMatch(/Line 3: the file counts in kilograms \(KGM\)/);
  });

  it("reads an e-despatch (e-İrsaliye) as a delivery note with no money", () => {
    const xml = `<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cbc="x" xmlns:cac="y">
      <cbc:ID>IRS-SYN-3</cbc:ID><cbc:UUID>AAAA-SYN</cbc:UUID><cbc:IssueDate>2027-07-01</cbc:IssueDate>
      <cac:DespatchLine><cbc:ID>1</cbc:ID><cbc:DeliveredQuantity unitCode="C62">10</cbc:DeliveredQuantity><cac:Item><cbc:Name>SYN Domates</cbc:Name></cac:Item></cac:DespatchLine>
    </DespatchAdvice>`;
    const doc = readUblTr(xml);
    expect(doc.docType).toBe("delivery_note");
    expect(doc.einvoice?.kind).toBe("e-irsaliye");
    expect(doc.currency).toBe("");
    expect(doc.total).toBeNull();
    expect(doc.lines[0].qty).toBe(10);
  });
});

describe("readEinvoiceFile — which files are e-invoices", () => {
  it("hands a PDF or a photo back to the other readers", () => {
    expect(readEinvoiceFile(Buffer.from("%PDF-1.7"), "a.pdf", "application/pdf").kind).toBe(
      "not_einvoice",
    );
  });

  it("reads a bare UBL-TR XML", () => {
    const out = readEinvoiceFile(Buffer.from(invoice()), "fatura.xml", "application/xml");
    expect(out.kind).toBe("read");
  });

  it("refuses an XML that is not an e-invoice, with a sentence", () => {
    const out = readEinvoiceFile(Buffer.from("<note>hi</note>"), "note.xml", "text/xml");
    expect(out).toEqual({ kind: "refused", reason: expect.stringMatching(/not an e-invoice/), notADocument: true });
  });

  it("reads the e-invoice inside a zip, and names the ones it did not read", () => {
    const z = zipOf([
      { name: "SYN1.xml", data: invoice() },
      { name: "SYN1.pdf", data: "%PDF" },
      { name: "SYN2.xml", data: invoice() },
    ]);
    const out = readEinvoiceFile(z, "efatura.zip", "application/zip");
    expect(out.kind).toBe("read");
    if (out.kind !== "read") return;
    expect(out.doc.ettn).toBe("0f0e0d0c-0000-4000-8000-synthetic001");
    expect(out.doc.warnings.join(" ")).toMatch(/held 2 e-invoices; only SYN1\.xml was read.*SYN2\.xml/);
  });

  it("a zip with no e-invoice in it is refused, naming what it held", () => {
    const z = zipOf([{ name: "photo.jpg", data: "x" }]);
    const out = readEinvoiceFile(z, "efatura.zip", "application/zip");
    expect(out).toEqual({
      kind: "refused",
      reason: expect.stringMatching(/holds no e-invoice XML.*photo\.jpg/),
      notADocument: true,
    });
  });

  it("a zip not named as one (an .xlsx, a .docx) is not an e-invoice", () => {
    const z = zipOf([{ name: "[Content_Types].xml", data: "<Types/>" }]);
    expect(readEinvoiceFile(z, "prices.xlsx", "application/vnd.openxmlformats").kind).toBe(
      "not_einvoice",
    );
  });
});
