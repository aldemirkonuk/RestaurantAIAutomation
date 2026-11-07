import { minutesSince, seatingFreshness, type FreshnessStatus } from "./freshness";

/**
 * Pre-delivery run alerts (Food up).
 *
 * The pass knows the food is up; the waiter knows the table. This composes the
 * Food-up brief for a signed-in screen: what's ready, the pass's own message,
 * and the table insights that change how the plates get dropped (party size,
 * dwell, how stale the last visit is). Whether a waiter's `/floor/me` may show
 * its minute and count lines under "Nothing for now" is open: ADR 0345 `:176`
 * and `:204` give the waiter phone no figure, ADR 0351 `:62` counts minutes as
 * figures, and ADR 0352 `:33` keeps the brief lines on signed-in screens
 * without saying whose. This file decides none of it.
 *
 * None of it is a push payload. The Food-up push (ADR 0352 `:33`) carries
 * only the house, the table label and "Food up", composed by the gateway; the
 * brief's lines and the pass's note stay on signed-in screens, never on a
 * lock screen.
 *
 * Ported from the Floor Checker's `lib/meal-alert.ts` (uncommitted Food-up
 * work, frozen 2026-10-31 at p4-scratch/floor-checker-freeze-2026-10-31).
 * Pure — no database, no React, no clock: `now` is required. Behaviour is the
 * checker's, except:
 * - the status comes from `seatingFreshness` (the ported `freshnessOf`), so
 *   ADR 0346 D4 (d)'s boundary applies (a table at exactly the warn minute is
 *   on time);
 * - `seats` may be null (ADR 0347 D4: unknown seats print no "N-top"; the
 *   checker already omitted it unless seats > 0);
 * - a seated party with no visit is measured from `seatedAt`, not read as
 *   idle. The checker never saw that case: its `seatings.last_check_in_at` was
 *   `not null default now()` and a trigger bumped it (checker
 *   `supabase/migrations/0001_init.sql:96`, `:119-130`). The port's floor
 *   schema (its migration is not on main yet) stores no last-visit column and no seated visit row, so the caller's natural input
 *   for an unvisited party is null. Reading that as idle ("Run it now", normal
 *   priority) past the late minute is silence read as health, which ADR 0346
 *   D4 (b) removes from the score; the brief follows it. This departs from the
 *   checker's `scripts/test-meal-brief.mjs:174-178` (see the parity spec).
 *   An unreadable visit time falls back to the seat time; a seating none of
 *   whose times can be read is "late", not idle (fail closed). The insights
 *   say which time is unknown;
 * - notes and labels are cut on code points, never mid-pair; controls become
 *   spaces and the format and default-ignorable characters `cleanText` lists
 *   are removed (ZWJ, ZWNJ and U+FE0E-FE0F are kept); labels are capped. The
 *   checker cut on UTF-16 units, turned only C0 controls and DEL into spaces
 *   and printed labels as given;
 * - a seat count, party size or check-in count that is not a positive whole
 *   number prints nothing (the checker printed any number above 0);
 * - a note or label left with no visible character after cleaning (only
 *   joiners, presentation selectors or blanks) counts as empty: the note is
 *   null and the label prints "—";
 * - `durationText` prints "—" for a non-finite minute count, where the
 *   checker printed "NaNh" for NaN (and "Infinityh" for Infinity).
 */

export type MealCourse = "drinks" | "starters" | "mains" | "dessert" | "other";

export const MEAL_COURSES: {
  key: MealCourse;
  /** Chip label on the Food-up composer (any staff may raise one, ADR 0351 `:70`). */
  label: string;
  /** Reads as "<subject> ready for Table 12". */
  subject: string;
}[] = [
  { key: "drinks", label: "Drinks", subject: "Drinks" },
  { key: "starters", label: "Starters", subject: "Starters" },
  { key: "mains", label: "Mains", subject: "Mains" },
  { key: "dessert", label: "Dessert", subject: "Dessert" },
  { key: "other", label: "Other", subject: "Order" },
];

export const DEFAULT_MEAL_COURSE: MealCourse = "mains";

/** Notes are read at a glance on the waiter's screen — keep them short. */
export const MEAL_NOTE_MAX = 140;

/** The one-line summary's cap (`body`). */
export const MEAL_BODY_MAX = 180;

/** A table or merge-group label in the title, headline and insights. */
export const MEAL_LABEL_MAX = 32;

/**
 * The brief's title budget, "Food up · Table <label>". The title meets
 * it by construction and is never cut: the 16-unit prefix plus a label capped
 * at MEAL_LABEL_MAX (32) units is at most 48.
 */
export const MEAL_TITLE_MAX = 64;

/** Minutes as "<1m", "38m", "1h 5m"; "—" for unknown (checker `lib/format.ts:20-27`). */
export function durationText(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return "—";
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function isMealCourse(value: unknown): value is MealCourse {
  return MEAL_COURSES.some((c) => c.key === value);
}

export function courseLabel(course: MealCourse): string {
  return MEAL_COURSES.find((c) => c.key === course)?.label ?? "Order";
}

function courseSubject(course: MealCourse): string {
  return MEAL_COURSES.find((c) => c.key === course)?.subject ?? "Order";
}

/**
 * Cut `text` to at most `max` UTF-16 units, ending in "…" when cut. The cut
 * falls on a code-point boundary, so an emoji at the edge is dropped whole
 * instead of leaving a lone surrogate (which would render as U+FFFD).
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Every format character (category Cf) and default-ignorable code point,
 * except ZWNJ/ZWJ (U+200C-200D) and the text/emoji presentation selectors
 * (U+FE0E-FE0F).
 */
const INVISIBLE =
  /(?!\u200c|\u200d|\ufe0e|\ufe0f)[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Turn C0/C1 controls into spaces; drop every `INVISIBLE` character; replace
 * a lone surrogate with U+FFFD; collapse whitespace to single spaces.
 *
 * `INVISIBLE` takes the bidi controls (which can reorder what the waiter
 * reads), zero-width spaces, word joiners, the BOM, soft hyphens, tag
 * characters (U+E0000-E007F, the invisible ASCII-smuggling range), variation
 * selectors other than U+FE0E-FE0F, the combining grapheme joiner U+034F and
 * fillers such as U+3164. It also takes format characters that can be
 * visible, such as U+0600-0605 and U+FFF9-FFFB, and a subdivision flag
 * (England's) falls back to a plain black flag. ZWJ and ZWNJ stay because
 * emoji sequences and some scripts need them; they reorder nothing, but a run
 * of them can still carry text nobody sees.
 */
function cleanText(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
      .replace(INVISIBLE, "")
      .replace(/[\ud800-\udfff]+/g, fixSurrogates)
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Keep each high-low surrogate pair; replace a lone half with U+FFFD. Written
 * without a regex lookbehind, which older Safari cannot parse.
 */
function fixSurrogates(run: string): string {
  let out = "";
  for (let i = 0; i < run.length; i++) {
    const c = run.charCodeAt(i);
    const n = run.charCodeAt(i + 1);
    if (c <= 0xdbff && n >= 0xdc00 && n <= 0xdfff) {
      out += run[i] + run[i + 1];
      i++;
    } else {
      out += "\ufffd";
    }
  }
  return out;
}

/**
 * True when something a person can see is left: not only ZWJ/ZWNJ, the
 * presentation selectors, whitespace or the Braille blank U+2800.
 */
const UNSEEN = new Set([0x200c, 0x200d, 0xfe0e, 0xfe0f, 0x2800]);
function hasVisible(text: string): boolean {
  for (const ch of text) {
    if (!/\s/.test(ch) && !UNSEEN.has(ch.codePointAt(0) as number)) return true;
  }
  return false;
}

/** Clean as `cleanText`, then cap at MEAL_NOTE_MAX; "" when nothing visible is left. */
export function sanitizeMealNote(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = cleanText(raw);
  return hasVisible(text) ? clip(text, MEAL_NOTE_MAX) : "";
}

/** A label cleaned as a note and capped at MEAL_LABEL_MAX. */
function sanitizeLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = cleanText(raw);
  return hasVisible(text) ? clip(text, MEAL_LABEL_MAX) : "";
}

export interface MealBriefInput {
  tableLabel: string;
  /** Merge group label like "12+13" when the party spans tables. */
  groupLabel?: string | null;
  course: MealCourse;
  note?: string | null;
  /** Typed seat count; null when nobody typed one (ADR 0347 D4). */
  seats: number | null;
  partySize: number | null;
  /** `floor_seatings.seated_at`; null only when the table has no open seating. */
  seatedAt: string | null;
  /**
   * The last visit (`floor_visits.visited_at`), or `paid_undone_at` when that
   * is later (ADR 0347 D7: the late clock restarts from an undo); null when
   * neither exists. With null or an unreadable time, the status is measured
   * from `seatedAt` (`seatingFreshness`).
   */
  lastCheckInAt: string | null;
  /** Honor check-ins logged on this seating, all actors. */
  checkInCount: number;
  warnAfterMin: number;
  lateAfterMin: number;
  now: number;
}

export interface MealBrief {
  /** Title on the signed-in screen, e.g. "Food up · Table 12". Not a push title. */
  title: string;
  /** In-app heading, e.g. "Mains ready for Table 12". */
  headline: string;
  courseLabel: string;
  /** The pass's own words, sanitized — null when they didn't type any. */
  note: string | null;
  /** What to do with the table while you're standing there. */
  cue: string;
  /** Table insights, most decision-relevant first. */
  insights: string[];
  /** Flattened note + insights, one line, for the signed-in screen. Never a push body. */
  body: string;
  /**
   * `seatingFreshness`: from the last visit, else the seat time; idle only
   * with neither; late when one is given and none can be read.
   */
  status: FreshnessStatus;
  /** high → the table is already overdue. */
  priority: "normal" | "high";
  minsSinceCheckIn: number | null;
  dwellMin: number | null;
}

const CUE: Record<FreshnessStatus, string> = {
  late: "Table is overdue — log the visit when you drop the plates.",
  warn: "Visit is due soon — this drop can count as it.",
  fresh: "Run it now — tap Delivered once the plates are down.",
  idle: "Run it now — tap Delivered once the plates are down.",
};

/** Compose the Food-up brief for a signed-in screen. */
export function buildMealBrief(input: MealBriefInput): MealBrief {
  const now = input.now;
  const tableLabel = sanitizeLabel(input.tableLabel);
  const groupLabel = sanitizeLabel(input.groupLabel);
  // A label that cleans to nothing prints "—" (ADR 0051), never "Table ".
  const name = groupLabel || tableLabel || "—";
  const merged = Boolean(groupLabel && groupLabel !== tableLabel);

  const minsSinceCheckIn = minutesSince(input.lastCheckInAt, now);
  const dwellMin = minutesSince(input.seatedAt, now);
  // The last anchor: the last visit, else the seat time. See the header.
  const status = seatingFreshness(
    { seatedAt: input.seatedAt, lastVisitAt: input.lastCheckInAt },
    input.warnAfterMin,
    input.lateAfterMin,
    now,
  );

  const insights: string[] = [];

  const whole = (n: number | null): n is number =>
    typeof n === "number" && Number.isInteger(n) && n > 0;
  const seatsPart = whole(input.seats) ? `${input.seats}-top` : null;
  if (whole(input.partySize)) {
    insights.push(
      seatsPart
        ? `Party of ${input.partySize} · ${seatsPart}`
        : `Party of ${input.partySize}`,
    );
  } else if (seatsPart) {
    insights.push(seatsPart);
  }

  if (merged) {
    insights.push(`Merged party — ${groupLabel} share one ticket`);
  }

  if (dwellMin !== null) {
    insights.push(`Seated ${durationText(dwellMin)} ago`);
  } else if (input.seatedAt != null) {
    insights.push("Seat time unknown");
  }

  if (minsSinceCheckIn !== null) {
    const word =
      status === "late" ? "overdue" : status === "warn" ? "due soon" : "on time";
    insights.push(
      `Last visit ${durationText(minsSinceCheckIn)} ago · ${word}`,
    );
  } else if (input.lastCheckInAt != null || whole(input.checkInCount)) {
    // A visit exists but its time cannot be read: not "no visit".
    insights.push("Last visit time unknown");
  } else {
    insights.push("No visit logged yet this party");
  }

  if (whole(input.checkInCount)) {
    insights.push(
      `${input.checkInCount} check-in${input.checkInCount === 1 ? "" : "s"} this party`,
    );
  }

  const note = sanitizeMealNote(input.note) || null;
  const parts = note ? [`“${note}”`, ...insights] : insights;

  const body = clip(parts.join(" · "), MEAL_BODY_MAX);

  return {
    // Within MEAL_TITLE_MAX by construction (see there); never cut.
    title: `Food up · Table ${name}`,
    headline: `${courseSubject(input.course)} ready for Table ${name}`,
    courseLabel: courseLabel(input.course),
    note,
    cue: CUE[status],
    insights,
    body,
    status,
    priority: status === "late" ? "high" : "normal",
    minsSinceCheckIn,
    dwellMin,
  };
}
