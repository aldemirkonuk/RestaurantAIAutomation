/**
 * @wineops/floor-core — the checker's time logic, across modules.
 *
 * Every spec here imports the real code. The checker's own scripts copied the
 * logic into the test file (`scripts/test-attribution.mjs:8`), so they could
 * pass while the app drifted; that is not repeated.
 *
 * Each module's own cases live in `<module>.spec.ts` (the short-visit rules in
 * `visit-leave.spec.ts`); the cases here span modules (response time with the
 * score, freshness and the Food-up brief). Shared fixtures live in
 * `test-fixtures.ts`.
 *
 * - Kept: checker behaviour the corrections must not disturb.
 * - Corrections: ADR 0346 D4 (b) and founder F1 (2026-10-31) here; D4 (c)
 *   and (e) are pinned in `response-time.spec.ts`. Each fails against the
 *   checker's original formula.
 * - Review fixes (2026-10-31): the seat time as an anchor, ties at one
 *   millisecond, and inputs that used to fail open (an unreadable time, a
 *   window end or warn minute that is not a finite number).
 */
import {
  buildMealBrief,
  durationText,
  freshnessOf,
  minutesSince,
  overdueGapCount,
  responseSamples,
  seatingFreshness,
  visitScore,
  waiterPerformanceScore,
} from "./index";
import { MIN, T0, at, WARN, LATE, ev, facts } from "./test-fixtures";

// ---------------------------------------------------------------------------
// Kept: checker behaviour the corrections must not disturb
// ---------------------------------------------------------------------------

describe("kept from the checker", () => {
  it("keeps the score curve: full marks to T, halving every T after", () => {
    expect(visitScore(WARN, WARN)).toBe(100);
    expect(visitScore(2 * WARN, WARN)).toBeCloseTo(50, 10);
    expect(waiterPerformanceScore([5, 2 * WARN], WARN)).toBe(75);
  });

  it("keeps the late boundary at the late minute", () => {
    expect(freshnessOf(LATE, WARN, LATE)).toBe("late");
    expect(freshnessOf(LATE - 1, WARN, LATE)).toBe("warn");
    expect(freshnessOf(null, WARN, LATE)).toBe("idle");
    expect(overdueGapCount([LATE, LATE - 1, 20], LATE)).toBe(2);
  });

  it("does not count an open gap of T or less", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ leftAt: at(5 + WARN) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------
// Corrections — each fails against the checker's original formula
// ---------------------------------------------------------------------------

describe("ADR 0346 D4 (b) / founder F1: silence counts as one long gap", () => {
  it("a party seated, never visited and gone after 90m scores 0, not 100", () => {
    const { byWaiter } = responseSamples([ev("seated", "W", 0)], {
      seatings: [facts({ leftAt: at(90) })],
      warnAfterMin: WARN,
      now: T0 + 120 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([90]);
    expect(waiterPerformanceScore(byWaiter.get("W") ?? [], WARN)).toBe(0);
  });

  it("a gap over 120 minutes is kept", () => {
    const { byWaiter } = responseSamples([ev("seated", "W", 0), ev("check_in", "W", 130)], {
      seatings: [facts({ leftAt: at(131) })],
      warnAfterMin: WARN,
      now: T0 + 200 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([130]);
  });

  it("a party still seated counts its silence up to now (executor's reading)", () => {
    const { byWaiter } = responseSamples([ev("seated", "W", 0)], {
      seatings: [facts()],
      warnAfterMin: WARN,
      now: T0 + 30 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([30]);
  });
});

// ---------------------------------------------------------------------------
// Review fixes (2026-10-31)
// ---------------------------------------------------------------------------

describe("the seat time is an anchor (the floor stores it only as seated_at)", () => {
  it("a party seated, never visited and gone after 90m scores 0 with no events at all", () => {
    const { byWaiter, byTable, seatingsWithoutFacts } = responseSamples([], {
      seatings: [facts({ leftAt: at(90) })],
      warnAfterMin: WARN,
      now: T0 + 120 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([90]);
    expect(byTable.get("t1")).toEqual([90]);
    expect(waiterPerformanceScore(byWaiter.get("W") ?? [], WARN)).toBe(0);
    expect(seatingsWithoutFacts).toEqual([]);
  });

  it("a manager seats (seated_by), the waiter visits: the greeting gap is the caretaker's", () => {
    const events = [ev("check_in", "W", 20), ev("check_in", "W", 26)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ seatedBy: "M", caretakerAtSeatId: "W", leftAt: at(30) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([20, 6]);
    expect(byWaiter.has("M")).toBe(false);
  });

  it("an anchor and a visit at the same millisecond give the same samples in either order", () => {
    const opts = { seatings: [facts({ leftAt: at(12) })], warnAfterMin: WARN, now: T0 + 60 * MIN };
    const seatedFirst = [ev("seated", "W", 0), ev("check_in", "W", 0), ev("check_in", "W", 5)];
    const visitFirst = [ev("check_in", "W", 0), ev("seated", "W", 0), ev("check_in", "W", 5)];
    expect(responseSamples(seatedFirst, opts).byWaiter.get("W")).toEqual([0, 5]);
    expect(responseSamples(visitFirst, opts).byWaiter.get("W")).toEqual([0, 5]);
  });

  it("the made seated anchor sorts before a visit at the seat millisecond", () => {
    const { byWaiter } = responseSamples([ev("check_in", "W", 0), ev("check_in", "W", 5)], {
      seatings: [facts({ leftAt: at(12) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([0, 5]);
  });

  it("two waiters' visits at one millisecond credit the same gaps in either order", () => {
    // Sorted A before B: the greeting gap is the caretaker's, A -> B is A's.
    const opts = { seatings: [facts({ leftAt: at(8) })], warnAfterMin: WARN, now: T0 + 60 * MIN };
    const ab = [ev("check_in", "A", 5), ev("check_in", "B", 5)];
    const want = [["W", [5]], ["A", [0]]];
    expect([...responseSamples(ab, opts).byWaiter]).toEqual(want);
    expect([...responseSamples([...ab].reverse(), opts).byWaiter]).toEqual(want);
    // With a caretaker, a visit with no actor credits the same gaps in either
    // order: the greeting gap is W's and the 0-minute gap is A's whichever of
    // the two comes first. So this does not show where a null actor sorts;
    // the next test, with no caretaker, does.
    const anon = [ev("check_in", null, 5), ev("check_in", "A", 5)];
    const anonWant = [["W", [5]], ["A", [0]]];
    expect([...responseSamples(anon, opts).byWaiter]).toEqual(anonWant);
    expect([...responseSamples([...anon].reverse(), opts).byWaiter]).toEqual(anonWant);
  });

  it("with no caretaker, a visit with no actor sorts first at its millisecond in all six input orders", () => {
    // No caretaker, so every gap goes by the handoff rule and the order of
    // the three visits decides who is credited. Sorted null, A, B: the
    // greeting gap is filed for the table and credited to no waiter, and
    // null -> A and A -> B are A's. Every other order of the three credits a
    // gap to B, so it fails here.
    const opts = {
      seatings: [facts({ seatedBy: null, caretakerAtSeatId: null, leftAt: at(8) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    };
    const visits = [ev("check_in", "B", 5), ev("check_in", null, 5), ev("check_in", "A", 5)];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) {
      const { byWaiter, byTable } = responseSamples(
        order.map((i) => visits[i]),
        opts,
      );
      expect([...byWaiter]).toEqual([["A", [0, 0]]]);
      expect([...byTable]).toEqual([["t1", [5, 0, 0]]]);
    }
  });

  it("one waiter's visits to two tables at one millisecond file the same gaps in either order", () => {
    const opts = { seatings: [facts({ leftAt: at(8) })], warnAfterMin: WARN, now: T0 + 60 * MIN };
    const pair = [ev("check_in", "W", 5, { tableId: "t1" }), ev("check_in", "W", 5, { tableId: "t2" })];
    const want = [["t1", [5]], ["t2", [0]]];
    expect([...responseSamples(pair, opts).byTable]).toEqual(want);
    expect([...responseSamples([...pair].reverse(), opts).byTable]).toEqual(want);
  });

  it("an unreadable seated row does not hide the seat time", () => {
    const events = [ev("seated", "W", 0, { createdAt: "not a time" }), ev("check_in", "W", 20)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ leftAt: at(25) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([20]);
  });

  it("a visit whose time cannot be read is left out, and the gaps around it still count", () => {
    const events = [ev("seated", "A", 0), ev("check_in", "A", 0, { createdAt: "not a time" }), ev("check_in", "A", 10)];
    const { byWaiter } = responseSamples(events, { seatings: [], warnAfterMin: WARN, now: T0 + 60 * MIN });
    expect(byWaiter.get("A")).toEqual([10]);
  });

  it("lists a seating whose seat time is unreadable instead of reading it as on time", () => {
    const { byWaiter, seatingsWithoutAnchor } = responseSamples([], {
      seatings: [facts({ seatedAt: "not a time", leftAt: at(90) })],
      warnAfterMin: WARN,
      now: T0 + 120 * MIN,
    });
    expect(byWaiter.size).toBe(0);
    expect(seatingsWithoutAnchor).toEqual(["s1"]);
  });
});

describe("an unparseable time is no time, and is never read as on time or Empty", () => {
  it("minutesSince gives null, not NaN, and durationText prints a dash", () => {
    expect(minutesSince("not a time", T0)).toBeNull();
    expect(durationText(NaN)).toBe("—");
    expect(durationText(Infinity)).toBe("—");
  });

  it("freshnessOf reads null as no open seating; seatingFreshness reads an unknown gap as late", () => {
    expect(freshnessOf(null, WARN, LATE)).toBe("idle");
    expect(seatingFreshness({ seatedAt: null, lastVisitAt: null }, WARN, LATE, T0)).toBe("idle");
    expect(seatingFreshness({ seatedAt: "not a time", lastVisitAt: null }, WARN, LATE, T0)).toBe("late");
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: null }, WARN, LATE, T0 + 4 * MIN)).toBe("fresh");
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: null }, WARN, LATE, T0 + 20 * MIN)).toBe("late");
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: at(18) }, WARN, LATE, T0 + 20 * MIN)).toBe("fresh");
    expect(seatingFreshness({ seatedAt: at(0), lastVisitAt: "not a time" }, WARN, LATE, T0 + 20 * MIN)).toBe("late");
  });

  it("a Food-up brief with an unreadable seat time is overdue, not Empty", () => {
    const b = buildMealBrief({
      tableLabel: "12",
      course: "mains",
      seats: 4,
      partySize: 3,
      seatedAt: "not a time",
      lastCheckInAt: null,
      checkInCount: 0,
      warnAfterMin: WARN,
      lateAfterMin: LATE,
      now: T0,
    });
    expect(b.status).toBe("late");
    expect(b.priority).toBe("high");
    expect(b.insights).toEqual(["Party of 3 · 4-top", "Seat time unknown", "No visit logged yet this party"]);
  });

  it("refuses a window end or warn minutes that are not numbers", () => {
    const opts = { seatings: [facts()], warnAfterMin: WARN, now: T0 + 60 * MIN };
    expect(() => responseSamples([], { ...opts, now: NaN })).toThrow(RangeError);
    expect(() => responseSamples([], { ...opts, now: Infinity })).toThrow(RangeError);
    expect(() => responseSamples([], { ...opts, warnAfterMin: NaN })).toThrow(RangeError);
  });

  it("an unreadable Paid is absent: the clock stops at leave", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ paidAt: "not a time", leftAt: at(30) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([5, 25]);
  });
});
