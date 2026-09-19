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

/**
 * The decision side of an upload (ADR 0128), stubbed to the simplest honest
 * answer: these bytes are not on record, no admitted edition exists to compare
 * against, and the jurisdiction holds nobody else. Under it every book is a
 * FIRST book and is therefore HELD - which the assertions in this file, all of
 * which are about what reaches the WRITE, are indifferent to. The tier
 * arithmetic itself is proved in `upload-tier.spec.ts` and the ceremony in
 * `price-index-review.spec.ts`.
 */
function reviewsWithNoHistory() {
  return {
    existingFor: jest
      .fn()
      .mockResolvedValue({ review: null, readFailed: false }),
    baselineFor: jest
      .fn()
      .mockResolvedValue({ baseline: null, readFailed: false }),
    record: jest.fn(async (input: any) => ({
      id: "review-1",
      sourceKey: input.sourceKey,
      state: input.state,
      fileName: input.fileName,
      fileSha256: input.fileSha256,
      editionDate: input.editionDate,
      rowsWritten: input.rowsWritten,
      uploadedBy: input.uploadedBy,
      uploadedByRestaurantId: input.uploadedByRestaurantId ?? null,
      uploadedAt: input.uploadedAt,
      tier: input.verdict.tier,
      tierReasons: input.verdict.reasons,
      tierNote: input.verdict.sentences.join(" "),
      status: input.verdict.tier === "routine" ? "stood" : "pending",
      confirmedBy: null,
      confirmedAt: null,
      confirmationEvidence: null,
      confirmationReason: null,
      refusedBy: null,
      refusedAt: null,
      refusalReason: null,
      escalatedAt: null,
    })),
    admittersFor: jest.fn().mockResolvedValue({
      people: [],
      readFailed: false,
      housesInJurisdiction: 1,
    }),
    admitRoutine: jest.fn().mockResolvedValue(0),
    announceStood: jest.fn().mockResolvedValue(undefined),
    announceHeld: jest.fn().mockResolvedValue(undefined),
  };
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(dbThatRecords() as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
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
    const svc = new PriceIndexUploadService(dbThatRecords() as never, reviewsWithNoHistory() as never);
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

/**
 * The decision an upload makes about itself (ADR 0128).
 *
 * The arithmetic is proved in `upload-tier.spec.ts` and the ceremony in
 * `price-index-review.spec.ts`; what is proved here is the SEAM — that a book
 * whose bands trip is written and held rather than written and shown, that a
 * routine one is stamped through the same statement a confirmation uses, and
 * that a failure to file the decision leaves the rows invisible rather than
 * leaving them on screens with nothing explaining them.
 */
describe("PriceIndexUploadService.ingest — how big a decision this book is", () => {
  const originalFlag = process.env[PRICE_INDEX_UPLOAD_FLAG];
  beforeEach(() => {
    process.env[PRICE_INDEX_UPLOAD_FLAG] = "1";
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env[PRICE_INDEX_UPLOAD_FLAG];
    else process.env[PRICE_INDEX_UPLOAD_FLAG] = originalFlag;
  });

  async function commit(
    svc: PriceIndexUploadService,
    over: Record<string, unknown> = {},
  ) {
    return svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
        fileBase64: await michiganWorkbookBase64(),
        commit: true,
        uploadedByUserId: "user-42",
        uploadedByRestaurantId: "house-1",
        ...over,
      },
      { today: FRESH },
    );
  }

  it("writes a FIRST book and holds it out of the market", async () => {
    const db = dbThatRecords();
    const reviews = reviewsWithNoHistory();
    const out = await commit(
      new PriceIndexUploadService(db as never, reviews as never),
    );
    expect(out.committed).toBe(true);
    expect(out.written).toBe(18);
    expect(out.review?.tier).toBe("second_pair_of_eyes");
    expect(out.review?.tierReasons).toEqual(["first_book"]);
    expect(out.review?.status).toBe("pending");
    expect(out.review?.inTheMarket).toBe(false);
    expect(out.silentBecause).toMatch(/written and HELD/);
    // Rows land with no admission stamp; nothing else may set one.
    const [rows] = db.upsert.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows.every((r) => !("admitted_at" in r))).toBe(true);
    expect(reviews.admitRoutine).not.toHaveBeenCalled();
    expect(reviews.announceHeld).toHaveBeenCalledTimes(1);
  });

  it("lets a ROUTINE book stand, and stamps it through the admission statement", async () => {
    const db = dbThatRecords();
    const reviews = reviewsWithNoHistory();
    // A baseline identical to the book about to be uploaded: nothing moved.
    const rows = fixture.rows;
    reviews.baselineFor = jest.fn(async () => {
      const { parseMichigan } = await import("./parse-michigan");
      const { fingerprintOf } = await import("./upload-tier");
      const run = parseMichigan(rows, "2025-05-04", "https://example.invalid");
      return {
        baseline: {
          fingerprint: fingerprintOf(run.sightings).fingerprint as Record<
            string,
            number
          >,
          editionDate: "2025-05-04",
        },
        readFailed: false,
      };
    }) as never;
    reviews.admitRoutine = jest.fn().mockResolvedValue(18);

    const out = await commit(
      new PriceIndexUploadService(db as never, reviews as never),
    );
    expect(out.review?.tier).toBe("routine");
    expect(out.review?.status).toBe("stood");
    expect(out.review?.inTheMarket).toBe(true);
    expect(out.silentBecause).toBeNull();
    expect(reviews.admitRoutine).toHaveBeenCalledTimes(1);
    expect(reviews.announceStood).toHaveBeenCalledTimes(1);
  });

  it("HOLDS a book whose baseline could not be read — unknown is not a first book", async () => {
    const reviews = reviewsWithNoHistory();
    reviews.baselineFor = jest
      .fn()
      .mockResolvedValue({ baseline: null, readFailed: true }) as never;
    const out = await commit(
      new PriceIndexUploadService(dbThatRecords() as never, reviews as never),
    );
    expect(out.review?.tier).toBe("second_pair_of_eyes");
    expect(out.review?.tierReasons).toEqual(["diff_untestable"]);
    expect(out.review?.tierNote).toMatch(/could not be read/);
  });

  it("refuses the SAME bytes twice, with what happened the first time", async () => {
    const db = dbThatMustNotBeWritten();
    const reviews = reviewsWithNoHistory();
    reviews.existingFor = jest.fn().mockResolvedValue({
      review: {
        status: "refused",
        refusedAt: "2026-09-05T10:00:00.000Z",
        refusalReason: "This is the 2024 book renamed.",
        state: "US-MI",
        uploadedAt: "2026-09-05T09:00:00.000Z",
      },
      readFailed: false,
    }) as never;
    const out = await commit(
      new PriceIndexUploadService(db as never, reviews as never),
    );
    expect(out.committed).toBe(false);
    expect(out.written).toBe(0);
    expect(out.silentBecause).toMatch(/were refused on 2026-09-05/);
    expect(out.silentBecause).toMatch(/does not become acceptable by being sent again/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("will not write when it cannot tell whether these bytes were already decided", async () => {
    const db = dbThatMustNotBeWritten();
    const reviews = reviewsWithNoHistory();
    reviews.existingFor = jest
      .fn()
      .mockResolvedValue({ review: null, readFailed: true }) as never;
    const out = await commit(
      new PriceIndexUploadService(db as never, reviews as never),
    );
    expect(out.committed).toBe(false);
    expect(out.silentBecause).toMatch(/This is unknown, not new/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("leaves the rows HELD, not shown, when the decision cannot be filed", async () => {
    const db = dbThatRecords();
    const reviews = reviewsWithNoHistory();
    reviews.record = jest
      .fn()
      .mockRejectedValue(new Error("reviews table is missing")) as never;
    const out = await commit(
      new PriceIndexUploadService(db as never, reviews as never),
    );
    expect(out.written).toBe(18);
    // NOT committed: a decision that was not filed did not happen.
    expect(out.committed).toBe(false);
    expect(out.review).toBeNull();
    expect(out.silentBecause).toMatch(/held out of the market and nothing is on any screen/);
    expect(reviews.admitRoutine).not.toHaveBeenCalled();
  });

  it("still records a decision when the upload names no house", async () => {
    const reviews = reviewsWithNoHistory();
    const out = await commit(
      new PriceIndexUploadService(dbThatRecords() as never, reviews as never),
      { uploadedByRestaurantId: undefined },
    );
    expect(out.committed).toBe(true);
    expect(out.review?.status).toBe("pending");
    expect(
      (reviews.record as unknown as jest.Mock).mock.calls[0][0]
        .uploadedByRestaurantId,
    ).toBeNull();
  });
});
