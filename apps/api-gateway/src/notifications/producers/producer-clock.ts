/**
 * Where a producer gets "now" from.
 *
 * THE DEFECT THIS FILE EXISTS FOR (2026-09-04).
 * `ProducerLedgerService.claim` stamped `claimed_at` with `new Date()` — the
 * real wall clock — while `claimedKeysSince` filtered that column against a
 * window the CALLER derived from its own `now`. In production the two agree,
 * because the orchestrator's `now` is the wall clock. In a spec they do not,
 * and the disagreement is silent until the machine date happens to cross the
 * window's edge:
 *
 *   market-price.producer.spec.ts fixes NOW at 2026-09-03T14:00Z and sweeps a
 *   third time at NOW + 8 days, expecting the 7-day suppression to have lapsed.
 *   The claim written by sweep one carried the REAL date. While the real date
 *   was 2026-09-03 that fell before the window (2026-09-04T14:00Z) and the
 *   third sweep wrote. On 2026-09-04 the same claim fell INSIDE the window, the
 *   sweep suppressed, and a test that had passed for a day went red having
 *   changed nothing. It was measuring the calendar.
 *
 * A test whose outcome depends on the machine date is not a test of the code.
 * So every instant a producer stamps or compares now comes from one of two
 * places, and both are injectable:
 *
 *   1. **The sweep's own `now`**, threaded through `EmitContext.now`. This is
 *      the authoritative one wherever it exists, because a claim's timestamp
 *      should be the instant the sweep is operating at — the same instant its
 *      suppression window is derived from. Like compared with like.
 *   2. **This clock**, for the stamps that have no sweep instant to hand (the
 *      delivery confirmation, the run row's `finished_at`). Injected, so a spec
 *      can fix it; defaulting to the wall clock, so production is unchanged.
 *
 * The token is `@Optional()` at every injection site on purpose: seven
 * producers and their specs construct `ProducerLedgerService` directly, and a
 * required constructor argument would have made this fix a rewrite of files it
 * has no business touching.
 */

export interface ProducerClock {
  now(): Date;
}

/** Nest injection token. Optional everywhere; absent means the wall clock. */
export const PRODUCER_CLOCK = "PRODUCER_CLOCK";

/** What production uses, and what an absent injection falls back to. */
export const SYSTEM_CLOCK: ProducerClock = {
  now: () => new Date(),
};

/**
 * A clock pinned to one instant, for specs.
 *
 * `advanceTo` exists because a sweep sequence is a sequence of instants: the
 * market spec sweeps at NOW, NOW+3d and NOW+8d, and each sweep's claim must be
 * stamped at ITS instant, not at the first one.
 */
export function fixedClock(at: Date): ProducerClock & { advanceTo(d: Date): void } {
  let current = new Date(at.getTime());
  return {
    now: () => new Date(current.getTime()),
    advanceTo(d: Date) {
      current = new Date(d.getTime());
    },
  };
}
