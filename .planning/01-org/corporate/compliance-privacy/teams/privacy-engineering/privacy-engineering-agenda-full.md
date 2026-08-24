---
type: agenda-full
division: corporate
department: compliance-privacy
team: privacy-engineering
status: provisional
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, privacy.store_inventory_coverage]
updated: 2026-08-24
links: ["[[privacy-engineering-charter]]", "[[privacy-engineering-premortem]]", "[[privacy-engineering-directive]]", "[[privacy-engineering-loops]]", "[[privacy-engineering-schedule]]", "[[privacy-engineering-agenda-board]]", "[[compliance-privacy-agenda-full]]", "[[regulatory-posture-charter]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[customer-relationship-research-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[schema-migrations-charter]]", "[[security-charter]]", "[[decision-office-charter]]"]
---

# Privacy Engineering — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The team's
> controls are committed and CI-enforced; its primary metric is 0%, and the schema
> those controls protect has never been called by application code.

## What

Five deliverables. The first three are days of work each and unblock everything else.

1. **One PII definition.** Collapse three definitions across four guards into one
   module plus one CI guard, with a specimen corpus asserted against every consumer.
2. **A discovered store inventory.** Enumerate every table from the live catalogue,
   classify each as person-bearing or not, and make an unclassified table a *failing*
   condition rather than an omission.
3. **An erasure path that produces a receipt.** The receipt table
   `erasure_receipt_id` (`:82`) already points at nothing; build the thing it points
   at, plus the function that writes it, plus the drill that proves absence.
4. **The consent gate**, as a callable check with a real denial path — the dependency
   [[customer-relationship-research-charter]] is blocked on.
5. **The schema's first caller.** One consent record captured end to end through
   `guest_link_identifier()`, so the spine has been exercised once.

Explicitly *not* on this list: obligations and registers
([[regulatory-posture-charter]]), instruments (Legal), access control (Security),
identity resolution ([[guest-identity-consent-charter]]).

## How

**Sequencing claim: define → inventory → erase → gate → call.** Counter-intuitive,
because item 5 sounds like the foundation and is listed last. It is last because it
requires a negotiation with Product about who builds the capture surface, and the
first four do not require anyone else's roadmap. A team whose entire plan is blocked
on another team's sequencing has no plan.

- **Define.** `services/agent-orchestrator/privacy/pii.py` — one pattern set, one
  version constant, imported by `constraint_engine.py` (today `:28-36`) and
  `provider_communication_agent.py` (today `:40-48`, a byte-identical copy) and
  `research_tasks.py` (today `:101-102`, a disjoint email/phone definition). Then
  `scripts/check_single_pii_definition.sh` in the shape of the five guards already in
  CI. **Then the part that matters more than the merge:** a specimen fixture — SSN,
  IBAN, card, email, phone, passport, a guest name, a hashed channel — asserted
  against every consumer. The list makes them agree today; the corpus makes them
  agree after the next edit, and it surfaces the two specimens that currently fail on
  all four guards.
- **Inventory.** A script over `information_schema.columns` producing
  `(table, column, person_bearing?, classified_by, classified_at)`. Seed the
  person-bearing side from the six sinks `check_no_raw_guest_channels.sh` already
  names, then classify the rest. **An unclassified table fails the job.** That is the
  forcing function; without it a new migration silently widens the denominator, which
  is [[privacy-engineering-premortem]] M2.
- **Erase.** `guest_erasure_receipts` table + an `erase_guest()` security-definer
  function in the same style as `guest_link_identifier()` (`:375`, execute revoked
  from public, granted narrowly at `:504-506`). The receipt records *which stores
  were checked and by what evidence* — not a boolean.
- **Gate.** A single callable check: given a guest and a purpose, is there a live
  consent record whose `consent_purpose` covers it and whose `consent_withdrawn_at`
  is null? Returns a decision **and a reason**. Denials are counted; a gate with zero
  denials over a quarter is unused or misconfigured, and those look identical from a
  dashboard — the exact failure shape
  `services/agent-orchestrator/agents/compliance_agent.py:11-15` describes for stub
  agents.
- **Call.** One `staff_verbal` capture path, end to end, with
  [[guest-identity-consent-charter]]. The narrowest of the four CHECK-constrained
  channels (`:60-62`) and the one needing no new UI surface.

**Method note.** Every control this team ships should be a grep or a test where a
grep or a test suffices. The repo already proves the pattern for privacy
specifically: two guard scripts run on push, PR and a daily cron
(`.github/workflows/schema-parity.yml:19-27, 152-154`), and their headers carry the
*argument*, not just the rule — which is why a future contributor learns why before
adding an allowlist entry. Copy that convention including the header essay.

## Why now

1. **Every item is cheap exactly once, and this is that moment.** Three PII
   definitions merge in an afternoon; thirty is a project. An erasure denominator over
   a handful of tables is enumerable; over two years of accreted schema it is a
   forensic exercise. `check_no_raw_guest_channels.sh` makes this argument about
   itself — *"free to enforce now and impossible to enforce later"* — and it is the
   single most reusable sentence in this repository.
2. **The design fights are already won.** Consent-as-a-record, tombstone-not-soft-delete,
   hash-only channel storage, verified-only merge keys: all committed, all argued
   in-file, none of them needs re-litigating. This team is unusually free to just
   build.
3. **Two other teams are blocked on us.**
   [[customer-relationship-research-charter]] cannot start without the gate;
   [[regulatory-posture-charter]] cannot cite a control that has never run.
4. **The NF-B store is empty today.** Its erasability question is answerable for free
   now and expensive later, monotonically. See §Questions 4.

**Why *not* now, honestly.** No guest data is flowing. A controls team hardening a
path with no traffic is doing preventive work with no visible customer, and it will
lose most weeks against the product's named blocker — data ([[README]] §1). That is
why this plan is sized in days and why items 1–3 do not require anyone else's
attention to complete.

## Next steps

| # | Step | Depends on | Unblocks |
|---|---|---|---|
| 1 | `privacy/pii.py` — one definition, one version constant | — | guards 1–3 converge |
| 2 | PII specimen corpus asserted against all consumers | 1 | proves the merge held |
| 3 | `check_single_pii_definition.sh` in CI | 1 | prevents re-divergence (M1) |
| 4 | Store inventory script over `information_schema`, unclassified = fail | — | the erasure denominator (M2) |
| 5 | `guest_erasure_receipts` table + `erase_guest()` | 4 | a receipt that can claim something |
| 6 | Monthly erasure drill: create → exercise → erase → enumerate → assert | 4, 5 | `privacy.erasure_completeness` |
| 7 | Consent gate as a callable check with reasons + denial counter | — | [[customer-relationship-research-charter]] |
| 8 | `check_no_guest_pii_outside_identifiers.sh` — the bypass guard | 4 | M4 |
| 9 | Expiring allowlists on both existing guard scripts | — | M3 |
| 10 | First `staff_verbal` consent capture, end to end | Product negotiation | `privacy.consent_call_sites` > 0 |
| 11 | Erasability requirement filed against the NF-B schema | — | M5; needs a founder decision |

Steps 1–5, 8 and 9 need nobody outside this team. Step 10 is the realistic critical
path and is a scheduling negotiation, not a technical one.

## Questions for the founder

1. **Who builds guest consent capture?** All four `consent_captured_via` values
   (`:60-62`) lack implementations. Proposed: Product builds the surface, this team
   owns the record's contents and validity rules. Per CLAUDE.md §0.1 that is not
   decided until it is written in `.planning/decisions/`. **This session had no write
   access outside the department directory to file it.**
2. **May this team block a migration?** The charter claims privacy-by-construction
   review of schema changes, jointly with [[schema-migrations-charter]]. A review that
   cannot hold a migration is advice. If it can, the store inventory's
   "unclassified = fail" rule has teeth; if not, M2 is unpreventable.
3. **Do the guard allowlists get expiry?** An expiring allowlist converts the cheap
   path from "add a line" to "add a line that comes back to you". It also means
   someone's build can fail for a reason unrelated to their change, which is a real
   tax. Both scripts have empty allowlists today, so the policy costs nothing to
   adopt now and is unenforceable to retrofit at eighteen entries.
4. **NF-B erasability — decided by whom, by when?** Deliberately not proposed here.
   [ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md) locks the
   research store as append-only and never migrated; guest taste fingerprints are
   personal data; the three reconciliations (crypto-shredding per-subject keys,
   subject-level partitions, aggregate-only retention) all cost ML value and all must
   be designed in from row one. **A controls team that unilaterally picks the
   ML-cheapest option has failed; one that picks the most expensive has overreached.**
   What this team asks for is a decision with a date while the store is empty.
5. **Is "no guest PII outside the identity spine" a rule we are willing to enforce?**
   The guard is trivial to write. It will occasionally block a shortcut that a
   restaurant's urgent request makes tempting. Enforcing it is a real constraint on
   product velocity and should be agreed before it is written, not discovered when it
   first fires.

## What this team owes others, and when

| Consumer | Owed | Blocking them today? |
|---|---|---|
| [[customer-relationship-research-charter]] | The consent gate | **Yes** — they cannot start |
| [[regulatory-posture-charter]] | Controls with `file:line` evidence, and honest gaps | Partly — 2 controls citable, the rest are gaps |
| [[taste-fingerprint-charter]] | What NF-B may not condition on; erasure behaviour | Not yet — becomes blocking at first row |
| [[security-charter]] | One definition of PII to protect | Yes — they currently have three to choose from |
| [[schema-migrations-charter]] | The person-bearing classification for new tables | Not yet — no inventory exists to classify against |
