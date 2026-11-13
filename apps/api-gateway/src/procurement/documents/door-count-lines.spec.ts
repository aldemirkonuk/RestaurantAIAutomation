import { makeMockDb, MockDb } from "../canonical/delivery-mock";
import { DatabaseService } from "../../database/database.service";
import { DocumentIntakeService } from "./document-intake.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";
import { VendorResolutionService } from "../vendor-identity/vendor-resolution.service";
import { doorLineRefusal, knownPack } from "./door-count-lines";
import { paperForTheDoor } from "./door-count-paper";

/**
 * r28 invoices audit, G1 and G13: what a door count may put on the shelf.
 *
 * Two unread cases used to go on the shelf as 2 bottles instead of 24, and a
 * count of 1.5 bottles was rounded. Both now refuse the whole count before
 * anything is written. All ids and goods are SYNTHETIC.
 */

describe("knownPack: a pack says how many bottles, or it says nothing", () => {
  it.each([
    [12, 12],
    ["6", 6],
    [2, 2],
  ])("%p is a pack of %p", (raw, n) => expect(knownPack(raw)).toBe(n));

  // 1 is how the paper column writes "never stated" (NOT NULL DEFAULT 1).
  it.each([[1], [0], [-6], [1.5], [2.5], [null], [undefined], [""], ["twelve"]])(
    "%p is no pack",
    (raw) => expect(knownPack(raw)).toBeNull(),
  );
});

describe("doorLineRefusal", () => {
  const line = (over: Record<string, unknown>) =>
    ({ lineNo: 2, description: "SYNTHETIC Rakı 70cl", qty: 2, uom: "case", ...over }) as never;

  it.each([
    ["case", undefined],
    ["koli", undefined],
    ["case", 1],
    ["pack", null],
    ["split_case", 0],
  ])("refuses %s counted with pack %p, naming the line and what to do", (uom, packSize) => {
    const why = doorLineRefusal([line({ uom, packSize })]);
    expect(why).toContain('Line 2 ("SYNTHETIC Rakı 70cl")');
    expect(why).toMatch(/nothing says how many bottles one holds/);
    expect(why).toMatch(/Say how many bottles are in one, or count the line in bottles/);
    expect(why).toMatch(/Nothing was recorded\.$/);
  });

  it("says packs and split cases in their own words", () => {
    expect(doorLineRefusal([line({ uom: "pack" })])).toMatch(/counted in packs,/);
    expect(doorLineRefusal([line({ uom: "split_case" })])).toMatch(/counted in split cases,/);
    expect(doorLineRefusal([line({ uom: "case" })])).toMatch(/counted in cases,/);
  });

  it("takes a case with a stated pack, and a case counted at zero whatever its pack", () => {
    expect(doorLineRefusal([line({ packSize: 12 })])).toBeNull();
    expect(doorLineRefusal([line({ qty: 0 })])).toBeNull();
    expect(doorLineRefusal([line({ qty: 1.5, packSize: 12 })])).toBeNull();
  });

  it("refuses part of a bottle, of a piece, and a part case that is not whole bottles", () => {
    expect(doorLineRefusal([line({ uom: "bottle", qty: 1.5 })])).toMatch(
      /counts 1\.5 bottles, and the shelf keeps whole ones\. Count whole bottles or pieces\. Nothing was recorded\.$/,
    );
    expect(doorLineRefusal([line({ uom: "adet", qty: 2.25 })])).toMatch(/counts 2\.25 pieces,/);
    expect(doorLineRefusal([line({ qty: 1.5, packSize: 7 })])).toMatch(
      /counts 1\.5 cases of 7, which is 10\.5 bottles, and the shelf keeps whole ones/,
    );
  });

  it("leaves weights, volumes and kegs to their own rules", () => {
    for (const uom of ["kg", "g", "liter", "keg"])
      expect(doorLineRefusal([line({ uom, qty: 1.5 })])).toBeNull();
  });

  it("reads an unknown unit as bottles, as the count does", () => {
    expect(doorLineRefusal([line({ uom: "zzz", qty: 0.5 })])).toMatch(/counts 0\.5 bottles/);
    expect(doorLineRefusal([line({ uom: "zzz", qty: 3 })])).toBeNull();
  });

  it("finds the bad line among good ones, and names a line with no description by number", () => {
    const why = doorLineRefusal([
      line({ lineNo: 1, uom: "bottle", qty: 6 }),
      { lineNo: 3, qty: 1, uom: "case" } as never,
    ]);
    expect(why).toMatch(/^Line 3 is counted in cases/);
  });
});

describe("recordDoorCount refuses before anything is written", () => {
  let db: MockDb;
  let service: DocumentIntakeService;
  beforeEach(() => {
    db = makeMockDb();
    db.reset();
    db.insertAnswers.procurement_documents = { data: { id: "doc-count" }, error: null };
    db.insertAnswers.procurement_document_lines = { data: null, error: null };
    service = new DocumentIntakeService(
      db.client as unknown as DatabaseService,
      {} as unknown as DocumentExtractorService,
      {} as unknown as CanonicalDocumentService,
      {} as unknown as VendorResolutionService,
    );
  });

  it.each([
    ["two cases with no pack", { qty: 2, uom: "KOLİ" }, /counted in cases/],
    ["two cases with a pack of one", { qty: 2, uom: "case", packSize: 1 }, /counted in cases/],
    ["one and a half bottles", { qty: 1.5, uom: "bottle" }, /1\.5 bottles/],
  ])("%s", async (_label, over, words) => {
    const res = await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "user-1",
      lines: [{ lineNo: 1, ...over } as never],
    });
    expect(res.documentId).toBeNull();
    expect(res.error).toMatch(words);
    expect(db.writes).toEqual([]);
  });

  it("books two cases of twelve as 24 bottles", async () => {
    const res = await service.recordDoorCount({
      restaurantId: "rest-1",
      countedBy: "user-1",
      lines: [{ lineNo: 1, qty: 2, uom: "koli", packSize: 12 }],
    });
    expect(res.error ?? null).toBeNull();
    const lines = db.writes.find((w) => w.table === "procurement_document_lines")
      ?.payload as Record<string, unknown>[];
    expect(lines[0]).toMatchObject({ uom: "case", pack_size: 12, qty_bottles: 24 });
  });
});

describe("paperForTheDoor: a case the paper has no pack for", () => {
  const REST = "11111111-1111-1111-1111-111111111111";
  const PAPER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const RAKI = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const L1 = "10000000-0000-0000-0000-000000000001";
  let db: MockDb;
  const client = () => db.client.getClient() as never;
  const paperWith = (pack_size: unknown, uom = "case") => {
    db = makeMockDb();
    db.answers.procurement_documents = { data: { id: PAPER, doc_type: "invoice" }, error: null };
    db.answers.procurement_document_lines = {
      data: [
        { id: L1, line_no: 5, inventory_id: RAKI, uom, format_ml: 700, pack_size, vintage: null, description: "SYNTHETIC Rakı", vendor_sku: null },
      ],
      error: null,
    };
    db.answers.procurement_document_links = { data: [], error: null };
    db.answers.document_deliveries = { data: [], error: null };
  };
  const count = (over: Record<string, unknown> = {}) =>
    paperForTheDoor(client(), REST, PAPER, [{ lineNo: 1, qty: 2, uom: "case", sourceLineId: L1, ...over } as never], null);

  it.each([[1], [null]])("pack %p and none from the door: refused in words, 422", async (pack) => {
    paperWith(pack);
    const r = await count();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.error).toContain('Line 5 of the paper ("SYNTHETIC Rakı") is in cases');
    expect(r.error).toMatch(/Say how many bottles are in one, or set the pack on the paper's line first\. Nothing was recorded\.$/);
  });

  it("takes the door's pack when the paper has none", async () => {
    paperWith(1);
    const r = await count({ packSize: 12 });
    expect(r.ok && r.value.lines[0].packSize).toBe(12);
  });

  it("refuses a door pack of one as no pack", async () => {
    paperWith(1);
    expect((await count({ packSize: 1 })).ok).toBe(false);
  });

  it("never lets the door override a pack the paper states", async () => {
    paperWith(6);
    const r = await count({ packSize: 12 });
    expect(r.ok && r.value.lines[0].packSize).toBe(6);
  });

  it("a case counted at zero is not refused", async () => {
    paperWith(1);
    expect((await count({ qty: 0 })).ok).toBe(true);
  });

  it("a bottle line does not ask for a pack, and keeps the paper's", async () => {
    paperWith(1, "bottle");
    const r = await count({ uom: "bottle", packSize: 12 });
    expect(r.ok && r.value.lines[0].packSize).toBe(1);
  });

  it("a pack line says packs", async () => {
    paperWith(null, "pack");
    const r = await count();
    expect(!r.ok && r.error).toMatch(/is in packs,/);
  });
});
