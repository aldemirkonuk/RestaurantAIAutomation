---
type: schedule
division: product
department: partnerships-integrations
team: partner-alliance-development
status: new
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partner-alliance-development-charter]]"
  - "[[partner-alliance-development-loops]]"
  - "[[partner-alliance-development-directive]]"
  - "[[partnerships-integrations-schedule]]"
  - "[[decision-office-charter]]"
---

# Partner & Alliance Development — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per candidate** | Reachability triage — can this counterparty be reached via `generic_webhook` / `csv_import` instead of a signature? | L3 |
| **Per artifact** | Guest firewall check — does this guest-experience artifact assume the partnership while OD-07 is open? | L4 |
| **Per outreach** | Record the attempt and date **before** the message is sent | L1 |
| **Monthly** | Counterparty ledger review — agreements **and** attempts **and** response times **and** state distribution. Never one alone | L1, `pi.*` |
| **Monthly** | OD-07 decay check — days untouched, cross-referenced against guest-experience commits; escalate at 60 | L2 |
| **Quarterly** | Registry re-read — have any providers changed `authModel`, or have new `partner_agreement` entries appeared? | L1 |
| **At 6 months** | Staffing finding — if all nine ledger rows still read *never contacted*, is this team correctly active or should it be dormant? | — |

**Anti-sprawl, applied honestly.** A job producing no action for 3 consecutive runs is
downgraded or deleted. Two exemptions, both stated rather than assumed:

- **The monthly counterparty review is exempt for its first three runs.** A BD loop reading
  zero three months running is telling the truth about a slow clock, not failing. At **six**
  runs of zero it is deleted and the team is reconsidered — which is the "at 6 months" row
  above.
- **The guest firewall check (L4) will read zero by design.** It is a fork-specific guard,
  deleted two quarters after OD-07 closes, not after three quiet runs.

Everything else obeys the rule as written.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet.** Per foundation §3.3, each names a
trigger, doneability criteria, and a real past instance — and where there is no real instance,
this table says so.

| Skill | Trigger | Done when | Real past instance | Tier |
|---|---|---|---|---|
| `counterparty-reachability-triage` | A new counterparty is considered for outreach | The counterparty is classified partnership-problem or bridge-problem, with the reason recorded | **Yes** — `pos-provider.registry.ts` already did this for AKINSOFT Wolvox: *"start with file export → csv_import bridge"*. The reasoning exists in code and nowhere else | T2 |
| `blocker-ledger-sync` | Monthly, or on any registry `authModel` change | Every `partner_agreement` provider has a current state and date; new blocked entries added; agreements reflected in registry status | **Yes, negatively** — this session found 9 blocked providers enumerable by grep, and **no record anywhere of whether any had been contacted.** That gap is the instance | T2 |
| `option-memo` | A strategic option risks being foreclosed by accumulation rather than decision | A memo exists stating what the option buys, costs, forecloses, and how fast it decays | **Yes** — OD-07 is exactly this shape today, and the `NF-C` treatment at foundation README §4.3 (*"preserved as ambition, not carried as dead weight"*) is a prior instance of the same reasoning applied successfully | T2 |
| `decision-drift-check` | Monthly, per open decision this team touches | Days-since-touched reported alongside activity in the area the decision governs; conjunction escalated | **Yes, in the org's own history** — `ORG_STRUCTURE.md:62` names decisions *"drifting rather than closing"* as the failure the Decision Office exists to prevent. Shared with [[decision-office-charter]]; if that unit builds it, this team should use theirs rather than duplicate | T4 |

**Honest note.** All four cite a real instance, which is unusual for a NEW team — the reason
is that this team's work is *recording and triaging*, and the repo contains several instances
of that reasoning being done ad hoc and then lost. That is the strongest argument for the
team's skills; it is not an argument that the team has done any BD.

**Deduplication flag:** `decision-drift-check` is very likely
[[decision-office-charter]]'s skill, not this team's. It is listed here because this team has
a concrete need for it today (OD-07) and no owner has claimed it. **If the Decision Office
builds it, this entry is deleted rather than maintained in parallel.**

## Deliberately not scheduled

- **Any outreach cadence.** The sequence and the first targets are founder-deferred. The
  monthly review measures whatever outreach happens; it schedules none.
- **Beli conversation cadence.** The deliverable is a memo. A scheduled conversation would
  *be* premortem M4.
- **Commercial-terms review.** Not this team's, and deferred regardless.
