/**
 * CANONICAL SOURCE OF TRUTH — UCC contract-formation guardrail patterns (OD-44).
 *
 * AI-SPEC §6: phrases that could constitute a binding purchase commitment. A
 * generated reply matching any of these must NEVER be sent without a human
 * approving it, in EVERY runtime that can send.
 *
 * ── Edit this file and nothing else ──────────────────────────────────────────
 * The Python orchestrator carries the same guardrail. Its copy
 * (services/agent-orchestrator/core/commitment_patterns.py) is GENERATED from
 * this file. After changing the list below, run:
 *
 *     python3 scripts/sync_commitment_patterns.py
 *
 * and commit both files. `--check` mode runs in CI and fails the build when the
 * two drift, which is what OD-44 was: a comment here claimed the lists were
 * "ported verbatim" while TS carried 19 patterns and Python carried 8 — and
 * Python is the runtime that actually auto-sends.
 *
 * ── Why strings, not RegExp literals ────────────────────────────────────────
 * These sources are the shared wire format between the two runtimes, so they
 * must stay in the portable intersection of JS RegExp and Python `re`:
 * `\b`, `\d`, `?`, character literals. No lookbehind, no named groups, no
 * inline flags. Case-insensitivity is applied by each runtime (JS `i` flag /
 * Python `re.IGNORECASE`), never encoded in the pattern.
 *
 * Each entry must also be a valid JSON string literal — the generator parses
 * this array with `json.loads`, so use `\\b` (not `\b`) and double quotes.
 */
export const COMMITMENT_PATTERN_SOURCES: readonly string[] = [
  "\\bwill take\\b",
  "\\bwould like to order\\b",
  "\\bplease confirm our order\\b",
  "\\bwe'?ll proceed with\\b",
  "\\bwe accept\\b",
  "\\bconfirm \\d+ cases?\\b",
  "\\blet'?s go ahead\\b",
  "\\bsending payment\\b",
  "\\bplace the order\\b",
  "\\bgo ahead and ship\\b",
  "\\bnous acceptons\\b",
  "\\bnous confirmons\\b",
  "\\bbon de commande\\b",
  "\\baccettiamo\\b",
  "\\bconfermiamo l'ordine\\b",
  "\\baceptamos\\b",
  "\\bconfirmamos el pedido\\b",
  "\\bwir akzeptieren\\b",
  "\\bbestellung aufgeben\\b",
];

/** Compiled form used by the guardrail check. Case-insensitive, per the note above. */
export const COMMITMENT_PATTERNS: RegExp[] = COMMITMENT_PATTERN_SOURCES.map(
  (source) => new RegExp(source, "i"),
);

/** True when `text` contains language that could form a binding purchase commitment. */
export function containsCommitmentLanguage(text: string): boolean {
  return COMMITMENT_PATTERNS.some((p) => p.test(text));
}
