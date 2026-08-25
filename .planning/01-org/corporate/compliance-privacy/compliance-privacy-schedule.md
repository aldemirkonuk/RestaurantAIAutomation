---
type: schedule
division: corporate
department: compliance-privacy
status: new
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy]
updated: 2026-08-24
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-directive]]", "[[privacy-engineering-schedule]]", "[[regulatory-posture-schedule]]", "[[regulated-operations-schedule]]", "[[security-charter]]", "[[legal-charter]]", "[[standards-verification-charter]]", "[[README]]"]
---

# Compliance & Privacy — Schedule & Skills

## Recurring work

**Two jobs run today; everything else is `NEW`.** The two that run were built by
another department for another reason and happen to be this department's only live
controls.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| Per-push · per-PR · daily 06:00 | **Guest identity guards** — `check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh` | CI pass/fail | ✅ **RUNNING** — `.github/workflows/schema-parity.yml:19-27, 152-154` |
| Per-push · per-PR · daily 06:00 | **Guest merge policy eval** — `scripts/eval_guest_merge_policies.py` | merge-policy report | ✅ **RUNNING** — same workflow, `:149`. Fails loudly if `SUPABASE_DIRECT_CONNECTION_STRING` is unset, rather than passing for the wrong reason (`:143-147`) |
| Per-merge | **Single-PII-definition guard** — `check_single_pii_definition.sh` | CI pass/fail | **NEW** — the divergence it prevents is a one-sided edit to two byte-identical lists |
| Per-PR touching a registered control | **Notice-accuracy check** — does this PR invalidate a claim in `Privacy.tsx`? | register delta | **NEW** — the obligation is already written as a comment at `Privacy.tsx:5-12` and enforced by nothing |
| Weekly | **Consent-gate audit** — did every consumer honour the gate's answer? | `privacy.consent_gate_denials` | **NEW** · blocked — no gate running |
| Monthly | **Erasure drill** — synthetic guest, full lifecycle, catalogue-driven absence assertion | `privacy.erasure_completeness` | **NEW** · the department's primary metric has no producer |
| Monthly | **Obligation-register sweep** — new duties, changed controls, stale citations | `compliance.obligation_coverage` | **NEW** |
| Quarterly | **Subprocessor reclassification** — re-run the host inventory, diff against the register | `compliance.subprocessor_classification` | **NEW** · raw material exists ([`EXTERNAL_CONNECTIONS.md`](../../../foundation/EXTERNAL_CONNECTIONS.md), 50 hosts) |
| Quarterly | **Regulated-operations trigger check** — has a licensed jurisdiction or an excise MSA appeared? | trigger verdict | **NEW** · see below — this one job is what stops a dormant team staying dormant past its trigger |
| Quarterly | **Purpose-widening audit** — widenings vs recorded dissent vs notice-version bumps | `privacy.purpose_widenings` | **NEW** · routes to [[red-team-charter]] |

**The trigger check is the most important `NEW` row on this table, and it is the
least interesting.** [[regulated-operations-charter]]'s own premortem is *the trigger
fires and nobody notices, because a dormant team has no cadence*. A quarterly
five-minute check with a named owner is the entire counter-pressure. If it is not on
a schedule, the team is not gated — it is forgotten, and those look identical until
a customer's accountant tells the difference.

**Build target for the erasure drill:** `.github/workflows/schema-parity.yml` is the
right shape and the right precedent — it rebuilds from migrations and diffs against
reality on a cron *because "drift is usually introduced outside a PR"* (`:23-25`).
Erasure completeness drifts the same way: a new table added by any department
silently widens the denominator. Copy the workflow's structure, including its habit
of failing loudly when a required secret is missing rather than passing vacuously.

**Anti-sprawl applies to this table.** [[README]] §6: a scheduled job that produces
no action for 3 consecutive runs is downgraded or deleted. Ten rows for a department
with two running controls is already at the edge of that rule. The three that earn
their slot first are the single-PII-definition guard (cheap, prevents a live
divergence), the erasure drill (produces the primary metric), and the quarterly
trigger check (prevents a named premortem).

## Skills owned

Skills live in **`.claude/skills/`** — auto-discovered, committed, PR-reviewable. A
skill that has not fired in 30 days is reviewed for deletion
([[README]] §3.3).

**Count today: 0.** The directory does not exist; `.claude/` holds `launch.json`,
`settings.local.json`, and `worktrees`. This department owns no skills yet and
should own few — most of its controls belong in CI as `check_*.sh` guards, which are
cheaper, always-on, and cannot be forgotten to invoke.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty |

### Candidate skills — and the discipline of not writing them yet

[[README]] §3.3 requires four things before a skill may be committed: a trigger,
doneability criteria, **a real past instance**, and an owning department. Applied
honestly, this department has exactly one candidate that qualifies.

| Candidate | Trigger | Real past instance (§3.3 rule 3) | Eligible? |
|---|---|---|---|
| `privacy-review-pass` — run the [[compliance-privacy-directive]] gate over a proposed change | A PR or proposal touches personal data | **None.** No such review has been run. | ❌ not yet |
| `dpa-annex-check` — line-by-line evidence check of a data-protection exhibit | An inbound DPA arrives | **None.** No DPA has ever been received. | ❌ not yet |
| `erasure-drill` — the monthly drill as a skill rather than a bespoke script | Monthly, or on demand for a real request | **None.** No erasure has been executed. | ❌ not yet |
| `pii-definition-audit` — enumerate every PII definition in the tree and diff them | A guard file changes | ✅ **This session.** The audit that found 3 distinct definitions across `constraint_engine.py:28`, `provider_communication_agent.py:40`, `research_tasks.py:101-102`, and `20260805000000_baseline_from_production.sql:1080` was performed by hand and will need repeating. | ✅ eligible |

**Three of four are listed as ineligible on purpose.** Under §3.3 rule 3 a skill
needs a citable past instance, and inventing one to unlock a skill is exactly the
speculation the rule exists to block. Leaving them visible and ineligible is cheaper
than a plausible justification — and this department, of all of them, should not
write down a claim it cannot evidence.

Note also that `pii-definition-audit` is a **grep with a report**, which per
[[compliance-privacy-directive]] §"One rule about how controls get written" means the
correct home is probably `scripts/check_single_pii_definition.sh` in CI rather than a
skill invoked by a human who has to remember. A skill that duplicates a CI guard is
sprawl with extra steps.

## What this department consumes from others' schedules

| Their job | Their owner | What we take from it |
|---|---|---|
| Weekly security pass ([[README]] §6) | [[security-charter]] | New controllers/routes that reach personal data |
| Daily schema-parity rebuild | [[schema-migrations-charter]] | New tables → widened erasure denominator |
| Monthly agenda sync ([[README]] §6) | All | Whether this board agenda has drifted from the full one |
| Doc staleness detection | [[standards-verification-charter]] | Claims in `Privacy.tsx` going stale against code |
