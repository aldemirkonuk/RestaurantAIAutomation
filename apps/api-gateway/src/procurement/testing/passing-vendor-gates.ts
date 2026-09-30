/**
 * Stand-ins for the two vendor-send gates (ADR 0175 D9/D10, 2026-09-21), for
 * specs whose subject is what a send or a confirmation WRITES — the price
 * history, the units, the currency — and not who may do it.
 *
 * `confirmDeal` and `manualReply` refuse when either gate is missing (a gate
 * that opens when its dependency is absent is not a gate), so a spec that
 * builds `ProcurementService` positionally must supply both. These admit:
 * the WHO stand-in answers "a manager", the seal stand-in accepts any token.
 * The real gates are exercised in `staff-ask-manager-sends.spec.ts` and
 * `vendor-doors-are-sealed.spec.ts`; nothing here may be used to claim a gate
 * holds.
 *
 * No jest types, no Nest decorators: it compiles into `dist` harmlessly, the
 * same arrangement as `notifications/producers/testing/fake-db.ts`.
 */

export const PASSING_SEAL = {
  issue: async (p: { action: string }) => ({ challenge: "seal", expiresAt: "t", action: p.action }),
  redeem: async () => ({ sealId: "seal-1" }),
};

export const PASSING_AUTHORITY = {
  assertMaySend: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
  standing: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
  readout: async () => ({ readable: true, maySend: true, mode: "send", basis: "manager", grant: null, sentence: null }),
  ownersAndManagers: async () => ({ owners: [], managers: [] }),
  namesOf: async () => new Map<string, string>(),
  // A manager sends by role, which is not a grant event: nothing to write.
  witnessGrantUse: async () => undefined,
};

/**
 * The approval rules, as a house that has set none (ADR 0244 D3). Since
 * 2026-09-30 `confirmDeal` runs the house's approval rules for the confirming
 * person (founder F2) and refuses when it cannot read them; a readable, empty
 * policy fires nothing, so a spec about what a confirmation WRITES is not a
 * spec about the rules. The rules themselves are exercised in
 * `order-price-recheck.spec.ts` and `order-approval-gate.spec.ts`.
 */
export const PASSING_THRESHOLDS = {
  read: async (restaurantId: string) => ({
    restaurantId,
    thresholds: [],
    policyEmpty: true,
    readable: true,
    reason: null,
    actorNamesReason: null,
  }),
};

/** A manager, for the role reads the rules make. Asserts nothing about who may act. */
export const PASSING_ORGANIZATIONS = {
  resolveRestaurantRole: async () => "manager",
  assertCanManageRestaurant: async () => undefined,
};

/** The eight positional `@Optional()`s after the ledger, then the two gates. */
export const GATES_AFTER_LEDGER = [
  undefined, // orchestrator
  undefined, // gmail
  undefined, // inbound responder
  undefined, // websocket
  undefined, // inbound address
  undefined, // notifications
  PASSING_THRESHOLDS, // approval thresholds (a house with no rule)
  PASSING_ORGANIZATIONS, // organizations (a manager)
  PASSING_SEAL,
  PASSING_AUTHORITY,
] as unknown as [
  undefined, undefined, undefined, undefined, undefined, undefined, any, any, any, any,
];

/** The actor and the seal a gated call carries in these specs. */
export const A_MANAGER = "manager-1";
export const A_SEAL = "seal";
