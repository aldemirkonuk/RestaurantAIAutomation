import { MAX_REORDER_QUANTITY, validateAction } from "./ask-ai-actions";

const INV = "11111111-1111-4111-8111-111111111111";
const PROV = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";

const reorder = (over: Record<string, unknown> = {}) => ({
  family: "procurement",
  actionType: "reorder",
  payload: { inventoryId: INV, providerId: PROV, quantity: 6, ...over },
});

describe("validateAction — the allowlist has to be mechanical", () => {
  it("accepts a well-formed reorder", () => {
    const v = validateAction(reorder());
    expect(v.ok).toBe(true);
    expect(v).toMatchObject({ ok: true, action: { payload: { quantity: 6 } } });
  });

  it("accepts a well-formed vendor draft", () => {
    const v = validateAction({
      family: "communications",
      actionType: "vendor_draft",
      payload: { orderId: ORDER, instruction: "chase the late delivery" },
    });
    expect(v.ok).toBe(true);
  });

  it("rejects a family that is not on the list", () => {
    // The model inventing `family: "inventory"` must not reach an executor
    // just because inventory actions exist elsewhere in the product.
    const v = validateAction({
      family: "inventory",
      actionType: "transfer",
      payload: { inventoryId: INV, quantity: 6 },
    });
    expect(v.ok).toBe(false);
    // `if (!v.ok)` narrows again now that strictNullChecks is on (OD-107).
    if (!v.ok) expect(v.reason).toContain("allowlisted action family");
  });

  it("rejects an unknown action inside an allowed family", () => {
    const v = validateAction({
      family: "procurement",
      actionType: "cancel_all_orders",
      payload: {},
    });
    expect(v.ok).toBe(false);
  });

  it("rejects non-uuid ids rather than passing them to an executor", () => {
    expect(validateAction(reorder({ inventoryId: "the barolo" })).ok).toBe(
      false,
    );
    expect(validateAction(reorder({ providerId: "our usual guy" })).ok).toBe(
      false,
    );
  });

  it("rejects a fractional or zero quantity instead of rounding it", () => {
    expect(validateAction(reorder({ quantity: 0 })).ok).toBe(false);
    expect(validateAction(reorder({ quantity: 2.5 })).ok).toBe(false);
    expect(validateAction(reorder({ quantity: -3 })).ok).toBe(false);
  });

  it("rejects a quantity above the cap — a misread digit is money", () => {
    // "12 cases" misparsed as 1200 is a plausible model error and an
    // implausible human intent.
    const v = validateAction(reorder({ quantity: MAX_REORDER_QUANTITY + 1 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("Orders page");
  });

  it("accepts exactly the cap", () => {
    expect(validateAction(reorder({ quantity: MAX_REORDER_QUANTITY })).ok).toBe(
      true,
    );
  });

  it("rejects a quantity that is a numeric string, rather than coercing it", () => {
    expect(validateAction(reorder({ quantity: "6" })).ok).toBe(false);
  });

  it("drops an empty unitType instead of storing it", () => {
    const v = validateAction(reorder({ unitType: "   " }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.action.payload).not.toHaveProperty("unitType");
  });

  it("rejects a vendor draft with no instruction", () => {
    const v = validateAction({
      family: "communications",
      actionType: "vendor_draft",
      payload: { orderId: ORDER, instruction: "  " },
    });
    expect(v.ok).toBe(false);
  });

  it("rejects prose, null and arrays without throwing", () => {
    for (const bad of [null, undefined, "just order some wine", [], 42]) {
      const v = validateAction(bad);
      expect(v.ok).toBe(false);
    }
  });

  it("always gives a reason — a dead end with no explanation kills a feature", () => {
    const rejections = [
      validateAction(null),
      validateAction({ family: "billing", actionType: "x", payload: {} }),
      validateAction(reorder({ quantity: 0 })),
      validateAction({ family: "procurement", actionType: "reorder" }),
    ];
    for (const r of rejections) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
    }
  });
});
