/**
 * Two small pure helpers for the append-only verdict ledger
 * (ADR 0149 row 23; sketch 107-receiving-structure), kept apart from
 * `receiving.service.ts` so each can be tested without a database.
 */

/* ── the paging cursor ────────────────────────────────────────────────── */

/**
 * The ledger pages on the sort key `(recorded_at desc, id desc)`. A cursor on
 * `recorded_at` alone (what this used to be) skips every row that shares the
 * boundary row's timestamp — two appends landing in the same instant are
 * ordinary for a batch, and Postgres `timestamptz` ties are possible even at
 * microsecond precision. The cursor therefore names BOTH parts:
 * `<recorded_at>|<id>`.
 *
 * A bare `<recorded_at>` is still accepted — a client mid-session with a
 * cursor from before this change keeps working, with the old (tie-blind)
 * behaviour rather than a 400.
 */
const TS = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?`;
const UUID = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;

/** The one shape a `before` query value may take. Anchored: this string is
 * interpolated into a PostgREST `or(...)` filter, so nothing outside the
 * timestamp/uuid grammar (a comma, a parenthesis) may ever reach it. */
export const VERDICT_CURSOR_RE = new RegExp(`^(${TS})(?:\\|(${UUID}))?$`);

export interface VerdictCursor {
  recordedAt: string;
  /** Null for a legacy, timestamp-only cursor. */
  id: string | null;
}

export function formatVerdictCursor(row: { recorded_at: string; id: string }): string {
  return `${row.recorded_at}|${row.id}`;
}

/** Returns null for anything that is not a well-formed cursor. */
export function parseVerdictCursor(raw: string): VerdictCursor | null {
  const m = VERDICT_CURSOR_RE.exec(raw.trim());
  if (!m) return null;
  return { recordedAt: m[1], id: m[2] ?? null };
}

/**
 * The PostgREST `or(...)` filter for "strictly before this cursor" under the
 * ordering `(recorded_at desc, id desc)`:
 * `recorded_at < T  OR  (recorded_at = T AND id < I)`.
 */
export function verdictCursorFilter(cursor: VerdictCursor & { id: string }): string {
  return `recorded_at.lt.${cursor.recordedAt},and(recorded_at.eq.${cursor.recordedAt},id.lt.${cursor.id})`;
}

/* ── a trigger refusal, said as a sentence ────────────────────────────── */

const bottles = (n: number) => `${n} bottle${n === 1 ? "" : "s"}`;

/**
 * `receiving_line_verdicts_guard_supersedes` (the migration) refuses with a
 * plain `raise exception`, which reaches the gateway as SQLSTATE P0001 and a
 * message written for a DBA: row UUIDs, `%` arithmetic. A manager holding
 * "damaged 2" over a row that two earlier entries already took from read that
 * verbatim. This turns each message the trigger can produce into one sentence
 * that says what is true and that nothing was written.
 *
 * Returns null for a message it does not recognise — the caller decides what
 * to show, and must not pass an unrecognised database string through (it can
 * name another row's order id).
 */
export function readableLedgerRefusal(message: string): string | null {
  let m = /^over-take on row \S+: (\d+) already taken \+ (\d+) now = \d+ bottles, more than its (\d+) bottles$/.exec(
    message,
  );
  if (m) {
    const already = Number(m[1]);
    const now = Number(m[2]);
    const total = Number(m[3]);
    const left = Math.max(0, total - already);
    return left > 0
      ? `That entry has only ${left} of its ${bottles(total)} left — ${already} ${already === 1 ? "is" : "are"} already taken by later entries — so it cannot give up ${now} more. Nothing was appended.`
      : `All ${bottles(total)} of that entry are already taken by later entries, so it cannot give up ${now} more. Nothing was appended.`;
  }

  m = /^cannot take (\d+) bottles from a row of (\d+) bottles \(/.exec(message);
  if (m) {
    return `Cannot take ${bottles(Number(m[1]))} from an entry of ${bottles(Number(m[2]))} — that is more than it holds. Nothing was appended.`;
  }

  m = /^cannot take a (\S+) portion from a row counted in (\S+) — keg and liter/.exec(message);
  if (m) {
    return `Cannot take a "${m[1]}" portion from an entry counted in "${m[2]}" — keg and liter never convert to another unit. Nothing was appended.`;
  }

  if (/^supersedes must name a row on the same order and line/.test(message)) {
    return "A portion can only take from an entry on the same order line — the entry chosen belongs to a different one. Nothing was appended.";
  }

  if (
    /^supersedes must name a row in the same restaurant/.test(message) ||
    /^supersedes \S+ does not name an existing verdict row/.test(message)
  ) {
    return "That entry is not on this restaurant's ledger. Nothing was appended.";
  }

  if (/^a verdict row cannot supersede itself/.test(message)) {
    return "An entry cannot take from itself. Nothing was appended.";
  }

  return null;
}
