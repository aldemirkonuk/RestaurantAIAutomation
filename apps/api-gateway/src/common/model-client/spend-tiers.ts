/**
 * Per-tier model-spend allowances.
 *
 * PLACEHOLDER NUMBERS, deliberately. Pricing itself is founder-deferred (OD-23) and
 * no ADR records a price. These figures were set by the founder on 2026-08-24 purely
 * so the ceiling is *safe by default* while the product is exercised — they are not a
 * pricing decision and must not be cited as one.
 *
 * The important distinction is the MODE, not the number:
 *
 *   core  — a $5 CREDIT that depletes and does not reset. It exists so a new member
 *           can upload their menu and try the features. Once spent, it is spent; that
 *           is what makes it a trial rather than a free tier.
 *   plus  — $5 per UTC day, resets daily.
 *   pro   — $10 per UTC day, resets daily.
 *
 * A credit and a daily ceiling are different questions asked of the ledger — lifetime
 * sum versus today's sum — so the mode drives the query window, not just the figure.
 *
 * Unknown or unmapped tiers (including the current live default `pilot`) resolve to
 * CORE. That is the conservative direction: a tier we do not recognise gets the
 * smallest allowance, never the largest.
 */

export type SpendMode = "credit" | "daily";

export interface TierAllowance {
  /** Ceiling in USD. */
  readonly limitUsd: number;
  /** `credit` sums all time; `daily` sums the current UTC day. */
  readonly mode: SpendMode;
  /** Shown in logs so an operator can see which rule bit. */
  readonly label: string;
}

const CORE: TierAllowance = {
  limitUsd: 5.0,
  mode: "credit",
  label: "core ($5 one-time credit — menu upload + trial)",
};

export const TIER_ALLOWANCES: Readonly<Record<string, TierAllowance>> = {
  core: CORE,
  // Live default today. Treated as core until a real tier is assigned.
  pilot: { ...CORE, label: "pilot → core ($5 one-time credit)" },
  free: { ...CORE, label: "free → core ($5 one-time credit)" },
  plus: { limitUsd: 5.0, mode: "daily", label: "plus ($5/day)" },
  pro: { limitUsd: 10.0, mode: "daily", label: "pro ($10/day)" },
};

/**
 * Resolve a tier string to its allowance. Never throws, never returns undefined:
 * an unrecognised tier is a reason to be *more* careful, not less.
 */
export function allowanceForTier(tier?: string | null): TierAllowance {
  if (!tier) return CORE;
  return TIER_ALLOWANCES[tier.trim().toLowerCase()] ?? CORE;
}

/**
 * Window start for the ledger query implied by the mode.
 * `credit` → null (sum all time). `daily` → today at 00:00 UTC.
 */
export function windowStartIso(mode: SpendMode): string | null {
  if (mode === "credit") return null;
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
