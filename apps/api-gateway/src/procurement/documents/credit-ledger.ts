import { isClaimable, MatchResult, MatchVerdict } from "../invoice-match";

/**
 * credit-ledger — the state machine behind a vendor credit claim, and the only
 * honest definition of "recovered".
 *
 * THE DISTINCTION THIS MODULE EXISTS TO PROTECT: claimed is not recovered.
 *
 * A restaurant that has asked its distributor for $4,200 back has recovered
 * nothing. Money is recovered when the distributor issues a credit memo and it
 * lands. Every product in this space is tempted to report the first number
 * because it is bigger and arrives sooner — and it is the number that destroys
 * credibility the first time a bookkeeper ties it to a vendor statement, which
 * they always do. So `recovered` counts only claims in state `credited`, using
 * `creditedAmount` (what the vendor allowed), never `claimedAmount` (what we
 * asked for).
 */

export type CreditState =
  | "open"
  | "requested"
  | "promised"
  | "credited"
  | "rejected"
  | "written_off";

export type CreditReason =
  | "overbilled_vs_ship"
  | "qty_short"
  | "short_shipped"
  | "damaged"
  | "price_variance"
  | "never_ordered"
  | "other"
  /**
   * The house paid for an order that was then cancelled `never_arrived`
   * (ADR 0207 round 5). Distinct from `never_ordered` (a vendor billed for
   * something the house never placed at all) — this is the reverse: the
   * house placed it, paid for it, and it never came. Opened only from
   * `ProcurementService.openNeverArrivedCreditClaim`, never from
   * `draftClaimFromMatch` (an invoice-match verdict is never this reason).
   */
  | "never_arrived"
  /**
   * The door's own reason, kept on the claim (founder, 2026-10-02, W54 /
   * F-158, ADR 0267 option 8: "Keep the door's reason"). Before this a
   * `rejected` verdict was always filed as `damaged`, so a wrong item, a
   * broken case and a warm truck were one claim with three names on three
   * pages. `damaged` stays for old rows and for a rejection whose reason the
   * door did not give (see `doorReason`) — never rewritten (no backfill).
   */
  | "wrong_item"
  | "broken"
  | "temperature";

/**
 * Every claim reason in the house's words — ONE wording, used by every page
 * and by the vendor letter (W54: "one wording on every page and in the
 * letter").
 *
 * `label` is what a page prints for the claim (/receipts › Credits,
 * /receiving's drafted card, the vendor scorecard). `sentence` is the clause
 * the credit letter puts after "because" (`credit-letter.ts`). They say the
 * same thing in two grammatical shapes; no page or letter carries its own
 * copy. The web keeps a mirror of `label` (`ReceiptsCredits.tsx`
 * REASON_WORDS) because it cannot import gateway code at runtime, and
 * `credit-reason-words.test.ts` fails the build when the two differ.
 */
export const CREDIT_REASON_WORDING: Record<
  CreditReason,
  { label: string; sentence: string }
> = {
  overbilled_vs_ship: {
    label: "Billed for more than their packing slip shipped",
    sentence: "we were invoiced for more than was delivered",
  },
  qty_short: {
    label: "Billed for more than arrived",
    sentence: "the quantity delivered was short of the quantity invoiced",
  },
  short_shipped: {
    label: "Lost between their warehouse and the door",
    sentence: "part of the order was not delivered",
  },
  // Old rows and unnamed rejections: the door turned it away or found it
  // broken, and the claim does not know which. Said as exactly that — the
  // old "arrived damaged" told a vendor something the house never recorded.
  damaged: {
    label: "Refused or broken at the door",
    sentence: "part of the delivery was refused or arrived broken at the door",
  },
  price_variance: {
    label: "Billed above the agreed price",
    sentence: "the price invoiced differs from the price agreed",
  },
  never_ordered: {
    label: "Billed for something never ordered",
    sentence: "we were invoiced for goods we did not order",
  },
  other: {
    label: "Another reason",
    sentence: "there is a discrepancy on this delivery",
  },
  never_arrived: {
    label: "Paid for, never arrived",
    sentence: "we paid for an order that never arrived",
  },
  wrong_item: {
    label: "Wrong item, refused at the door",
    sentence:
      "part of the delivery was not what we ordered, and we refused it at the door",
  },
  broken: {
    label: "Arrived broken",
    sentence: "part of the delivery arrived broken",
  },
  temperature: {
    label: "Wrong temperature, refused at the door",
    sentence:
      "part of the delivery arrived at the wrong temperature, and we refused it at the door",
  },
};

/** A reason code in the house's words; an unknown code is shown, not hidden. */
export function creditReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "No reason recorded";
  return (
    CREDIT_REASON_WORDING[reason as CreditReason]?.label ??
    `Recorded as “${reason}”`
  );
}

/**
 * The door's refusal reasons (`procurement_receipt_events.refusal_reason`,
 * `DOOR_REFUSAL_REASONS` in receiving.service.ts) as claim reasons. The door
 * says `wrong_wine` because it was built for a wine house; the claim says
 * `wrong_item` because the build scope is every beverage, then food.
 */
export const DOOR_REASON_TO_CREDIT_REASON: Record<string, CreditReason> = {
  wrong_wine: "wrong_item",
  broken_case: "broken",
  temperature: "temperature",
  other: "other",
};

/** One door receipt event, as far as its rejection is concerned. */
export interface DoorRejectionFact {
  outcome: string | null;
  refusal_reason: string | null;
  rejected_qty_bottles?: number | null;
  rejected_qty?: number | null;
}

/**
 * The one reason the door gave for what it turned away on an order, or null
 * when it gave none, or more than one.
 *
 * - `refused` carries the receiver's own reason (wrong item, broken case,
 *   temperature, other). A refusal with no reason is no reason.
 * - `accepted` or `short` with units rejected is the door's broken count —
 *   the only way those outcomes reject anything (DoorModel.doorFacts) — so
 *   it is `broken`.
 * - An event with no outcome predates the door's structured facts: what it
 *   rejected was refused or broken, and nothing says which.
 *
 * Two trucks with two different reasons make one claim with no single
 * reason; it is filed `damaged` ("refused or broken at the door") rather
 * than under whichever truck came first.
 */
export function doorReason(
  events: readonly DoorRejectionFact[],
): CreditReason | null {
  const found = new Set<CreditReason>();
  for (const e of events) {
    const rejected = Number(e.rejected_qty_bottles ?? e.rejected_qty ?? 0);
    if (e.outcome === "refused") {
      const r = e.refusal_reason
        ? DOOR_REASON_TO_CREDIT_REASON[e.refusal_reason]
        : undefined;
      if (!r) return null;
      found.add(r);
    } else if (rejected > 0) {
      if (e.outcome === "accepted" || e.outcome === "short") found.add("broken");
      else return null;
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

export interface Credit {
  state: CreditState;
  claimedAmount: number;
  creditedAmount: number | null;
  creditDocumentId: string | null;
  openedAt: string;
  selfEvidenced: boolean;
  /**
   * The claim's own ISO 4217 code (`procurement_credits.currency`). Optional
   * because `transition` never reads it; `recoveryStatsByCurrency` does.
   */
  currency?: string | null;
}

/**
 * Legal transitions.
 *
 * `promised` deliberately cannot go straight to nothing and cannot be counted:
 * "the rep said he'd credit it next order" is the single most common thing that
 * happens to a beverage claim, and it is neither a settlement nor a refusal. It
 * gets its own state so it can be aged and chased rather than quietly assumed.
 *
 * `credited` is terminal. A settled claim that could be reopened would let the
 * same money be counted twice across periods.
 */
const TRANSITIONS: Record<CreditState, CreditState[]> = {
  open: ["requested", "written_off", "rejected"],
  requested: ["promised", "credited", "rejected", "written_off"],
  promised: ["credited", "rejected", "written_off"],
  credited: [],
  rejected: ["requested", "written_off"],
  written_off: [],
};

export function canTransition(from: CreditState, to: CreditState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionInput {
  to: CreditState;
  creditedAmount?: number | null;
  creditDocumentId?: string | null;
}

export interface TransitionOutcome {
  ok: boolean;
  error?: string;
  next?: Partial<Credit> & { state: CreditState };
}

/**
 * Apply a state change, refusing the ones that would let unverifiable money be
 * reported as recovered.
 */
export function transition(
  credit: Credit,
  input: TransitionInput,
): TransitionOutcome {
  if (credit.state === input.to)
    return { ok: false, error: `Already ${credit.state}.` };

  if (!canTransition(credit.state, input.to))
    return {
      ok: false,
      error: `Cannot move a claim from ${credit.state} to ${input.to}.`,
    };

  if (input.to === "credited") {
    // The proof requirement. Without the credit memo this is a promise, and a
    // promise counted as recovery is exactly the lie this module prevents.
    if (!input.creditDocumentId)
      return {
        ok: false,
        error:
          "A claim can only be marked credited against the credit memo that settles it.",
      };
    if (input.creditedAmount == null || input.creditedAmount < 0)
      return {
        ok: false,
        error:
          "Recording a credit requires the amount the vendor actually allowed.",
      };
    // Over-crediting is legal — vendors round up, or settle two claims on one
    // memo — but it is unusual enough to be worth surfacing rather than
    // silently inflating the recovery figure.
    return {
      ok: true,
      next: {
        state: "credited",
        creditedAmount: input.creditedAmount,
        creditDocumentId: input.creditDocumentId,
      },
    };
  }

  return { ok: true, next: { state: input.to } };
}

/**
 * Verdicts that justify asking a distributor for money back.
 *
 * Which verdicts are claimable is decided ONCE, by isClaimable in invoice-match.
 * This function only names the reason. Restating the list here would give the
 * codebase two answers to "can we claim on this?", and the two would drift —
 * ending with either a claim raised on an unfinished delivery, or a real
 * overbill silently never claimed.
 */
export function reasonForVerdict(
  verdict: MatchVerdict,
  fromDoor: CreditReason | null = null,
): CreditReason | null {
  if (!isClaimable(verdict)) return null;
  switch (verdict) {
    case "overbilled_vs_ship":
      return "overbilled_vs_ship";
    case "qty_short":
      return "qty_short";
    case "short_shipped":
      return "short_shipped";
    case "rejected":
      // The door's own reason when it gave one (W54); `damaged` — "refused
      // or broken at the door" — only when it did not.
      return fromDoor ?? "damaged";
    case "price_variance":
      return "price_variance";
    default:
      return "other";
  }
}

export interface DraftClaim {
  reason: CreditReason;
  claimedAmount: number;
  selfEvidenced: boolean;
  summary: string;
}

/**
 * Turn a match verdict into a claim, or decline to.
 *
 * Returns null when there is nothing to claim OR when the amount cannot be
 * computed. An unpriced discrepancy is real but not yet chargeable, and a claim
 * for $0 in a distributor's inbox costs more credibility than it recovers.
 */
export function draftClaimFromMatch(
  match: MatchResult,
  fromDoor: CreditReason | null = null,
): DraftClaim | null {
  const reason = reasonForVerdict(match.verdict, fromDoor);
  if (!reason) return null;
  if (!match.creditDue) return null;
  if (match.creditAmount == null || match.creditAmount <= 0) return null;

  return {
    reason,
    claimedAmount: match.creditAmount,
    selfEvidenced: match.selfEvidenced,
    summary: match.summary,
  };
}

export interface RecoveryStats {
  /** Settled, evidenced by a credit memo. The only number safe to advertise. */
  recovered: number;
  /** Asked for and not yet settled. Explicitly not recovery. */
  outstanding: number;
  /** A rep said yes. Still not money. */
  promised: number;
  /** Asked for and refused — the honest counterweight to a recovery figure. */
  rejected: number;
  openClaims: number;
  /** Age of the oldest unsettled claim, in days. The manager's real work queue. */
  oldestOpenDays: number | null;
  /**
   * Settled divided by everything that has been claimed and resolved. A vendor
   * whose claims never land is itself the finding, and this is how that shows up.
   */
  settlementRate: number | null;
}

export function recoveryStats(
  credits: Credit[],
  now = new Date(),
): RecoveryStats {
  let recovered = 0;
  let outstanding = 0;
  let promised = 0;
  let rejected = 0;
  let openClaims = 0;
  let oldestOpenMs: number | null = null;

  for (const c of credits) {
    switch (c.state) {
      case "credited":
        // creditedAmount, not claimedAmount. Partial settlement is the norm:
        // claim two broken bottles, the distributor allows one.
        recovered += c.creditedAmount ?? 0;
        break;
      case "promised":
        promised += c.claimedAmount;
        outstanding += c.claimedAmount;
        openClaims++;
        break;
      case "open":
      case "requested":
        outstanding += c.claimedAmount;
        openClaims++;
        break;
      case "rejected":
        rejected += c.claimedAmount;
        break;
      case "written_off":
        break;
    }

    if (["open", "requested", "promised"].includes(c.state)) {
      const age = now.getTime() - new Date(c.openedAt).getTime();
      if (Number.isFinite(age) && (oldestOpenMs == null || age > oldestOpenMs))
        oldestOpenMs = age;
    }
  }

  const resolved = credits.filter((c) =>
    ["credited", "rejected"].includes(c.state),
  );
  const settledCount = resolved.filter((c) => c.state === "credited").length;

  return {
    recovered: round2(recovered),
    outstanding: round2(outstanding),
    promised: round2(promised),
    rejected: round2(rejected),
    openClaims,
    oldestOpenDays:
      oldestOpenMs == null ? null : Math.floor(oldestOpenMs / 86_400_000),
    // Null rather than 0 when nothing has resolved yet: a 0% settlement rate on
    // zero attempts reads as a vendor refusing everything.
    settlementRate: resolved.length
      ? Math.round((settledCount / resolved.length) * 100) / 100
      : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The key a claim with no stated currency is grouped under. Not an ISO 4217
 * code on purpose: a renderer that formats it as money finds no code and says
 * the currency was not recorded, instead of borrowing one.
 */
export const CURRENCY_UNRECORDED = "UNRECORDED";

/**
 * `recoveryStats`, once per currency.
 *
 * `recoveryStats` adds every claim's amount into one figure. A house that
 * claims in two currencies gets a sum of lira and euros printed as if it were
 * one number, and nothing in this system converts (founder, 2026-09-06, batch
 * 63: the house states its currency; nothing is converted). So the figures are
 * also kept apart by the claim's own code, and a screen that has more than one
 * group shows them side by side rather than added up. The combined figures stay
 * where they were for the callers that already read them.
 */
export function recoveryStatsByCurrency(
  credits: Credit[],
  now = new Date(),
): Record<string, RecoveryStats> {
  const groups = new Map<string, Credit[]>();
  for (const c of credits) {
    const code =
      typeof c.currency === "string" && c.currency.trim() !== ""
        ? c.currency.trim().toUpperCase()
        : CURRENCY_UNRECORDED;
    const list = groups.get(code);
    if (list) list.push(c);
    else groups.set(code, [c]);
  }
  const out: Record<string, RecoveryStats> = {};
  for (const [code, list] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    out[code] = recoveryStats(list, now);
  return out;
}
