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

/** The eight positional `@Optional()`s after the ledger, then the two gates. */
export const GATES_AFTER_LEDGER = [
  undefined, // orchestrator
  undefined, // gmail
  undefined, // inbound responder
  undefined, // websocket
  undefined, // inbound address
  undefined, // notifications
  undefined, // approval thresholds
  undefined, // organizations
  PASSING_SEAL,
  PASSING_AUTHORITY,
] as unknown as [
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, any, any,
];

/** The actor and the seal a gated call carries in these specs. */
export const A_MANAGER = "manager-1";
export const A_SEAL = "seal";
