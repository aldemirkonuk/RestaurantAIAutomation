import {
  exportFileStem,
  houseSlug,
  writtenLabel,
} from "./report-export-naming";

/** F-413 — the file name and the "Written" line are on the house's clock. */
describe("export naming (F-413)", () => {
  const base = {
    cutting: "till",
    windowDays: 7,
    houseName: "Tuzlu Rüzgar",
    zone: "America/Los_Angeles",
  };

  it("names the till by house and its window in house days, not the UTC date", () => {
    // 01:30 UTC on the 10th is 18:30 on the 9th in Los Angeles.
    expect(
      exportFileStem({ ...base, finishedAt: "2026-10-10T01:30:00.000Z" }),
    ).toBe("mudavym-tuzlu-ruzgar-till-2026-10-03-to-2026-10-09");
  });

  it("a fixed-window cutting is named for the house day it was written", () => {
    expect(
      exportFileStem({
        ...base,
        cutting: "ledger",
        windowDays: null,
        finishedAt: "2026-10-10T01:30:00.000Z",
      }),
    ).toBe("mudavym-tuzlu-ruzgar-ledger-as-of-2026-10-09");
  });

  it("a house with no zone is named on the UTC day, marked as UTC", () => {
    expect(
      exportFileStem({
        ...base,
        zone: null,
        finishedAt: "2026-10-10T01:30:00.000Z",
      }),
    ).toBe("mudavym-tuzlu-ruzgar-till-7-days-as-of-2026-10-10-utc");
  });

  describe("a month of the till (F-1013)", () => {
    const month = { ...base, windowDays: null, windowMonth: "2026-09" };

    it("is named for the month once it has ended on the house's clock, not the UTC day", () => {
      // 01:30 UTC on 1 October is still 30 September in Los Angeles: the
      // month is running there, so the name says how far it was read.
      expect(
        exportFileStem({ ...month, finishedAt: "2026-10-01T01:30:00.000Z" }),
      ).toBe("mudavym-tuzlu-ruzgar-till-2026-09-01-to-2026-09-30");
      expect(
        exportFileStem({ ...month, finishedAt: "2026-10-02T18:00:00.000Z" }),
      ).toBe("mudavym-tuzlu-ruzgar-till-2026-09");
    });

    it("a month still running is named for the days read so far", () => {
      expect(
        exportFileStem({ ...month, finishedAt: "2026-09-15T18:00:00.000Z" }),
      ).toBe("mudavym-tuzlu-ruzgar-till-2026-09-01-to-2026-09-15");
    });

    it("a house with no zone names the month and the UTC day, marked as UTC", () => {
      expect(
        exportFileStem({
          ...month,
          zone: null,
          finishedAt: "2026-10-02T18:00:00.000Z",
        }),
      ).toBe("mudavym-tuzlu-ruzgar-till-2026-09-as-of-2026-10-02-utc");
    });
  });

  it("names nothing until the file is written", () => {
    expect(exportFileStem({ ...base, finishedAt: null })).toBeNull();
  });

  it("folds a house name to plain file-name letters", () => {
    expect(houseSlug("Çırağan Şişli İskele")).toBe("ciragan-sisli-iskele");
    expect(houseSlug(null)).toBe("house");
    expect(houseSlug("***")).toBe("house");
  });

  it("writes Written on the house's wall clock with the zone named", () => {
    expect(
      writtenLabel("2026-10-10T01:30:00.000Z", "America/Los_Angeles"),
    ).toBe("2026-10-09 18:30, house time (America/Los_Angeles)");
    expect(writtenLabel("2026-10-10T01:30:00.000Z", null)).toBe(
      "2026-10-10 01:30 UTC; this house has no time zone set, so this is not its own clock",
    );
  });
});
