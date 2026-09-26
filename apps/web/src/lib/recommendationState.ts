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
 * The dismissal labels — the gateway's closed set, in its order
 * (`apps/api-gateway/src/analytics/insights/item-state.ts` DISMISS_REASONS).
 * "The reason is a labelled signal": every door that dismisses for the
 * house asks for one of these, and the gateway refuses anything else. Two,
 * since ADR 0191 round 3 — see `DISMISS_CHOICES` for what became of the
 * other two. A vocabulary, not tenant data (`scripts/check_no_seeded_defaults.py` S1).
 */
export const DISMISS_REASONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'not_relevant', label: 'Not relevant' },
  { id: 'disagree', label: 'I disagree' },
];

/** What a choice in the dismiss list actually records. */
export type ChoiceRecords = 'dismissed' | 'done' | 'snoozed_for_you';

export type DismissChoiceId = 'not_relevant' | 'already_handled' | 'disagree' | 'not_now';

/**
 * The dismiss list a person sees — the same four choices as before, but two
 * of them are not dismissals any more (ADR 0191 round 3, founder 2026-09-21):
 *
 *   - "Already handled" is recorded as DONE — completion, no negative
 *     signal — not as a dismissal (answer 3);
 *   - "Not right now" hides the card from the person who pressed it, alone,
 *     until tomorrow; everyone else still sees it (answer 4, "Only them").
 *
 * `note` is what the list says under the choice, so nobody picks a label
 * believing it does something else.
 */
export const DISMISS_CHOICES: ReadonlyArray<{
  id: DismissChoiceId;
  label: string;
  records: ChoiceRecords;
  note: string;
}> = [
  {
    id: 'not_relevant',
    label: 'Not relevant',
    records: 'dismissed',
    note: 'Dismissed for the house, with this reason.',
  },
  {
    id: 'already_handled',
    label: 'Already handled',
    records: 'done',
    note: 'Recorded as done, not as a dismissal.',
  },
  {
    id: 'disagree',
    label: 'I disagree',
    records: 'dismissed',
    note: 'Dismissed for the house, with this reason.',
  },
  {
    id: 'not_now',
    label: 'Not right now',
    records: 'snoozed_for_you',
    note: 'Hidden from you alone until tomorrow. Everyone else still sees it.',
  },
];

/**
 * How long "Not right now" hides a card from you: until tomorrow, the
 * shortest snooze the product offers. The gateway uses the same day when a
 * client sends no instant (`NOT_NOW_DEFAULT_MS`).
 */
export const NOT_NOW_DAYS = 1;

/** What a surface says after a dismiss-list choice landed. */
export function choiceSaid(id: DismissChoiceId): string {
  if (id === 'already_handled') return 'Recorded as done';
  if (id === 'not_now') return 'Hidden from you until tomorrow';
  return 'Insight dismissed';
}

/**
 * Undo a dismiss-list choice: "Not right now" was this person's own snooze,
 * so it is woken (`POST …/snoozed-for-me/wake`); a dismissal or a done goes
 * back to the house's active state, which is kept in the history as a
 * restore. The path and body, never the call — each surface posts it.
 */
export function undoOf(
  restaurantId: string,
  key: string,
  id: DismissChoiceId,
): { path: string; body: Record<string, unknown> } {
  return id === 'not_now'
    ? {
        path: `/analytics/recommendations/${restaurantId}/snoozed-for-me/wake`,
        body: { ruleKey: key },
      }
    : {
        path: `/analytics/recommendations/${restaurantId}/action`,
        body: { ruleKey: key, status: 'active' },
      };
}

/** The body a dismiss-list choice posts — the act it means, not its label. */
export function patchForChoice(
  id: DismissChoiceId,
  now: number = Date.now(),
): Record<string, unknown> {
  if (id === 'already_handled') return { status: 'done' };
  if (id === 'not_now')
    return {
      status: 'snoozed',
      snoozeFor: 'me',
      snoozeUntil: new Date(now + NOT_NOW_DAYS * 86_400_000).toISOString(),
    };
  return { status: 'dismissed', reason: id };
}

/**
 * Who acts FOR the house on its cards — owners and managers, the gateway's
 * `mayActForTheHouse`. Not the platform `admin` (ADR 0191 round 4, answer 7:
 * the platform admin never acts for a house's cards unless an owner or
 * manager of that house — and then the token reads that role, not `admin`).
 * The gateway decides; the page only stops offering what it would refuse.
 */
export function mayActForTheHouse(role: string | null | undefined): boolean {
  const r = role ? String(role).toLowerCase() : '';
  return r === 'owner' || r === 'manager';
}

/**
 * Who may snooze a card for everyone — owners and managers (round 3, answer
 * 4; round 4 took `admin` out). Anyone else's snooze hides the card from them
 * alone.
 */
export function maySnoozeForEveryone(role: string | null | undefined): boolean {
  return mayActForTheHouse(role);
}

/**
 * The gateway's word for a refused undo of someone else's act (round 4,
 * answer 5): staff undo only their own acts; owners and managers anyone's.
 */
export const NOT_YOUR_ACT = 'not_your_act';

/** The page's sentence when a return to the book is not this person's to make. */
export const NOT_YOUR_ACT_SAID =
  'Only the person who did this, or an owner or manager, can undo it.';

/**
 * Whether a refused write was the not-your-act refusal, and the gateway's
 * own sentence for it when it sent one (it words the unnamed-author case
 * differently). Null when the refusal was something else.
 */
export function notYourActOf(err: unknown): string | null {
  const data = (err as { response?: { data?: { code?: unknown; message?: unknown } } } | null)
    ?.response?.data;
  if (!data || data.code !== NOT_YOUR_ACT) return null;
  return typeof data.message === 'string' && data.message ? data.message : NOT_YOUR_ACT_SAID;
}

/**
 * The page's sentence when a note (pin, rating, assignment) is not this
 * person's to change — ADR 0191 round 5, answer 2 ("Gate like acts"): staff
 * change or clear only their own note; owners and managers anyone's; the
 * platform admin none.
 */
export const NOT_YOUR_NOTE_SAID =
  'Only the person who made this note, or an owner or manager, can change or clear it.';

/**
 * A refused note change, in the gateway's own sentence: `not_your_note` for
 * someone else's note, or the platform admin's refusal, which carries no
 * code. Never a whole-house dismiss sentence — a pin is not a dismissal.
 */
export function noteRefusalOf(err: unknown): string {
  const data = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data;
  return typeof data?.message === 'string' && data.message ? data.message : NOT_YOUR_NOTE_SAID;
}

/**
 * The receipts a state write returns, said as one line when one of them
 * missed: the house log (a whole-rule act, or — round 5 — a note change,
 * `noteAudit`) or the append-only history (every dismiss, restore, done and
 * snooze for the house — "Keep every label"). Null when nothing missed.
 */
export function paperMissOf(data: unknown): string | null {
  const d = data as {
    audit?: { recorded?: unknown; reason?: unknown } | null;
    noteAudit?: { recorded?: unknown; reason?: unknown } | null;
    history?: { recorded?: unknown; reason?: unknown } | null;
  } | null;
  const miss = (r: { recorded?: unknown; reason?: unknown } | null | undefined) =>
    r && r.recorded === false
      ? typeof r.reason === 'string' && r.reason
        ? r.reason
        : 'no reason given'
      : null;
  const a = miss(d?.audit) ?? miss(d?.noteAudit);
  const h = miss(d?.history);
  if (a && h) return `not written to the house log (${a}) or the history (${h})`;
  if (a) return `not written to the house log (${a})`;
  if (h) return `not kept in the history (${h})`;
  return null;
}

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
