---
type: agenda-board
division: corporate
department: knowledge-documentation
team: standards-verification
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[standards-verification-charter]]", "[[standards-verification-agenda-full]]", "[[standards-verification-loops]]", "[[standards-verification-schedule]]", "[[knowledge-documentation-agenda-board]]"]
---

# Standards & Verification — Board

> **PROVISIONAL — no work done yet.**

> ⚠️ Dataview is not installed (no `.obsidian/`), so these queries return nothing today.
> This team owns the 60-day rule and cannot currently execute it — which is itself the
> first entry in the verification backlog.

## Every Standards & Verification artifact

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation/teams/standards-verification"
SORT type ASC
```

## The 60-day rule, org-wide, no exclusions

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  default(department, "—") AS Department,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched",
  (date(today) - date(updated)).days AS "Days"
FROM "01-org" OR "02-advisory"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

**This department's own 21 provisional agendas fire 2026-10-23** and will be the oldest
entries in this table on that date, because they were written first. That is by design —
[[standards-verification-premortem]] M4 is the failure where they are quietly excluded.

## Provisional documents that never became real

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  updated AS "Last touched"
FROM "01-org" OR "02-advisory"
WHERE status = "provisional" AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

A provisional banner is a promise that work is coming. Past 60 days it is a statement that
it is not.

## Standing counters (hand-entered until the verification jobs exist)

- [ ] `standards.stale_claim_rate` — **unmeasured**. Building the measurement is deliverable #1
- [ ] `standards.unpinned_claim_count` — **≥ 1 known** and it is load-bearing
- [ ] `standards.docs_past_60_day_rule` — **0**; first fires **2026-10-23**
- [ ] `standards.stale_brand_doc_count` — **216** of 1,118 `.planning/` · **75** of 113 `md/` · founding spine-scoped figure was **28** — all three true, scopes attached
- [ ] `standards.contract_self_compliance_pct` — **0 of 2** (`ORG_STRUCTURE.md`, `OBSIDIAN_VAULT.md`)
- [ ] `standards.regenerated_companion_age_days` — unmeasured for `ENDPOINTS.md`, `PAGE_MAP.md`, `EXTERNAL_CONNECTIONS.md`
- [ ] `standards.correction_age_days` — 0 raised so far

## Open verification findings

| # | Finding | Evidence | Routes to |
|---|---|---|---|
| V-1 | **Insight count unpinned** — corpus says 375, 573, and 348 | `LLM_INSTRUCTION_PROMPTS.md:19,51,56,166,167`; `YC_WEDGE_PLAN.md:280,324`; `AGENT_NATIVE_UI_DECISION.md:64,100,105`; source computed at `insight-catalog.ts:547`; only test asserts `>= 200` at `insight-catalog.spec.ts:10` | Owning unit for the test; [[positioning-fundraise-readiness-charter]] for the YC doc |
| V-2 | **Standard-setter violates its own standard** — frontmatter mandated, absent | [[ORG_STRUCTURE]] §5; `ORG_STRUCTURE.md` has no frontmatter. Same for `OBSIDIAN_VAULT.md` §3 | [[graph-retrieval-charter]] (joint) |
| V-3 | **Register contradiction** — OD-21 marked LOCKED in a doc, Open in the register | [[OBSIDIAN_VAULT]]:3 vs `OPEN-DECISIONS.md` Open table | [[decision-office-charter]] |
| V-4 | **Stale index** — every category count wrong | `md/DOCUMENTATION_INDEX.md` (2026-01-29): claims `04-updates-builds` = 6; actual **48** | [[corpus-archive-charter]] |
| V-5 | **Root `SKILLS.md`** — prose protocol named like a registry, stale brand | `SKILLS.md:3` *"the WineOps AI project"*, mtime 2026-02-15. **OD-14** | Founder |
| V-6 | **`.claude/skills/` does not exist** — asserted by 99 `schedule.md` files | Only skill is `.agents/skills/railway-config/`. Staged **OD-C7** | [[skills-charter]] + founder |
| V-7 | **Rule with no mechanism** | `CLAUDE.md:147` — *"'Should work' is not a report"*; nothing checks it | This team — it is the mandate |
