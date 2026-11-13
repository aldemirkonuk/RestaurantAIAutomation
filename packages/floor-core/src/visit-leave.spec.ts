import {
  SHORT_VISIT_CHECKINS_MAX,
  SHORT_VISIT_DWELL_MAX_MIN,
  dwellMinutesSince,
  honorCheckInCount,
  isQuickLeaveMeta,
  needsShortVisitConfirm,
} from "./visit-leave";
import { MIN, T0, at } from "./test-fixtures";

describe("kept from the checker (`lib/visit-leave.ts` at 5958689)", () => {
  it("keeps the thresholds: under 12 minutes and under 2 honor check-ins", () => {
    expect(SHORT_VISIT_DWELL_MAX_MIN).toBe(12);
    expect(SHORT_VISIT_CHECKINS_MAX).toBe(2);
  });

  it("keeps the short-visit confirm: under 12m and under 2 check-ins", () => {
    const now = T0 + 11 * MIN;
    expect(needsShortVisitConfirm({ seatedAt: at(0), lastCheckInAt: null, nowMs: now })).toBe(true);
    expect(
      needsShortVisitConfirm({ seatedAt: at(0), lastCheckInAt: at(5), checkInCount: 2, nowMs: now }),
    ).toBe(false);
    expect(needsShortVisitConfirm({ seatedAt: at(0), lastCheckInAt: null, nowMs: T0 + 12 * MIN })).toBe(
      false,
    );
  });

  it("rounds the dwell: 11.5 minutes is 12 and closes the confirm", () => {
    const seated = { seatedAt: at(0), lastCheckInAt: null };
    expect(dwellMinutesSince(at(0), T0 + 11.5 * MIN)).toBe(12);
    expect(needsShortVisitConfirm({ ...seated, nowMs: T0 + 11.5 * MIN })).toBe(false);
    expect(needsShortVisitConfirm({ ...seated, nowMs: T0 + 11.49 * MIN })).toBe(true);
  });

  it("a seat time ahead of the clock counts as 0 minutes and opens the confirm (the executor's reading under OD-242)", () => {
    expect(dwellMinutesSince(at(20), T0)).toBe(0);
    expect(needsShortVisitConfirm({ seatedAt: at(20), lastCheckInAt: null, nowMs: T0 })).toBe(true);
  });

  it("the timestamp proxy is 0 within 2 seconds of the seat time, else 1", () => {
    expect(honorCheckInCount(at(0), at(0))).toBe(0);
    expect(honorCheckInCount(at(0), at(3))).toBe(1);
    expect(honorCheckInCount(at(0), null)).toBe(0);
  });

  it("the proxy's window is 2 seconds: 1.999s reads 0, 2s reads 1", () => {
    const sec = (ms: number) => new Date(T0 + ms).toISOString();
    expect(honorCheckInCount(sec(0), sec(1_999))).toBe(0);
    expect(honorCheckInCount(sec(0), sec(2_000))).toBe(1);
    expect(honorCheckInCount(sec(2_000), sec(0))).toBe(1);
    expect(honorCheckInCount(sec(2_000), sec(1))).toBe(0);
    expect(honorCheckInCount(sec(0), "not a time")).toBe(0);
    expect(honorCheckInCount("not a time", sec(0))).toBe(0);
  });

  it("a seat time that cannot be read gives no dwell and no confirm", () => {
    expect(dwellMinutesSince("not a time", T0)).toBeNull();
    expect(dwellMinutesSince(null, T0)).toBeNull();
    expect(needsShortVisitConfirm({ seatedAt: "not a time", lastCheckInAt: null, nowMs: T0 })).toBe(false);
  });

  it("check-in count: 1 still confirms; negative reads 0; fractional floors; NaN falls back", () => {
    const o = { seatedAt: at(0), lastCheckInAt: at(5), nowMs: T0 + 6 * MIN };
    expect(needsShortVisitConfirm({ ...o, checkInCount: 1 })).toBe(true);
    expect(honorCheckInCount(at(0), at(5), -3)).toBe(0);
    expect(honorCheckInCount(at(0), at(5), 1.9)).toBe(1);
    expect(honorCheckInCount(at(0), at(5), 0)).toBe(0);
    expect(honorCheckInCount(at(0), at(5), NaN)).toBe(1);
  });

  it("isQuickLeaveMeta reads only visit_kind quick_leave", () => {
    expect(isQuickLeaveMeta({ visit_kind: "quick_leave" })).toBe(true);
    expect(isQuickLeaveMeta({ visit_kind: "stayed" })).toBe(false);
    expect(isQuickLeaveMeta({})).toBe(false);
    expect(isQuickLeaveMeta(null)).toBe(false);
  });
});

describe("changed from the checker", () => {
  it("a clock that is not a number gives no dwell and no confirm, never NaN", () => {
    for (const nowMs of [NaN, Infinity, -Infinity]) {
      expect(dwellMinutesSince(at(0), nowMs)).toBeNull();
      expect(needsShortVisitConfirm({ seatedAt: at(0), lastCheckInAt: null, nowMs })).toBe(false);
    }
  });
});
