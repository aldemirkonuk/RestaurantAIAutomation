> **Needs the founder's word (ADR 0090, 2026-09-18 amendment).** This PR edits an existing row of `.planning/decisions/README.md`, which the audit gate gives to the founder. Nothing else is in it. It was split out of #628 so #628 no longer touches an owned file.

**Branch** `docs/the-a045-index-row-says-what-the-cellar-counts`, from origin/main `b30ca260e`. 1 file, 1 line.

## Why

The ADR 0090 audit of #628 at `0c5e3b55e` was BLOCK (comment 6048728727). One of its two reasons: the decision index row for ADR 0301 (`README.md:212`) says §2 counts the door-checked price "until a filed invoice takes over" and that A-045 is open until #628 merges. Once #628 merges, the index would say something broader than the code, and the entry point for "what is locked, what is open" would still show A-045 open.

What #628's code does (ADR 0301 amendment 1): the door-checked price counts until an invoice is linked to that order or its line is paired with the order's line. An invoice filed without either counts alongside it, and a Paid that adds both books reads 'door-checked + invoiced'. That fork was decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, not by the founder; ADR 0301 records the reasons and the rejected options.

## What changes

`.planning/decisions/README.md`, the ADR 0301 row only: one dated bracket after the 2026-10-05 one, saying the above and that A-045 resolves when #628 merges. No other row, no code.

## Merge order

Either order is safe. If this merges first, its bracket says A-045 resolves when #628 merges, which is still true then. #628 points at this PR from ADR 0301's review trail.

## Not done

- No claims row: the bracket is prose about a PR that has not merged yet.
- Checks run on this branch at `623ee73dc`: `check_decision_claims.sh` **937/937**; `lanecheck.sh` six fast guards rc=0, files=1, and the ownership check names the one owned edit (above).
- No ADR 0090 audit has run. The gate will not release an owned change without the founder's word in any case.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
