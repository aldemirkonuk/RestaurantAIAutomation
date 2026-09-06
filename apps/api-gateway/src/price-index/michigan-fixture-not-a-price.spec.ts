/**
 * Q21, answered by the founder 2026-09-05: *"Acceptable for shape only,
 * labelled; never for a price line."*
 *
 * The Michigan parser is written against real MLCC bytes obtained from an
 * Internet Archive capture, because the issuer's own host refuses this
 * fetcher. The founder accepted that for proving a PARSE and refused it for
 * producing a PRICE. This file is the second half of that decision, made
 * executable.
 *
 * WHAT ACTUALLY STOPS A FIXTURE-SOURCED ROW — measured, not assumed. There are
 * exactly two barriers and only one of them is load-bearing:
 *
 *   1. The fixture on disk is JSON, not a workbook, so the upload path cannot
 *      open it at all. This is real but WEAK: it stops the file as stored, and
 *      anyone (this repository's own tests included) can rebuild an .xlsx from
 *      those rows in four lines.
 *
 *   2. **The edition date, and this is the one that holds.** The fixture's file
 *      name states 2025-08-03, and the book's measured cadence gives it a
 *      105-day bound. It was already 398 days stale on the day it was recorded
 *      and it gets worse every day — 763 days a year later. There is no clock,
 *      past or future, at which the staleness gate admits it.
 *
 * There is no third barrier, and this file does not pretend there is one. The
 * fixture is not blocked because it is *the fixture*; it is blocked because it
 * is *old*, and it can only ever get older. That is a stronger guarantee than
 * an identity check would be — an identity check would compare a sha256 that
 * changes the moment anyone re-serialises the rows.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { PriceIndexUploadService } from "./price-index-upload.service";
import { MICHIGAN_SOURCE_KEY, readEditionDate } from "./parse-michigan";
import { SOURCES } from "./price-index.registry";
import { refuseStale } from "./staleness";

const FIXTURE_PATH = join(
  __dirname,
  "__fixtures__",
  "michigan-lcc-price-book-2025-08-03.sample.json",
);
const fixture: {
  fileName: string;
  rows: Array<Array<string | number | null>>;
} = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const TODAY = new Date("2026-09-05T00:00:00Z");

/** A database that fails loudly if a single row reaches it. */
function dbThatMustNotBeWritten() {
  const upsert = jest.fn(() => {
    throw new Error("a fixture-sourced row reached the register");
  });
  return { client: { from: jest.fn(() => ({ upsert })) }, upsert };
}

async function xlsxFromFixtureRows(): Promise<string> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CL20065");
  for (const r of fixture.rows) ws.addRow(r);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString("base64");
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

describe("the Michigan fixture proves a parse and can never become a price", () => {
  it("is labelled in the file itself as a shape fixture, not a price", () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      _note: string;
    };
    expect(raw._note).toMatch(/shape fixture/i);
    expect(raw._note).toMatch(/never a current price/i);
  });

  it("BARRIER 1: the fixture as stored is not a workbook, so it cannot be uploaded", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: fixture.fileName,
        fileBase64: readFileSync(FIXTURE_PATH).toString("base64"),
        commit: true,
        uploadedByUserId: "user-1",
      },
      { today: TODAY },
    );
    expect(out.written).toBe(0);
    expect(out.committed).toBe(false);
    expect(out.silentBecause).toMatch(/could not be (opened|read)/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("BARRIER 2: rebuilt as a real workbook it is still refused, as STALE", async () => {
    const db = dbThatMustNotBeWritten();
    const svc = new PriceIndexUploadService(db as never, reviewsWithNoHistory() as never);
    const out = await svc.ingest(
      {
        sourceKey: MICHIGAN_SOURCE_KEY,
        fileName: fixture.fileName,
        fileBase64: await xlsxFromFixtureRows(),
        commit: true,
        uploadedByUserId: "user-1",
      },
      { today: TODAY },
    );
    // It parses perfectly — that is the point of a shape fixture.
    expect(out.admitted).toBe(18);
    // And not one of those rows may be written.
    expect(out.accepted).toBe(false);
    expect(out.committed).toBe(false);
    expect(out.written).toBe(0);
    expect(out.ageDays).toBe(398);
    expect(out.silentBecause).toMatch(/REFUSED \(stale\)/);
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("BARRIER 2 holds at every clock, and only gets stronger", () => {
    const issued = readEditionDate(fixture.fileName, TODAY);
    expect(issued).toBe("2025-08-03");
    const bound = SOURCES[MICHIGAN_SOURCE_KEY].maxAgeDays;
    for (const day of [
      "2026-09-05",
      "2027-09-05",
      "2030-01-01",
      "2099-12-31",
    ]) {
      const verdict = refuseStale(issued, bound, new Date(`${day}T00:00:00Z`));
      expect(verdict.stale).toBe(true);
      expect(verdict.ageDays).toBeGreaterThan(bound);
    }
    // The nearest clock at which it would NOT be stale is before it existed:
    // 105 days after 2025-08-03 is 2025-11-16, and the gate is monotonic.
    expect(
      refuseStale(issued, bound, new Date("2025-11-16T00:00:00Z")).stale,
    ).toBe(false);
    expect(
      refuseStale(issued, bound, new Date("2025-11-17T00:00:00Z")).stale,
    ).toBe(true);
  });

  it("the register itself records that Michigan has no fetcher, so nothing pulls the book on a schedule", () => {
    const mi = SOURCES[MICHIGAN_SOURCE_KEY];
    expect(mi.parse).toBeUndefined();
    expect(mi.withheld).toBeDefined();
    expect(mi.intake).toBe("upload");
    // The fixture is named on the entry, and the entry says what it is for.
    expect(mi.fixture).toBe("michigan-lcc-price-book-2025-08-03.sample.json");
  });
});
