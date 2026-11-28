import { PDFDocument, StandardFonts } from "pdf-lib";
import { DocumentIntakeService } from "../documents/document-intake.service";
import { canonicalFromParsedDocument } from "./from-parsed-document";
import { parsedFromDocumentRows } from "./from-document-rows";

/**
 * Geometry travels intake snapshot -> rows -> canonical envelope, and a box is
 * drawn only for a line that has one. EVERY value is SYNTHETIC.
 */
const row = (n: number, desc: string, total: number) => ({
  line_no: n,
  description: desc,
  qty: 1,
  uom: "bottle",
  unit_price: total,
  line_total: total,
});

const doc = (extracted: unknown) =>
  ({
    doc_type: "invoice",
    currency: "USD",
    subtotal: 30,
    total: 30,
    extracted,
  }) as any;

const rows = [row(1, "Alpha Wine", 10), row(2, "Beta Wine", 20)] as any[];

describe("line geometry on the canonical envelope", () => {
  const snap = {
    lines: [
      { lineNo: 1, geometry: { page: 2, bbox: [0.1, 0.2, 0.9, 0.25] } },
      { lineNo: 2 },
    ],
  };
  const build = (extracted: unknown) =>
    canonicalFromParsedDocument(
      parsedFromDocumentRows(doc(extracted), rows),
      { documentId: "d1", restaurantId: "r1" },
    );

  it("puts page and bbox on the row fields of a boxed line, and null on the other", () => {
    const [a, b] = build(snap).layer1.lines;
    for (const f of [a.description, a.quantity, a.netPrice, a.netAmount]) {
      expect(f.page).toBe(2);
      expect(f.bbox).toEqual([0.1, 0.2, 0.9, 0.25]);
    }
    expect(b.netAmount.page).toBeNull();
    expect(b.netAmount.bbox).toBeNull();
  });

  it("drops a malformed box rather than drawing it", () => {
    for (const bad of [
      [0.1, 0.2, 0.9],
      [0.9, 0.2, 0.1, 0.25],
      [0.1, 0.2, 1.4, 0.25],
      ["a", 0.2, 0.9, 0.25],
    ]) {
      const [a] = build({
        lines: [{ lineNo: 1, geometry: { page: 1, bbox: bad } }],
      }).layer1.lines;
      expect(a.netAmount.bbox).toBeNull();
    }
    const [z] = build({
      lines: [{ lineNo: 1, geometry: { page: 0, bbox: [0, 0, 1, 1] } }],
    }).layer1.lines;
    expect(z.netAmount.bbox).toBeNull();
  });

  it("keeps no geometry for a document whose snapshot has none", () => {
    const [a] = build({ lines: [{ lineNo: 1 }] }).layer1.lines;
    expect(a.netAmount.bbox).toBeNull();
  });
});

describe("DocumentIntakeService.withLineGeometry", () => {
  const svc = Object.create(DocumentIntakeService.prototype) as any;
  const parsed = (lines: unknown[]) => ({ lines }) as any;

  async function pdfBytes() {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf
      .addPage([595, 842])
      .drawText("Alpha Wine 1 bottle 10.00", { x: 60, y: 700, size: 11, font });
    return Buffer.from(await pdf.save());
  }

  it("adds geometry to the snapshot line of a PDF, and never touches its values", async () => {
    const p = parsed([
      { lineNo: 1, description: "Alpha Wine", lineTotal: 10 },
    ]);
    const out = await svc.withLineGeometry(
      { mimeType: "application/pdf", filename: "a.pdf" },
      await pdfBytes(),
      p,
    );
    expect(out.lines[0].geometry.page).toBe(1);
    expect(out.lines[0].lineTotal).toBe(10);
    expect(p.lines[0].geometry).toBeUndefined();
  });

  it("leaves a photo untouched", async () => {
    const p = parsed([
      { lineNo: 1, description: "Alpha Wine", lineTotal: 10 },
    ]);
    const out = await svc.withLineGeometry(
      { mimeType: "image/jpeg", filename: "a.jpg" },
      await pdfBytes(),
      p,
    );
    expect(out).toBe(p);
  });
});
