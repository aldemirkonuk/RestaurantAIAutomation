/**
 * pdf-line-geometry — a box is a citation, never an estimate (ADR 0104).
 * EVERY value below is SYNTHETIC: a PDF drawn here with pdf-lib.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  lineGeometryForPdf,
  matchLineGeometry,
  rowsFromItems,
  type GeometryLine,
} from "./pdf-line-geometry";

// 1x1 transparent PNG: a page that holds a picture and no text layer.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function fixture(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (
    page: ReturnType<typeof pdf.addPage>,
    y: number,
    text: string,
  ) => page.drawText(text, { x: 60, y, size: 11, font });

  const p1 = pdf.addPage([595, 842]);
  draw(p1, 780, "SYNTHETIC INVOICE 0001");
  draw(p1, 700, "Margaux Reserve 12 bottles 1,440.00");
  draw(p1, 660, "Raki Yeni 3 cases 1.234,56");
  draw(p1, 620, "Chardonnay Estate 6 bottles 60.00");
  draw(p1, 580, "Subtotal 2,734.56");

  const p2 = pdf.addPage([595, 842]);
  draw(p2, 700, "Pinot Noir 2 bottles 85.50");
  draw(p2, 660, "Chardonnay Estate 6 bottles 60.00");
  draw(p2, 620, "Delivery note 85.50");

  const p3 = pdf.addPage([595, 842]);
  const img = await pdf.embedPng(Buffer.from(PNG_1X1, "base64"));
  p3.drawImage(img, { x: 50, y: 400, width: 300, height: 200 });
  return pdf.save();
}

const lines: GeometryLine[] = [
  { lineNo: 1, description: "Margaux Reserve", lineTotal: 1440 },
  { lineNo: 2, description: "Raki Yeni", lineTotal: 1234.56 },
  { lineNo: 3, description: "Chardonnay Estate", lineTotal: 60 },
  { lineNo: 4, description: "Pinot Noir", lineTotal: 85.5 },
  { lineNo: 5, description: "Unlisted Item", lineTotal: 99 },
  { lineNo: 6, description: "Margaux Reserve", lineTotal: 1441 },
];

describe("lineGeometryForPdf", () => {
  let got: Awaited<ReturnType<typeof lineGeometryForPdf>>;
  beforeAll(async () => {
    got = await lineGeometryForPdf(await fixture(), lines);
  });

  it("boxes a line whose amount and a description word sit in exactly one row, on page 1", () => {
    const g = got.get(1);
    expect(g?.page).toBe(1);
    const [x0, y0, x1, y1] = g!.bbox;
    // Row drawn at y=700 of 842 (from the bottom): about 0.16 from the top.
    expect(y0).toBeGreaterThan(0.15);
    expect(y1).toBeLessThan(0.19);
    expect(x0).toBeGreaterThan(0.05);
    expect(x1).toBeGreaterThan(x0);
    expect(x1).toBeLessThanOrEqual(1);
  });

  it("reads the paper's own number format: 1.234,56 matches 1234.56", () => {
    expect(got.get(2)?.page).toBe(1);
  });

  it("boxes a line on a later page with that page's number", () => {
    expect(got.get(4)?.page).toBe(2);
  });

  it("leaves a duplicated amount null, even across pages", () => {
    expect(got.get(3)).toBeNull();
  });

  it("leaves a line null when the amount is not on the paper or the words are not", () => {
    expect(got.get(5)).toBeNull();
    expect(got.get(6)).toBeNull();
  });

  it("keeps an image-only PDF null for every line", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawImage(await pdf.embedPng(Buffer.from(PNG_1X1, "base64")), {
      x: 50,
      y: 400,
      width: 300,
      height: 200,
    });
    const out = await lineGeometryForPdf(await pdf.save(), lines);
    expect([...out.values()].every((v) => v === null)).toBe(true);
    expect(out.size).toBe(lines.length);
  });

  it("is null, not a throw, for bytes that are not a PDF (a photo)", async () => {
    const out = await lineGeometryForPdf(
      Buffer.from(PNG_1X1, "base64"),
      lines,
    );
    expect([...out.values()].every((v) => v === null)).toBe(true);
  });
});

describe("matchLineGeometry", () => {
  const row = (text: string, page = 1) => ({
    page,
    text,
    bbox: [0.1, 0.2, 0.9, 0.25] as [number, number, number, number],
  });

  it("prefers the paper's printed glyphs when the line kept them", () => {
    const out = matchLineGeometry(
      [row("Margaux Reserve 1.440,00 EUR")],
      [
        {
          lineNo: 1,
          description: "Margaux Reserve",
          lineTotal: 1440,
          printed: { lineTotal: "1.440,00" },
        },
      ],
    );
    expect(out.get(1)?.page).toBe(1);
  });

  it("needs a description token of three or more characters", () => {
    const out = matchLineGeometry(
      [row("Ab 12.00")],
      [{ lineNo: 1, description: "Ab", lineTotal: 12 }],
    );
    expect(out.get(1)).toBeNull();
  });

  it("never matches a line with no read amount", () => {
    const out = matchLineGeometry(
      [row("Margaux Reserve 12.00")],
      [{ lineNo: 1, description: "Margaux Reserve", lineTotal: null }],
    );
    expect(out.get(1)).toBeNull();
  });
});

describe("rowsFromItems", () => {
  it("joins items on one baseline left to right and normalises to 0..1 from the top", () => {
    const rows = rowsFromItems(2, 200, 100, [
      { str: "12.00", x0: 120, y0: 10, x1: 160, y1: 20 },
      { str: "Item", x0: 20, y0: 10, x1: 60, y1: 20 },
      { str: "Other", x0: 20, y0: 50, x1: 60, y1: 60 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      page: 2,
      text: "Item 12.00",
      bbox: [0.1, 0.1, 0.8, 0.2],
    });
  });
});
