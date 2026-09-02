/**
 * One question, asked the same way at every read in the scheduled jobs: *did
 * this query succeed?*
 *
 * supabase-js does not throw on a database error. It RETURNS `{ data: null,
 * error }`, so a `try/catch` around a read is inert for exactly the failures
 * that matter, and
 *
 *     const { data: rows } = await client.from("t").select(...)...;
 *     if (!rows || rows.length === 0) return;
 *
 * treats "the query failed" and "nothing matched" as one outcome. Three crons
 * in `scheduled-tasks.service.ts` have died inside that conflation — the
 * `status = 'RECURRING'` filter (ADR 0058), the recurring reminder aimed at the
 * wrong table (ADR 0061) and the payment-due reminder filtering on a column no
 * table declares (ADR 0077). Each ran daily for its whole life, sent nothing,
 * and logged nothing.
 *
 * These helpers are pure so the decision — failed, or merely empty — can be
 * tested without NestJS DI, a database, or a clock. The service supplies the
 * logger; this module supplies the words.
 */

/** The shape supabase-js hands back from a `.select()`. */
export interface ReadEnvelope<T> {
  data: T[] | null;
  error: {
    message?: string | null;
    code?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null;
}

/**
 * A read either produced rows or failed. There is deliberately no third state
 * that means "null, make of it what you will" — that ambiguity is the defect.
 */
export type ReadOutcome<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: string };

/**
 * PostgREST codes worth naming in words, because each points at a different
 * repair and the raw code points at none.
 */
const CODE_MEANINGS: Record<string, string> = {
  "42703": "the query names a COLUMN that does not exist",
  "42P01": "the query names a TABLE that does not exist",
  PGRST204: "the payload names a column that does not exist",
  PGRST205: "the schema cache has no such table",
  "42501": "permission denied — check RLS for this role",
};

/**
 * Say the failure in words: which job, which table, what the database said, and
 * — the part that is always true and always omitted — that nothing was sent.
 *
 * The last clause is not decoration. The reason all three dead crons survived
 * review is that "no email today" and "no email ever" look identical from
 * outside, so the message has to assert which one just happened.
 */
export function describeReadFailure(
  job: string,
  table: string,
  error: ReadEnvelope<unknown>["error"],
): string {
  const code = (error?.code ?? "").trim();
  const meaning = code ? CODE_MEANINGS[code] : undefined;
  const parts = [
    `${job}: read of \`${table}\` FAILED`,
    code ? `[${code}]` : "[no code]",
    error?.message?.trim() || "no message from the database",
  ];
  if (meaning) parts.push(`— ${meaning}`);
  if (error?.details?.trim()) parts.push(`details: ${error.details.trim()}`);
  if (error?.hint?.trim()) parts.push(`hint: ${error.hint.trim()}`);
  parts.push(
    "This is a FAILED read, not an empty one: nothing was sent, and the " +
      "absence of a notification today does not mean there was nothing to send.",
  );
  return parts.join(" ");
}

/**
 * Turn a supabase read envelope into an outcome that cannot be mistaken.
 *
 * `data: null` with no error is treated as a FAILURE rather than an empty list.
 * That is the conservative reading and it is the right one here: every caller
 * in the scheduled jobs asks "is there anything to tell someone about?", and a
 * client that returned neither rows nor an error has not answered.
 */
export function interpretRead<T>(
  job: string,
  table: string,
  envelope: ReadEnvelope<T> | null | undefined,
): ReadOutcome<T> {
  if (!envelope) {
    return {
      ok: false,
      reason: describeReadFailure(job, table, {
        message: "the client returned no response envelope at all",
      }),
    };
  }
  if (envelope.error) {
    return {
      ok: false,
      reason: describeReadFailure(job, table, envelope.error),
    };
  }
  if (envelope.data == null) {
    return {
      ok: false,
      reason: describeReadFailure(job, table, {
        message: "the client returned neither rows nor an error",
      }),
    };
  }
  return { ok: true, rows: envelope.data };
}
