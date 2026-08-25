---
type: schedule
division: corporate
department: knowledge-documentation
team: standards-verification
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[standards-verification-charter]]", "[[standards-verification-loops]]", "[[standards-verification-agenda-board]]", "[[knowledge-documentation-schedule]]", "[[graph-retrieval-schedule]]", "[[skills-charter]]", "[[decision-office-charter]]"]
---

# Standards & Verification — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Generated-doc guard** — reject hand edits to `ENDPOINTS.md`, `PAGE_MAP.md`, `EXTERNAL_CONNECTIONS.md`; only generator output may land | `standards.hand_edits_to_generated_docs` |
| Per PR | **Evidence check** on any doc asserting behaviour — a claim about what the system does needs a `path:line`, a query, or a test ([`CLAUDE.md`](../../../../../CLAUDE.md):147) | Warning list; escalates to error once the backlog is cleared |
| Weekly | **Claim sample** — L-SV-1; N claims re-checked against source, verdict `verified`/`stale`/`unpinnable` | `standards.stale_claim_rate`, `standards.unpinned_claim_count` |
| Weekly | **Correction ageing** — anything raised against another unit and unacknowledged | `standards.correction_age_days`; 30-day escalations to [[decision-office-charter]] |
| Monthly | **60-day sweep** — L-SV-2, org-wide, **no exclusions** | `standards.docs_past_60_day_rule` |
| Monthly | **Companion regeneration** — L-SV-3; re-run each generator, diff against committed | `standards.regenerated_companion_age_days` |
| Monthly | **Brand-drift scan** — scoped: spine · `.planning/` tree · `md/` tree | `standards.stale_brand_doc_count` × 3 scopes |
| Monthly | **OD-22 library freshness** — entries whose `verified` date is over 180 days | Re-verify or mark dead |
| Quarterly | **Contract self-compliance** — do foundation documents obey the rules they impose? | `standards.contract_self_compliance_pct` |

**Note on ordering.** The per-PR evidence check ships as a **warning** first and only
becomes an error after the existing backlog is cleared. A gate that fails on 95% of the
corpus on day one gets disabled on day two, and a disabled gate is worse than an absent one
because it reads as coverage. This is the same reasoning that led
[[graph-retrieval-directive]] to scope its contract by importance rather than by date.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

⚠️ **`.claude/skills/` does not exist in this repo.** The only project skill is
`.agents/skills/railway-config/SKILL.md`. Ninety-nine `schedule.md` files across the org
assert a directory that is not there — finding **V-6** on
[[standards-verification-agenda-board]], staged as **CORP-F7**. This team found it, and it
appears in this team's own document, which is the correct place for it.

| Proposed skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `claim-verify` | Weekly sample; also on demand against one document | Each sampled claim gets `verified`/`stale`/`unpinnable` with a `path:line`; refuses to emit a rate if any sample could not be resolved | `md/DOCUMENTATION_INDEX.md` has been wrong in every category count since 2026-01-29 and nothing surfaced it |
| `claim-pin` | A number appears in ≥ 2 spine docs | Produces the assertion that would make the source fail loudly when the value changes, and identifies the owning unit | The insight count is quoted as 375, 573, and 348; the only test asserts `>= 200`, so all three pass |
| `staleness-sweep` | Monthly, org-wide | Lists every `agenda-*` past 60 days with no exclusions; this department's own docs included | The 60-day rule has existed since 2026-08-24 with no mechanism |
| `companion-regen` | Monthly, and per PR touching the three generated docs | Re-runs each generator and diffs; a hand edit is distinguishable from a world change | [[README|foundation-README]] §0 declares them regenerated-not-hand-edited; nothing enforces it |
| `brand-drift-scan` | Monthly | Reports per scope with denominators; refuses to emit a bare count | The same fact is 28, 216, or 75 depending on scope — a bare number here would be self-refuting |

Each names a trigger, a doneability criterion, and a real past instance, per
[[README|foundation-README]] §3.3. **None is built.**

Two of these skills — `claim-verify` and `claim-pin` — are the team's actual product. If
twelve months pass and the only artifacts are documents rather than these two,
[[standards-verification-premortem]] M1 has happened.

Registry governance belongs to [[skills-charter]] (Applied AI); this team authors, and
audits the registry's documentation, but does not govern it.
