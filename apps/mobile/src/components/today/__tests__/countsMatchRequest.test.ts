import { countsMatchRequest } from "@/components/today/countsMatchRequest";

describe("countsMatchRequest (F-372)", () => {
  it("posts the order's own verify-receipt route", () => {
    expect(countsMatchRequest({ orderId: "order-1" })).toEqual({
      path: "/procurement/orders/order-1/verify-receipt",
      body: { adjustments: [] },
    });
  });

  it("never builds a request for a card with no order", () => {
    expect(countsMatchRequest({ orderId: null })).toBeNull();
    expect(countsMatchRequest({ orderId: undefined as any })).toBeNull();
  });
});
