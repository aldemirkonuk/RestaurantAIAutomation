import {
  OPEN_STATUSES,
  STATUS_LABEL,
  TIMELINE,
  receiveActionLabel,
  timelineIndex,
} from "../orderStatus";

describe("a truck counted with its invoice still to come (F-589)", () => {
  it("says it in words, not the raw status", () => {
    expect(STATUS_LABEL.PARTIALLY_RECEIVED).toBe("Counted — invoice to come");
  });

  it("stays under Open", () => {
    expect(OPEN_STATUSES.has("PARTIALLY_RECEIVED")).toBe(true);
    expect(OPEN_STATUSES.has("COMPLETED")).toBe(false);
  });

  it("sits between delivered and completed on the timeline", () => {
    const step = timelineIndex("PARTIALLY_RECEIVED");
    expect(step).toBe(TIMELINE.indexOf("DELIVERED") + 1);
    expect(step).toBe(TIMELINE.indexOf("COMPLETED") - 1);
  });

  it("offers the next step: add the invoice", () => {
    expect(receiveActionLabel("PARTIALLY_RECEIVED")).toBe("Add the invoice");
    expect(receiveActionLabel("DELIVERED")).toBe("Count & verify receipt");
    expect(receiveActionLabel("COMPLETED")).toBeNull();
  });
});
