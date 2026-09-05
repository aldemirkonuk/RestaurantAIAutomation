/**
 * Q17, answered by the founder 2026-09-05: *"Promote them to columns on the
 * postings row."*
 *
 * The four facts that make a hand-carried book auditable — who carried it,
 * which file, which bytes, and what date the file name stated — used to live as
 * JSONB keys under `raw.upload`. A JSONB key cannot be indexed, cannot be
 * constrained, and cannot answer "which manager's upload put this number on the
 * screen" without a scan. They are columns now.
 *
 * The pre-fix proof is at the bottom: the same write, run against a verbatim
 * `git show HEAD:` copy of the writer, produces a row with none of the four.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { PRICE_INDEX_UPLOAD_FLAG, PriceIndexUploadService } from "./price-index-upload.service";
import { MICHIGAN_SOURCE_KEY } from "./parse-michigan";

const fixture: { rows: Array<Array<string | number | null>> } = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "michigan-lcc-price-book-2025-08-03.sample.json"),
    "utf8",
  ),
);
/** 29 days after the 2025-08-03 edition: inside the 105-day bound. */
const FRESH = new Date("2025-09-01T00:00:00Z");

function dbThatRecords() {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  return { client: { from: jest.fn(() => ({ upsert })) }, upsert };
}

async function bookBase64(): Promise<string> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CL20065");
  for (const r of fixture.rows) ws.addRow(r);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString("base64");
}

describe("the four provenance columns", () => {
  const original = process.env[PRICE_INDEX_UPLOAD_FLAG];
  beforeEach(() => {
    process.env[PRICE_INDEX_UPLOAD_FLAG] = "true";
  });
  afterEach(() => {
    if (original === undefined) delete process.env[PRICE_INDEX_UPLOAD_FLAG];
    else process.env[PRICE_INDEX_UPLOAD_FLAG] = original;
  });

  it("writes all four on every row, with explicit keys", async () => {
    const db = dbThatRecords();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await bookBase64(),
        commit: true,
        uploadedByUserId: "6d3f0f8e-0000-4000-8000-000000000001",
      },
      { today: FRESH },
    );
    expect(out.written).toBe(18);
    const rows = db.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(18);
    for (const row of rows) {
      expect(row.uploaded_by).toBe("6d3f0f8e-0000-4000-8000-000000000001");
      expect(row.upload_file_name).toBe("8-3-25-PRICE-BOOK-EXCEL.xlsx");
      expect(String(row.upload_sha256)).toMatch(/^[0-9a-f]{64}$/);
      expect(row.upload_edition_date).toBe("2025-08-03");
    }
  });

  it("the sha256 column is the sha256 of the bytes that were actually sent", async () => {
    const b64 = await bookBase64();
    const db = dbThatRecords();
    const svc = new PriceIndexUploadService(db as never);
    await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: b64,
        commit: true,
        uploadedByUserId: "u-1",
      },
      { today: FRESH },
    );
    const { createHash } = await import("crypto");
    const expected = createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
    const rows = db.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].upload_sha256).toBe(expected);
  });

  it("upload_edition_date agrees with issued_at, and both come from the file name", async () => {
    const db = dbThatRecords();
    const svc = new PriceIndexUploadService(db as never);
    await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await bookBase64(),
        commit: true,
        uploadedByUserId: "u-1",
      },
      { today: FRESH },
    );
    const row = (db.upsert.mock.calls[0][0] as Array<Record<string, unknown>>)[0];
    expect(row.upload_edition_date).toBe(row.issued_at);
    const raw = row.raw as Record<string, Record<string, unknown>>;
    expect(raw.upload.editionDateFrom).toBe("file_name");
  });

  it("keeps the JSONB copy, including the three facts NOT promoted", async () => {
    const db = dbThatRecords();
    const svc = new PriceIndexUploadService(db as never);
    await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await bookBase64(),
        commit: true,
        uploadedByUserId: "u-1",
      },
      { today: FRESH },
    );
    const row = (db.upsert.mock.calls[0][0] as Array<Record<string, unknown>>)[0];
    const upload = (row.raw as Record<string, Record<string, unknown>>).upload;
    expect(upload.fileBytes).toBeGreaterThan(0);
    expect(upload.sheetName).toBe("CL20065");
    expect(typeof upload.uploadedAt).toBe("string");
  });

  it("REFUSES an upload that names no person, rather than writing a half-provenanced row", async () => {
    const db = dbThatRecords();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await bookBase64(),
        commit: true,
        uploadedByUserId: null,
      },
      { today: FRESH },
    );
    expect(out.written).toBe(0);
    expect(out.silentBecause).toMatch(/names no person/);
    expect(out.committed).toBe(false);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("a fetched row is unaffected: the four columns belong to the upload writer alone", () => {
    // The scheduled fetch service writes its own row shape and never sets
    // these; the table's CHECK admits all-four-NULL for exactly that case.
    const fetchWriter = readFileSync(
      join(__dirname, "price-index-fetch.service.ts"),
      "utf8",
    );
    expect(fetchWriter).not.toMatch(/uploaded_by/);
    expect(fetchWriter).not.toMatch(/upload_sha256/);
  });
});

describe("the migration states the contract it enforces", () => {
  const sql = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20260905160000_an_uploaded_book_names_who_carried_it.sql",
    ),
    "utf8",
  );

  it("points the actor FK at public.users and never auth.users", () => {
    expect(sql).toMatch(/REFERENCES public\.users\(user_id\)/);
    expect(sql).not.toMatch(/REFERENCES auth\.users/);
  });

  it("makes the four all-or-nothing", () => {
    expect(sql).toMatch(/price_index_postings_upload_provenance_complete/);
    expect(sql).toMatch(/uploaded_by IS NULL[\s\S]*upload_edition_date IS NULL/);
    expect(sql).toMatch(/uploaded_by IS NOT NULL[\s\S]*upload_edition_date IS NOT NULL/);
  });

  it("proves its own CHECK refuses a partial row rather than trusting it exists", () => {
    expect(sql).toMatch(/admits_partial/);
    expect(sql).toMatch(/a half-provenanced row looks provenanced/);
  });

  it("adds no DEFAULT and leaves RLS alone", () => {
    expect(sql).not.toMatch(/ADD COLUMN[^;]*DEFAULT/i);
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY|CREATE POLICY|GRANT /);
  });
});
