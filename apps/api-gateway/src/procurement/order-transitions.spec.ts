import { ProcurementOrderStatus } from "./dto/procurement.dto";
import {
  ORDER_GOODS_ARRIVED_STATUSES,
  ORDER_TERMINAL_STATUSES,
  ORDER_TRANSITIONS,
  canTransition,
  decideTransition,
  readOrderStatus,
  refuseTransition,
  statusInWords,
} from "./order-transitions";

/**
 * ADR 0125 — the rules an order's state change is held to.
 *
 * These are the assertions that would have failed on the tree before this pass,
 * because before it there was no rule at all: `updateOrder` wrote
 * `status: dto.status ?? undefined` and `cancelOrder` wrote CANCELLED from
 * anything, including a DELIVERED order whose stock was already booked.
 *
 * Nothing here touches Nest or a database, so every rule is decided in the same
 * place a reader can check it.
 */

const ALL = Object.values(ProcurementOrderStatus);

describe("the table covers the vocabulary, and cannot rot quietly", () => {
  it("names every one of the twelve enum members", () => {
    // If the enum gains a member and this file does not, the new state has no
    // rule — and `canTransition` would answer `false` for every move out of it,
    // silently freezing the new state rather than reporting a gap.
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL].sort());
    expect(ALL).toHaveLength(12);
  });

  it("gives every member a sentence in a person's words", () => {
    for (const s of ALL) {
      const words = statusInWords(s);
      expect(words).toBeTruthy();
      // The words are for an operator, so they must not BE the enum member.
      expect(words).not.toBe(s);
    }
  });

  it("names only reachable states as targets", () => {
    for (const from of ALL) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(ALL).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it("derives the terminal set rather than restating it", () => {
    expect([...ORDER_TERMINAL_STATUSES].sort()).toEqual(
      [
        ProcurementOrderStatus.CANCELLED,
        ProcurementOrderStatus.COMPLETED,
        ProcurementOrderStatus.FAILED,
        ProcurementOrderStatus.REJECTED,
      ].sort(),
    );
  });
});

describe("the moves this house already makes are all legal", () => {
  /**
   * Every edge below is a transition an EXISTING writer performs, read off the
   * census in ADR 0125. A table that forbade one of these would not make the
   * system correct; it would break it in a new place.
   */
  const CENSUS: Array<[ProcurementOrderStatus, ProcurementOrderStatus, string]> = [
    [
      ProcurementOrderStatus.PENDING,
      ProcurementOrderStatus.APPROVAL_NEEDED,
      "parkOrderAwaitingApproval",
    ],
    [
      ProcurementOrderStatus.PENDING,
      ProcurementOrderStatus.NEGOTIATING,
      "inbound-responder syncOrderState",
    ],
    [
      ProcurementOrderStatus.APPROVAL_NEEDED,
      ProcurementOrderStatus.NEGOTIATING,
      "inbound-responder syncOrderState",
    ],
    [
      ProcurementOrderStatus.PENDING,
      ProcurementOrderStatus.APPROVED,
      "approveOrder",
    ],
    [
      ProcurementOrderStatus.APPROVAL_NEEDED,
      ProcurementOrderStatus.APPROVED,
      "approveOrder after the gate parked it",
    ],
    [
      ProcurementOrderStatus.NEGOTIATING,
      ProcurementOrderStatus.APPROVED,
      "confirmDeal",
    ],
    [
      ProcurementOrderStatus.APPROVED,
      ProcurementOrderStatus.CONFIRMED,
      "syncOrderState on a matching vendor receipt; the legacy desk's Mark as Ordered",
    ],
    [
      ProcurementOrderStatus.APPROVED,
      ProcurementOrderStatus.DELIVERED,
      "markDelivered",
    ],
    [
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.DELIVERED,
      "markDelivered",
    ],
    [
      ProcurementOrderStatus.IN_TRANSIT,
      ProcurementOrderStatus.DELIVERED,
      "markDelivered",
    ],
    [
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.PARTIALLY_RECEIVED,
      "the receiving door",
    ],
    [
      ProcurementOrderStatus.DELIVERED,
      ProcurementOrderStatus.COMPLETED,
      "verifyReceipt, three-way match clean",
    ],
    [
      ProcurementOrderStatus.DELIVERED,
      ProcurementOrderStatus.PARTIALLY_RECEIVED,
      "verifyReceipt, short delivery",
    ],
    [
      ProcurementOrderStatus.PARTIALLY_RECEIVED,
      ProcurementOrderStatus.COMPLETED,
      "verifyReceipt closing the backorder",
    ],
    [
      ProcurementOrderStatus.PENDING,
      ProcurementOrderStatus.CANCELLED,
      "cancelOrder",
    ],
    [
      ProcurementOrderStatus.APPROVED,
      ProcurementOrderStatus.CANCELLED,
      "cancelOrder after approval",
    ],
    [
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.CANCELLED,
      "cancelOrder on a placed order",
    ],
    [
      ProcurementOrderStatus.NEGOTIATING,
      ProcurementOrderStatus.REJECTED,
      "a rejection recorded against an order still in negotiation",
    ],
  ];

  it.each(CENSUS)("%s -> %s is allowed (%s)", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("allows a repeat of an OPEN state, which is not a transition", () => {
    // The receiving door writes PARTIALLY_RECEIVED on every case counted, and
    // verifyReceipt writes it again on the second short delivery against the
    // same backorder. Refusing those would break the only path in this house
    // that reconciles a partial delivery, in the name of a rule about CHANGES.
    expect(
      canTransition(
        ProcurementOrderStatus.PARTIALLY_RECEIVED,
        ProcurementOrderStatus.PARTIALLY_RECEIVED,
      ),
    ).toBe(true);
    expect(
      canTransition(
        ProcurementOrderStatus.DELIVERED,
        ProcurementOrderStatus.DELIVERED,
      ),
    ).toBe(true);
  });

  it("refuses a repeat of a TERMINAL state", () => {
    // A state you can never leave, you enter once. Cancelling an already
    // cancelled order changes no status, but it overwrites the reason with a
    // second account and files a second audit row naming a second person — so
    // the record of what happened to this order stops being one thing.
    for (const s of ORDER_TERMINAL_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
    expect(
      refuseTransition(
        ProcurementOrderStatus.CANCELLED,
        ProcurementOrderStatus.CANCELLED,
      ),
    ).toMatch(/already cancelled/);
  });
});

describe("a cancellation cannot erase money the shelf still holds", () => {
  it.each(ORDER_GOODS_ARRIVED_STATUSES)(
    "refuses %s -> CANCELLED",
    (from) => {
      expect(canTransition(from, ProcurementOrderStatus.CANCELLED)).toBe(false);
    },
  );

  it("says why, in the words that name the consequence", () => {
    const sentence = refuseTransition(
      ProcurementOrderStatus.DELIVERED,
      ProcurementOrderStatus.CANCELLED,
    );
    // The sentence has to carry the fact a person cannot see: the money leaves
    // the books and the bottles do not leave the shelf. "Invalid transition"
    // is the message that teaches an operator to try again harder.
    expect(sentence).toMatch(/delivered/);
    expect(sentence).toMatch(/counted into stock/);
    expect(sentence).toMatch(/spend and delivery figure/);
    expect(sentence).toMatch(/Nothing was changed/);
    // And what to do instead, or the refusal is a dead end.
    expect(sentence).toMatch(/credit|receiving door/);
  });

  it("still allows a cancellation before anything arrives", () => {
    for (const from of [
      ProcurementOrderStatus.PENDING,
      ProcurementOrderStatus.APPROVAL_NEEDED,
      ProcurementOrderStatus.NEGOTIATING,
      ProcurementOrderStatus.APPROVED,
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.IN_TRANSIT,
    ]) {
      expect(canTransition(from, ProcurementOrderStatus.CANCELLED)).toBe(true);
    }
  });
});

describe("a closed order is not reopened", () => {
  it.each(ORDER_TERMINAL_STATUSES)("refuses every move out of %s", (from) => {
    for (const to of ALL) {
      if (to === from) continue;
      expect(canTransition(from, to)).toBe(false);
    }
  });

  it("says a second life would double-count the money", () => {
    const sentence = refuseTransition(
      ProcurementOrderStatus.COMPLETED,
      ProcurementOrderStatus.PENDING,
    );
    expect(sentence).toMatch(/already completed/);
    expect(sentence).toMatch(/counted twice/);
    expect(sentence).toMatch(/Raise a new order/);
  });
});

describe("the delivery chain does not run backwards", () => {
  it.each([
    [ProcurementOrderStatus.DELIVERED, ProcurementOrderStatus.PENDING],
    [ProcurementOrderStatus.DELIVERED, ProcurementOrderStatus.APPROVED],
    [ProcurementOrderStatus.DELIVERED, ProcurementOrderStatus.CONFIRMED],
    [ProcurementOrderStatus.CONFIRMED, ProcurementOrderStatus.PENDING],
    [ProcurementOrderStatus.CONFIRMED, ProcurementOrderStatus.APPROVED],
    [ProcurementOrderStatus.APPROVED, ProcurementOrderStatus.PENDING],
    [
      ProcurementOrderStatus.PARTIALLY_RECEIVED,
      ProcurementOrderStatus.CONFIRMED,
    ],
  ])("refuses %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("an unreadable state is refused, never treated as permission", () => {
  it("reads a member, in any casing", () => {
    expect(readOrderStatus("delivered")).toBe(ProcurementOrderStatus.DELIVERED);
    expect(readOrderStatus(" APPROVED ")).toBe(ProcurementOrderStatus.APPROVED);
  });

  it("refuses to guess at anything else", () => {
    for (const raw of [null, undefined, "", "SHIPPED", "ordered", 7, {}]) {
      expect(readOrderStatus(raw)).toBeNull();
    }
  });

  it("decides a null status as a refusal with its own sentence", () => {
    const verdict = decideTransition(null, ProcurementOrderStatus.CANCELLED);
    expect(verdict.allowed).toBe(false);
    expect(verdict.from).toBeUndefined();
    expect(verdict.sentence).toMatch(/nothing at all/);
    expect(verdict.sentence).toMatch(/refused rather than treated as permission/);
  });

  it("quotes back a value it did not recognise", () => {
    const verdict = decideTransition("SHIPPED", ProcurementOrderStatus.DELIVERED);
    expect(verdict.allowed).toBe(false);
    expect(verdict.sentence).toMatch(/"SHIPPED"/);
  });

  it("reports the state it read on a legal move", () => {
    const verdict = decideTransition(
      "approved",
      ProcurementOrderStatus.CANCELLED,
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.from).toBe(ProcurementOrderStatus.APPROVED);
    expect(verdict.sentence).toBeUndefined();
  });
});


/**
 * ADR 0125 Q3 — the founder, 2026-09-05: "Return to NEGOTIATING, with the
 * decline recorded."
 *
 * A vendor's no used to be written as terminal REJECTED by
 * `procurement_agent.py:780`, which dropped the order out of every open-order
 * list, outstanding count and reorder widget before a person decided anything.
 * Dynamics 365 holds such a PO "In external review" for the same reason: the
 * house may still buy the wine at another price or from another vendor.
 */
describe("a vendor's decline returns the order to negotiation", () => {
  it.each([
    ProcurementOrderStatus.PENDING,
    ProcurementOrderStatus.APPROVAL_NEEDED,
    ProcurementOrderStatus.APPROVED,
    ProcurementOrderStatus.CONFIRMED,
  ])("allows %s -> NEGOTIATING, the state a decline lands in", (from) => {
    expect(canTransition(from, ProcurementOrderStatus.NEGOTIATING)).toBe(true);
  });

  it("allows a decline on an order already in negotiation to change nothing", () => {
    expect(
      canTransition(
        ProcurementOrderStatus.NEGOTIATING,
        ProcurementOrderStatus.NEGOTIATING,
      ),
    ).toBe(true);
  });

  it("CONFIRMED -> NEGOTIATING is the edge this decision added", () => {
    // The one edge the census did not already contain: before ADR 0125 Q3
    // nothing walked an order backwards out of CONFIRMED, because the only
    // thing that answered a decline wrote REJECTED instead.
    expect(
      ORDER_TRANSITIONS[ProcurementOrderStatus.CONFIRMED],
    ).toContain(ProcurementOrderStatus.NEGOTIATING);
  });

  it("still refuses a decline written the old way, from a placed order", () => {
    // `CONFIRMED -> REJECTED` is what `procurement_agent.py` used to write. The
    // table refuses it, and since the trigger landed so does the database.
    expect(
      canTransition(
        ProcurementOrderStatus.CONFIRMED,
        ProcurementOrderStatus.REJECTED,
      ),
    ).toBe(false);
  });

  it("does not walk an order backwards out of the delivery chain", () => {
    // A decline after the wine is on its way is not a negotiation; it is a
    // delivery problem, and it belongs at the door.
    for (const from of [
      ProcurementOrderStatus.IN_TRANSIT,
      ProcurementOrderStatus.DELIVERED,
      ProcurementOrderStatus.PARTIALLY_RECEIVED,
    ]) {
      expect(canTransition(from, ProcurementOrderStatus.NEGOTIATING)).toBe(false);
    }
  });
});
