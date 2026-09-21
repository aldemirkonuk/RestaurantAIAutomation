/**
 * The shared per-item state, as the web sees it (ADR 0191; founder,
 * 2026-09-21: "Build it right, in order" — one state, dismissed with a
 * reason / snoozed-until / done, that the feed, the catalogue, Reports and
 * the rails all read).
 *
 * The gateway resolves the state and withholds what it hides, on the live
 * compute AND the stored read (`insight-generator.service.ts`
 * `withholdByState`). No surface filters by it again: before this, the
 * rails and the Reports panel filtered client-side on a key they built
 * themselves — `insight:<candidate>:<entity>` — which nothing server-side
 * ever wrote or matched, so a dismissal from a rail held on that rail and
 * nowhere else. A surface now only needs the key an act on an item goes to,
 * and the gateway sends it with every row.
 */

/**
 * The dismissal reasons — the gateway's closed label set, in its order
 * (`apps/api-gateway/src/analytics/insights/item-state.ts` DISMISS_REASONS).
 * "The reason is a labelled signal": every door that dismisses asks for one
 * of these, and the gateway refuses anything else. A vocabulary, not tenant
 * data (`scripts/check_no_seeded_defaults.py` S1).
 */
export const DISMISS_REASONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'not_relevant', label: 'Not relevant' },
  { id: 'already_handled', label: 'Already handled' },
  { id: 'disagree', label: 'I disagree' },
  { id: 'not_now', label: 'Not right now' },
];

export interface InsightActKey {
  /** The key a one-item act writes — the gateway's `suppression.key`. */
  key: string;
  /**
   * True when that key is the whole rule or catalogue type (no subject, no
   * period): acting on "this one" would act on all of them, which is the
   * catalogue's On/Off and an owner/manager act, so a one-item surface does
   * not offer it.
   */
  ruleWide: boolean;
}

/**
 * The act key an insight row carries, or null when it carries none — then
 * the row is shown and never acted on, rather than acted on at a key this
 * page made up.
 */
export function insightActKey(row: unknown): InsightActKey | null {
  const s = (row as { suppression?: { key?: unknown; keys?: { rule?: unknown } } } | null)
    ?.suppression;
  if (!s || typeof s.key !== 'string' || !s.key) return null;
  const rule = typeof s.keys?.rule === 'string' ? s.keys.rule : null;
  return { key: s.key, ruleWide: rule === null ? !s.key.includes('#') : s.key === rule };
}
