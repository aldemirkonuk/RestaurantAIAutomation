/**
 * Whether a person's own settings let a phone push through, right now.
 *
 * WHY THIS EXISTS (QA round 4, B1, 2026-11-07)
 * --------------------------------------------
 * The alert funnel (`NotificationsService.persistForRestaurant`) pushed every
 * non-low notification to every addressed member's phone and read no
 * preference: a GM with quiet hours 22:00-08:00 and push switched off was still
 * buzzed at 2am by a medium supplier notice. The two readers that did honour
 * quiet hours (the recommendation digest and calendar reminders) each read the
 * row themselves; the phone leg read nothing.
 *
 * THE RULE, in the words the settings page already gives (NotifySection.tsx,
 * "Quiet hours"): inside the window everything below critical is DROPPED, not
 * delayed, and critical still goes out. That is the alerting agent's rule
 * (`notification_agent.py` `_select_channels`) and this gate keeps it. Nothing
 * is lost by the drop: the inbox row is written before the push leg runs.
 *
 * The RULE is shared; the CLOCK is not. This gate reads the window on the
 * house's clock (below). The agent's `_is_quiet_hours` reads it on
 * `datetime.now()`, the server process's clock (`notification_agent.py:1539`),
 * so for a house outside the server's zone the agent's 22:00-08:00 falls at
 * other local hours. That divergence is already on record (ADR 0109, "Quiet
 * hours are evaluated on the restaurant's clock"; 06-pages/calendar.md §9
 * item 2) and is not closed here.
 *
 * `push_enabled = false` holds EVERY push, critical included: the person
 * switched the phone door off, and the inbox still carries the alert. Only a
 * literal `false` is an opt-out — no row, or a row that never set it, means
 * push (`team/broadcast-preferences.ts` `channelAllowed`, the same reading).
 *
 * The window is read on the HOUSE's clock (`restaurants.timezone`, else the
 * country's only zone — `common/house-frame.ts`), never guessed as UTC.
 *
 * WHEN IT CANNOT BE JUDGED, THE PUSH GOES OUT, and the report says so. A
 * preferences read that fails, or a house whose zone is unknown or unreadable,
 * pushes as the funnel did before it read anything. That is the founder's one
 * ruling on this exact question (ADR 0281, fork 1, 2026-10-05: "Push anyway
 * (Recommended)" — "a failed settings read should not turn into silence"),
 * given for the refused-checks note, which sends through this same funnel and
 * must keep it. Applying it funnel-wide is the session's call under the
 * 2026-11-07 /goal: one funnel, one failure rule, and no producer whose own
 * reading the funnel quietly overturns. The team broadcast fails the other way
 * (`team.controller.ts`) and does not come through here.
 */

import {
  isWithinQuietHours,
  type QuietHours,
} from "../calendar/reminder-window";

export interface PushPreference {
  pushEnabled: boolean;
  quiet: QuietHours;
}

/** Why a push was not sent to one person. */
export type PushHold = "push_off" | "quiet_hours";

/**
 * A row as `NotificationsService.mapPreferencesRow` reads it: the same
 * defaults (push on, quiet hours off, 22:00-08:00), so one row never means two
 * things depending on which reader looks at it.
 */
export function pushPreferenceFromRow(row: any): PushPreference {
  return {
    pushEnabled: row?.push_enabled !== false,
    quiet: {
      enabled: row?.quiet_hours_enabled === true,
      start: row?.quiet_hours_start || "22:00",
      end: row?.quiet_hours_end || "08:00",
    },
  };
}

/**
 * Null means send. `timeZone` null means the house clock is unknown, so the
 * window is not judged (fork 1 above). A person with no preference row has
 * opted out of nothing.
 */
export function pushHoldFor(
  pref: PushPreference | undefined,
  now: Date,
  timeZone: string | null,
  critical: boolean,
): PushHold | null {
  if (!pref) return null;
  if (!pref.pushEnabled) return "push_off";
  if (critical || !pref.quiet.enabled || timeZone === null) return null;
  return isWithinQuietHours(now, timeZone, pref.quiet) ? "quiet_hours" : null;
}

/** The sentence a surface prints for what the gate held back. */
export function heldSentence(held: Record<PushHold, string[]>): string {
  const parts: string[] = [];
  if (held.push_off.length)
    parts.push(`${held.push_off.length} switched push off`);
  if (held.quiet_hours.length)
    parts.push(`${held.quiet_hours.length} inside their quiet hours`);
  return parts.length ? `Not pushed to ${parts.join(", ")}.` : "";
}
