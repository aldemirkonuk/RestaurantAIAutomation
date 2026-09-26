/**
 * A line's history on the receiving desk, built from the door receipts already
 * recorded (founder, 2026-09-25, answer 2: "built from the door receipts
 * already recorded — no separate verdict ledger table"; ADR 0160 §107, sketch
 * 107 Approach 1 of 2026-09-22: "a line's full history opened on demand,
 * paged 10 at a time").
 *
 * The record is `procurement_receipt_events`, one row per thing that happened
 * to the line: the door's count (`case_count`), a refusal at the door (the same
 * stage with `outcome = 'refused'`), and — since #436 (ADR 0192 amendment) —
 * the desk's verification (`reconciled`, with the invoice's bottles). Nothing
 * here is a second copy of any of it: these helpers only page and word the
 * rows the door and the desk already wrote.
 *
 * Kept apart from `receiving.service.ts` so the cursor and the row shape can be
 * tested without a database.
 */

/** The founder's page size (Q7 Approach 1, 2026-09-22): ten entries per page. */
export const LINE_HISTORY_PAGE = 10;

/* ── the paging cursor ────────────────────────────────────────────────── */

/**
 * The history pages on the sort key `(occurred_at desc, id desc)`. A cursor on
 * `occurred_at` alone would skip every row sharing the boundary row's instant —
 * a door retry and its original, or two trucks booked by one batch, can share
 * a timestamp — so the cursor names BOTH parts: `<occurred_at>|<id>`.
 *
 * Anchored and closed: the value is interpolated into a PostgREST `or(...)`
 * filter, so nothing outside the timestamp and uuid grammar (a comma, a
 * parenthesis, a dot-operator) may reach it.
 */
const TS = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?`;
const UUID = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;
export const LINE_HISTORY_CURSOR_RE = new RegExp(`^(${TS})\\|(${UUID})$`);

export interface LineHistoryCursor {
  occurredAt: string;
  id: string;
}

export function formatLineHistoryCursor(row: { occurred_at: string; id: string }): string {
  return `${row.occurred_at}|${row.id}`;
}

/** Null for anything that is not a well-formed cursor. */
export function parseLineHistoryCursor(raw: string | null | undefined): LineHistoryCursor | null {
  if (typeof raw !== "string") return null;
  const m = LINE_HISTORY_CURSOR_RE.exec(raw.trim());
  if (!m) return null;
  return { occurredAt: m[1], id: m[2] };
}

/**
 * "Strictly older than the cursor" under `(occurred_at desc, id desc)`:
 * `occurred_at < T  OR  (occurred_at = T AND id < I)`.
 *
 * The timestamp is double-quoted: an offset such as `+00:00` carries a colon and
 * a plus, and PostgREST reads an unquoted value up to the next reserved
 * character. Quoting makes the whole value one literal.
 */
export function lineHistoryCursorFilter(cursor: LineHistoryCursor): string {
  const t = `"${cursor.occurredAt}"`;
  return `occurred_at.lt.${t},and(occurred_at.eq.${t},id.lt.${cursor.id})`;
}

/* ── one entry ────────────────────────────────────────────────────────── */

export type LineHistoryKind =
  /** The door counted and accepted (some or all of) the truck. */
  | "door_count"
  /** The door turned the truck away. */
  | "door_refused"
  /** The desk verified the line against its paperwork (#436, ADR 0192). */
  | "desk_verified"
  /** A stage the desk does not word yet (`signed_at_door`, `bottle_count`): shown by its own name. */
  | "other";

export interface LineHistoryEntry {
  id: string;
  kind: LineHistoryKind;
  /** The raw stage, always sent, so an unworded stage is never hidden. */
  stage: string;
  occurredAt: string;
  outcome: string | null;
  refusalReason: string | null;
  /** What the person counted, in the unit they counted in. Never re-multiplied here. */
  countedQtyInCountedUom: number | null;
  countedUom: string | null;
  /** The same count in bottles, as the door converted it; null when the door could not. */
  countedBottles: number | null;
  rejectedQtyInCountedUom: number | null;
  rejectedBottles: number | null;
  expectedBottles: number | null;
  /** On a desk verification only: what the invoice billed, in bottles. */
  invoiceBottles: number | null;
  notes: string | null;
  driverName: string | null;
  signedByInitials: string | null;
  /** Who recorded it, by name; null when unknown or when the names could not be read. */
  recordedBy: string | null;
}

/** A measured number, or null. A missing or non-numeric value is never 0. */
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export function kindOf(stage: unknown, outcome: unknown): LineHistoryKind {
  if (stage === "reconciled") return "desk_verified";
  if (stage === "case_count") return outcome === "refused" ? "door_refused" : "door_count";
  return "other";
}

export function toLineHistoryEntry(
  row: Record<string, unknown>,
  names: Map<string, string>,
): LineHistoryEntry {
  const by = s(row.received_by);
  return {
    id: String(row.id),
    kind: kindOf(row.stage, row.outcome),
    stage: String(row.stage ?? ""),
    occurredAt: String(row.occurred_at ?? ""),
    outcome: s(row.outcome),
    refusalReason: s(row.refusal_reason),
    countedQtyInCountedUom: n(row.counted_qty),
    countedUom: s(row.counted_uom),
    countedBottles: n(row.counted_qty_bottles),
    rejectedQtyInCountedUom: n(row.rejected_qty),
    rejectedBottles: n(row.rejected_qty_bottles),
    expectedBottles: n(row.expected_qty_bottles),
    invoiceBottles: n(row.invoice_qty_bottles),
    notes: s(row.notes),
    driverName: s(row.driver_name),
    signedByInitials: s(row.signed_by_initials),
    recordedBy: by ? (names.get(by) ?? null) : null,
  };
}
