import { computeMatch } from "../invoice-match";
import {
  canTransition,
  Credit,
  CREDIT_REASON_WORDING,
  doorReason,
  draftClaimFromMatch,
  reasonForVerdict,
  CURRENCY_UNRECORDED,
  recoveryStats,
  recoveryStatsByCurrency,
  memoMarkRefusal,
  MEMO_MARKABLE_FROM,
  transition,
} from "./credit-ledger";

const credit = (o: Partial<Credit> = {}): Credit => ({
  state: "open",
  claimedAmount: 44,
  creditedAmount: null,
  creditDocumentId: null,
  openedAt: "2026-07-01T00:00:00.000Z",
  selfEvidenced: false,
  ...o,
});

describe("transitions", () => {
  it("refuses to mark a claim credited without the memo that settles it", () => {
    // Without the document this is a promise, and a promise counted as recovery
    // is the lie this whole module exists to prevent.
    const r = transition(credit({ state: "requested" }), {
      to: "credited",
      creditedAmount: 44,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/credit memo/i);
  });

  it("refuses to mark a claim credited without an amount", () => {
    const r = transition(credit({ state: "requested" }), {
      to: "credited",
      creditDocumentId: "doc-1",
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/amount the vendor actually allowed/i);
  });

  it("settles when both the amount and the proof are present", () => {
    const r = transition(credit({ state: "promised" }), {
      to: "credited",
      creditedAmount: 22,
      creditDocumentId: "doc-1",
    });

    expect(r.ok).toBe(true);
    expect(r.next).toMatchObject({ state: "credited", creditedAmount: 22 });
  });

  it("treats credited as terminal", () => {
    // A settled claim that could reopen would let the same money be counted
    // twice across two periods.
    expect(canTransition("credited", "requested")).toBe(false);
    expect(canTransition("credited", "open")).toBe(false);
  });

  it("gives 'the rep said he'd credit it next order' its own state", () => {
    // The most common thing that happens to a beverage claim. It is neither a
    // settlement nor a refusal, so it must be ageable and chaseable.
    expect(canTransition("requested", "promised")).toBe(true);
    expect(canTransition("promised", "credited")).toBe(true);
  });

  it("lets a rejected claim be pressed again", () => {
    expect(canTransition("rejected", "requested")).toBe(true);
  });

  it("refuses a nonsensical jump", () => {
    // `open -> credited` is no longer one (ADR 0267 item 9); a written-off
    // claim pressed again is.
    expect(
      transition(credit({ state: "written_off" }), { to: "requested" }).ok,
    ).toBe(false);
    expect(transition(credit({ state: "open" }), { to: "open" }).ok).toBe(
      false,
    );
  });
});

describe("settling an unasked memo (ADR 0267 item 9, W55 / F-159)", () => {
  it("lets an open claim settle straight against a memo, with the full proof", () => {
    expect(canTransition("open", "credited")).toBe(true);
    const r = transition(credit({ state: "open" }), {
      to: "credited",
      creditedAmount: 30,
      creditDocumentId: "memo-1",
    });
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({
      state: "credited",
      creditedAmount: 30,
      creditDocumentId: "memo-1",
    });
  });

  it("still refuses open -> credited without the memo", () => {
    const r = transition(credit({ state: "open" }), {
      to: "credited",
      creditedAmount: 30,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/credit memo/i);
  });

  it("still refuses open -> credited without the amount allowed", () => {
    const r = transition(credit({ state: "open" }), {
      to: "credited",
      creditDocumentId: "memo-1",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/amount the vendor actually allowed/i);
  });

  it("marks only a paper nothing has classed", () => {
    expect(MEMO_MARKABLE_FROM).toEqual(["unknown"]);
    expect(
      memoMarkRefusal({ doc_type: "unknown", status: "received" }),
    ).toEqual({ ok: true, already: false });
    expect(
      memoMarkRefusal({ doc_type: "credit_memo", status: "verified" }),
    ).toEqual({ ok: true, already: true });
  });

  it.each([
    "invoice",
    "packing_slip",
    "delivery_receipt",
    "delivery_note",
    "receiving_advice",
    "purchase_order",
    "statement",
    "price_list",
    "informal_note",
    "portal_export",
  ])("never takes a %s's role away", (docType) => {
    const r = memoMarkRefusal({ doc_type: docType, status: "received" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Nothing was changed/);
  });

  it("refuses a superseded or rejected paper, and one the house issued", () => {
    expect(
      memoMarkRefusal({ doc_type: "unknown", status: "superseded" }).ok,
    ).toBe(false);
    expect(
      memoMarkRefusal({ doc_type: "unknown", status: "rejected" }).ok,
    ).toBe(false);
    expect(
      memoMarkRefusal({
        doc_type: "unknown",
        status: "received",
        direction: "issued_by_us",
      }).ok,
    ).toBe(false);
  });
});

describe("draftClaimFromMatch", () => {
  it("raises a self-evidenced claim from the vendor's own two documents", () => {
    const m = computeMatch({
      orderedQty: 24,
      poUnitPrice: 22,
      shippedQty: 22,
      invoiceQty: 24,
      invoiceUnitPrice: 22,
      acceptedQty: 22,
    });
    const claim = draftClaimFromMatch(m)!;

    expect(claim.reason).toBe("overbilled_vs_ship");
    expect(claim.claimedAmount).toBe(44);
    expect(claim.selfEvidenced).toBe(true);
  });

  it("does not chase a distributor over paperwork still in flight", () => {
    // `partial` and `unmatched` are unfinished deliveries, not vendor errors.
    expect(reasonForVerdict("partial")).toBeNull();
    expect(reasonForVerdict("unmatched")).toBeNull();
    expect(reasonForVerdict("matched")).toBeNull();
  });

  it("declines to raise a claim it cannot put a number on", () => {
    // A $0 claim in a distributor's inbox costs more credibility than it recovers.
    const unpriced = computeMatch({
      orderedQty: 24,
      poUnitPrice: null,
      invoiceQty: 24,
      invoiceUnitPrice: null,
      acceptedQty: 22,
    });
    expect(draftClaimFromMatch(unpriced)).toBeNull();
  });

  describe("keeps the door's reason (W54 / F-158, ADR 0267 option 8)", () => {
    // 2 of 24 turned away at the door, invoiced for all 24.
    const refusal = computeMatch({
      orderedQty: 24,
      poUnitPrice: 22,
      invoiceQty: 24,
      invoiceUnitPrice: 22,
      acceptedQty: 22,
      rejectedQty: 2,
    });

    it.each([
      ["wrong_wine", "wrong_item"],
      ["broken_case", "broken"],
      ["temperature", "temperature"],
      ["other", "other"],
    ])("a door refusal for %s is claimed as %s", (door, claimed) => {
      expect(refusal.verdict).toBe("rejected");
      const r = doorReason([
        { outcome: "refused", refusal_reason: door, rejected_qty_bottles: 2 },
      ]);
      expect(draftClaimFromMatch(refusal, r)!.reason).toBe(claimed);
    });

    it("a broken count on a kept delivery is broken, not a refusal", () => {
      for (const outcome of ["accepted", "short"]) {
        expect(
          doorReason([
            { outcome, refusal_reason: null, rejected_qty_bottles: 1 },
          ]),
        ).toBe("broken");
      }
    });

    it("falls back to damaged when the door gave no reason, or two", () => {
      // No door event at all — a rejection typed at the desk.
      expect(draftClaimFromMatch(refusal, doorReason([]))!.reason).toBe("damaged");
      // A refusal with no reason.
      expect(
        doorReason([{ outcome: "refused", refusal_reason: null, rejected_qty: 2 }]),
      ).toBeNull();
      // A legacy event with no outcome: refused or broken, nobody said which.
      expect(
        doorReason([{ outcome: null, refusal_reason: null, rejected_qty_bottles: 2 }]),
      ).toBeNull();
      // Two trucks, two reasons: not filed under whichever came first.
      expect(
        doorReason([
          { outcome: "refused", refusal_reason: "wrong_wine", rejected_qty_bottles: 12 },
          { outcome: "accepted", refusal_reason: null, rejected_qty_bottles: 1 },
        ]),
      ).toBeNull();
      // A clean truck beside a refusal does not blur the refusal's reason.
      expect(
        doorReason([
          { outcome: "accepted", refusal_reason: null, rejected_qty_bottles: 0 },
          { outcome: "refused", refusal_reason: "temperature", rejected_qty_bottles: 6 },
        ]),
      ).toBe("temperature");
    });

    it("never lends the door's reason to a verdict that is not a rejection", () => {
      const overbill = computeMatch({
        orderedQty: 24,
        poUnitPrice: 22,
        shippedQty: 22,
        invoiceQty: 24,
        invoiceUnitPrice: 22,
        acceptedQty: 22,
      });
      expect(draftClaimFromMatch(overbill, "wrong_item")!.reason).toBe(
        "overbilled_vs_ship",
      );
    });

    it("gives every reason a page label and a letter sentence", () => {
      for (const [code, w] of Object.entries(CREDIT_REASON_WORDING)) {
        expect(`${code}:${w.label}`).toMatch(/:\S/);
        expect(`${code}:${w.sentence}`).toMatch(/:\S/);
      }
      expect(CREDIT_REASON_WORDING.damaged.label).toBe(
        "Refused or broken at the door",
      );
    });
  });

  it("raises nothing on a clean delivery", () => {
    const clean = computeMatch({
      orderedQty: 24,
      poUnitPrice: 22,
      invoiceQty: 24,
      invoiceUnitPrice: 22,
      acceptedQty: 24,
    });
    expect(draftClaimFromMatch(clean)).toBeNull();
  });
});

describe("recoveryStats", () => {
  const now = new Date("2026-07-27T00:00:00.000Z");

  it("counts only settled credits as recovered", () => {
    const s = recoveryStats(
      [
        credit({
          state: "credited",
          claimedAmount: 100,
          creditedAmount: 100,
          creditDocumentId: "d",
        }),
        credit({ state: "requested", claimedAmount: 250 }),
        credit({ state: "promised", claimedAmount: 80 }),
      ],
      now,
    );

    // Asking for $330 more is not recovering it.
    expect(s.recovered).toBe(100);
    expect(s.outstanding).toBe(330);
    expect(s.promised).toBe(80);
  });

  it("uses what the vendor allowed, not what we asked for", () => {
    // Partial settlement is the norm: claim two broken bottles, they allow one.
    const s = recoveryStats(
      [
        credit({
          state: "credited",
          claimedAmount: 44,
          creditedAmount: 22,
          creditDocumentId: "d",
        }),
      ],
      now,
    );

    expect(s.recovered).toBe(22);
  });

  it("reports refusals alongside recovery", () => {
    // The honest counterweight. A recovery figure with no denominator flatters.
    const s = recoveryStats(
      [
        credit({
          state: "credited",
          claimedAmount: 50,
          creditedAmount: 50,
          creditDocumentId: "d",
        }),
        credit({ state: "rejected", claimedAmount: 150 }),
      ],
      now,
    );

    expect(s.rejected).toBe(150);
    expect(s.settlementRate).toBe(0.5);
  });

  it("reports no settlement rate rather than 0% when nothing has resolved", () => {
    // 0% on zero attempts reads as a distributor refusing everything.
    const s = recoveryStats([credit({ state: "open" })], now);
    expect(s.settlementRate).toBeNull();
  });

  it("ages the oldest unsettled claim", () => {
    const s = recoveryStats(
      [
        credit({ state: "requested", openedAt: "2026-07-20T00:00:00.000Z" }),
        credit({ state: "open", openedAt: "2026-06-27T00:00:00.000Z" }),
        // Settled claims must not age the queue.
        credit({
          state: "credited",
          openedAt: "2020-01-01T00:00:00.000Z",
          creditedAmount: 1,
          creditDocumentId: "d",
        }),
      ],
      now,
    );

    expect(s.oldestOpenDays).toBe(30);
    expect(s.openClaims).toBe(2);
  });

  it("excludes written-off claims from every money figure", () => {
    const s = recoveryStats(
      [credit({ state: "written_off", claimedAmount: 999 })],
      now,
    );

    expect(s.recovered).toBe(0);
    expect(s.outstanding).toBe(0);
    expect(s.rejected).toBe(0);
    expect(s.openClaims).toBe(0);
  });

  it("returns zeroes, not NaN, for a restaurant with no claims", () => {
    const s = recoveryStats([], now);
    expect(s.recovered).toBe(0);
    expect(s.oldestOpenDays).toBeNull();
    expect(s.settlementRate).toBeNull();
  });
});

describe("recoveryStatsByCurrency", () => {
  const now = new Date("2026-07-27T00:00:00.000Z");

  it("never adds one currency's claims to another's", () => {
    const by = recoveryStatsByCurrency(
      [
        credit({ state: "requested", claimedAmount: 250, currency: "TRY" }),
        credit({ state: "open", claimedAmount: 40, currency: "EUR" }),
        credit({
          state: "credited",
          claimedAmount: 100,
          creditedAmount: 90,
          creditDocumentId: "d",
          currency: "TRY",
        }),
      ],
      now,
    );

    expect(Object.keys(by)).toEqual(["EUR", "TRY"]);
    expect(by.TRY.outstanding).toBe(250);
    expect(by.TRY.recovered).toBe(90);
    expect(by.EUR.outstanding).toBe(40);
    expect(by.EUR.recovered).toBe(0);
    // The combined figure still exists for the callers that read it, and it is
    // exactly the sum this function refuses to show as one number.
    expect(
      recoveryStats(
        [
          credit({ state: "requested", claimedAmount: 250, currency: "TRY" }),
          credit({ state: "open", claimedAmount: 40, currency: "EUR" }),
        ],
        now,
      ).outstanding,
    ).toBe(290);
  });

  it("normalises the code and names a missing one instead of borrowing a currency", () => {
    const by = recoveryStatsByCurrency(
      [
        credit({ state: "open", claimedAmount: 10, currency: " try " }),
        credit({ state: "open", claimedAmount: 5, currency: null }),
        credit({ state: "open", claimedAmount: 7 }),
      ],
      now,
    );

    expect(by.TRY.outstanding).toBe(10);
    expect(by[CURRENCY_UNRECORDED].outstanding).toBe(12);
    expect(by.USD).toBeUndefined();
  });

  it("answers an empty ledger with no groups, not a zero in some currency", () => {
    expect(recoveryStatsByCurrency([], now)).toEqual({});
  });
});
