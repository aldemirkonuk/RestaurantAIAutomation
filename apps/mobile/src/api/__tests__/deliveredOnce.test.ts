/**
 * The mobile half of "already delivered is not a failure".
 *
 * Founder, 2026-09-05 (batch 46), rejecting 400 for this refusal: *"the request
 * is well-formed, the order's state conflicts with it, and the door and the
 * one-tap rail must be able to tell 'already done' from 'you sent nonsense' and
 * show the earlier delivery instead of an error."*
 *
 * On this app the entry is enqueued at the truck door and may sit in the outbox
 * for minutes with no signal, so by the time it dispatches a colleague upstairs
 * may already have booked the same truck in. The outbox has always refused to
 * retry a 4xx — which is right, and is exactly why 409 rather than 500 is the
 * status that matters here — but it printed "didn't go through" over an order
 * that HAD gone through. These pin the parser that fixes the words.
 *
 * The body fixture is the same one asserted in
 * `apps/api-gateway/src/procurement/tests/delivered-once.spec.ts` and in
 * `apps/web/src/services/api/orders.deliverOnce.test.ts`. Three copies of one
 * literal is what holds this contract, because `check_web_reads_gateway_dto_keys`
 * pairs a client TYPE with a gateway DTO CLASS and this is an ERROR body off a
 * pure module — neither side of that pairing.
 */
import { ApiError } from "../client";
import {
  alreadyDeliveredRefusal,
  alreadyDeliveredWords,
} from "../delivered-once";

const SUMMARY =
  "Delivered on 2026-09-04 at 14:05 UTC by Ada Lovelace, 12 bottles booked in.";
const MESSAGE = "An order is delivered once. Nothing was changed.";

const EARLIER = {
  deliveredAt: "2026-09-04T14:05:00.000Z",
  receivedBy: "user-7",
  receivedByName: "Ada Lovelace",
  receivedByNameReason: null,
  quantityReceived: 12,
  unitType: "bottle",
  quantityUnitWhy:
    "Stated in bottle: the order's own unit does not multiply.",
  bottlesTotal: 12,
  summary: SUMMARY,
};

const conflict = (earlier: unknown = EARLIER) =>
  new ApiError(409, MESSAGE, {
    reason: "order_already_delivered",
    orderId: "ord-9",
    orderNumber: "ORD-2026-00042",
    status: "DELIVERED",
    deliveredAt: "2026-09-04T14:05:00.000Z",
    earlierDelivery: earlier,
    message: MESSAGE,
  });

describe("alreadyDeliveredRefusal — mobile", () => {
  it("reads the earlier delivery off a 409", () => {
    const refused = alreadyDeliveredRefusal(conflict());
    expect(refused).not.toBeNull();
    expect(refused!.orderNumber).toBe("ORD-2026-00042");
    expect(refused!.earlierDelivery).toEqual(EARLIER);
    expect(alreadyDeliveredWords(refused!)).toBe(`${SUMMARY} ${MESSAGE}`);
  });

  it("is null for every error that is not this refusal", () => {
    expect(alreadyDeliveredRefusal(new Error("offline"))).toBeNull();
    expect(alreadyDeliveredRefusal(new ApiError(500, "boom", {}))).toBeNull();
    expect(
      alreadyDeliveredRefusal(
        new ApiError(409, "no", { reason: "credit_already_claimed" }),
      ),
    ).toBeNull();
    // A 409 whose body never reached the client at all.
    expect(alreadyDeliveredRefusal(new ApiError(409, "no"))).toBeNull();
  });

  it("does not invent a delivery from an unusable body", () => {
    // A captive portal answering 409 with HTML. A screen that rendered blanks
    // from this would be claiming a delivery the house never recorded.
    expect(
      alreadyDeliveredRefusal(new ApiError(409, "conflict", "<html/>")),
    ).toBeNull();

    const noSummary = alreadyDeliveredRefusal(
      conflict({ ...EARLIER, summary: "" }),
    );
    expect(noSummary).not.toBeNull();
    expect(noSummary!.earlierDelivery).toBeNull();
    expect(alreadyDeliveredWords(noSummary!)).toBe(MESSAGE);
  });

  it("keeps a failed name lookup distinct from a delivery nobody signed for", () => {
    const unnamed = alreadyDeliveredRefusal(
      conflict({
        ...EARLIER,
        receivedByName: null,
        receivedByNameReason: "the people register could not be read (timeout)",
      }),
    );
    expect(unnamed!.earlierDelivery!.receivedBy).toBe("user-7");
    expect(unnamed!.earlierDelivery!.receivedByName).toBeNull();
    expect(unnamed!.earlierDelivery!.receivedByNameReason).toMatch(
      /could not be read/,
    );
  });
});
