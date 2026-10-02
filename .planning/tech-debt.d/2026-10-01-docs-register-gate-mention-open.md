## A claims row that mentions the audit gate in passing still makes any edit to it gate-owned — OPEN — 2026-10-01

Filed on the founder's word, chat, 2026-10-01, verbatim: *"File it, build later (Recommended)"*. He was asked whether the 2026-09-30 narrowing (ADR 0090, "a decision record is owned by its subject, not by a mention") should reach `CLAIMS.jsonl` rows. Line numbers are at `main` `e39935fbc`.

**What.** The narrowing judges a non-register record by its subject and by any rule about the gate stated in it (`scripts/pr_audit_gate.py:1129-1140`). Registers were left out on purpose ("Registers keep their line-diff rules unchanged", ADR 0090 line 2509). Each changed run of a register is passed whole to `_scan_text` (`scripts/pr_audit_gate.py:1164-1178`), so a mention anywhere in a removed or added `CLAIMS.jsonl` line owns the PR.

**Real instance.** PR #569 at `7211683fa` changes only the `verify` fields of two rows, `TD-2026-09-27-PROMOTIONS-ROOM-SHOWN-TO-STAFF` and `OD-176-PROMOTIONS-HAND-IS-A-MANAGERS-FOR-STAFF`. The TD row's unchanged `claim` text says it was "Filed from the ADR 0090 audit of #487", so `--ownership` exits 3 with `.planning/decisions/CLAIMS.jsonl: removed text names the audit gate`. It was escalated in comment 5944848249. The founder chose *"Review, then your word (Recommended)"*, recorded in the review comment 5945006683.

**Size.** Running `origin/main`'s `_scan_text` on each line of `CLAIMS.jsonl` (746 rows) gave 26 hits. By their ids, 4 are about the gate itself: `ADR-0090` (two rows), `ADR-0231-SUPERSEDES-0050` and `ADR-0237-AUDIT-EFFORT`. The other 22 have ids about other subjects. One example is the TD row above, which names the gate only because an audit filed it. An edit to any of those 22 needs the founder's word today.

**Fix (build later; gate-owned, so it needs his word).** Judge a changed `CLAIMS.jsonl` row the way `_scan_record` judges a claims fragment:
- by its `id` (every `id` key);
- by any rule about the gate (`GATE_RULE_RE`) in its raw line and its decoded keys and values.

Keep the hygiene checks, the JSON-parse check and the line-diff bound on every changed line. A row with no `id` has no subject, so it keeps today's whole-row scan (`CLAIMS.jsonl` has 2 such rows; neither names the gate).

**What that fix would release.** Measured with `origin/main`'s `skeleton`, `GATE_SUBJECT_RE` and `GATE_RULE_RE` on each of the 26 rows: 12 stay owned and 14 are released. The 12 are the 4 gate rows above (by id) and 8 others whose skeleton text has a listed verb stem up to 60 characters from a gate token, on either side (for example "amended 2026-09-27" before "ADR 0090" in `ADR-0164-SESSIONS-FOLLOW-MEMBERSHIP`). The #569 TD row is among the 14 released.

It also owns rows that are released today, so it is not a pure narrowing. Rows 148–156 all have the id `ADR-0097` (deploy verification). `GATE_SUBJECT_RE` names 0097, 0231 and 0237, while today's text scan names only 0050 and 0090. Of those 9 rows, 5 verify the deploy check (`deploy.yml`, which the gate owns, `check_deployed_sha.py` or `check_deploy_audit_ran.sh`). 2 verify the gateway's health routes, and 2 name no file. Whether owning them is right is for the build's review to say.

**What it would still miss.** A row whose `id` is not about the gate but whose `verify` checks a gate file would be released. No such row exists today. `CLAIMS.jsonl` is frozen (ADR 0240, its last line), so new rows go to `claims.d/` fragments, which `_scan_record` already judges by id and rule. The build must judge both the removed and the added side, so that a row whose gate id is edited away stays owned by its old id.

The other registers (the index, `OPEN-DECISIONS.md`, `PROJECT.md`, `FUTURES.md`) need their own answer, because the index already has its own pure-append rule.
