/**
 * Snooze, with the one behaviour that makes snooze safe — and the one
 * sentence that makes it honest.
 *
 * WHY IT WAKES BY ITSELF. Linear has had inbox snooze since 2021, and the
 * detail everyone copies badly is not the timer: "Notifications are
 * automatically un-snoozed if there are new comments or other activity in the
 * issue" (https://linear.app/changelog/2021-06-17-inbox-snooze-and-easier-issue-merge;
 * the same wake-on-activity is written into Triage's snooze,
 * https://linear.app/docs/triage). PagerDuty makes the same argument from the
 * other end: acknowledging an incident "halts the escalation process", but
 * "when the acknowledgement timeout is reached, the incident returns to
 * triggered status" (https://support.pagerduty.com/main/docs/incidents). A
 * pause that cannot expire is not a pause, it is a deletion the reader did not
 * mean to perform. So a line asleep here wakes on EITHER edge: its own
 * deadline, or the register writing about it again.
 *
 * WHY IT IS PER BROWSER, AND WHY THAT IS SAID OUT LOUD. `public.notifications`
 * has no snooze column — `id, restaurant_id, recipient_id, notification_type,
 * title, message, priority, channels, sent_at, delivered_at, read_at,
 * delivery_status, actions, responded_at, response_action, response_data,
 * related_entity_type, related_entity_id, notification_group, batch_id,
 * created_at, user_id, type, status, action_url, action_label, metadata,
 * archived_at, group_key` and nothing else
 * (`supabase/migrations/20260805000000_baseline_from_production.sql`). Adding
 * one is a migration, which this pass is not allowed to write, so the state
 * lives in `localStorage` and every surface that shows it says the server was
 * not told. `/recommendations` already has the server-side version of this
 * (`analytics/recommendation-actions.service.ts:109-116` wakes an expired
 * `snooze_until` on read) — that is the shape the column should copy, and it
 * is filed in the page note §13.
 *
 * Nothing here writes to the network. Nothing here hides a line the reader has
 * not personally put to sleep.
 */

export type WakeReason = 'deadline' | 'activity' | 'settled';

export interface SnoozeRecord {
  id: string;
  /** Epoch ms after which the line comes back on its own. */
  until: number;
  /** The row's own stamp when it was put down — newer means new activity. */
  seenAt: number;
  /** Folded duplicates at that moment — more means the alert repeated. */
  seenFolded: number;
}

/** What the page needs to know about one row, to decide if it may sleep. */
export interface SleepCandidate {
  id: string;
  /** `timestamp ?? createdAt`, in epoch ms; 0 when the row has no stamp. */
  stampedAt: number;
  folded: number;
  /** Anything other than `unread` means it has been dealt with. */
  unread: boolean;
}

export interface SnoozeVerdict {
  /** Ids still asleep — the page hides exactly these and nothing else. */
  asleep: Set<string>;
  /** Ids that woke this pass, and why. Rendered as a sentence, not a badge. */
  woke: Array<{ id: string; reason: WakeReason }>;
  /** Records worth keeping in storage after this pass. */
  keep: SnoozeRecord[];
}

/**
 * A record is only ever kept while its line is genuinely still asleep, so the
 * store cannot grow without bound: the deadline drops it even when its row is
 * on a page nobody has read. That is deliberate — the alternative, keeping a
 * record alive "until the row comes back", is how a browser ends up holding
 * ids for notifications that were deleted months ago.
 */

export const DURATIONS: Array<{ key: string; label: string; ms: number }> = [
  { key: 'hour', label: 'an hour', ms: 60 * 60 * 1000 },
  { key: 'shift', label: 'after service', ms: 8 * 60 * 60 * 1000 },
  { key: 'tomorrow', label: 'tomorrow', ms: 24 * 60 * 60 * 1000 },
  { key: 'week', label: 'next week', ms: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Decide which snoozed lines are still asleep.
 *
 * `rows` is the book as it was just read. A row that is missing from it is
 * neither woken nor forgotten: it may simply be on a page nobody asked for.
 */
export function resolveSnoozes(
  records: SnoozeRecord[],
  rows: SleepCandidate[],
  now: number = Date.now(),
): SnoozeVerdict {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const asleep = new Set<string>();
  const woke: Array<{ id: string; reason: WakeReason }> = [];
  const keep: SnoozeRecord[] = [];

  for (const rec of records) {
    const row = byId.get(rec.id);

    // Ruled off, archived or deleted while it slept: the record has done its
    // job. Reported only when the line is on screen, because a reader cannot
    // be told "this came back" about something they cannot see.
    if (row && !row.unread) {
      woke.push({ id: rec.id, reason: 'settled' });
      continue;
    }

    // The register wrote about this again — a newer line, or one more folded
    // repeat. Linear's rule, and the reason a snooze cannot bury a situation
    // that is getting worse.
    if (row && (row.stampedAt > rec.seenAt || row.folded > rec.seenFolded)) {
      woke.push({ id: rec.id, reason: 'activity' });
      continue;
    }

    if (now >= rec.until) {
      if (row) woke.push({ id: rec.id, reason: 'deadline' });
      continue;
    }

    // Still asleep. An id whose row is not on any page read so far is kept in
    // both sets: it hides nothing today, and it is still down when the reader
    // pages back to it.
    asleep.add(rec.id);
    keep.push(rec);
  }

  return { asleep, woke, keep };
}

/** "asleep for another 3h 20m" — an unknown deadline is never guessed. */
export function sleepsFor(until: number, now: number = Date.now()): string {
  const ms = until - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'due back now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.round(h / 24)}d`;
}
