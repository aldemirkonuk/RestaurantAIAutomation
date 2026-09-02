/**
 * Operating hours — STUB (ADR 0093 D1).
 *
 * The real helper is built by another builder on this same ADR and lands at
 * exactly this path with exactly these signatures. This file exists so the
 * scenario verifier compiles and so that, until the real one arrives, the
 * hours question answers **unknown** rather than guessing.
 *
 * `open: null` is the whole point: ADR 0020 forbids rendering an unknown as a
 * `false`. A verifier check that depends on this therefore reports
 * `unverifiable` with the reason, never `pass` and never `fail`.
 *
 * DO NOT extend this. The integrator replaces it wholesale.
 */

export interface OpenAtVerdict {
  /** `true` open, `false` closed, `null` we do not know (ADR 0020). */
  open: boolean | null;
  /** Why the answer is what it is — always set when `open` is null. */
  reason?: string;
  /** The service window the instant fell in, when one is known. */
  window?: { start: Date; end: Date };
}

/** One weekday's ranges, normalised. The real helper defines the full shape. */
export interface ParsedOperatingHours {
  /** Index 0 = Sunday, matching `Date.prototype.getDay()`. */
  byWeekday: Array<Array<{ startMinute: number; endMinute: number }>>;
}

/** Parse the `operating_hours` jsonb. The stub knows no shape, so: null. */
export function parseOperatingHours(
  _hours: unknown,
): ParsedOperatingHours | null {
  return null;
}

/** Concrete open/close instants for a local service date. The stub has none. */
export function serviceWindows(
  _hours: unknown,
  _timezone: string | null | undefined,
  _localDate: string,
): Array<{ start: Date; end: Date }> {
  return [];
}

/** Is the venue open at `instant`? The stub cannot know, and says so. */
export function isOpenAt(
  _hours: unknown,
  _timezone: string | null | undefined,
  _instant: Date,
): OpenAtVerdict {
  return { open: null, reason: "hours_unknown" };
}
