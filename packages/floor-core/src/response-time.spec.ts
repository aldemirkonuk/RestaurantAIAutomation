/**
 * @wineops/floor-core — visit gaps and who each one is credited to.
 *
 * Every spec here imports the real code. The checker's own scripts copied the
 * logic into the test file (`scripts/test-attribution.mjs:8`), so they could
 * pass while the app drifted; that is not repeated.
 */
import {
  responseSamples,
  type SeatingFacts,
} from "./index";
import { MIN, T0, at, WARN, ev, facts } from "./test-fixtures";

// ---------------------------------------------------------------------------
// 1. Parity with the checker's scripts
// ---------------------------------------------------------------------------

describe("parity: handoff gap attribution (test-attribution.mjs)", () => {
  // The checker's script ran events with no seating facts, so these use none:
  // the port gives such seatings the checker's treatment and lists them.
  const opts = { seatings: [], warnAfterMin: WARN, now: T0 + 60 * MIN };

  it("credits prior waiter when B claims and taps after A's long wait", () => {
    const events = [ev("seated", "A", 0), ev("check_in", "A", 8), ev("check_in", "B", 23)];
    const { byWaiter, seatingsWithoutFacts } = responseSamples(events, opts);
    expect(byWaiter.get("A")?.length).toBe(2);
    expect(Math.abs((byWaiter.get("A") ?? [])[0] - 8)).toBeLessThan(0.01);
    expect(Math.abs((byWaiter.get("A") ?? [])[1] - 15)).toBeLessThan(0.01);
    expect(byWaiter.has("B")).toBe(false);
    expect(seatingsWithoutFacts).toEqual(["s1"]);
  });

  it("does not replace A's samples with only B's short follow-up gap", () => {
    const events = [
      ev("check_in", "A", 0),
      ev("check_in", "A", 15),
      ev("check_in", "B", 20),
      ev("check_in", "B", 25),
    ];
    const { byWaiter } = responseSamples(events, opts);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // A keeps 15m + the 5m handoff gap (started on A's last tap)
    expect(byWaiter.get("A")?.length).toBe(2);
    expect(Math.abs(avg(byWaiter.get("A") ?? []) - 10)).toBeLessThan(0.01);
    // B only gets the 5m gap between B's own taps
    expect(byWaiter.get("B")?.length).toBe(1);
    expect(Math.abs((byWaiter.get("B") ?? [])[0] - 5)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 2. Corrections — each fails against the checker's original formula
// ---------------------------------------------------------------------------

describe("ADR 0346 D4 (c) / founder F1: the greeting gap is the table's waiter's", () => {
  it("a manager seats, the waiter visits: both gaps are the waiter's", () => {
    const events = [ev("seated", "M", 0), ev("check_in", "W", 20), ev("check_in", "W", 26)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ caretakerAtSeatId: "W", leftAt: at(30) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([20, 6]);
    expect(byWaiter.has("M")).toBe(false);
  });
});

describe("ADR 0346 D4 (e): Paid stops the clock", () => {
  it("a check-in after Paid adds no gap", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5), ev("check_in", "W", 30)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ paidAt: at(8), leftAt: at(40) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([5]);
  });

  it("the open gap ends at Paid, not at leave", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ paidAt: at(30), leftAt: at(90) })],
      warnAfterMin: WARN,
      now: T0 + 120 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([5, 25]);
  });
});

describe("founder F7 (2026-10-31) / ADR 0346 D5: a hidden table's past seatings", () => {
  it("stay in the waiter's samples and leave the table's", () => {
    const events = [
      ev("seated", "W", 0, { tableId: "t9" }),
      ev("check_in", "W", 8, { tableId: "t9" }),
    ];
    const { byWaiter, byTable } = responseSamples(events, {
      seatings: [facts({ tableId: "t9", tableHidden: true, leftAt: at(12) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([8]);
    expect(byTable.has("t9")).toBe(false);
  });
});


describe("now is the end of the window", () => {
  it("a leave or visit after now is not seen, and the open gap stops at now", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5), ev("check_in", "W", 70)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ leftAt: at(300) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([5, 55]);
  });

  it("a Paid after now is not seen, so the clock stops at a leave before now", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5)];
    const { byWaiter } = responseSamples(events, {
      seatings: [facts({ paidAt: at(300), leftAt: at(30) })],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("W")).toEqual([5, 25]);
  });

  it("a visit after now is not seen on a seating without facts either", () => {
    const events = [ev("seated", "A", 0), ev("check_in", "A", 5), ev("check_in", "A", 90)];
    const { byWaiter, seatingsWithoutFacts } = responseSamples(events, {
      seatings: [],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byWaiter.get("A")).toEqual([5]);
    expect(seatingsWithoutFacts).toEqual(["s1"]);
  });
});

describe("a hidden-table flag cannot be forgotten", () => {
  it("is required by the type, and an omitted flag leaves the per-table figures", () => {
    // @ts-expect-error tableHidden is required (ADR 0303 :60, ADR 0346 D5).
    const missing: SeatingFacts = {
      seatingId: "s1",
      tableId: "t1",
      seatedAt: at(0),
      seatedBy: "W",
      caretakerAtSeatId: "W",
      paidAt: null,
      leftAt: at(12),
      caretakerLastTapAt: null,
    };
    const { byTable, byWaiter } = responseSamples([ev("check_in", "W", 8)], {
      seatings: [missing],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(byTable.has("t1")).toBe(false);
    expect(byWaiter.get("W")).toEqual([8]);
  });
});

describe("ADR 0346 :63 (D4 b): the open gap's terminators", () => {
  const run = (over: Partial<SeatingFacts>, events = [ev("seated", "W", 0), ev("check_in", "W", 5)]) =>
    responseSamples(events, { seatings: [facts(over)], warnAfterMin: WARN, now: T0 + 600 * MIN });

  it("ends at the caretaker's last tap when that is earliest, so a leave next morning does not stretch it", () => {
    expect(run({ caretakerLastTapAt: at(40), leftAt: at(500) }).byWaiter.get("W")).toEqual([5, 35]);
  });

  it("ends at the earlier of Paid and leave, whichever was stamped first", () => {
    expect(run({ paidAt: at(90), leftAt: at(30) }).byWaiter.get("W")).toEqual([5, 25]);
  });

  it("ends at Paid or leave when either comes before the last tap", () => {
    expect(run({ paidAt: at(20), caretakerLastTapAt: at(200) }).byWaiter.get("W")).toEqual([5, 15]);
    expect(run({ leftAt: at(25), caretakerLastTapAt: at(200) }).byWaiter.get("W")).toEqual([5, 20]);
  });

  it("a last tap before the last visit adds no open gap", () => {
    expect(run({ caretakerLastTapAt: at(3), leftAt: at(300) }).byWaiter.get("W")).toEqual([5]);
  });

  it("the last tap ends only the open gap: a colleague's later check-in still closes one", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 5), ev("check_in", "X", 30)];
    expect(run({ caretakerLastTapAt: at(5), leftAt: at(40) }, events).byWaiter.get("W")).toEqual([5, 25]);
  });

  it("an unreadable or later-than-now tap is not seen", () => {
    expect(run({ caretakerLastTapAt: "bad", leftAt: at(30) }).byWaiter.get("W")).toEqual([5, 25]);
    expect(run({ caretakerLastTapAt: at(9000), leftAt: at(30) }).byWaiter.get("W")).toEqual([5, 25]);
  });

  it("lists a seating with neither Paid nor leave as not closed; its gap to the last tap still counts", () => {
    const out = run({ caretakerLastTapAt: at(60) });
    expect(out.seatingsNotClosed).toEqual(["s1"]);
    expect(out.byWaiter.get("W")).toEqual([5, 55]);
    expect(run({ leftAt: at(30) }).seatingsNotClosed).toEqual([]);
    expect(run({ paidAt: at(9000) }).seatingsNotClosed).toEqual(["s1"]);
  });
});

describe("the branches the port adds", () => {
  const opts = (over: Partial<SeatingFacts> = {}, now = 600) => ({
    seatings: [facts(over)],
    warnAfterMin: WARN,
    now: T0 + now * MIN,
  });

  it("keeps a closed gap over 120 minutes (the checker dropped it)", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "W", 150)];
    expect(responseSamples(events, opts({ leftAt: at(150) })).byWaiter.get("W")).toEqual([150]);
  });

  it("scores a party seated and never visited, to the caretaker at seat time", () => {
    const out = responseSamples([], opts({ seatedBy: "M", caretakerAtSeatId: "W", leftAt: at(30) }));
    expect(out.byWaiter.get("W")).toEqual([30]);
    expect(out.byWaiter.has("M")).toBe(false);
    expect(out.byTable.get("t1")).toEqual([30]);
  });

  it("with no caretaker, credits the greeting gap for the visit, not the Seat tap (D4 c)", () => {
    const open = responseSamples([], opts({ seatedBy: "M", caretakerAtSeatId: null, leftAt: at(30) }));
    expect(open.byWaiter.size).toBe(0);
    expect(open.byTable.get("t1")).toEqual([30]);
    const closed = responseSamples([ev("check_in", "X", 12)], opts({ seatedBy: "M", caretakerAtSeatId: null, leftAt: at(12) }));
    expect(closed.byWaiter.get("X")).toEqual([12]);
    expect(closed.byWaiter.has("M")).toBe(false);
    const selfSeated = responseSamples([ev("check_in", "M", 12)], opts({ seatedBy: "M", caretakerAtSeatId: null, leftAt: at(12) }));
    expect(selfSeated.byWaiter.get("M")).toEqual([12]);
  });

  it("counts an open gap only when it exceeds T, and T is at least one minute", () => {
    expect(responseSamples([], opts({ leftAt: at(WARN) })).byWaiter.has("W")).toBe(false);
    expect(responseSamples([], opts({ leftAt: at(WARN + 1) })).byWaiter.get("W")).toEqual([WARN + 1]);
    const zero = (leftAt: string) =>
      responseSamples([], { seatings: [facts({ leftAt })], warnAfterMin: 0, now: T0 + 600 * MIN });
    expect(zero(at(1)).byWaiter.has("W")).toBe(false);
    expect(zero(at(2)).byWaiter.get("W")).toEqual([2]);
  });

  it("lists a seating whose seat time is unreadable and that has no seated event", () => {
    const out = responseSamples([], opts({ seatedAt: "bad", leftAt: at(30) }));
    expect(out.seatingsWithoutAnchor).toEqual(["s1"]);
    expect(out.byWaiter.size).toBe(0);
  });

  it("refuses a window end or warn minute that is not finite", () => {
    expect(() => responseSamples([], { seatings: [], warnAfterMin: WARN, now: NaN })).toThrow(RangeError);
    expect(() => responseSamples([], { seatings: [], warnAfterMin: Infinity, now: T0 })).toThrow(RangeError);
  });

  it("leaves out an event whose time is unreadable, so an unreadable seated row cannot hide the seat time", () => {
    const events = [ev("seated", "W", 0, { createdAt: "bad" }), ev("check_in", "W", 5, { createdAt: "bad" }), ev("check_in", "W", 8)];
    const out = responseSamples(events, opts({ leftAt: at(8) }));
    expect(out.byWaiter.get("W")).toEqual([8]);
    expect(out.seatingsWithoutAnchor).toEqual([]);
  });

  it("orders same-millisecond events the same whatever the input order", () => {
    const events = [ev("check_in", "X", 5), ev("check_in", "W", 5), ev("seated", "W", 5), ev("check_in", "W", 9)];
    const a = responseSamples(events, opts({ leftAt: at(9) }));
    const b = responseSamples([...events].reverse(), opts({ leftAt: at(9) }));
    expect(a.byWaiter).toEqual(b.byWaiter);
    expect(a.byWaiter.get("W")).toEqual([0, 0]);
    expect(a.byWaiter.get("X")).toEqual([4]);
  });

  it("does not list a seating without facts as not closed", () => {
    const out = responseSamples([ev("seated", "W", 0), ev("check_in", "W", 5)], {
      seatings: [],
      warnAfterMin: WARN,
      now: T0 + 60 * MIN,
    });
    expect(out.seatingsNotClosed).toEqual([]);
    expect(out.seatingsWithoutFacts).toEqual(["s1"]);
  });

  it("credits the open gap after a colleague's visit to that colleague, bounded by the caretaker's last tap", () => {
    const events = [ev("seated", "W", 0), ev("check_in", "X", 5)];
    const out = responseSamples(events, opts({ caretakerLastTapAt: at(40), leftAt: at(300) }));
    expect(out.byWaiter.get("W")).toEqual([5]);
    expect(out.byWaiter.get("X")).toEqual([35]);
  });
});
