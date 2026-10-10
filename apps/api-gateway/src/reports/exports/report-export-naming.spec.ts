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
