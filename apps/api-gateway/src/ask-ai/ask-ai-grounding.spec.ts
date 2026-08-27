import { checkActionGrounded } from "./ask-ai-grounding";
import { AskAiAction } from "./ask-ai-actions";

const INV = "11111111-1111-4111-8111-111111111111";
const PROV = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";

const candidates = {
  inventoryIds: new Set([INV]),
  providerIds: new Set([PROV]),
  orderIds: new Set([ORDER]),
};

const reorder = (over: Record<string, unknown> = {}): AskAiAction => ({
  family: "procurement",
  actionType: "reorder",
  payload: { inventoryId: INV, providerId: PROV, quantity: 6, ...over } as any,
});

describe("checkActionGrounded — a well-formed uuid is not a real one", () => {
  it("accepts ids that came from the candidate set", () => {
    expect(checkActionGrounded(reorder(), candidates).grounded).toBe(true);
  });

  it("rejects an inventory id the model invented", () => {
    // This is the case that matters: it passes every shape check and points at
    // nothing — or at another restaurant's row.
    const g = checkActionGrounded(
      reorder({ inventoryId: OTHER_TENANT }),
      candidates,
    );
    expect(g.grounded).toBe(false);
    if (!g.grounded)
      expect(g.ungrounded).toContain(`inventoryId:${OTHER_TENANT}`);
  });

  it("rejects a provider id from outside the candidate set", () => {
    const g = checkActionGrounded(
      reorder({ providerId: OTHER_TENANT }),
      candidates,
    );
    expect(g.grounded).toBe(false);
  });

  it("names every ungrounded id, not just the first", () => {
    const g = checkActionGrounded(
      reorder({ inventoryId: OTHER_TENANT, providerId: OTHER_TENANT }),
      candidates,
    );
    if (!g.grounded) expect(g.ungrounded).toHaveLength(2);
  });

  it("does NOT echo the invented uuid back to the operator", () => {
    // Reporting a uuid that may belong to another tenant is worse than
    // unhelpful. Precise in the log, vague in the reason.
    const g = checkActionGrounded(
      reorder({ inventoryId: OTHER_TENANT }),
      candidates,
    );
    if (!g.grounded) expect(g.reason).not.toContain(OTHER_TENANT);
    if (!g.grounded) expect(g.reason).toContain("could not find");
  });

  it("checks the order id for a vendor draft", () => {
    const draft: AskAiAction = {
      family: "communications",
      actionType: "vendor_draft",
      payload: { orderId: OTHER_TENANT, instruction: "chase it" },
    };
    expect(checkActionGrounded(draft, candidates).grounded).toBe(false);
  });

  it("rejects everything when the candidate set is empty", () => {
    // An empty set must never read as "anything goes".
    const empty = {
      inventoryIds: new Set<string>(),
      providerIds: new Set<string>(),
      orderIds: new Set<string>(),
    };
    expect(checkActionGrounded(reorder(), empty).grounded).toBe(false);
  });
});
