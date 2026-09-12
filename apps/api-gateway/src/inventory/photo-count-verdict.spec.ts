import {
  countTolerance,
  humanCountVerdict,
  photoCountParseVerdict,
} from "./photo-count-verdict";

describe("photoCountParseVerdict", () => {
  it("calls an unparseable response a failure", () => {
    expect(
      photoCountParseVerdict({
        parsed: false,
        suggestedQty: null,
        confidence: "low",
      }).outcome,
    ).toBe("failure");
  });

  it("does NOT call a declination a failure — the prompt asks for it", () => {
    // "Never guess wildly — a null with a clear note is better than a
    // confident wrong number." Grading obedience as failure creates pressure
    // toward exactly the confident wrong number the prompt forbids.
    const v = photoCountParseVerdict({
      parsed: true,
      suggestedQty: null,
      confidence: "low",
    });
    expect(v.outcome).toBeNull();
    expect(v.evidence?.untestable).toBe("model_declined_to_count");
  });

  it("separates a declination from an unreadable response", () => {
    const declined = photoCountParseVerdict({
      parsed: true,
      suggestedQty: null,
      confidence: "low",
    });
    const broken = photoCountParseVerdict({
      parsed: false,
      suggestedQty: null,
      confidence: "low",
    });
    expect(declined.outcome).not.toEqual(broken.outcome);
  });

  it("calls a returned number a parse success", () => {
    expect(
      photoCountParseVerdict({
        parsed: true,
        suggestedQty: 12,
        confidence: "high",
      }).outcome,
    ).toBe("success");
  });
});

describe("countTolerance", () => {
  it("never falls below one bottle", () => {
    expect(countTolerance(0)).toBe(1);
    expect(countTolerance(4)).toBe(1);
  });

  it("scales on larger counts, so a bin is not judged like a shelf", () => {
    expect(countTolerance(60)).toBe(3);
  });
});

describe("humanCountVerdict", () => {
  const v = (suggestedQty: number | null, countedQty: number) =>
    humanCountVerdict({ suggestedQty, countedQty, confidence: "high" });

  it("calls an exact match a success", () => {
    expect(v(12, 12).outcome).toBe("success");
  });

  it("calls the occluded-bottle near miss partial", () => {
    expect(v(11, 12).outcome).toBe("partial");
  });

  it("calls a confident wrong number a failure", () => {
    expect(v(4, 12).outcome).toBe("failure");
  });

  it("scales the near-miss band with the count", () => {
    // 3 off on a 60-bottle bin is inside 5%; the same 3 on a shelf of 4 is not.
    expect(v(57, 60).outcome).toBe("partial");
    expect(v(1, 4).outcome).toBe("failure");
  });

  it("does not double-punish a declination", () => {
    const d = v(null, 12);
    expect(d.outcome).toBeNull();
    expect(d.evidence?.untestable).toBe("model_declined_to_count");
  });

  it("carries the delta and tolerance so a disputed verdict is re-checkable", () => {
    expect(v(9, 12).evidence).toMatchObject({
      suggested_qty: 9,
      counted_qty: 12,
      delta: 3,
      tolerance: 1,
    });
  });
});
