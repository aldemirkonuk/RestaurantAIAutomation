/**
 * Priority scoring (D4) — combine relevance × savings × urgency × trust into a notification
 * loudness bucket: interrupt / surface / digest. `interrupt` is intentionally strict (relevant
 * AND (valuable OR urgent) AND trusted) so we only break the manager's focus for offers that
 * actually matter — everything else surfaces quietly or lands in a digest. Pure + testable.
 */

export type PriorityBucket = "interrupt" | "surface" | "digest";

export interface PrioritySignals {
  /** How relevant to what we actually buy (0..1). */
  relevance: number;
  /** Normalized savings vs our target / market (0..1). */
  savings: number;
  /** Time pressure — expiring soon / limited / allocation (0..1). */
  urgency: number;
  /** Sender/vendor reputation (0..1). */
  trust: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function computePriority(raw: Partial<PrioritySignals>): {
  score: number;
  bucket: PriorityBucket;
  signals: PrioritySignals;
} {
  const s: PrioritySignals = {
    relevance: clamp01(raw.relevance ?? 0),
    savings: clamp01(raw.savings ?? 0),
    urgency: clamp01(raw.urgency ?? 0),
    trust: clamp01(raw.trust ?? 0.5),
  };
  const score =
    Math.round(
      (0.35 * s.relevance +
        0.3 * s.savings +
        0.2 * s.urgency +
        0.15 * s.trust) *
        100,
    ) / 100;

  const relevant = s.relevance >= 0.5;
  const valuableOrUrgent = s.savings >= 0.5 || s.urgency >= 0.6;
  const trusted = s.trust >= 0.5;

  let bucket: PriorityBucket = "digest";
  if (relevant && valuableOrUrgent && trusted) bucket = "interrupt";
  else if (relevant || s.urgency >= 0.6 || score >= 0.45) bucket = "surface";

  return { score, bucket, signals: s };
}
