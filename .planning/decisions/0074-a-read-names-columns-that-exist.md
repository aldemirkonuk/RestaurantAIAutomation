# 0074 — A read names columns that exist, and a guard that cannot look says so

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** check_read_columns_exist, select list, 42703, PostgREST, filters, column contract, shrink-only ratchet, CANNOT-CHECK, absence reported as health, guard design
- **Links:** [[0073-a-delivery-event-is-closed-by-its-order-id]] (surfaced the gap and deliberately left it unfiled), [[0056-order-paths-write-columns-that-exist]] (the write-side contract this mirrors), [[0065-a-conversation-log-names-real-columns-and-refuses-a-missing-body]] (whose read half this measures), [[0068-calendar-events-recurring-order-link]], [[0058-order-status-is-an-enum-not-a-string]]

## Context

[[0073-a-delivery-event-is-closed-by-its-order-id]] fixed two functions that
found a calendar event with `.select("id, tags")` against a table that has never
had a `tags` column. Its Consequences section recorded the part it could not
fix:

> **The guard is not evidence for this fix, and says so.**
> `check_order_capture_contract.py` reads `.insert`/`.update` payload keys. Both
> pre-fix functions named `tags` in a `.select()`, which the guard is
> structurally incapable of seeing — it passed on the pre-fix tree at exit 0.

That is the whole case. **A column named in a select list is exactly as fatal as
one in an insert payload** — PostgREST answers `42703` and fails the *entire*
statement — and nothing in CI had ever looked at one. The guard that appeared to
cover the area was green, at exit 0, for the entire life of the defect. It was
not wrong; its `WRITE_SITE_RE` (`scripts/check_order_capture_contract.py:559`)
matches `.insert|update|upsert` and a select is outside its universe. **A guard
being structurally incapable of seeing what it looks like it covers is the same
fault as the bug it missed, one level up** — `absence-reported-as-health` applied
to the checking apparatus itself.

The measurement, taken before any of this was designed, says the gap was not
theoretical. Across `apps/api-gateway/src`:

| | Count |
|---|---|
| readable `.select()` sites | 607 |
| filter arguments naming a column | 1371 |
| **select columns that do not exist** | **17** |
| **filter columns that do not exist** | **8** |
| **distinct `table.column` behind them** | **16** |

The two site counts are a **snapshot that moves with the codebase** — they were
604/1364 one merge earlier and will drift again; only the findings, the keys and
the blind spot are ratcheted. Re-measured on the current tree, not carried
forward: the first pass found
**27** findings over 17 keys, and `procurement_orders.next_order_date` was
repaired on `main` by [[0061-recurring-reminder-reads-the-recurrence-table]]
between the two runs. **The ratchet caught that itself** — see Consequences.

Some of those are not small. `procurement_orders.payment_due_date` is the sharpest.
`scheduled-tasks.service.ts` builds a three-clause date window on it, and
`payment_due_date` **is declared by no table in the schema at all** — the
nearest real column anywhere is `payment_terms`. It is not a wrong-table read
with a right table to point at; there is nothing to point it at, and the
payment-reminder cron has never sent one reminder. `users.avatar_url` is read at three sites, so
every team and member listing 42703s. And `procurement_conversations.message_body`
/ `.subject` are the **read half of the write defect
[[0065-a-conversation-log-names-real-columns-and-refuses-a-missing-body]] fixed**
— that ADR repaired the payload and left the reader naming the same phantom
columns, because nothing was looking at readers.

## Options considered

**A. Where it lives.**

1. **A sixth contract inside `check_order_capture_contract.py`.** Direct reuse,
   one CI step, one self-test harness. Rejected: that file is 1300 lines and all
   five contracts are write-path; its name, docstring and fixture are about order
   capture, and a read contract stretches all three. Its fixture would have to
   grow a second axis. It is also the file two other changes touched this week —
   [[0068-calendar-events-recurring-order-link]], and
   [[0073-a-delivery-event-is-closed-by-its-order-id]], which had to repair its
   self-test — so restructuring it is the highest-conflict edit available.
2. **A standalone script with its own migration parser.** Rejected outright: two
   parsers for one schema is how the two answers drift apart, and the drift would
   be invisible.
3. **A sibling script that loads the shared helpers by path.** Chosen.
   `declared_columns`, `ts_sources`, `strip_comments` and `_split_top_level` are
   imported from the existing guard, so there remains exactly one migration
   parser and one comment stripper in the repo. Loading by path is the repo's own
   idiom (`_od_collisions.py`, `check_beverage_identity_parity.py`).

It also lands in the right *conceptual* place. `check_queried_tables_exist.py`
is the established read-path guard, and this is its column-level counterpart:

> that guard — does the **table** the code reads exist?
> this guard — do the **columns** it names in that read exist?

**B. Filters: in scope, or a follow-up?** A bad column in `.eq()`, `.order()` or
`.not()` is the same `42703` as one in the projection. The argument for deferring
was false positives — embedded filters (`.eq("providers.name", …)`) and aliases
would need FK resolution.

**That argument was measured rather than believed, and it did not survive.** Of
the 1371 filter arguments in the gateway, **zero** are dotted/embedded and one
is a non-identifier. Excluding filters would have left 8 live instances of
exactly this defect unseen, on a theory the codebase contradicts.

**C. What to do about reads the parser cannot resolve.** `.select(cols)` with a
runtime value names columns that cannot be checked statically.

1. **Skip them silently.** This is the bug, reproduced inside its own fix.
2. **Fail on any of them.** Would block on two legitimate dynamic reads and get
   the guard switched off.
3. **Resolve what is statically knowable, count the rest, and ceiling the
   count.** Chosen. Resolving `"a" + "b"`, `` `a, b` `` and a same-file
   `const X = "…"` took the unreadable set **from 26 sites to 2** — and those 24
   were the long multi-column selects most likely to hide a bad column, so
   leaving them unresolved would have been a guard that mostly looked away.

## Decision

**Ship `scripts/check_read_columns_exist.py`: every column a read names —
in a projection or in a filter — must be declared by `supabase/migrations/`, or
be on a shrink-only debt list.**

- **Both halves of a read are checked**, per option B, on the measurement above.
- **Skipped, deliberately and named in the script:** `.select()` with no
  argument, `"*"`, and any parenthesised embedded resource
  (`providers(name)`, `inventory:inventory_id(…)`, `providers!left(name)`).
  Resolving an embed needs the FK graph, which a static parse does not have, so
  the token is skipped rather than guessed at. Aliases (`alias:column`), casts
  and `->` json paths are unwrapped to the real column.
- **`UNREADABLE_READ_CEILING = 2`**, measured, per option C. It may shrink
  freely; growing it requires editing that line, because every addition is a
  read the guard has stopped looking at.
- **`KNOWN_BAD_READ_COLUMNS` starts at 16 entries**, one per distinct
  `table.column`, each naming the column the table actually has where one is
  obvious. It is enforced in **both** directions — an entry the schema now
  declares fails, and an entry nothing reads any more fails — so the only way to
  touch it is to make it shorter. The list is **debt, not approval**: it exists
  so the guard is green on arrival and can therefore block the *next* one.
- **CANNOT-CHECK exits 2, never 0**, for: the shared parse missing or not
  importable, the shared parse no longer exporting a helper, the migration parse
  collapsing below 150 tables, or the site patterns matching fewer than 200
  selects / 400 filter arguments. A pattern that matches nothing is the exact
  failure this guard exists to catch, committed by the guard itself.

**One subtlety worth recording, because it was a real bug in the first draft and
the self-test caught it.** The shared module raises **its own** `CannotCheck`
class, which is not this file's. Untranslated, a blind shared parse escaped as an
uncaught exception and Python exited **1** — which CI reads as *"a column is
missing"* when the truth is *"this guard could not look."* The exit-2 state
exists precisely to keep those apart, and it was defeated by a class identity.
`CannotCheck` is now part of the required-exports contract and is translated at
the boundary.

**And one in the claim, for the same reason.** `CLAIMS.jsonl`'s entry for this
ADR asserts both ratchets are shrink-only. Written to read the constants by
*importing* the module, it returned a **stale** ceiling: the test edit changed
`2` to `3` — the same number of bytes, inside the same second — so
`__pycache__` was still valid by mtime-and-size and Python answered for a
version of the file that no longer existed. **A guard that reads a cache is
answering about something other than the thing it was asked about**, which is
this ADR's own subject one more level up. Both arms now read the source text
directly. CI never hits it (a fresh checkout has no `__pycache__`), which is
exactly why it would have survived indefinitely.

## Consequences

- **A bad column in a read is now a build failure**, on the same footing as a bad
  column in a write. The two guards together mean a column named anywhere in a
  Supabase call — payload, projection or filter — is checked against the schema.
- **25 live defects are now recorded with evidence** instead of being unknown.
  They are not fixed here: repairing them means deciding, per site, whether the
  right move is the real column, an embed, or deleting a dead query — and
  `scheduled-tasks.service.ts` alone would be its own change. **The debt list is
  the deliverable that makes them enumerable**, which is the one thing class-O
  damage otherwise denies (`absence-reported-as-health`).
- **The blind spot is 2 reads and is now a number**, not an unknown.
- **The ratchet paid for itself within a day, on this ADR's own list.** #227
  merged `procurement_orders.next_order_date`'s fix to `main` after the first
  measurement, and on the next merge the guard failed at exit 1: *"nothing under
  apps/api-gateway/src reads it any more. Delete the entry."* That is the exact
  shape that had just broken the sibling guard's self-test, caught mechanically
  this time instead of by hand — and it is the argument for enforcing a debt
  list in **both** directions rather than only against new violations.
- **This does not check the database.** Like its siblings' hermetic arm, it
  compares code against `supabase/migrations/`, needs no secret, and runs in
  seconds. A column that exists in a migration but not in production is
  `schema-parity.yml`'s question.
- **It does not cover `services/agent-orchestrator` (Python).**
  `check_queried_tables_exist.py` scans both languages at the relation level;
  this one scans TypeScript only, because `ts_sources` is what the shared parse
  offers. That is a real, named gap and the obvious next extension.
- **A guard is only as good as its own failure path**, so `--self-test` runs in
  CI beside it, with 13 assertions including the exact ADR 0073 defect, the
  comment false-positive, the cross-statement mis-pairing case, both ratchet
  directions, an empty ratchet, and six ways of going blind.

**A third instance, in the guard's own regex.** CodeQL flagged `py/redos` on the
first push: the concatenation pattern was written `(?:\s*<lit>\s*\+?)+`, whose
`+` is optional and whose `\s*` can match empty on either side, so one input has
exponentially many parses. Measured on `let $="" ""…`: **0.002s at 12
repetitions, 1.675s at 22.** It is not reachable from user input — the regex
reads repo source in CI — but **a guard that can be made to hang is a guard that
can fail to check**, which is this file's whole subject. Rewritten so each
further literal is introduced *by* a `+`, giving one parse per input: 5000
repetitions in 0.0001s, and the old and new forms produce **identical** results
on the tree (607/1371/2/25/16), so the fix changed nothing but the worst case.

## Verification

| What | Result |
|---|---|
| `scripts/check_read_columns_exist.py` on the tree | **exit 0**, 16 debt entries |
| Same guard, **proven to fire on the real defect** — ADR 0073's `.select("id, tags")` restored in place into `procurement.service.ts` | **exit 1**: `procurement.service.ts:1180 selects calendar_events.tags, which no migration in supabase/migrations declares` |
| …and it did **not** fire on `:1121`, the same string inside that function's doc comment | comment stripping proven on the real tree, not only the fixture |
| `--self-test` | **PASS**, 13 assertions |
| CANNOT-CHECK proven on a real empty directory, not only in the fixture | **exit 2** |
| `check_order_capture_contract.py` + `--self-test` | exit 0, PASS |
| `check_queried_tables_exist.py`, `check_citation_pairing.py`, `check_decision_claims.sh` (117), `check_adr_numbers_unique.py` (476 refs) | exit 0 |
| `npx jest src/procurement` | 343 passed, 3 skipped, 24 suites |

The pre-fix defect was restored by editing the file **in place** and diffing it
back afterwards — never `git stash`, which is repo-global across worktrees
([[shared-checkout-concurrent-sessions]]).

## Consequences for the register

No `OPEN-DECISIONS.md` row ([[0025-citations-must-disagree-loudly]]: adding one
re-anchors ~41 citations). One `CLAIMS.jsonl` entry.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
