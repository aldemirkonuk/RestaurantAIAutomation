import { isWithinQuietHours } from "../calendar/reminder-window";
import { houseFrame } from "../common/house-frame";

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
 * whatever the funnel does.
 *
 * A person with no preferences row is pushed (Push defaults on, quiet hours
 * off). When the preferences cannot be read, nobody is held, as before this
 * was read, and `warn` says so. A house with no time zone of its own is read
 * on its country's clock when the country keeps just one, otherwise in UTC
 * (F-868): the same rule Settings states and the calendar reminders keep, so
 * a window someone set still holds. Only when the house row cannot be read
 * are quiet hours not judged; the Push switch still is.
 */
export async function pushHolds(
  supabase: any,
  restaurantId: string,
  ids: string[],
  warn: (line: string) => void,
  now: Date = new Date(),
): Promise<Map<string, PushHoldReason>> {
  const held = new Map<string, PushHoldReason>();
  if (ids.length === 0) return held;
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
    return held;
  }
  let zone: string | null = null;
  try {
    const { data, error } = await supabase
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    zone = houseFrame(data ?? null).zone ?? "UTC";
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
      held.set(row.user_id, "quiet_hours");
    }
  }
  return held;
}
