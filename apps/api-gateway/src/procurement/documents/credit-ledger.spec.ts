import { computeMatch } from "../invoice-match";
import {
  canTransition,
  Credit,
  draftClaimFromMatch,
  reasonForVerdict,
  recoveryStats,
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
    expect(transition(credit(), { to: "credited" }).ok).toBe(false);
    expect(transition(credit({ state: "open" }), { to: "open" }).ok).toBe(
      false,
    );
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
