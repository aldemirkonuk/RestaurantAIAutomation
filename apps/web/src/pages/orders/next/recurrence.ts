/**
 * recurrence — reading an order's rule off the wire, and saying it in a sentence.
 *
 * ADR 0125's addendum (founder, 2026-09-05: "Build recurrence on the order").
 *
 * WHAT THIS REPLACES
 * ------------------
 * `useOrdersNextData.toRow` used to contain the line `const recurring = false;`
 * with a paragraph explaining that the route sent nothing, so the Recurring
 * station "HAS ALWAYS BEEN EMPTY and every order fell into one-time"
 * (`.planning/v3.0-TECH-DEBT.md`, "The orders wire", item 2). The route now
 * sends six keys and this module reads them.
 *
 * THE THREE-STATE READING, AND WHY THE STATION DEPENDS ON IT
 * ---------------------------------------------------------
 * `read: false` means this payload came from a route that does not select the
 * recurrence columns. It is NOT the same as "this order does not repeat", and
 * the difference is exactly what the station is allowed to say out loud: it may
 * print "no recurring orders" only when every row it looked at was READ and
 * said no. Otherwise it says it does not know.
 *
 * THE SENTENCE IS BUILT HERE AND NOT ON THE GATEWAY
 * -------------------------------------------------
 * "recurs weekly, next 12 Sep" contains a formatted date, and a date's format
 * belongs to the reader's locale, not to a server in UTC. The gateway sends the
 * facts (the rule, the anchor, the ISO date); the browser writes the sentence.
 */

/** The five rules the house can run. The gateway's own list, and the DB CHECK's. */
export const RECURRENCE_FREQUENCIES = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const RECURRENCE_STATUSES = ['active', 'paused', 'ended'] as const;
export type RecurrenceStatus = (typeof RECURRENCE_STATUSES)[number];

/** What one payload says about an order's recurrence. */
export interface RecurrenceReading {
  /** Did this route read the recurrence columns at all? */
  read: boolean;
  /**
   * The rule, when there is one. `null` on a route that read and found none.
   * Also `null` — with `unreadable` set — when the wire carried a frequency
   * this build does not recognise, which is a different fact from "no rule" and
   * is never quietly folded into it.
   */
  frequency: RecurrenceFrequency | null;
  anchorDay: number | null;
  nextDueOn: string | null;
  status: RecurrenceStatus | null;
  /** This order is one OCCURRENCE of another order's rule. */
  parentOrderId: string | null;
  occurrenceOn: string | null;
  /**
   * The wire said something about the rule or its status that this build cannot
   * read. Surfaced rather than swallowed: a newer gateway that adds a sixth
   * frequency must make an older page say "this build cannot read this rule",
   * never "this order does not repeat".
   */
  unreadable: string | null;
}

/** Not read at all. The only honest reading of a route that does not select. */
export const RECURRENCE_UNREAD: RecurrenceReading = {
  read: false,
  frequency: null,
  anchorDay: null,
  nextDueOn: null,
  status: null,
  parentOrderId: null,
  occurrenceOn: null,
  unreadable: null,
};

function asFrequency(v: unknown): RecurrenceFrequency | null {
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (RECURRENCE_FREQUENCIES as readonly string[]).includes(raw)
    ? (raw as RecurrenceFrequency)
    : null;
}

function asStatus(v: unknown): RecurrenceStatus | null {
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (RECURRENCE_STATUSES as readonly string[]).includes(raw)
    ? (raw as RecurrenceStatus)
    : null;
}

function asIsoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())
    ? v.trim()
    : null;
}

function asId(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Read the six keys off one wire row.
 *
 * THE KEY TEST, NOT THE VALUE TEST. `'recurrenceFrequency' in o` is true for a
 * route that read the columns and found nothing — which sends `null`. A
 * `?? null` would have collapsed that into the absent case and put the page
 * straight back where it started.
 */
export function readRecurrence(o: Record<string, unknown>): RecurrenceReading {
  if (!o || !('recurrenceFrequency' in o)) return RECURRENCE_UNREAD;

  const rawFrequency = o.recurrenceFrequency;
  const frequency = asFrequency(rawFrequency);
  const rawStatus = o.recurrenceStatus;
  const status = asStatus(rawStatus);

  const unreadableParts: string[] = [];
  if (rawFrequency != null && frequency === null) {
    unreadableParts.push(`the rule "${String(rawFrequency)}"`);
  }
  if (rawStatus != null && status === null) {
    unreadableParts.push(`the state "${String(rawStatus)}"`);
  }

  return {
    read: true,
    frequency,
    anchorDay:
      typeof o.recurrenceAnchorDay === 'number' &&
      Number.isInteger(o.recurrenceAnchorDay)
        ? o.recurrenceAnchorDay
        : null,
    nextDueOn: asIsoDate(o.recurrenceNextDueOn),
    status,
    parentOrderId: asId(o.recurrenceParentOrderId),
    occurrenceOn: asIsoDate(o.recurrenceOccurrenceOn),
    unreadable: unreadableParts.length
      ? `This page cannot read ${unreadableParts.join(' or ')} on this order.`
      : null,
  };
}

/**
 * Does this order belong in the Recurring station?
 *
 * A rule this build can read, in any state — including `ended`. An ended series
 * is still the reason this order exists and still the place a person looks for
 * it; hiding it the moment it ends would make the station lie about what the
 * house has been buying. The row says which state it is in.
 *
 * A CHILD OCCURRENCE DOES NOT COUNT. It carries no rule of its own, and putting
 * it here would show one standing order as N. It stays in its own stage, where
 * it is waiting for the seal that every occurrence needs.
 */
export function isRecurring(r: RecurrenceReading): boolean {
  return r.read && r.frequency !== null;
}

/** How the rule reads in a sentence. Never a raw enum member on screen. */
const FREQUENCY_WORD: Record<RecurrenceFrequency, string> = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'fortnightly',
  monthly: 'monthly',
  quarterly: 'quarterly',
};

const WEEKDAY_WORD = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** An ISO date as "12 Sep", in the reader's locale. Null in, null out. */
export function shortDate(iso: string | null, locale?: string): string | null {
  if (!iso) return null;
  // Parsed as UTC and formatted in UTC. The value is a calendar DATE, not an
  // instant: formatting it in the browser's zone would show 11 Sep to anyone
  // west of Greenwich, which is the same off-by-one-day fault the gateway's own
  // arithmetic is written around.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

/**
 * The ledger row's recurrence clause: "recurs weekly, next 12 Sep".
 *
 * Returns null when there is nothing true to say. It NEVER says "next —": a
 * paused series has no next date because it is paused, and the sentence says
 * that in words instead of printing a dash the reader has to interpret.
 */
export function recurrenceLabel(
  r: RecurrenceReading,
  locale?: string,
): string | null {
  if (!r.read) return null;
  if (r.unreadable) return r.unreadable;
  if (!r.frequency) return null;

  const word = FREQUENCY_WORD[r.frequency];
  const anchor =
    r.anchorDay === null
      ? null
      : r.frequency === 'weekly' || r.frequency === 'biweekly'
        ? (WEEKDAY_WORD[r.anchorDay] ?? null)
        : `the ${ordinal(r.anchorDay)}`;

  const rule = anchor ? `recurs ${word} on ${anchor}` : `recurs ${word}`;

  if (r.status === 'paused') return `${rule} — paused`;
  if (r.status === 'ended') return `${rule} — ended`;

  const next = shortDate(r.nextDueOn, locale);
  return next ? `${rule}, next ${next}` : rule;
}

/** 1st, 2nd, 3rd, 4th... for a day of the month. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * What the Recurring station may say when it has no rows.
 *
 * `readCount` is how many of the rows it looked at actually carried a
 * recurrence reading. Zero of N is a route that does not send it; N of N is a
 * measured "there are none".
 *
 * This is the whole honesty rule for this station in one function: a page may
 * not report absence as a fact it has not established.
 */
export function emptyStationSentence(
  hasData: boolean,
  rowCount: number,
  readCount: number,
): string {
  if (!hasData) {
    return 'The order book has not been read yet.';
  }
  if (rowCount === 0) {
    return 'There are no orders yet, so nothing repeats.';
  }
  if (readCount === 0) {
    return (
      'This page could not tell whether any order repeats: the order list it ' +
      'read does not carry a recurrence. This is not the same as there being none.'
    );
  }
  if (readCount < rowCount) {
    return (
      `Of ${rowCount} orders, ${readCount} said whether they repeat and none of ` +
      `those do. The other ${rowCount - readCount} did not say either way.`
    );
  }
  return `None of the ${rowCount} orders in this book repeats.`;
}
