import { addDaysToKey, houseClockKey, houseDateKey } from "@/lib/houseDate";

/**
 * What the Team tab's "On tonight" card says (F-251, F-252).
 *
 * F-251: `/team/week` and `/team/members` are for owners and managers
 * (`assertAccess(..., "manager")`), so a staff phone got a 403 and the card
 * said the team space was "not set up" — false in a house with a published
 * rota. Staff now read `/team/my-week`, their own shifts, and a refusal is
 * never worded as a missing setup.
 *
 * F-252: "tonight" is the house's date, not the phone's UTC date.
 *
 * F-1075: a shift that runs past midnight is still on after the house's date
 * turns, until its end passes on the house's clock (the gateway's
 * `shiftHasEnded` rule). On a Monday that shift is in last week's read.
 */

export const FULL_ROTA_IS_FOR_MANAGERS =
  "The full rota is for the house's owners and managers. Here are your own shifts.";
export const ROTA_DID_NOT_LOAD = "The rota didn't load. Try again in a moment.";
export const NO_SHIFTS_TONIGHT = "No shifts scheduled today.";
export const NOT_ON_TONIGHT = "You're not on the rota today.";
export const ROTA_NOT_PUBLISHED = "This week's rota isn't published yet.";

/**
 * Whether to ask for the whole rota. Only a phone the house names staff skips
 * it; any other role (or none yet) asks, and the gateway's 403 then decides,
 * so an owner whose role did not arrive is not shown only their own shifts.
 */
export function seesFullRota(role: string | null | undefined): boolean {
  return role !== "staff";
}

/** A 403 from the gateway: this person may not read that, not "missing". */
export function isRefusal(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 403;
}

export function shiftsOn(shifts: any[] | undefined, dateKey: string): any[] {
  return (shifts ?? [])
    .filter((s) => String(s?.shift_date ?? "").slice(0, 10) === dateKey)
    .sort((a, b) => String(a.start_time ?? "").localeCompare(String(b.start_time ?? "")));
}

/**
 * Tonight's shifts: today's, plus yesterday's that ran past midnight and have
 * not ended yet on the house's clock (F-1075). `earlier` carries the week
 * before when yesterday was its Sunday.
 */
export function shiftsTonight(
  shifts: any[] | undefined,
  earlier: any[] | undefined,
  now: Date,
  timeZone?: string | null,
): any[] {
  const today = houseDateKey(now, timeZone);
  const clock = houseClockKey(now, timeZone);
  const yesterday = addDaysToKey(today, -1);
  const stillOn = [...(shifts ?? []), ...(earlier ?? [])].filter((s) => {
    if (String(s?.shift_date ?? "").slice(0, 10) !== yesterday) return false;
    const start = String(s.start_time ?? "").slice(0, 5);
    const end = String(s.end_time ?? "").slice(0, 5);
    return !!start && !!end && end < start && `${today} ${end}` > clock;
  });
  return [...shiftsOn(stillOn, yesterday), ...shiftsOn(shifts, today)];
}

interface Read<T> {
  data?: T;
  isLoading: boolean;
  error: unknown;
}

export type TonightView =
  | { kind: "loading"; caption: string; note: string | null }
  | { kind: "shifts"; caption: string; note: string | null; shifts: any[]; own: boolean }
  | { kind: "none"; caption: string; note: string | null; message: string }
  | { kind: "error"; caption: string; note: string | null; message: string };

/** Which week read the card stands on: the full rota, or the caller's own. */
export function readsFullRota(role: string | null | undefined, weekError: unknown): boolean {
  return seesFullRota(role) && !isRefusal(weekError);
}

export function resolveTonight(input: {
  role: string | null | undefined;
  week: Read<{ shifts?: any[]; timezone?: string | null }>;
  mine: Read<{ mine?: any[]; timezone?: string | null; schedule?: { status?: string } | null }>;
  /** Last week's reads, asked for only on a Monday (F-1075). */
  weekBefore?: { data?: { shifts?: any[] } };
  mineBefore?: { data?: { mine?: any[] } };
  now: Date;
}): TonightView {
  const { role, week, mine, now } = input;

  if (readsFullRota(role, week.error)) {
    const caption = "On tonight";
    const note = null;
    if (week.isLoading && !week.data) return { kind: "loading", caption, note };
    if (week.error || !week.data) return { kind: "error", caption, note, message: ROTA_DID_NOT_LOAD };
    const shifts = shiftsTonight(
      week.data.shifts,
      input.weekBefore?.data?.shifts,
      now,
      week.data.timezone,
    );
    return shifts.length === 0
      ? { kind: "none", caption, note, message: NO_SHIFTS_TONIGHT }
      : { kind: "shifts", caption, note, shifts, own: false };
  }

  const caption = "Your shift tonight";
  const note = FULL_ROTA_IS_FOR_MANAGERS;
  if (mine.isLoading && !mine.data) return { kind: "loading", caption, note };
  if (mine.error || !mine.data) return { kind: "error", caption, note, message: ROTA_DID_NOT_LOAD };
  const shifts = shiftsTonight(mine.data.mine, input.mineBefore?.data?.mine, now, mine.data.timezone);
  // Staff are sent no shifts until the week is published (F-506), so an
  // empty list then is not "you're off" (F-884).
  const published = mine.data.schedule?.status === "published";
  return shifts.length === 0
    ? { kind: "none", caption, note, message: published ? NOT_ON_TONIGHT : ROTA_NOT_PUBLISHED }
    : { kind: "shifts", caption, note, shifts, own: true };
}
