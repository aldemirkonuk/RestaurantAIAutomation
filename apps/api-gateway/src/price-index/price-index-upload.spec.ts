/**
 * The human-fetch path: what it refuses, and what it will not write.
 *
 * The cases that matter are all refusals. An upload route that quietly accepts
 * an undated file, an old book, or a commit while disarmed would be worse than
 * no route at all — it would put a number on a Michigan house's screen with the
 * word "Michigan Liquor Control Commission" beside it and no way to tell how
 * old it is.
 *
 * The workbook is built here with `exceljs` — the same library the gateway
 * reads it with — from the REAL fixture rows, so the adapter and the parser are
 * exercised together rather than each against a mock of the other.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  PRICE_INDEX_UPLOAD_FLAG,
  PriceIndexUploadService,
  UPLOADABLE_SOURCES,
  priceIndexUploadArmed,
} from "./price-index-upload.service";
import { MICHIGAN_SOURCE_KEY } from "./parse-michigan";
import { MAX_UPLOAD_BYTES, base64Bytes, cellValue } from "./michigan-workbook";

const FIXTURE = join(
  __dirname,
  "__fixtures__",
  "michigan-lcc-price-book-2025-08-03.sample.json",
);
const fixture: { rows: Array<Array<string | number | null>> } = JSON.parse(
  readFileSync(FIXTURE, "utf8"),
);

/** A day 29 days after the 2025-08-03 edition: inside the 105-day bound. */
const FRESH = new Date("2025-09-01T00:00:00Z");
/** Today. The 2025-08-03 edition is ~398 days old here, far past the bound. */
const TODAY = new Date("2026-09-05T00:00:00Z");

async function michiganWorkbookBase64(
  rows: Array<Array<string | number | null>> = fixture.rows,
): Promise<string> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CL20065");
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString("base64");
}

/** A database that fails loudly if anything reaches it. */
function dbThatMustNotBeWritten() {
  const upsert = jest.fn(() => {
    throw new Error("the upload service wrote to the database in a dry run");
  });
  return {
    client: { from: jest.fn(() => ({ upsert })) },
    upsert,
  };
}

/** A database that records what it was asked to write. */
function dbThatRecords() {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  return { client: { from: jest.fn(() => ({ upsert })) }, upsert };
}

describe("the upload flag", () => {
  it("is an allow-list, so a typo leaves uploads off", () => {
    expect(priceIndexUploadArmed("true")).toBe(true);
    expect(priceIndexUploadArmed("1")).toBe(true);
    expect(priceIndexUploadArmed("TRUE ")).toBe(true);
    expect(priceIndexUploadArmed("yes")).toBe(false);
    expect(priceIndexUploadArmed("on")).toBe(false);
    expect(priceIndexUploadArmed(undefined)).toBe(false);
    expect(priceIndexUploadArmed(null)).toBe(false);
  });

  it("names Michigan as the only uploadable source today", () => {
    expect(Object.keys(UPLOADABLE_SOURCES)).toEqual([MICHIGAN_SOURCE_KEY]);
  });
});

describe("base64Bytes / cellValue", () => {
  it("sizes a payload without decoding it", () => {
    expect(base64Bytes(Buffer.from("hello").toString("base64"))).toBe(5);
    expect(base64Bytes(Buffer.alloc(1000).toString("base64"))).toBe(1000);
  });

  it("keeps numbers as numbers and empties as null", () => {
    expect(cellValue(14.41)).toBe(14.41);
    expect(cellValue("  ")).toBeNull();
    expect(cellValue(null)).toBeNull();
    expect(cellValue({ result: 7 })).toBe(7);
    expect(cellValue({ richText: [{ text: "AB" }, { text: "C" }] })).toBe("ABC");
  });
});

describe("PriceIndexUploadService.ingest", () => {
  const originalFlag = process.env[PRICE_INDEX_UPLOAD_FLAG];
  afterEach(() => {
    if (originalFlag === undefined) delete process.env[PRICE_INDEX_UPLOAD_FLAG];
    else process.env[PRICE_INDEX_UPLOAD_FLAG] = originalFlag;
  });

  it("refuses a source it does not accept a file for", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest({
      sourceKey: "iowa-liquor-products",
      fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
      fileBase64: "AAAA",
    });
    expect(out.accepted).toBe(false);
    expect(out.written).toBe(0);
    expect(out.silentBecause).toMatch(/not a source this register accepts a file for/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refuses a file whose name states no edition date, before reading a row", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "price book.xlsx",
        fileBase64: await michiganWorkbookBase64(),
      },
      { today: FRESH },
    );
    expect(out.accepted).toBe(false);
    expect(out.rowsRead).toBe(0); // refused before the workbook was opened
    expect(out.silentBecause).toMatch(/does not state an edition date/);
    expect(out.silentBecause).toMatch(/nothing is dated by the upload clock/i);
  });

  it("refuses a payload past the size ceiling without decoding it", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const huge = "A".repeat(Math.ceil(((MAX_UPLOAD_BYTES + 1024) * 4) / 3));
    const out = await svc.ingest({
      sourceKey: MICHIGAN_SOURCE_KEY,
      fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
      fileBase64: huge,
    });
    expect(out.accepted).toBe(false);
    expect(out.silentBecause).toMatch(/past the \d+-byte ceiling/);
  });

  it("refuses a file that is not an Excel workbook", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: Buffer.from("this is not a workbook").toString("base64"),
      },
      { today: FRESH },
    );
    expect(out.accepted).toBe(false);
    expect(out.silentBecause).toMatch(/could not be (opened|read)/);
    expect(out.fileSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses the real book in a dry run and writes NOTHING", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await michiganWorkbookBase64(),
      },
      { today: FRESH },
    );
    expect(out.accepted).toBe(true);
    expect(out.committed).toBe(false);
    expect(out.written).toBe(0);
    expect(out.issuedAt).toBe("2025-08-03");
    expect(out.ageDays).toBe(29);
    expect(out.admitted).toBe(18);
    expect(out.refusalsByReason).toEqual({ not_a_product_row: 6 });
    expect(out.silentBecause).toMatch(/dry run/);
    expect(out.sample[0].priceUnit).toBe("per bottle");
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("carries the file's own sha256 so the edition can be re-downloaded and compared", async () => {
    const b64 = await michiganWorkbookBase64();
    const svc = new PriceIndexUploadService(dbThatRecords() as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: b64,
      },
      { today: FRESH },
    );
    const { createHash } = await import("crypto");
    expect(out.fileSha256).toBe(
      createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex"),
    );
  });

  it("REFUSES today's upload of the 2025-08-03 edition as stale, and writes nothing", async () => {
    process.env[PRICE_INDEX_UPLOAD_FLAG] = "true";
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await michiganWorkbookBase64(),
        commit: true,
      },
      { today: TODAY },
    );
    expect(out.accepted).toBe(false);
    expect(out.committed).toBe(false);
    expect(out.written).toBe(0);
    expect(out.ageDays).toBe(398);
    expect(out.silentBecause).toMatch(/REFUSED \(stale\)/);
    expect(out.silentBecause).toMatch(/105-day cadence/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("refuses a commit while the flag is off, and says so", async () => {
    delete process.env[PRICE_INDEX_UPLOAD_FLAG];
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await michiganWorkbookBase64(),
        commit: true,
      },
      { today: FRESH },
    );
    expect(out.committed).toBe(false);
    expect(out.written).toBe(0);
    expect(out.silentBecause).toContain(PRICE_INDEX_UPLOAD_FLAG);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("writes only on an explicit commit with the flag armed, and stamps the row with the person", async () => {
    process.env[PRICE_INDEX_UPLOAD_FLAG] = "1";
    const db = dbThatRecords();
    const svc = new PriceIndexUploadService(db as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await michiganWorkbookBase64(),
        commit: true,
        uploadedByUserId: "user-42",
      },
      { today: FRESH },
    );
    expect(out.committed).toBe(true);
    expect(out.written).toBe(18);
    expect(db.upsert).toHaveBeenCalledTimes(1);

    const [rows, opts] = db.upsert.mock.calls[0] as [
      Array<Record<string, unknown>>,
      Record<string, unknown>,
    ];
    expect(rows).toHaveLength(18);
    expect(opts.onConflict).toBe("source_ref,content_hash");
    const first = rows[0];
    expect(first.state).toBe("US-MI");
    expect(first.source_class).toBe("posted_wholesale_list");
    expect(first.issued_at).toBe("2025-08-03");
    expect(first.price_unit).toBe("per bottle");
    const raw = first.raw as Record<string, Record<string, unknown>>;
    expect(raw.upload.uploadedByUserId).toBe("user-42");
    expect(raw.upload.fileName).toBe("8-3-25-PRICE-BOOK-EXCEL.xlsx");
    expect(raw.upload.editionDateFrom).toBe("file_name");
    expect(String(raw.upload.fileSha256)).toMatch(/^[0-9a-f]{64}$/);
    // The issuer's date and our clock are separate columns and never equal by
    // construction.
    expect(first.issued_at).not.toBe(first.fetched_at);
  });

  it("keeps the last outcome for the status line", async () => {
    const svc = new PriceIndexUploadService(dbThatRecords() as never);
    expect(svc.lastUploadFor(MICHIGAN_SOURCE_KEY)).toBeNull();
    await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await michiganWorkbookBase64(),
      },
      { today: FRESH },
    );
    expect(svc.lastUploadFor(MICHIGAN_SOURCE_KEY)?.issuedAt).toBe("2025-08-03");
  });
});
