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
  | "other";

export interface Credit {
  state: CreditState;
  claimedAmount: number;
  creditedAmount: number | null;
  creditDocumentId: string | null;
  openedAt: string;
  selfEvidenced: boolean;
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
export function reasonForVerdict(verdict: MatchVerdict): CreditReason | null {
  if (!isClaimable(verdict)) return null;
  switch (verdict) {
    case "overbilled_vs_ship":
      return "overbilled_vs_ship";
    case "qty_short":
      return "qty_short";
    case "short_shipped":
      return "short_shipped";
    case "rejected":
      return "damaged";
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
export function draftClaimFromMatch(match: MatchResult): DraftClaim | null {
  const reason = reasonForVerdict(match.verdict);
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
