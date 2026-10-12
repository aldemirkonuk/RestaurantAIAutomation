import { isWithinQuietHours } from "../calendar/reminder-window";
import { houseClock } from "../common/house-clock";

/** Why a person's phone or browser stays quiet for a push right now. */
export type PushHoldReason = "push_off" | "quiet_hours";

/**
 * Who among `ids` must NOT get a push right now, and why (F-539): someone
 * whose Push switch is off (`push_enabled`), or someone inside their quiet
 * hours, read on the house's own clock with the same half-open window the
 * calendar reminders and the producer ledger use (`isWithinQuietHours`).
 *
 * The one rule for every push: the restaurant funnel's push leg (F-528,
 * `persistForRestaurant`) and `sendToUser` both call this (F-835). Priority
 * is not read: whether quiet hours should let a
 * critical push through is an open founder question (F-540), and this keeps
 * whatever the funnel does. A push the team sends one another reads
 * `teamPushHolds` instead (the founder's F-540 ruling, 2026-10-11).
 *
 * A person with no preferences row is pushed (Push defaults on, quiet hours
 * off). When the preferences cannot be read, nobody is held, as before this
 * was read, and `warn` says so. A house with no time zone of its own is read
 * on its country's clock when the country keeps just one, otherwise in UTC
 * (F-868): `houseClock`, the rule Settings states and every quiet-hours sender
 * keeps (F-1339), so a window someone set still holds. Only when the house row cannot be read
 * are quiet hours not judged; the Push switch still is.
 */
export async function pushHolds(
  supabase: any,
  restaurantId: string,
  ids: string[],
  warn: (line: string) => void,
  now: Date = new Date(),
): Promise<Map<string, PushHoldReason>> {
  return (await readHolds(supabase, restaurantId, ids, warn, now, true)).held;
}

/** What a team push is and who sent it, for the quiet-hours log line. */
export interface TeamPushSend {
  /** The push's kind, e.g. `team_broadcast`, `shift_offer`. */
  what: string;
  /** The person who sent it; `null` when no one person did. */
  by: string | null;
}

/**
 * Who among `ids` must NOT get a TEAM push right now: only someone whose Push
 * switch is off. A push the team sends one another (a broadcast, a shift
 * offer, a call-out's cover) may reach a person inside their quiet hours:
 * work overloads and people catch up out of hours (the founder's F-540
 * ruling, 2026-10-11, F-1340). It is allowed because it is seen: every person
 * pushed inside their window gets one `TEAM_PUSH_IN_QUIET_HOURS` line on
 * `note`, naming the house, the person, the sender, the push and the time,
 * and the push gets ONE `system_audit_log` row (`message_sent_in_quiet_hours`,
 * ADR 0332 §3) so the owner sees it on /logs, not only in server output
 * (F-1463). Settings › Quiet hours says team messages can still arrive. A crew
 * note written now reads this too (F-1340); its Away release keeps `pushHolds`
 * (ADR 0218). The "someone left" push reads this too (F-1490).
 */
export async function teamPushHolds(
  supabase: any,
  restaurantId: string,
  ids: string[],
  sent: TeamPushSend,
  log: { warn: (line: string) => void; note: (line: string) => void },
  now: Date = new Date(),
): Promise<TeamPushHolds> {
  const { held, quiet } = await readHolds(
    supabase,
    restaurantId,
    ids,
    log.warn,
    now,
    false,
  );
  for (const id of quiet) {
    log.note(
      `TEAM_PUSH_IN_QUIET_HOURS restaurant=${restaurantId} to=${id} by=${sent.by ?? "nobody (the system)"} what=${sent.what} at=${now.toISOString()} — sent during quiet hours: a team push may arrive inside quiet hours (F-540).`,
    );
  }
  // F-1510: the /logs row waits for the send's outcome. Written here, before
  // the caller pushed, it said "was sent" when no phone was registered or the
  // device read failed, and nothing went.
  return Object.assign(held, {
    afterSend: async (result: { outcome: string } | null | undefined) => {
      if (quiet.length > 0 && result?.outcome === "accepted_by_service")
        await logQuietHoursSend(
          supabase,
          restaurantId,
          quiet,
          sent,
          log.warn,
          now,
        );
    },
  });
}

/**
 * Who is held from a team push (Push off), plus `afterSend`: call it with
 * `sendToUsers`' outcome once the push was tried, and the quiet-hours /logs row
 * is filed only when the push actually went (F-1510). Not calling it, or
 * calling it with nothing, files no row: nothing was sent.
 */
export type TeamPushHolds = Map<string, PushHoldReason> & {
  afterSend: (result: { outcome: string } | null | undefined) => Promise<void>;
};

/** The push's kind in the owner's words, for the /logs line. */
const TEAM_PUSH_WORDS: Record<string, string> = {
  team_broadcast: "A team message",
  shift_offer: "A shift offer",
  shift_callout: "A call for cover",
  team_member_left: "A note that someone left the team",
  team_note: "A team note",
};

/**
 * One `system_audit_log` row for a team push that reached people inside their
 * quiet hours (ADR 0332 §3, F-1463): the sender as actor, the house, and the
 * people inside their window by user id. /logs reads this table, so the row
 * reads there as "Ayşe: message sent in quiet hours — A shift offer was sent
 * to 2 people inside their quiet hours". Filed only after the push service
 * took the push (`afterSend`, F-1510). Never throws: the push still goes,
 * and a row that failed is said on `warn`, with the stdout line above as the
 * fallback record.
 */
async function logQuietHoursSend(
  supabase: any,
  restaurantId: string,
  quiet: string[],
  sent: TeamPushSend,
  warn: (line: string) => void,
  now: Date,
): Promise<void> {
  const kind = TEAM_PUSH_WORDS[sent.what] ?? "A team message";
  const people = quiet.length === 1 ? "1 person" : `${quiet.length} people`;
  try {
    const { error } = await supabase.from("system_audit_log").insert({
      actor_type: sent.by ? "user" : "system",
      actor_id: sent.by,
      action: "message_sent_in_quiet_hours",
      entity_type: "team_push",
      entity_id: null,
      changes: {
        subject: `${kind} was sent to ${people} inside their quiet hours`,
        what: sent.what,
        recipients: quiet,
        sent_at: now.toISOString(),
      },
      restaurant_id: restaurantId,
      reason: null,
    });
    if (error) throw new Error(error.message);
  } catch (e: any) {
    warn(
      `TEAM_PUSH_QUIET_HOURS_UNLOGGED restaurant=${restaurantId} what=${sent.what} — ${e?.message}. The push went; only the server output above records it.`,
    );
  }
}

async function readHolds(
  supabase: any,
  restaurantId: string,
  ids: string[],
  warn: (line: string) => void,
  now: Date,
  quietHolds: boolean,
): Promise<{ held: Map<string, PushHoldReason>; quiet: string[] }> {
  const held = new Map<string, PushHoldReason>();
  const quiet: string[] = [];
  if (ids.length === 0) return { held, quiet };
  let prefs: any[];
  try {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select(
        "user_id, push_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
      )
      .eq("restaurant_id", restaurantId)
      .in("user_id", ids);
    if (error) throw new Error(error.message);
    prefs = Array.isArray(data) ? data : [];
  } catch (e: any) {
    warn(
      `PUSH_PREFERENCES_UNREAD restaurant=${restaurantId} — ${e?.message}. Everyone addressed is pushed, as before quiet hours were read.`,
    );
    return { held, quiet };
  }
  let zone: string | null = null;
  try {
    const { data, error } = await supabase
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    zone = houseClock(data ?? null).zone;
  } catch (e: any) {
    warn(
      `PUSH_HOUSE_ZONE_UNREAD restaurant=${restaurantId} — ${e?.message}. Quiet hours are not judged on this push.`,
    );
  }
  for (const row of prefs) {
    if (!ids.includes(row?.user_id)) continue;
    if (row.push_enabled === false) {
      held.set(row.user_id, "push_off");
      continue;
    }
    if (
      zone &&
      isWithinQuietHours(now, zone, {
        enabled: row.quiet_hours_enabled === true,
        start: row.quiet_hours_start || "22:00",
        end: row.quiet_hours_end || "08:00",
      })
    ) {
      if (quietHolds) held.set(row.user_id, "quiet_hours");
      else quiet.push(row.user_id);
    }
  }
  return { held, quiet };
}
