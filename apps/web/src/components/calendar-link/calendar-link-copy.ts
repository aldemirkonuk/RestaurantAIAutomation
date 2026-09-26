/**
 * The words every calendar-link surface uses for the founder's round-6t
 * answers (ADR 0111, review trail 2026-09-21), in one place so no surface
 * drifts from another. Kept out of `useMyCalendarLink.ts` so a spec that
 * stubs the hook still renders the real sentences.
 */

/**
 * The founder, 2026-09-21 (round 6t): "Show once (Recommended)". The gateway
 * keeps only a hash, so the address cannot be shown again; every surface says
 * so in these same words, and says what "Get a new link" does about it.
 */
export const SHOWN_ONCE =
  'Your address is shown only once, when it is made. If you lose it, “Get a new link” makes a new address, and the old one stops working.';

/**
 * The founder, 2026-09-21 (round 6t): "Everyone can narrow (Recommended)". A
 * pick only ever shows less than the person's role allows, never more.
 */
export const NARROW_ONLY =
  'Picking narrows your link. It can only show less than you may see here, never more.';

/**
 * The founder, 2026-09-21 (round 6t): "Yes, revoke on leaving (Recommended)".
 * Leaving ends the link itself, not only what it shows, so coming back means
 * connecting again.
 */
export const ON_LEAVING =
  'If you leave this house your link stops for good, and nobody else’s changes. If you come back, you connect again.';
