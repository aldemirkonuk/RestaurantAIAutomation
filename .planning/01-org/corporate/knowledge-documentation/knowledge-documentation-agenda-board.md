---
type: agenda-board
division: corporate
department: knowledge-documentation
status: active
metrics: [corpus.duplicate_basename_count, graph.ambiguous_basename_count, standards.stale_claim_rate, kd.docs_added_vs_retired_ratio]
updated: 2026-08-28
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-agenda-full]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-schedule]]", "[[knowledge-documentation-agent-stack]]", "[[corpus-archive-agenda-board]]", "[[graph-retrieval-agenda-board]]", "[[standards-verification-agenda-board]]"]
---

# Knowledge & Documentation — Board

Live view of [[knowledge-documentation-agenda-full]] (dated 2026-08-28). Tasks live there;
this page holds the queries and the counters.

> **Dataview now executes** — `.planning/.obsidian/plugins/dataview` is committed. It
> executes **inside Obsidian only**: nothing materialises these fences to text, so an agent
> reading this file by `grep` still sees empty blocks. That is the live half of premortem
> M2 and it is scheduled as **KD-11**, close_time 2026-10-09. Until KD-11 lands, the
> §Standing counters below are the only machine-readable rows on this page — and every one
> of them names where its value came from, per **KD-4**.

## Every Knowledge & Documentation artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/corporate/knowledge-documentation"
WHERE type = "charter"
SORT status ASC
```

## Still provisional inside this department

The department's four department-level artifacts are dated 2026-08-28; the teams' are not.
This query is the burn-down, and it should reach zero rows.

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  type AS Type,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation"
WHERE status = "provisional"
SORT default(team, "") ASC, type ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/corporate/knowledge-documentation"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## The org-wide staleness sweep this department owns for everyone

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  default(department, "—") AS Department,
  updated AS "Last touched"
FROM "01-org" OR "02-advisory"
WHERE type = "agenda-full" OR type = "agenda-board"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

**Two fire dates now, not one — and that is this wave's doing.** Before the wave, 200
agenda files all carried `updated: 2026-08-24` and `watch_loops.py --asof 2026-10-24`
reported a single cliff of 200. Re-run mid-wave, 2026-08-28: **162 firing 2026-10-23** and
**38 firing 2026-10-27**, with `stale_now` still 200. The cliff rule groups by `updated:`
and flags any group of ≥10 (`watch_loops.py:83-96`). **KD-5** makes the sweep per-unit and
rolling, close_time **2026-10-16** — before either date.

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/knowledge-documentation"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Where the corrections are, and how old

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  open_questions AS Open,
  updated AS Updated
FROM "01-org/corporate/knowledge-documentation"
WHERE type = "questions"
SORT open_questions DESC
```

L-KD-4 escalates any correction open past **30 days** to [[decision-office-charter]]
regardless of severity. It has no mechanism this quarter — recorded as finding **F3** in
[[knowledge-documentation-agenda-full]], not quietly omitted.

---

## Standing counters — value, then provenance

Every row states where its number came from. A row with no source says **not measured**;
a row nothing can read says **unreadable**. Neither is ever left blank, and the three sets
are never summed (charter §Metrics; ADR 0020).

**Department — the growth ratio (`kd.*`)**

- [ ] `kd.planning_md_total` — **1,198** · `scripts/agents/run_card.py:314-330`, disk 2026-08-28
- [ ] `kd.top_level_md` — **6** · same run (`FUTURES`, `PROJECT`, `ROADMAP`, `STATE`, `YC_WEDGE_PLAN`, `v3.0-TECH-DEBT`)
- [ ] `kd.agent_stack_docs` — **100** · `memory/2026-08-28-vault-census.md`
- [ ] `kd.docs_retired_machine_readable` — **0** · no parser exists for the ADR 0032 tombstone index → **KD-1**
- [ ] `kd.docs_added_vs_retired_ratio` — **not measured** · numerator exists, denominator has no reader. Trajectory, hand-derived: 1,090 (2026-08-27) → 1,198 (2026-08-28), **+108 added, 0 retired**
- [ ] `kd.ledger_grain` — **unsettled** · three grains in three documents → **KD-2**

**Place it (`corpus.*`) — [[corpus-archive-charter]]**

- [ ] `corpus.top_level_planning_docs` — **6** · was 35 → 30 → 6 under ADR 0032; no guard prevents the 7th → **KD-14**
- [ ] `corpus.duplicate_basename_count` — **unreadable** · the 38 in the founding charter counted `md/` ∩ `md_files/`, and both trees were deleted 2026-08-27 (ADR 0032). Needs re-deriving over the surviving tree → **KD-13**
- [ ] `corpus.ambiguous_duplicate_count` — **unreadable** · same cause; the 3 diverged pairs were resolved by the ADR 0032 founder calls
- [ ] `corpus.tombstone_rows_parseable` — **no** · hand-written markdown table; conflict markers observed on disk 2026-08-28 (finding F1)

**Find it (`graph.*`) — [[graph-retrieval-charter]]**

- [ ] `graph.dataview_executable` — **true (in Obsidian only)** · `.planning/.obsidian/plugins/dataview` committed; **false** for any headless reader → **KD-11**
- [ ] `graph.ambiguous_basename_count` — **≥ 46** `README.md` under `.planning/`, **41** of them in `sketches/` · disk 2026-08-28. Wave 3 takes it to **≥ 70** → **KD-6**
- [ ] `graph.frontmatter_coverage_pct` — **not measured from the CLI** · the 8.9% figure was a one-off hand pass over a 45-doc spine that no longer exists in that shape → **KD-12**
- [ ] `graph.link_resolution_rate` — **not measured** · the vault it needed now exists; the script does not → **KD-12**

**Verify it (`standards.*`) — [[standards-verification-charter]]**

- [ ] `standards.decision_claims` — **PASS** · `run_card.py:279-294`, 2026-08-28
- [ ] `standards.citation_pairing` — **PASS** · same run
- [ ] `standards.agent_card_contract` — **PASS** · same run
- [ ] `standards.stale_claim_rate` — **not measured** · all three PASSes are register-scope; nothing samples prose → **KD-8**. Premortem M4's tell fires **2026-10-23**
- [ ] `standards.unpinned_claim_count` — **≥ 1 known** · insight types quoted as 375, 573, 348; sole assertion is `>= 200` (`insight-catalog.spec.ts:10`) → **KD-9**
- [ ] `standards.contract_self_compliance_pct` — **0 of 2** measurable cases · `ORG_STRUCTURE` §5, `OBSIDIAN_VAULT` §3 → **KD-10**

**Loops**

- [ ] `loops.running` — **5 of 485** · `python3 scripts/watch_loops.py`, 2026-08-28. All four KD loops `proposed`; this agenda mechanises L-KD-1 and L-KD-2 only (finding F3)
- [ ] `loops.staleness_cliffs` — **2** · 162 firing 2026-10-23, 38 firing 2026-10-27 (was **1** of 200) → **KD-5**
- [ ] `loops.fired_events_at_2026-10-24` — **13**, was **3** before this wave · **6** of them name this unit and are false: agenda `close_time` rows trip the retirement-trigger regex (`watch_loops.py` `trigger_words`) → **KD-16**
