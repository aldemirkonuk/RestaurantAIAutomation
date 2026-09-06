import { describe, it, expect } from "vitest";
import { describeReportsGap } from "./reportsDataGap";

/**
 * POS lens defect 9. The measured state: 44 ingested `pos_checks`, 34 depleted
 * bottles, 55 consumption rows — and a banner reading "Sales revenue needs a
 * connected POS and is not shown here". The POS was connected and had been
 * sending all night. Naming the wrong cause sends someone to fix the wrong
 * thing, which is not a smaller error than naming no cause.
 */
describe("describeReportsGap", () => {
  const base = {
    totalSpend: 0,
    totalOrders: 0,
    posChecks: 0,
    posStatusUnavailable: false,
  };

  it("says nothing at all when the charts have data to draw", () => {
    expect(describeReportsGap({ ...base, totalSpend: 1200 })).toBeNull();
    expect(describeReportsGap({ ...base, totalOrders: 3 })).toBeNull();
  });

  it("blames the connection only when there is no connection", () => {
    const gap = describeReportsGap(base)!;
    expect(gap.kind).toBe("no_pos_connected");
    expect(gap.body).toMatch(/needs a connected POS/i);
  });

  it("does NOT blame the connection when the POS is sending checks", () => {
    // The exact lens state.
    const gap = describeReportsGap({ ...base, posChecks: 44 })!;
    expect(gap.kind).toBe("pos_sends_no_money");
    expect(gap.body).not.toMatch(/needs a connected POS/i);
    expect(gap.body).toMatch(/44 check/);
    expect(gap.body).toMatch(/carry no money/i);
    // The distinction an owner has to be able to act on.
    expect(gap.body).toMatch(/not in the connection/i);
  });

  it("says it could not tell rather than guessing, when the status read failed", () => {
    const gap = describeReportsGap({
      ...base,
      posChecks: null,
      posStatusUnavailable: true,
    })!;
    expect(gap.kind).toBe("pos_status_unknown");
    expect(gap.body).not.toMatch(/needs a connected POS/i);
    expect(gap.body).toMatch(/could not check/i);
    // Nowhere to usefully send someone on an unknown.
    expect(gap.action).toBeNull();
  });
});
