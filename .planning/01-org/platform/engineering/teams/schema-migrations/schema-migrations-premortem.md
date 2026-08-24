---
type: premortem
division: platform
department: engineering
team: schema-migrations
status: provisional
metrics: [schema.days_since_hand_applied_ddl, schema.parity_job_green_streak]
updated: 2026-08-24
links: ["[[schema-migrations-charter]]", "[[schema-migrations-loops]]", "[[schema-migrations-directive]]", "[[engineering-premortem]]", "[[sre-state-integrity]]", "[[inventory-ledger-premortem]]", "[[red-team-charter]]"]
---

# Schema & Migrations — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:292-294`): *a production incident is
fixed with a live `ALTER` at 2am — correctly, because the alternative was downtime — the
parity job goes red, red becomes normal, and the team is back to 2026-08-05 with a red
badge instead of no badge.*

The unusual thing about this premortem is that its first step is **correct behaviour**.
Nobody makes a mistake. That is what makes it likely.

## It is 2027-08. This team has failed. What happened?

### M1 — Red became the normal colour

An incident at 2am was fixed with a live `ALTER`. That was the right call: the alternative
was downtime. The parity job went red the next morning. Everyone knew why, so nobody
treated it as news. A week later a second, unrelated drift appeared — and it was invisible,
because the badge was already red. Six months on, "the parity job is red" is a fact about
the world rather than a signal. The team has arrived back at 2026-08-05 — **27 tables, 403
columns, 13 functions with no source** — but now with a red badge instead of no badge,
which is arguably worse: the instrument exists and has been trained to be ignored.

**Earliest observable signal.** The parity job red for **two consecutive runs** with the
explanation living in a chat message rather than in a migration file. Also: any PR
description containing "already applied in prod".

**Counter-pressure.** **A red gate is closed by a file, not by a sentence.** The
reconciliation migration lands within one close-time or `schema.days_since_hand_applied_ddl`
publicly resets to zero and stays there. Because it is a **streak**, it cannot be averaged
away — the number is either rebuilding from zero or it is not. And the auditor declares red,
not the author ([[sre-state-integrity]], `technology.md:296-298`), so the team that did the
2am `ALTER` is not the team deciding whether it still counts.

---

### M2 — The emergency path was never designed, so it was improvised every time

The 2am `ALTER` is inevitable — some incidents genuinely cannot wait for a migration
pipeline. What is *not* inevitable is that it be improvised. With no defined emergency
procedure, each incident produces a slightly different shape: sometimes a migration follows
within hours, sometimes a note, sometimes nothing. The variation is what makes drift
accumulate; a single 2am `ALTER` followed by a reconciliation migration at 9am costs the
streak one day and nothing else.

**Earliest observable signal.** A hand-applied DDL with no ticket, no drift-inventory
entry, and no follow-up migration within 24 hours. The **first** one sets the template.

**Counter-pressure.** Write the emergency runbook **now**, while calm: what may be applied
by hand, who may do it, what is recorded at the time (statement, timestamp, operator), and
the hard requirement that a reconciliation migration lands within one close-time.
`.planning/SCHEMA_DRIFT_INVENTORY.txt` is the register. An emergency path that is designed
is a cost; one that is improvised is this premortem.

---

### M3 — Postgres functions drifted where the grep guards do not look

The original incident included **13 functions created by no migration** —
`calculate_sales_velocity` and `resolve_sku_to_inventory` were business logic with no
source in the repo (`scripts/check_schema_parity.sh:6-11`). Functions are the worst drift
class: they contain *logic*, not just shape, and they are invisible to the guards that
protect other invariants. `scripts/check_no_direct_stock_writes.sh` greps TypeScript, so a
Postgres function writing `stock_live` directly passes it —
[[inventory-ledger-premortem]] M1 and this mechanism are the same hole seen from two sides.

**Earliest observable signal.** Any function body in production whose text does not match
the repo — including a whitespace-level mismatch, since a re-created function is a rewritten
function. Parity on functions must compare **bodies**, not just names and signatures.

**Counter-pressure.** Function parity compares bodies. Every function has exactly one
authoritative source in `supabase/migrations/`. When a domain team needs logic in the
database — and sometimes that is right — it is authored here as DDL, reviewed as code, and
covered by the guard extension [[inventory-ledger-charter]] needs anyway.

---

### M4 — Generated types stopped being generated

`packages/database/src/types/database.types.ts` is generated from the schema. Under time
pressure someone hand-edits it — to add a column the migration will add "next week", or to
unblock a build. The file is now a hand-maintained artifact that *looks* generated.
TypeScript then confidently asserts a shape production does not have, and the compiler —
the strongest tool available for catching schema mismatches — is quietly telling everyone
a false story.

**Earliest observable signal.** A diff to a generated types file in a PR that contains no
migration. Structurally detectable and cheap: generated files and migrations should change
together or not at all.

**Counter-pressure.** CI regenerates types and fails on any difference, so a hand edit
cannot survive a build. Types are never edited, only regenerated — a rule that is easy to
state and needs machine enforcement precisely because the temptation arrives during time
pressure, when rules are weakest.

---

### M5 — Migration authorship drifted to whoever needed the column

62 migrations exist and were authored by whoever needed them. That is how it works before
there is an owner, and it is not a criticism. But if it continues after this charter, the
team owns a directory rather than a practice: irreversible operations (a dropped column, a
narrowed type, a `NOT NULL` on populated data) get written by people who reasonably do not
think about them daily, and reviewed by people optimising for a feature landing.

**Earliest observable signal.** A merged migration containing `DROP COLUMN`,
`ALTER TYPE`, or an unbackfilled `NOT NULL` with no review from this team. One instance is
the signal.

**Counter-pressure.** Any migration touching an **irreversible operation class** requires
this team's review — not all migrations, which would make the team a bottleneck and get
routed around. Publish the list of irreversible operations so it is checkable, and let
everything else pass with normal review. `scripts/concat_migrations.py` and
`scripts/run_migration.sh` are the practice's surface; keeping them ergonomic is what
prevents the routing-around.

---

## What [[red-team-charter]] should attack first

M1, and specifically the claim that "red is explained". The department's most valuable
instrument is a gate that has been red once with a good reason. Ask, on any red day:
*which file closes this, and when does it land?* If the answer is a sentence, the failure
has already started.
