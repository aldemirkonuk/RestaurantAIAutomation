import { ParsedDocument } from "../documents/parsed-document";
import { canonicalFromParsedDocument, doorAgainstPaper } from "./from-parsed-document";

/**
 * r24 walk (2026-11-13): a 5 L count of a 5 L invoice read "1 line differs from
 * the delivery" with the raw word "not_adjudicated", because the door's count
 * reached `received` and nothing judged it.
 */
const paper = (qtyBottles: number): ParsedDocument =>
  ({
    docType: "invoice",
    currency: "TRY",
    lines: [
      { lineNo: 1, description: "Zeytinyağı 5 L", qty: 5, uom: "liter", packSize: 1, qtyBottles, unitPrice: 120, lineTotal: 600 },
    ],
    warnings: [],
  }) as unknown as ParsedDocument;

const read = (counted: number, billed = 5, extra: Record<string, number> = {}) =>
  canonicalFromParsedDocument(paper(billed), {
    documentId: "d",
    restaurantId: "r",
    spine: { 0: { received: counted, ...extra } },
  }).layer3.lines[0];

describe("the door's count against the paper", () => {
  it("a count equal to the paper is ok", () => {
    expect(read(5).verdict).toBe("ok");
  });

  it("a count under the paper is short, over it is over", () => {
    expect(read(4).verdict).toBe("short_ship");
    expect(read(6).verdict).toBe("over_ship");
  });

  it("an uncounted line stays not adjudicated", () => {
    const line = canonicalFromParsedDocument(paper(5), { documentId: "d", restaurantId: "r" }).layer3.lines[0];
    expect(line.received).toBe("not_counted");
    expect(line.verdict).toBe("not_adjudicated");
  });

  it("with an order or a despatch line in the spine, the door alone does not judge", () => {
    expect(read(5, 5, { ordered: 6 }).verdict).toBe("not_adjudicated");
    expect(read(5, 5, { shipped: 5 }).verdict).toBe("not_adjudicated");
  });

  it("our own count document is not judged against itself", () => {
    const own = canonicalFromParsedDocument({ ...paper(5), docType: "receiving_advice" } as ParsedDocument, {
      documentId: "d",
      restaurantId: "r",
    }).layer3.lines[0];
    expect(own.billed).toBeNull();
    expect(own.verdict).toBe("not_adjudicated");
  });

  it("no billed number, no verdict", () => {
    expect(doorAgainstPaper(5, null, undefined)).toBe("not_adjudicated");
  });
});
