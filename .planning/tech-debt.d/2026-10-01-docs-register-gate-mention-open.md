## A claims row that mentions the audit gate in passing still makes any edit to it gate-owned — OPEN — 2026-10-01

Filed on the founder's word, chat, 2026-10-01, verbatim: *"File it, build later (Recommended)"*. He was asked whether the 2026-09-30 narrowing (ADR 0090, "a decision record is owned by its subject, not by a mention") should reach `CLAIMS.jsonl` rows. Line numbers are at `main` `e39935fbc`.

**What.** The narrowing judges a non-register record by its subject and by any rule about the gate stated in it (`scripts/pr_audit_gate.py:1129-1140`). Registers were left out on purpose ("Registers keep their line-diff rules unchanged", ADR 0090 line 2509). Each changed run of a register is passed whole to `_scan_text` (`scripts/pr_audit_gate.py:1164-1178`), so a mention anywhere in a removed or added `CLAIMS.jsonl` line owns the PR.

**Real instance.** PR #569 at `7211683fa` changes only the `verify` fields of two rows, `TD-2026-09-27-PROMOTIONS-ROOM-SHOWN-TO-STAFF` and `OD-176-PROMOTIONS-HAND-IS-A-MANAGERS-FOR-STAFF`. The TD row's unchanged `claim` text says it was "Filed from the ADR 0090 audit of #487", so `--ownership` exits 3 with `.planning/decisions/CLAIMS.jsonl: removed text names the audit gate`. It was escalated in comment 5944848249. The founder chose *"Review, then your word (Recommended)"*, recorded in the review comment 5945006683.

**Size.** Running `origin/main`'s `_scan_text` on each line of `CLAIMS.jsonl` (746 rows) gave 26 hits. By their ids, 4 are about the gate itself: `ADR-0090` (two rows), `ADR-0231-SUPERSEDES-0050` and `ADR-0237-AUDIT-EFFORT`. The other 22 have ids about other subjects. One example is the TD row above, which names the gate only because an audit filed it. An edit to any of those 22 needs the founder's word today.

**Fix (build later; gate-owned, so it needs his word).** Judge a changed `CLAIMS.jsonl` row the way `_scan_record` judges a claims fragment:
- by its `id` (every `id` key);
- by any rule about the gate (`GATE_RULE_RE`) in its raw line and its decoded keys and values.

Keep the hygiene checks, the JSON-parse check and the line-diff bound on every changed line. A row with no `id` has no subject, so it keeps today's whole-row scan (`CLAIMS.jsonl` has 2 such rows; neither names the gate).

**What that fix would release.** Measured with `origin/main`'s `skeleton`, `GATE_SUBJECT_RE` and `GATE_RULE_RE` on each of the 26 rows: 12 stay owned and 14 are released. The 12 are the 4 gate rows above (by id) and 8 others whose text puts a listed verb within 60 characters of a gate token (for example "amended" near "ADR 0090"). The #569 TD row is among the 14 released.

The other registers (the index, `OPEN-DECISIONS.md`, `PROJECT.md`, `FUTURES.md`) need their own answer, because the index already has its own pure-append rule.
