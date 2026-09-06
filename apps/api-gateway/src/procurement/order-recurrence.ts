/**
 * order-recurrence — the rule an order repeats by, and the arithmetic that says
 * when it next comes due.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * The founder, 2026-09-05: "Build recurrence on the order." Before this, the
 * rebuilt `/orders` page carried a Recurring station that could not ever fill:
 * `useOrdersNextData.toRow` set `recurring = false` as a stated fact about the
 * route, because nothing in `procurement_orders` recorded a recurrence at all
 * (`.planning/v3.0-TECH-DEBT.md`, "The orders wire", item 2).
 *
 * ===========================================================================
 * WHY THIS FILE IS PURE
 * ===========================================================================
 * Same reason `order-transitions.ts` is: every rule below is a statement about
 * dates, and a statement about dates should be testable without a database, a
 * Nest container, or a clock. Nothing here imports either. The one thing it
 * needs from outside — "what is today" — is a parameter.
 *
 * ===========================================================================
 * THE VOCABULARY IS NOT NEW
 * ===========================================================================
 * The five frequencies are the five `recurring_orders.frequency` has had since
 * `20260901180000_recurring_orders_shape.sql`, and `RECURRING_FREQUENCIES` in
 * `recurring-orders.service.ts` is the same list. They are re-declared here
 * rather than imported for one reason and it is not style: importing them would
 * make this pure module depend on a file that imports Nest, `@nestjs/schedule`,
 * `DatabaseService`, `ProcurementService` and `OrchestratorService` — the entire
 * container, to learn five strings. `order-recurrence.spec.ts` asserts the two
 * lists are equal, so they cannot drift without a red test.
 *
 * ===========================================================================
 * THE ARITHMETIC, AND THE TWO BUGS IT IS WRITTEN AROUND
 * ===========================================================================
 * Both were found and fixed in `calculateNextOrderDate` and both are re-made by
 * anybody who writes this from scratch:
 *
 *   1. `new Date("2026-09-01")` is UTC midnight and every JavaScript getter is
 *      LOCAL. West of Greenwich that instant reads 2026-08-31, so `setMonth(+1)`
 *      asks for 31 September, which rolls forward to 1 October. A monthly rule
 *      set for the 1st comes back as the 2nd — in negative-offset timezones
 *      only. Railway runs UTC and a laptop does not, which is the worst shape a
 *      scheduling bug can have. Everything below is Y/M/D integers and
 *      `Date.UTC`, never a Date built from an ISO string.
 *   2. Adding a month to 31 January must CLAMP to 28/29 February, not roll into
 *      March. `addMonths` clamps.
 *
 * ===========================================================================
 * NO `default:` ARM
 * ===========================================================================
 * `calculateNextOrderDate` used to return "+1 month" for anything it did not
 * recognise, so a DAILY rule — offered by the database CHECK and by the UI —
 * ran monthly and nothing said so. An unrecognised frequency here is refused,
 * in words, and the refusal is a value the caller has to handle rather than an
 * exception it can forget to catch.
 */

/**
 * The five shapes a recurrence can take. Identical to `RECURRING_FREQUENCIES`
 * and to the database CHECK on both `recurring_orders.frequency` and
 * `procurement_orders.recurrence_frequency`.
 */
export const ORDER_RECURRENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
] as const;
export type OrderRecurrenceFrequency =
  (typeof ORDER_RECURRENCE_FREQUENCIES)[number];

/**
 * The three states a recurrence can be in.
 *
 * `paused` and `ended` are separate on purpose. A paused series keeps its next
 * date and can be resumed onto the same calendar; an ended one is over, and the
 * distinction is the difference between "we are between menus" and "we do not
 * buy this any more". Collapsing them into a boolean is what
 * `recurring_orders.active` does, and it is why nothing there can say whether a
 * dormant schedule is coming back.
 */
export const ORDER_RECURRENCE_STATUSES = ["active", "paused", "ended"] as const;
export type OrderRecurrenceStatus = (typeof ORDER_RECURRENCE_STATUSES)[number];

/** The states from which the generator will mint a child. One member, stated. */
export const ORDER_RECURRENCE_GENERATING_STATUS: OrderRecurrenceStatus =
  "active";

/**
 * A result, not an exception.
 *
 * The house pattern (`resolveOrderUnits`, `readOrderStatus`): a caller that
 * forgets to handle a `{ ok: false }` gets a type error, and a caller that
 * forgets to catch a throw gets a 500 at 08:00 with nobody watching.
 */
export type RecurrenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

const fail = (reason: string, message: string): RecurrenceResult<never> => ({
  ok: false,
  reason,
  message,
});

/** Parse a stored value into a frequency, or `null`. Never guesses. */
export function readRecurrenceFrequency(
  value: unknown,
): OrderRecurrenceFrequency | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return (ORDER_RECURRENCE_FREQUENCIES as readonly string[]).includes(lower)
    ? (lower as OrderRecurrenceFrequency)
    : null;
}

/** Parse a stored value into a status, or `null`. Never guesses. */
export function readRecurrenceStatus(
  value: unknown,
): OrderRecurrenceStatus | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return (ORDER_RECURRENCE_STATUSES as readonly string[]).includes(lower)
    ? (lower as OrderRecurrenceStatus)
    : null;
}

/**
 * Which frequencies take a WEEKDAY anchor (0=Mon..6=Sun) and which take a DAY
 * OF MONTH (1..28). `daily` takes neither — an anchor on a daily rule is not a
 * narrowing, it is a contradiction, and it is refused rather than ignored.
 */
export function anchorKindFor(
  frequency: OrderRecurrenceFrequency,
): "weekday" | "monthday" | "none" {
  switch (frequency) {
    case "weekly":
    case "biweekly":
      return "weekday";
    case "monthly":
    case "quarterly":
      return "monthday";
    case "daily":
      return "none";
  }
}

/** The range an anchor may take for its frequency, or null when it takes none. */
export function anchorRangeFor(
  frequency: OrderRecurrenceFrequency,
): { min: number; max: number } | null {
  const kind = anchorKindFor(frequency);
  if (kind === "weekday") return { min: 0, max: 6 };
  // 28, not 31, and the ceiling is the same one `recurring_orders.frequency_day`
  // carries: a monthly rule anchored on the 30th has no February, and a rule
  // whose date silently moves twice a year is not a rule anybody agreed to.
  if (kind === "monthday") return { min: 1, max: 28 };
  return null;
}

/** Is this anchor legal for this frequency? The CHECK constraint, in TypeScript. */
export function validateAnchorDay(
  frequency: OrderRecurrenceFrequency,
  anchorDay: number | null | undefined,
): RecurrenceResult<number | null> {
  if (anchorDay === null || anchorDay === undefined) {
    return { ok: true, value: null };
  }
  if (!Number.isInteger(anchorDay)) {
    return fail(
      "anchor_not_whole",
      `An anchor day has to be a whole number; "${String(anchorDay)}" is not.`,
    );
  }
  const range = anchorRangeFor(frequency);
  if (!range) {
    return fail(
      "anchor_not_applicable",
      `A ${frequency} order comes round every day, so there is no day to anchor it to. ` +
        `Remove the anchor, or choose a weekly or monthly rule.`,
    );
  }
  if (anchorDay < range.min || anchorDay > range.max) {
    const kind = anchorKindFor(frequency);
    return fail(
      "anchor_out_of_range",
      kind === "weekday"
        ? `A ${frequency} order is anchored to a weekday, 0 (Monday) to 6 (Sunday). ${anchorDay} is not one.`
        : `A ${frequency} order is anchored to a day of the month, 1 to 28 — 28 so that every month has one. ${anchorDay} is not one.`,
    );
  }
  return { ok: true, value: anchorDay };
}

// ---------------------------------------------------------------------------
// Calendar arithmetic. Y/M/D integers and Date.UTC only — see the header.
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Split a YYYY-MM-DD into integers, refusing anything else. */
export function readCalendarDate(
  value: unknown,
): RecurrenceResult<{ y: number; m: number; d: number }> {
  if (typeof value !== "string") {
    return fail(
      "date_not_a_string",
      `A calendar date has to be written YYYY-MM-DD; this was ${value === null ? "null" : typeof value}.`,
    );
  }
  const match = ISO_DATE.exec(value.trim());
  if (!match) {
    return fail(
      "date_not_calendar",
      `"${value}" is not a YYYY-MM-DD calendar date.`,
    );
  }
  const y = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  const d = Number.parseInt(match[3], 10);
  if (m < 1 || m > 12) {
    return fail("date_not_calendar", `"${value}" names month ${m}.`);
  }
  if (d < 1 || d > daysInMonth(y, m)) {
    return fail(
      "date_not_calendar",
      `"${value}" names day ${d}, and ${y}-${String(m).padStart(2, "0")} has ${daysInMonth(y, m)}.`,
    );
  }
  return { ok: true, value: { y, m, d } };
}

/** Days in a 1-indexed month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
  };
}

/** Add whole months, CLAMPING the day. 31 January + 1 month is 28/29 February. */
function addMonths(y: number, m: number, d: number, n: number) {
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

/** Day of week read in UTC, so it agrees with `addDays`. 0=Sun (JavaScript). */
function jsDayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Move FORWARD to the next occurrence of `anchorDay` as a weekday, expressed
 * 0=Mon..6=Sun. Already on it means stay.
 *
 * The 0=Mon convention is `recurring_orders.frequency_day`'s, kept so the two
 * surfaces read the same number the same way. JavaScript's own is 0=Sun, which
 * is why the mapping is written out rather than left to arithmetic that looks
 * right and is off by one on Sundays.
 */
function snapToWeekday(
  at: { y: number; m: number; d: number },
  anchorDay: number,
): { y: number; m: number; d: number } {
  const targetJsDay = anchorDay === 6 ? 0 : anchorDay + 1;
  const diff = (targetJsDay - jsDayOfWeek(at.y, at.m, at.d) + 7) % 7;
  return diff === 0 ? at : addDays(at.y, at.m, at.d, diff);
}

/** Snap to `anchorDay` as a day of the month, clamped to the month's length. */
function snapToMonthDay(
  at: { y: number; m: number; d: number },
  anchorDay: number,
): { y: number; m: number; d: number } {
  return { y: at.y, m: at.m, d: Math.min(anchorDay, daysInMonth(at.y, at.m)) };
}

/**
 * The next occurrence AFTER `from`.
 *
 * This is the only thing that advances a series. `recurrence_next_due_on` is a
 * stored column, but it is stored so the generator can find its work with an
 * index probe — the VALUE always came from here, and
 * `OrderRecurrenceService.generateDueRecurrences` re-derives it and refuses to
 * write a child when the stored value and this function disagree.
 */
export function nextOccurrenceOn(
  from: string,
  frequency: OrderRecurrenceFrequency,
  anchorDay: number | null | undefined,
): RecurrenceResult<string> {
  const parsed = readCalendarDate(from);
  if (!parsed.ok) return parsed;
  const anchor = validateAnchorDay(frequency, anchorDay);
  if (!anchor.ok) return anchor;

  const { y, m, d } = parsed.value;
  const day = anchor.value;

  switch (frequency) {
    case "daily":
      return { ok: true, value: isoOf(addDays(y, m, d, 1)) };
    case "weekly": {
      const stepped = addDays(y, m, d, 7);
      return {
        ok: true,
        value: isoOf(day === null ? stepped : snapToWeekday(stepped, day)),
      };
    }
    case "biweekly": {
      const stepped = addDays(y, m, d, 14);
      return {
        ok: true,
        value: isoOf(day === null ? stepped : snapToWeekday(stepped, day)),
      };
    }
    case "monthly": {
      const stepped = addMonths(y, m, d, 1);
      return {
        ok: true,
        value: isoOf(day === null ? stepped : snapToMonthDay(stepped, day)),
      };
    }
    case "quarterly": {
      const stepped = addMonths(y, m, d, 3);
      return {
        ok: true,
        value: isoOf(day === null ? stepped : snapToMonthDay(stepped, day)),
      };
    }
  }
  // Unreachable for a member of the union; reached only by a caller that cast
  // a string. Refused rather than defaulted — see the header.
  return fail(
    "unknown_frequency",
    `"${String(frequency)}" is not a rule this house can run. Use one of: ` +
      `${ORDER_RECURRENCE_FREQUENCIES.join(", ")}.`,
  );
}

function isoOf(at: { y: number; m: number; d: number }): string {
  return iso(at.y, at.m, at.d);
}

/**
 * The FIRST occurrence of a rule that starts on `startsOn`.
 *
 * Distinct from `nextOccurrenceOn` in exactly one way and it matters: the first
 * occurrence may be `startsOn` ITSELF, if that day already satisfies the anchor.
 * Stepping first would make "weekly on Tuesday, starting this Tuesday" mean next
 * Tuesday, silently losing a week.
 */
export function firstOccurrenceOn(
  startsOn: string,
  frequency: OrderRecurrenceFrequency,
  anchorDay: number | null | undefined,
): RecurrenceResult<string> {
  const parsed = readCalendarDate(startsOn);
  if (!parsed.ok) return parsed;
  const anchor = validateAnchorDay(frequency, anchorDay);
  if (!anchor.ok) return anchor;

  const day = anchor.value;
  if (day === null) return { ok: true, value: isoOf(parsed.value) };

  switch (anchorKindFor(frequency)) {
    case "weekday":
      return { ok: true, value: isoOf(snapToWeekday(parsed.value, day)) };
    case "monthday": {
      // Forward only. A rule anchored to the 5th, started on the 20th, begins
      // NEXT month — never three weeks in the past, which is a date the
      // generator would treat as overdue and mint against immediately.
      const thisMonth = snapToMonthDay(parsed.value, day);
      if (thisMonth.d >= parsed.value.d) {
        return { ok: true, value: isoOf(thisMonth) };
      }
      const next = addMonths(parsed.value.y, parsed.value.m, 1, 1);
      return { ok: true, value: isoOf(snapToMonthDay(next, day)) };
    }
    case "none":
      return { ok: true, value: isoOf(parsed.value) };
  }
}

/**
 * The occurrences of a rule, in order, up to `count`.
 *
 * The day book's projection, and the only honest way to answer "when does this
 * come round next after that". Returns a refusal rather than a short list when
 * the arithmetic cannot continue, so a caller can never mistake "the rule broke
 * at occurrence 3" for "the rule has 2 occurrences".
 */
export function occurrencesFrom(
  first: string,
  frequency: OrderRecurrenceFrequency,
  anchorDay: number | null | undefined,
  count: number,
): RecurrenceResult<string[]> {
  if (!Number.isInteger(count) || count < 0) {
    return fail(
      "bad_count",
      `A projection is a whole number of occurrences; "${String(count)}" is not.`,
    );
  }
  const start = readCalendarDate(first);
  if (!start.ok) return start;
  if (count === 0) return { ok: true, value: [] };

  const out = [isoOf(start.value)];
  while (out.length < count) {
    const next = nextOccurrenceOn(out[out.length - 1], frequency, anchorDay);
    if (!next.ok) return next;
    out.push(next.value);
  }
  return { ok: true, value: out };
}

/**
 * Is this series due on `today`?
 *
 * `<=`, not `==`. A cron that did not run — a deploy, an outage, a weekend of
 * a paused worker — leaves a due date in the past, and a rule that only fires
 * on exact equality would skip that occurrence forever and report nothing
 * wrong. The generator mints ONE child for an overdue series and advances by
 * one step, so a series three weeks behind catches up over three runs rather
 * than minting three orders at once.
 */
export function isDueOn(nextDueOn: string, today: string): boolean {
  const due = readCalendarDate(nextDueOn);
  const now = readCalendarDate(today);
  if (!due.ok || !now.ok) return false;
  return isoOf(due.value) <= isoOf(now.value);
}

/**
 * The whole rule, validated together.
 *
 * One entry point so the three writers (the sheet, the generator, a future
 * import) cannot each validate a different subset. Returns the values to store,
 * with the first occurrence DERIVED — the caller never supplies a next date.
 */
export interface RecurrencePlan {
  frequency: OrderRecurrenceFrequency;
  anchorDay: number | null;
  anchoredOn: string;
  nextDueOn: string;
}

export function planRecurrence(input: {
  frequency: unknown;
  anchorDay?: number | null;
  startsOn: unknown;
}): RecurrenceResult<RecurrencePlan> {
  const frequency = readRecurrenceFrequency(input.frequency);
  if (!frequency) {
    return fail(
      "unknown_frequency",
      `"${String(input.frequency)}" is not a rule this house can run. Use one of: ` +
        `${ORDER_RECURRENCE_FREQUENCIES.join(", ")}.`,
    );
  }
  const anchor = validateAnchorDay(frequency, input.anchorDay);
  if (!anchor.ok) return anchor;

  const start = readCalendarDate(input.startsOn);
  if (!start.ok) return start;
  const anchoredOn = isoOf(start.value);

  const first = firstOccurrenceOn(anchoredOn, frequency, anchor.value);
  if (!first.ok) return first;

  return {
    ok: true,
    value: {
      frequency,
      anchorDay: anchor.value,
      anchoredOn,
      nextDueOn: first.value,
    },
  };
}
