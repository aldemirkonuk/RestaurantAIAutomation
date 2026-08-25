---
type: schedule
division: corporate
department: compliance-privacy
team: privacy-engineering
status: exists
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.store_inventory_coverage, privacy.guard_allowlist_size]
updated: 2026-08-24
links: ["[[privacy-engineering-charter]]", "[[privacy-engineering-loops]]", "[[privacy-engineering-directive]]", "[[compliance-privacy-schedule]]", "[[regulatory-posture-schedule]]", "[[schema-migrations-charter]]", "[[security-charter]]", "[[README]]"]
---

# Privacy Engineering — Schedule & Skills

## Recurring work

**Three jobs run today.** All three were authored by the guest-identity work
(commit `ce65715`) rather than by this team, and they are the department's only live
controls.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| Push · PR · daily 06:00 | `check_no_guest_name_matching.sh` — `display_label` is never a match key | CI verdict | ✅ **RUNNING** — `.github/workflows/schema-parity.yml:153` |
| Push · PR · daily 06:00 | `check_no_raw_guest_channels.sh` — raw channels only via `guest_link_identifier()` | CI verdict | ✅ **RUNNING** — `:154` |
| Push · PR · daily 06:00 | `eval_guest_merge_policies.py` — no known-different guests may be merged | merge-policy report | ✅ **RUNNING** — `:149`; refuses to run without its DB secret rather than passing vacuously (`:143-147`) |
| Per-merge | `check_single_pii_definition.sh` — no PII regex outside `privacy/pii.py` | CI verdict | **NEW** — prevents [[privacy-engineering-premortem]] M1 |
| Per-merge | PII specimen corpus asserted against every consumer | pass rate | **NEW** — proves the merge *stayed* merged |
| Per-migration · daily sweep | Store inventory — classify every table; **unclassified = fail** | `privacy.store_inventory_coverage` | **NEW** — the erasure denominator (M2) |
| Per-merge | `check_no_guest_pii_outside_identifiers.sh` — the bypass guard | CI verdict | **NEW** — M4 |
| Monthly | **Erasure drill** — synthetic guest → exercise every write path → erase → enumerate from catalogue → assert absence | `privacy.erasure_completeness` | **NEW** — the primary metric currently has no producer |
| Quarterly | **Allowlist expiry sweep** — every guard allowlist entry re-verified or the guard fails | `privacy.guard_allowlist_size`, `allowlist_entry_age_max` | **NEW** — M3 |
| Weekly | Consent-gate audit — did consumers honour the gate's answer? | `privacy.consent_gate_denials` | **NEW** · blocked, no gate |

**Build target, and it is a precedent rather than an analogy.**
`.github/workflows/schema-parity.yml` exists because production had drifted from
migrations by 27 tables and 403 columns over months, applied by hand
(`:3-16`). Its response was a cron that rebuilds and diffs. **The erasure denominator
drifts by exactly the same mechanism** — a table added by any department silently
widens it — so the erasure drill and the inventory sweep should be built inside that
workflow's shape, including two habits worth copying verbatim:

1. **Fail loudly when a required secret is missing** (`:143-147`) rather than passing
   for the wrong reason. A privacy job that passes because it could not connect is
   worse than one that fails.
2. **Run on push, PR *and* cron**, because *"drift is usually introduced outside a
   PR — someone fixing production live"* (`:23-25`).

**Anti-sprawl applies here.** [[README]] §6: a scheduled job producing no action for
3 consecutive runs is downgraded or deleted. Ten rows for a team with three running
jobs is at the edge. The three `NEW` rows that earn their slot first are the
single-PII-definition guard (prevents a live, dated divergence), the store inventory
(makes the primary metric meaningful), and the monthly erasure drill (produces it).
The allowlist sweep is fourth and is the cheapest of all to arm — both allowlists are
empty today, so the policy costs nothing now and is unenforceable at eighteen entries.

## Skills owned

Skills live in **`.claude/skills/`** — auto-discovered, committed, PR-reviewable. A
skill unfired for 30 days is reviewed for deletion ([[README]] §3.3).

**Count today: 0.** The directory does not exist. This team should own **very few**
skills by design: almost every control it produces belongs in CI as a `check_*.sh`
guard, which is always-on, cannot be forgotten to invoke, and fails a build rather
than producing a report someone reads later. A skill that duplicates a CI guard is
sprawl with extra steps.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty |

### Candidates, against [[README]] §3.3's four required fields

| Candidate | Trigger | Doneability | Real past instance | Eligible? |
|---|---|---|---|---|
| `pii-definition-audit` — enumerate every PII definition in the tree and diff them | A guard file changes, or quarterly | Report lists every definition with `file:line` and a diff verdict | ✅ **This session** — the audit finding 3 definitions across `constraint_engine.py:28`, `provider_communication_agent.py:40`, `research_tasks.py:101-102`, `20260805000000_baseline_from_production.sql:1080` was done by hand | ✅ eligible — **but see below** |
| `erasure-drill` — the monthly drill as a skill | Monthly, or a real request | Receipt naming every store checked and the evidence | ❌ no erasure has been executed | ❌ |
| `privacy-schema-review` — run the [[privacy-engineering-directive]] gate over a migration | A migration touches a person-describing attribute | Verdict + classification recorded in the inventory | ❌ no such review has been run | ❌ |
| `store-classification` — classify a new table as person-bearing | New table appears in the catalogue | Row added to the inventory with a classifier and a date | ❌ no inventory exists | ❌ |

**Even the eligible one probably should not be a skill.** `pii-definition-audit` is a
grep with a report, and per [[privacy-engineering-directive]] §"Two working rules"
that means its correct home is `scripts/check_single_pii_definition.sh` in CI, not a
skill a human has to remember to invoke. The distinction that would justify a skill
is *judgement*: deciding whether a newly-found pattern **is** PII is judgement;
finding the patterns is a grep. If the skill is written at all, it should own only
the judgement half and delegate the grep to the guard.

Three of four listed as ineligible is the point. §3.3 rule 3 requires a citable past
instance, and this team of all teams should not write down a claim it cannot
evidence.

## What this team consumes from other schedules

| Their job | Owner | What we take |
|---|---|---|
| Daily schema-parity rebuild | [[schema-migrations-charter]] | New tables → widened erasure denominator (feeds L2) |
| Weekly security pass ([[README]] §6) | [[security-charter]] | New controllers/routes reaching personal data |
| Daily data-substrate progress | Data | New enrichment stores that may carry a person |
| Monthly obligation-register sweep | [[regulatory-posture-charter]] | Which of our controls are being cited, so we know what must not silently change |
