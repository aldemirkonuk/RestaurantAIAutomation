import {
  OPEN_STATUSES,
  STATUS_LABEL,
  TIMELINE,
  deliverWithCountPath,
  orderUnitWords,
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

describe("the delivery mark carries the truck's count (F-1182, rehit F-1126)", () => {
  it("puts the count in the query the gateway reads", () => {
    expect(deliverWithCountPath("o1", 4)).toBe(
      "/procurement/orders/o1/deliver?quantityReceivedInOrderUom=4",
    );
    expect(deliverWithCountPath("o1", 0)).toBe(
      "/procurement/orders/o1/deliver?quantityReceivedInOrderUom=0",
    );
  });
  it("sends nothing for a count that is not a whole number", () => {
    expect(deliverWithCountPath("o1", -1)).toBeNull();
    expect(deliverWithCountPath("o1", 1.5)).toBeNull();
    expect(deliverWithCountPath("o1", Number.NaN)).toBeNull();
  });
  it("says the count in the order's unit", () => {
    expect(orderUnitWords("case", 3)).toBe("3 cases");
    expect(orderUnitWords("split_case", 1)).toBe("1 split case");
    expect(orderUnitWords("each", 2)).toBe("2 bottles");
    expect(orderUnitWords(undefined, 1)).toBe("1 bottle");
  });
});
