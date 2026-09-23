import { createHash } from "crypto";
import type { FindingRow, ReadingArgs, ReadingId, ReadingOutcome, ReadingReason } from "./reading.types";

/**
 * A Finding's fingerprint: stable across reads when the measured cells, their
 * provenance, the outcome and the reason agree. Cell ids are random per read,
 * so they are left out.
 *
 * One function, used by `RecordingSession.finish` and by anything that
 * rewrites a Finding for the asker's role (`withholdFailureDetail`): the
 * fingerprint hashes the REASON, and every reason the runner can give is a
 * short public list, so a Finding whose reason was withheld but whose
 * fingerprint was left in place would still say which reason it was -- anyone
 * can hash the ~20 candidates and compare (2026-09-21, round 6r).
 */
export function findingFingerprint(input: {
  id: ReadingId;
  version: number;
  args: ReadingArgs;
  outcome: ReadingOutcome;
  reason: ReadingReason | null;
  rows: FindingRow[];
}): string {
  const { id, version, args, outcome, reason, rows } = input;
  return createHash("sha256").update(JSON.stringify({ id, version, args, outcome, reason,
    rows: rows.map(row => ({ key: row.key, cells: row.cells.map(({ id: _id, ...cell }) => cell) })) })).digest("hex");
}
