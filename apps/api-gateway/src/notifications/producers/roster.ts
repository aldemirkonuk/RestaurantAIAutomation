import type { Logger } from "@nestjs/common";
import { candidateShiftDates, onShiftAt } from "./shift-window";

/**
 * Who the schedule says was working at an instant, with names resolved.
 *
 * Extracted from `goal-reached.producer.ts` when the ceiling producer landed
 * (2026-09-03) and needed the same answer: two copies of "who was on shift"
 * would be two answers to one question, and the founder asked for the roster on
 * both the crossing and the period close.
 *
 * NEVER THROWS. A missing roster degrades the sentence; it does not lose the
 * notification. An unreadable schedule and an empty one both produce `[]` and
 * are distinguished in the log — the copy says "the schedule names nobody for
 * that hour", never "nobody was working". `shifts` is a PLAN and there is no
 * clock-in table in this schema.
 */
export interface RosterEntry {
  memberId: string;
  /** Null when the shift's member row is gone. The page renders the em dash. */
  name: string | null;
  role: string | null;
}

export async function rosterAt(
  client: any,
  restaurantId: string,
  instant: Date,
  timeZone: string,
  logger: Logger,
): Promise<RosterEntry[]> {
  const [from, to] = candidateShiftDates(instant, timeZone);
  try {
    const { data, error } = await client
      .from("shifts")
      .select("member_id, shift_date, start_time, end_time, role, state")
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", from)
      .lte("shift_date", to);
    if (error) throw new Error(error.message);

    const covering = onShiftAt((data ?? []) as any[], instant, timeZone);
    if (!covering.length) return [];

    const { data: members, error: memberError } = await client
      .from("team_members")
      .select("id, display_name")
      .eq("restaurant_id", restaurantId)
      .in(
        "id",
        covering.map((c) => c.memberId),
      );
    if (memberError) throw new Error(memberError.message);

    const names = new Map<string, string>();
    for (const m of (members ?? []) as any[]) {
      if (m?.id && m?.display_name) names.set(m.id, m.display_name);
    }

    return covering.map((c) => ({
      memberId: c.memberId,
      name: names.get(c.memberId) ?? null,
      role: c.role,
    }));
  } catch (e: any) {
    logger.warn(
      `ROSTER_UNREADABLE restaurant=${restaurantId} at=${instant.toISOString()} — ` +
        `${e?.message}. The notification will omit who was on shift rather than claim nobody was.`,
    );
    return [];
  }
}

/** The one sentence both producers use for the roster. */
export const ROSTER_SOURCE =
  "public.shifts — the published schedule, not a clock-in record";
