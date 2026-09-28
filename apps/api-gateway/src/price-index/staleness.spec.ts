import {
  priceIndexFetchArmed,
  refuseStale,
  stalenessDays,
  PRICE_INDEX_FETCH_FLAG,
} from "./staleness";

/**
 * The staleness gate is the point of the whole module: a live 200 that serves a
 * year-old file must be REFUSED, not parsed as current (the measured
 * bh_fv020.txt case, 2026-09-04).
 */
describe("refuseStale", () => {
  const today = new Date("2026-09-04T12:00:00Z");

  it("admits a fresh monthly posting", () => {
    const v = refuseStale("2026-09-01", 62, today);
    expect(v.stale).toBe(false);
    expect(v.ageDays).toBe(3);
  });

  it("REFUSES the 975-day USDA case", () => {
    const v = refuseStale("2024-01-03", 62, today);
    expect(v.stale).toBe(true);
    expect(v.ageDays).toBe(975);
    expect(v.reason).toContain("975 days old");
  });

  it("REFUSES a run with no readable issue date", () => {
    const v = refuseStale(null, 62, today);
    expect(v.stale).toBe(true);
    expect(v.ageDays).toBeNull();
    expect(v.reason).toContain("no issue date");
  });

  it("holds the boundary — exactly at the cadence passes, one past refuses", () => {
    expect(refuseStale("2026-07-04", 62, today).stale).toBe(false); // 62 days
    expect(refuseStale("2026-07-03", 62, today).stale).toBe(true); // 63 days
  });
});

describe("stalenessDays", () => {
  it("counts whole days and rejects an unparseable date", () => {
    expect(stalenessDays("2026-09-01", new Date("2026-09-04T00:00:00Z"))).toBe(3);
    expect(stalenessDays("not-a-date", new Date())).toBeNull();
  });
});

describe("priceIndexFetchArmed (allow-list, off by default)", () => {
  it("arms only on true/1", () => {
    expect(priceIndexFetchArmed("true")).toBe(true);
    expect(priceIndexFetchArmed("1")).toBe(true);
    expect(priceIndexFetchArmed(" TRUE ")).toBe(true);
    expect(priceIndexFetchArmed("false")).toBe(false);
    expect(priceIndexFetchArmed("")).toBe(false);
    expect(priceIndexFetchArmed(undefined)).toBe(false);
    expect(priceIndexFetchArmed("yes")).toBe(false); // a typo stays OFF
  });

  it("names the flag it reads", () => {
    expect(PRICE_INDEX_FETCH_FLAG).toBe("PRICE_INDEX_FETCH_ENABLED");
  });
});
