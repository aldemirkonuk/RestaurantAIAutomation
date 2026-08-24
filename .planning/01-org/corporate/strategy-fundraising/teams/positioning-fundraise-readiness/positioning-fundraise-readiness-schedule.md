---
type: schedule
division: corporate
department: strategy-fundraising
team: positioning-fundraise-readiness
status: provisional
metrics: [strategy.claim_to_evidence_coverage, strategy.citation_drift_rate, strategy.claim_overstatement_count, strategy.diligence_pack_completeness]
updated: 2026-08-24
links: ["[[positioning-fundraise-readiness-charter]]", "[[positioning-fundraise-readiness-loops]]", "[[positioning-fundraise-readiness-directive]]", "[[positioning-fundraise-readiness-agenda-board]]", "[[positioning-fundraise-readiness-premortem]]", "[[strategy-fundraising-schedule]]", "[[skills-charter]]", "[[foundation-README]]", "[[narrative-collateral-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[design-partner-operations-charter]]", "[[standards-verification-charter]]", "[[instruments-equity-charter]]"]
---

# Positioning & Fundraise Readiness — Schedule & Skills

## Recurring work

[[strategy-fundraising-schedule]] holds the jobs that cross a department boundary or gate a
send. This table holds the desk work.

| Cadence | Job | Emits |
|---|---|---|
| **Per claim** | Register entry — verbatim claim, audience + channel, evidence type, verification result — L-PFR-1 | A row, or a recorded rejection. `strategy.registered_claim_count`, `strategy.rejected_claim_count` |
| **Per claim** | Verb-strength rewrite against the metric contract and the produced number — L-PFR-2 | `strategy.weakened_claim_count`; the shipped verb |
| **Per send** | The five-question checklist ([[positioning-fundraise-readiness-agenda-full]] §Step 2) | Hold, weaken, flag, or release |
| **Per external conversation** | Spoken-claim capture within 24h — R6 | Register rows with `channel: spoken`. **Zero after an active month is a signal, not restraint** |
| Monthly | Citation drift sweep across the register and `YC_WEDGE_PLAN.md` §6 — L-PFR-3 | Per-citation result; `strategy.citation_drift_rate`; oldest-unverified age |
| Monthly | Wedge reduction across the month's artifacts — L-PFR-4 | `strategy.wedge_sentence_lead_rate`; surface-area flags to [[narrative-collateral-charter]] |
| Monthly | Evidence-type mix review — is the register drifting toward `path:line` and away from demos? | A leading indicator for next quarter's drift rate |
| Quarterly | Competitive-read refresh — `YC_WEDGE_PLAN.md:328` and successors | An updated read, or a dated confirmation that it still holds |
| Quarterly | Readiness-vs-claim balance — L-PFR-5 | `strategy.readiness_vs_claim_item_ratio`; R4 breach list |
| Quarterly | Diligence **index** refresh — questions, locations, owners. **The index only** | One page. Most rows read "does not exist yet," which is the useful part |
| Quarterly | Staleness sweep, read with the P1 exception below | Archive, rewrite, or a real P1 finding |

**Three deliberate absences, and one deliberate exception.**

1. **There is no "register upkeep" job**, and its absence is a control, not an oversight.
   The register is touched **only as part of sending**
   ([[positioning-fundraise-readiness-directive]] R1). A maintenance cadence would let the
   register be current while the practice is dead —
   [[positioning-fundraise-readiness-premortem]] P1, wearing a green dashboard.
2. **There is no weekly anything.** No register, no artifact in flight, no counterparty. A
   weekly reading of zero produces no action for three consecutive runs and is deleted by
   the org's own anti-sprawl rule ([[foundation-README]] §6).
3. **There is no data-room, cap-table, or diligence-artifact cadence** until the split
   trigger fires (`corporate.md:457-458`). A standing readiness cadence **is** the second
   team this department declined to charter, arriving through the schedule instead of the
   org chart — R4.

**The exception:** the quarterly staleness sweep normally treats an untouched document as
finished-or-fiction ([[ORG_STRUCTURE]] §4). For the **claim register specifically**, an
untouched quarter in which nothing was sent is *correct*, and reads as honest. An untouched
register in a quarter where artifacts shipped is P1. The sweep must distinguish the two, and
it does so by reading the send log alongside `git log --stat` — date-only diffs count as
untouched everywhere else.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**Two honest statements before the table.**

1. **`.claude/skills/` does not exist in this repo.** Verified: `.claude/` contains
   `launch.json`, `settings.local.json` and `worktrees/` only. [[foundation-README]] §3.1
   records **zero committed skills** repo-wide. Everything below is a name, not an asset.
2. **Every skill this team owns is a checker or a recorder. None generates prose.** A team
   whose job is to prevent claims from outrunning evidence must not own a tool that produces
   claims — that is [[narrative-collateral-charter]]'s craft, and the separation is
   [[positioning-fundraise-readiness-directive]] R5 in tooling form.

| Proposed skill | Tier | Shape | Trigger | Doneability criterion |
|---|---|---|---|---|
| `claim-register-entry` | T2 | Recorder | Any claim about to go outward, written or spoken | A row exists whose `evidence` field is a query id, `path:line` + symbol, or a demo path. Prose in that field fails the run |
| `citation-reverify` | T2 | Checker | Every send; the monthly sweep | Every citation returns `holds` / `drifted to :N` / `inverted` / `gone`. **Silence is a failure, not a pass** |
| `verb-strength-check` | T2 | Checker | Any draft outward artifact | Every money or completion verb matched against its contract. `recovered` with no landed credit is a hard flag; `complete` with no scope is a hard flag |
| `wedge-reduction-check` | T2 | Checker | Any draft outward artifact | Binary, with the offending first paragraph quoted back. Flag-only — never blocks |
| `evidence-type-mix` | T2 | Reporter | Monthly | Share of register evidence by type, trended. Rising `path:line` share is reported as a leading risk |
| `diligence-index-check` | T2 | Checker | Quarterly, **after the split trigger only** | Each named question has a location and an owner. **Dormant** — listed dormant deliberately, so it is built against a trigger rather than invented to fill a gap |

**Each skill cites a real past instance**, per [[foundation-README]] §3.3's no-speculative-
skills rule:

- `citation-reverify` would have caught all four founding-artifact defects:
  `YC_WEDGE_PLAN.md:401` (`ReceivingWorkspace.tsx:233,265` → now `:401,440`; and `:92` →
  now `:168`, superseded by a design change), `:404` (ux-optimizer guards inverted —
  `ux-optimizer.controller.ts:55` — while the same document says ✅ at `:339`), and `:5`
  (header says REVISION 2 while §REVISION 3 opens at `:9`).
- `verb-strength-check` would have caught the *dollars recovered* framing at `:315`, which
  the same document contradicts at `:31-33` and argues against again at `:369-373`; and the
  Track A *"Security"* label at `:339`.
- `claim-register-entry` would have caught the 573-insight-types figure entering the YC
  narrative while the corpus also says 375 (`corporate.md:206-213`) — it would have entered
  `BLOCKED`, which is the whole point of having a blocked state.
- `evidence-type-mix` has no past instance and is the weakest entry here. It is listed
  anyway and labelled as such rather than padded: the founding artifact is **100%
  `path:line` evidence with zero demos**, which is exactly the mix that produced a 29% drift
  rate, so the metric has a baseline even though it has no history.
- `wedge-reduction-check` has no past instance because no outward artifact exists. Also
  labelled.

**Nothing in this table exists.** It is listed so a skill gets built against a scheduled job
with a close-time, rather than a skill being built and a job invented to justify it.
Ownership of the skill **registry** sits with [[skills-charter]] (Applied AI) — this team
authors and commissions; it does not govern the registry.

**The one skill rule specific to this team:** a `citation-reverify` run that reports **zero**
drift across a document older than a month is a **defect until proven otherwise**. The
founding artifact drifted at four citations, across three findings, in under a month of
commits. A clean sweep is more
likely to mean the checker could not resolve the paths than that nothing moved — and a
checker that fails silently is indistinguishable from the timestamp-verification failure
([[positioning-fundraise-readiness-premortem]] P2) it exists to prevent.
