---
type: agent-stack
division: corporate
department: compliance-privacy
team: privacy-engineering
status: designed
updated: 2026-08-27
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, privacy.store_inventory_coverage]
links: ["[[privacy-engineering-charter]]", "[[privacy-engineering-schedule]]", "[[privacy-engineering-loops]]", "[[privacy-engineering-directive]]", "[[privacy-engineering-premortem]]", "[[0034-agent-stack-artifact]]", "[[compliance-privacy-agent-stack]]", "[[regulatory-posture-agent-stack]]", "[[action-safety-the-human-gate-agent-stack]]", "[[schema-migrations-charter]]", "[[taste-fingerprint-charter]]", "[[neural-footprint-instrumentation-charter]]"]
---

# Privacy Engineering — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's controls belong in CI, not in an agent: a `check_*.sh` guard is
> always-on and cannot be forgotten to invoke, and *"a skill that duplicates a CI
> guard is sprawl with extra steps"* ([[privacy-engineering-schedule]]). So the card
> below owns only the half a guard cannot do — **the judgement** — and is forbidden
> the half it can.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pii-store-classifier` | Decide the two questions a grep cannot: **is this newly-found pattern PII**, and **does this store carry a person** — producing inventory rows and definition proposals, never the guard and never an erasure | NEW; everything it would classify EXISTS |

## 2. Agent cards

```yaml
agent: pii-store-classifier
unit: privacy-engineering
triggers:
  - schedule: "monthly, ahead of the erasure drill so the denominator is current"   # [[privacy-engineering-schedule]]
  - topic: table.created            # publisher: NONE (gap — the daily schema-parity rebuild detects drift but emits no event)
  - topic: guard.definition_changed # publisher: NONE (gap — the two running guards emit a CI verdict, not an event)
consumes:
  - the live catalogue via the schema-parity rebuild — every table, classified or unclassified
  - "the four PII definitions: constraint_engine.py:28-36, provider_communication_agent.py:40-48, research_tasks.py:101-102, 20260805000000_baseline_from_production.sql:1080"
  - "the guest schema: 20260819000000_guest_identity_minimal_slice.sql:58-64 (consent), :79-82 (tombstone), :131-145 (HMAC + canonicaliser_version)"
  - both guard allowlists (empty today) — check_no_guest_name_matching.sh, check_no_raw_guest_channels.sh
emits:
  - "store-inventory rows (person-bearing / not / unclassified) → privacy.store_inventory_coverage → [[compliance-privacy-agent-stack|cp-orchestrator]] board"
  - "proposed content for the single PII definition → enforced by check_single_pii_definition.sh in CI, never by this agent"
  - "erasability requirements placed on other teams' schemas → [[neural-footprint-instrumentation-charter]], [[taste-fingerprint-charter]] (consumers named; no event channel — gap)"
  - "convergence and drill verdicts → [[regulatory-posture-agent-stack|obligation-register-steward]], which needs them to drop or keep a citation's caveat"
  - nf_a events (task_type: privacy_classification)
routing_class: judgment       # deciding whether a pattern IS PII is judgement; finding the patterns is a grep and belongs in CI ([[privacy-engineering-schedule]] §Candidates)
quality_bar: "unclassified counts as FAIL, never as not-personal — the store inventory's own rule; and every classification cites the column, never the table's name"
autonomy:
  read: autonomous
  propose: autonomous         # inventory rows, definition deltas, requirements — all PRs
  mutate_stock_money_outbound: confirm   # constant
memory: privacy-engineering
escalates_to: "[[compliance-privacy-charter]]; a suspected disclosure goes to [[security-charter]] as an incident — 'A false guest merge is a DISCLOSURE… No un-merge reverses that' (check_no_guest_name_matching.sh)"
```

**Three hard rules, each defending a named premortem.** (1) **It never executes an
erasure against real guest data** — drills use a synthetic guest, and a real request is
a human procedure with a receipt that has no table yet (`erasure_receipt_id` at `:82`
has no foreign key). (2) **It never edits a guard allowlist** — growth is the erosion
signal (`privacy.guard_allowlist_size`, both empty today, premortem M3), and an agent
that can quiet the guard constraining it has no guard. (3) **It never writes the consent
record** — zero call sites is a fact about the product, not a vacancy an agent may fill,
and who builds the capture surface is a contested seam that stays open.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `pii-classification-judgement` | T2 | A guard file changes, or a new pattern is proposed as PII | A verdict per pattern — PII / not / escalate — with the reasoning and the consumer it affects; the enumeration itself is delegated to `check_single_pii_definition.sh`, not repeated here | The 2026-08-24 charter session that established 3 distinct definitions across 4 guards by hand — an email is PII to guard #3 and invisible to #1 and #2; an SSN the reverse ([[privacy-engineering-charter]] §Evidence) | NEW |

**Three candidates deliberately not written.** `erasure-drill` (no erasure has ever
been executed), `privacy-schema-review` (no such review has been run) and
`store-classification` (no inventory exists) all fail §3.3 rule 3 and stay ineligible
until they have an instance — inventing one to unlock a skill is the speculation the
rule blocks, and this team should not record a claim it cannot evidence.

Consumed, owned elsewhere: the skill envelope ([[skills-charter]]); the mutation gate
([[action-safety-the-human-gate-charter]]).

## 4. Memory

- **Procedural** — the one §3 skill; candidates via [[skill-harvesting-charter]]'s
  queue, through the §3.3 gate.
- **Episodic** — nf_a `task_type: privacy_classification`, with `context.store` and
  `context.definition_id` as jsonb keys. **A specimen never enters an episodic row.**
  The research store is append-only with no per-subject removal mechanism, so a PII
  team that logs PII there has written its own premortem into a place it cannot erase.
- **Semantic** — `memory/` beside this file, index `privacy-engineering-MEMORY.md`.
  The founding facts are known and would be its first three files: three definitions
  across four guards; the zero-callers finding; and the **scope correction** that
  `ConsentDialog.tsx:1-8` is *operator* consent and must never be cited as
  guest-consent capture — the fact most likely to be re-mis-stated by a future
  session. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate. The 564-line migration
  is a grep target by `path:line`, never preloaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[privacy-engineering-schedule]]: diff the
inventory against last month's; a table that entered the catalogue unclassified becomes
a fact naming the mechanism that added it, not "coverage dipped"; every red drill result
becomes a failure fact naming the store that retained the row; expire at 90 days;
propose candidates. One PR; "no delta" stated when true.

## 5. Async contract

CI verdicts, board rows, memory PRs, NF-A events, [[privacy-engineering-loops]]. Gaps:

| Gap | Why it is a gap |
|---|---|
| `table.created` has no publisher | The daily schema-parity rebuild exists because production drifted by 27 tables and 403 columns applied by hand; it diffs but emits nothing, so the erasure denominator widens silently and the monthly schedule bounds the blind spot at 30 days |
| The `erasure-proof` loop (`close_time: per-event`) has no producer | No erasure function, no receipt table, no test. The primary metric reads "not emitted", never 0% achieved |
| The `consent-gate` loop cannot close | The gate is not a callable check, so [[customer-relationship-research-charter]] is blocked on us — stated loudly here rather than read as their delay |
| `nfb-research-store-erasability` — **owner assigned 2026-08-27 (founder, ADR 0035): this team** | The loop is now this team's to run; NF-B itself stays HELD (ADR 0029), so owning the question activates nothing. The *mechanism* fork (crypto-shredding vs subject partitions vs aggregate-only retention — each with real ML cost) *remains open* and is this team's to bring to the founder with costs attached |

## 6. Evidence today

- **EXISTS — everything the classifier would read.** The consent/erasure schema
  (`20260819000000_guest_identity_minimal_slice.sql:54,58-64,79-82,131-152,375,429-435,504-506`);
  three CI jobs on push, PR and daily cron
  (`.github/workflows/schema-parity.yml:19-27,149,152-154`); the four PII guards at
  the `path:line`s in the card.
- **PARTIAL — the operator consent surface.** `ConsentDialog.tsx:1-8` — right pattern,
  different subject.
- **NEW — the classifier, the one skill, the store inventory, the single PII module,
  the receipt table, and all of §4.** The audit justifying the skill was done by hand
  in the 2026-08-24 session; that is its past instance and also its only run.
