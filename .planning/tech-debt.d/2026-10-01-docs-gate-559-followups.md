## The ADR-number guard prints an empty "on" line for a same-tree-only collision — OPEN — 2026-10-01

Filed after PR #559 (merged `2019ae7f6`). Non-blocking note from its round-2 correctness review.

**What.** `scripts/check_adr_numbers_unique.py` `report_collision()` prints, for each other slug, `on {fmt_refs(where[(number, slug)])}` (`:361` at `2019ae7f6`). Since #559 a collision can come from a slug that exists only in this tree, committed or staged. When that slug is on no swept ref, `where[(number, slug)]` is empty and the line reads `on ` with nothing after it.

**Fix.** When `where` has no ref for that slug, print `in this tree` instead. Add a self-test assertion on the 9005 staged case's output.

## Non-canonical decision file names are outside the number rule and the ADR-number guard — OPEN (by design) — 2026-10-01

Filed after PR #559. Stated as a residual in ADR 0090's 2026-10-01 case follow-up.

**What.** The guard's `ADR_RE` (`scripts/check_adr_numbers_unique.py:130` at `2019ae7f6`) parses only `NNNN-slug.md`, where the slug is letters, digits and hyphens in any case. The gate's number rule (`ADR_FILE_RE`, `scripts/pr_audit_gate.py:599`) takes lowercase ASCII slugs only. A name outside that shape is not parsed by either: `0097_x.md`, `0097.md`, or `0097-x_y.md`.
- Without the hyphen after the number (`0097_x.md`, `0097.md`), the file is also outside the owned prefixes. It is owned only by the subject or rule test of ADR 0090's 2026-09-30 amendment: its title, metadata or claim id names the gate, or its text states a rule about the gate. The guard never counts its number.
- With the hyphen (`0097-x_y.md`), the owned prefix `.planning/decisions/0097-` still owns it, in any letter case. The guard does not count its number.

**Today.** Measured 2026-10-01 at `2019ae7f6`: none of the 1,552 local and origin refs holds a name under `.planning/decisions/` that starts with a gate number (0050, 0090, 0097, 0231, 0237) and is not `NNNN-slug.md`.

**Fix (not decided here; the founder's call).** Two options: add a guard that fails on any file under `.planning/decisions/` that starts with four digits but does not match `NNNN-slug.md`, or own `.planning/decisions/0097` and the other gate numbers without the hyphen.

## Two ADR 0090 lines read narrower than the code since #559 — OPEN — 2026-10-01

Filed after PR #559. Non-blocking notes from its reviews. Both are true as written but out of date.

**What.**
- `.planning/decisions/0090-pr-audit-gate-autonomous-merge.md:2499` (at `2019ae7f6`), in the 2026-09-30 amendment: "0050 and 0090 are also owned by path". Since #559 all five gate numbers are owned by path.
- `:2514`: "`--self-test`: 102 → 121 invariants". #559 took it to 122.

**Fix.** Add a dated bracket to each line in the next gate-owned ADR 0090 edit. ADR 0090 is a gate-owned path, so that edit merges only on the founder's word, as every owned PR does under ADR 0090. That same edit should record in the review trail the founder's #559 merge answer, chat, 2026-10-01, verbatim: "Merge #559 (Recommended)". It sits in #559's PASS comment, not in the ADR.
