import { describe, it, expect } from "vitest";
import { formatVenueTime, hoursStateLabel } from "./venueTime";

/**
 * POS lens defect 12. The measured symptom: a check rung at 23:20 PDT in Palo
 * Alto rendered as "2:20 AM" — the reader's clock, the wrong hour, and the
 * wrong service day. The fix is not only "use the venue's zone"; it is also
 * "say which zone you used", because the failure mode of a fallback is a
 * confident wrong time nobody can spot.
 */
describe("formatVenueTime", () => {
  // 2026-09-05T06:20:00Z === Fri 4 Sep 23:20 in America/Los_Angeles.
  const late = "2026-09-05T06:20:00.000Z";

  it("renders in the venue's zone regardless of the viewer's", () => {
    const r = formatVenueTime(late, "America/Los_Angeles");
    expect(r.inVenueZone).toBe(true);
    expect(r.text).toContain("11:20");
    expect(r.text).toContain("PM");
    expect(r.text).toContain("PDT");
  });

  it("puts the same instant on a different clock for a different venue", () => {
    const ny = formatVenueTime(late, "America/New_York");
    expect(ny.text).toContain("2:20");
    expect(ny.text).toContain("AM");
    // Same instant, different local day — which is exactly why the venue's
    // zone is not cosmetic.
    expect(ny.text).toContain("Sep 5");
    expect(formatVenueTime(late, "America/Los_Angeles").text).toContain(
      "Sep 4",
    );
  });

  it("labels the fallback instead of silently using the viewer clock", () => {
    const r = formatVenueTime(late, null);
    expect(r.inVenueZone).toBe(false);
    expect(r.title).toMatch(/no timezone set/i);
    expect(r.title).toMatch(/YOUR clock/);
  });

  it("treats an invalid IANA string as a missing one rather than throwing", () => {
    const r = formatVenueTime(late, "Not/AZone");
    expect(r.inVenueZone).toBe(false);
    expect(r.text).not.toBe("—");
  });

  it("renders a missing or unparseable timestamp as a dash, not as now", () => {
    expect(formatVenueTime(null, "America/Los_Angeles").text).toBe("—");
    expect(formatVenueTime("not-a-date", "America/Los_Angeles").text).toBe("—");
  });
});

/**
 * POS lens defect 11. Three of these six states mean "we could not answer",
 * and rendering them as silence would be the absence-as-health fault again.
 */
describe("hoursStateLabel", () => {
  it("flags a check that rang after the published close", () => {
    expect(hoursStateLabel("outside_hours")).toMatchObject({ tone: "warn" });
  });

  it('distinguishes "could not tell" from "it was fine"', () => {
    for (const state of [
      "hours_unknown",
      "hours_invalid",
      "timezone_unknown",
    ]) {
      const l = hoursStateLabel(state);
      expect(l).not.toBeNull();
      expect(l!.tone).toBe("unknown");
    }
  });

  it("says nothing for a check rung during service", () => {
    expect(hoursStateLabel("open")).toBeNull();
  });

  it("says nothing for a check that predates the column", () => {
    expect(hoursStateLabel(null)).toBeNull();
  });
});
