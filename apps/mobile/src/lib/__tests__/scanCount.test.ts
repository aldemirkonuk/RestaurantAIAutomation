import { SIGHTING_GAP_MS, newScanRun, readScan, type ScanOutcome } from "../scanCount";

/** Feed reads [code, ms] through one run; return how many counted. */
function count(reads: Array<[string, number]>): { counted: number; outcomes: ScanOutcome[] } {
  let run = newScanRun();
  const outcomes: ScanOutcome[] = [];
  for (const [code, at] of reads) {
    const r = readScan(run, code, at);
    run = r.run;
    outcomes.push(r.outcome);
  }
  return { counted: outcomes.filter((o) => o === "counted").length, outcomes };
}

const WINE = "8001234567890";

it("one bottle held steady for three seconds counts once (F-405)", () => {
  // expo-camera reports the code every ~100 ms while it stays in frame.
  const reads: Array<[string, number]> = [];
  for (let t = 0; t <= 3000; t += 100) reads.push([WINE, t]);
  expect(count(reads).counted).toBe(1);
});

it("the next bottle of the same wine counts once the first has left the frame", () => {
  expect(
    count([
      [WINE, 0],
      [WINE, 100],
      [WINE, 100 + SIGHTING_GAP_MS + 1],
      [WINE, 200 + SIGHTING_GAP_MS],
    ]).counted,
  ).toBe(2);
});

it("a QR, a case label or any non-bottle code never counts", () => {
  const { counted, outcomes } = count([
    ["https://vendor.example/invoice/42", 0],
    ["(01)18001234567897(10)LOT7", 2000],
    ["ABC-123", 4000],
  ]);
  expect(counted).toBe(0);
  expect(outcomes).toEqual(["not-a-bottle", "not-a-bottle", "not-a-bottle"]);
});

it("a different wine after the first is not counted, even alternating in frame", () => {
  const other = "5012345678900";
  const { counted, outcomes } = count([
    [WINE, 0],
    [other, 50],
    [WINE, 100],
    [other, 150],
    [WINE, 200],
  ]);
  expect(counted).toBe(1);
  expect(outcomes[1]).toBe("other-wine");
});
