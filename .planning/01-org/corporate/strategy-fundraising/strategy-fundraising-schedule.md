---
type: schedule
division: corporate
department: strategy-fundraising
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.wedge_metric_instrumentation, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[strategy-fundraising-charter]]", "[[strategy-fundraising-loops]]", "[[strategy-fundraising-directive]]", "[[strategy-fundraising-agenda-board]]", "[[strategy-fundraising-premortem]]", "[[positioning-fundraise-readiness-schedule]]", "[[skills-charter]]", "[[README|foundation-README]]", "[[standards-verification-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[narrative-collateral-charter]]", "[[editorial-gate-charter]]", "[[design-partner-operations-charter]]", "[[decision-office-charter]]", "[[OPEN-DECISIONS]]"]
---

# Strategy & Fundraising — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per send** | Claim verification gate — L-STR-1. Register entry, evidence check, re-verification, verb check | Hold or release of the send; `strategy.claim_to_evidence_coverage`, `strategy.citation_drift_rate` |
| **Per claim** | Verb-strength check against the metric contract and the produced number — L-STR-2 | `strategy.claim_overstatement_count`; a weakened verb, or a rejection |
| **Per external conversation** | Spoken-claim capture ([[strategy-fundraising-directive]] R6) — any number given verbally is entered in the register within 24h | Register rows with `channel: spoken` |
| Monthly | **OD-23 status report, by name** — including *"still open, day N, nothing changed"* — L-STR-4 | Line in [[strategy-fundraising-agenda-board]]; escalation at 2 consecutive months |
| Monthly | Wedge coherence — do outward artifacts still reduce to one sentence? — L-STR-3 | `strategy.wedge_sentence_lead_rate`; surface-area flags to [[narrative-collateral-charter]] |
| Monthly | Unattributed-target sweep — any Commercial/Product plan quoting a revenue figure without the fork id | `strategy.unattributed_target_citations` |
| Quarterly | **Raise position restated in writing** — *raise, or not yet, and on what trigger*. "Not yet" is a valid answer and must be written | One dated paragraph. Absence is itself the finding |
| Quarterly | Founding-artifact re-verification — every `path:line` in `.planning/YC_WEDGE_PLAN.md` §6 re-read against source | Drift list; feeds `strategy.citation_drift_rate` baseline |
| Quarterly | Team-shape review — split / not-needed / drift conditions — L-STR-5 | Keep-one, split, or dissolve-the-deferral recommendation to [[decision-office-charter]] |
| Quarterly | **Overstatement sweep of this vault** — [[strategy-fundraising-directive]] R1 applied to the department's own 14 documents | Rewrite list |
| Quarterly | Staleness sweep — anything untouched 60+ days is finished or fiction ([[ORG_STRUCTURE]] §4). **Date-only diffs count as untouched**, read via `git log --stat` | Archive, rewrite, or the L-STR-5 drift finding |

**Three cadences are deliberately absent, and the absences are the honest part of this
table.**

1. **No weekly anything.** No register, no artifact in flight, no counterparty. A weekly
   review of zero produces no action for three consecutive runs and gets deleted by the
   org's own anti-sprawl rule ([[README|foundation-README]] §6, GENERATION_BRIEF §3.8). Better not
   to create it.
2. **No data-room or diligence cadence** until the split trigger fires
   (`corporate.md:457-458`). [[strategy-fundraising-directive]] R4 makes this a rule rather
   than an oversight: readiness work is triggered, claim work is continuous. A standing
   readiness cadence *is* the second team this department declined to charter, arriving
   through the schedule instead of the org chart.
3. **No YC application cadence.** The path is owned here; the application is an event with
   a founder decision in front of it, not a recurring job.

**One cadence is unusually fast for this department, and deliberately so.** The per-send
gate is the only real-time obligation, because it is the only moment where the department's
central failure actually occurs. Everything else can wait a month; a claim in a partner's
notebook cannot be recalled.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion — the anti-sprawl rule applies here exactly as it does to agendas.

**Two honest statements before the table.**

1. **`.claude/skills/` does not exist in this repo.** Verified: the directory is absent;
   `.claude/` contains `launch.json`, `settings.local.json` and `worktrees/` only.
   [[README|foundation-README]] §3.1 states the repo has **zero committed skills**. Everything
   below is a name, not an asset.
2. **This department owns no generative skill, by design.** Every skill listed is a
   **checker or a recorder**. A department whose job is to prevent claims from outrunning
   evidence should not own a tool that produces claims — that is
   [[narrative-collateral-charter]]'s craft, and separating the producing tool from the
   checking tool is the same structural argument [[legal-charter]] makes for keeping
   generative drafting out of its one-way-door team.

| Proposed skill | Tier | Shape | Fires on | Doneability criterion |
|---|---|---|---|---|
| `claim-register-entry` | T2 | **Recorder** — adds a claim with audience, evidence type, evidence value, verification date | Any claim about to go outward, written or spoken | The row exists and its evidence field is a query id, `path:line` + symbol, or a demo path — never prose |
| `citation-reverify` | T2 | **Checker** — re-reads every `path:line` in a document against source and reports drift, inversion, or supersession | A send; the quarterly founding-artifact sweep | Every citation returns `holds` / `drifted to :N` / `inverted` / `gone`. Silence is a failure, not a pass |
| `verb-strength-check` | T2 | **Checker** — flags claim verbs stronger than the registered evidence | Any draft outward artifact | Every money/completion verb is matched against its metric contract; `recovered` without a landed credit is a hard flag |
| `wedge-reduction-check` | T2 | **Checker** — does this artifact reduce to the wedge sentence in its first paragraph? | Any draft outward artifact | Binary, with the offending first paragraph quoted back |
| `open-target-attribution` | T2 | **Checker** — finds revenue figures quoted without their open-decision id | Monthly sweep across `.planning/` | Every occurrence of a target figure is listed with fork id present/absent |
| `diligence-index-check` | T2 | **Checker** — does each named diligence slot have an owner and a location? | Quarterly, **after** the split trigger only | Dormant until triggered. Listing it dormant is deliberate — see below |

**Each skill above cites a real past instance**, per [[README|foundation-README]] §3.3's rule that
there are no speculative skills:

- `citation-reverify` would have caught `YC_WEDGE_PLAN.md:401` (`ReceivingWorkspace.tsx:233,265`
  → now `:401,440`), `:404` (ux-optimizer guards inverted; the same document says ✅ at
  `:339`), and `:5` (header says REVISION 2 while §REVISION 3 opens at `:9`).
- `verb-strength-check` would have caught the *dollars recovered* framing at `:315`, which
  the same document contradicts at `:31-33` and again at `:369-373`.
- `open-target-attribution` would have caught OD-23's figure travelling into
  [[finance-pricing-charter]] and Design's fork list without its status.
- `wedge-reduction-check` has no past instance yet because no outward artifact exists —
  and it is listed anyway, flagged, because the first artifact is the one it must catch.
  That is the weakest entry in this table and it is labelled as such rather than padded.

**Nothing in this table exists.** It is listed so that a skill gets built against a
scheduled job with a close-time, rather than a skill being built and a job invented to
justify it. Ownership of the skill **registry** sits with [[skills-charter]] (Applied AI),
not here — Strategy authors and commissions skills; it does not govern the registry.

**The one skill rule specific to this department:** a `citation-reverify` run that reports
**zero** drift across a document older than a month is treated as a defect until proven
otherwise. The founding artifact drifted at three points in under a month of commits; a
clean sweep is more likely to mean the checker did not resolve the paths than that nothing
moved.

Team-level recurring work — register upkeep, the send checklist itself, the seed-claim
backlog — is in [[positioning-fundraise-readiness-schedule]]. This table holds only the
jobs that cross a department boundary or gate an outward send.
