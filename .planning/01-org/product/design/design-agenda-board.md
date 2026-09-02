---
type: agenda-board
division: product
department: design
status: active
metrics: []
updated: 2026-08-28
links: ["[[design-charter]]", "[[design-agenda-full]]", "[[design-loops]]", "[[design-schedule]]", "[[design-premortem]]", "[[design-directive]]", "[[design-agent-stack]]", "[[design-questions]]", "[[0039-activation-plan-of-record]]", "[[FORK-REGISTRY]]"]
---

# Design — Board

Live view of the department. Counters are hand-entered until the three mechanical cards in
[[design-agenda-full]] (T1.3, T2.1, T3.4) run from `scripts/agents/run_card.py`. The
department's own card is `routing_class: extraction` and will **not** be automated — see
[[design-agenda-full]] §6.

**One rule on this board:** the five primary metrics are a **set**. No sum, no average, no
"design velocity" figure — [[design-directive]], opposed-metrics rule.

## Every Design artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/design"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/product/design"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/design"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Teams with no premortem — the artifact that is skipped first

```dataview
LIST
FROM "01-org/product/design"
WHERE type = "charter" AND team != null
  AND !contains(file.outlinks, link(team + "-premortem"))
```

## Standing counters — re-measured 2026-08-28

An unmeasured metric is written **unmeasured**, never blank: a blank cell reads as zero and
zero reads as fine.

- [ ] `design.paths_closed_per_month` — **rate never measured**; ~90–100 of **910** unique
      `NEW-` IDs closed cumulatively (catalogue now 1,872 lines / 158,311 bytes)
- [ ] `design.paths_closed_on_service_routes` — **undefined**; the service-route set does
      not exist yet → [[design-agenda-full]] T1.2
- [ ] `design.deferred_unblocker_ratio` — **uncomputed**; the data is in
      `UX_PATHS_CATALOG.md:10-67` and nobody has divided → T1.1
- [ ] `design.ledger_drift_days` — **≥ 32 and rising** (floor, not a reading). `:49` still
      says the Seating Density widget *"does not exist yet"*; `:1013` says it shipped;
      `SeatingDensityPanel.tsx` on disk at **31,709 bytes** since 2026-07-27 → T1.1
- [x] `design.token_source_count` — **2** (`apps/web/tailwind.config.js:31` `#9E4249`;
      `apps/mobile/src/design/tokens.ts`). Target **1**, and it needs a migration budget →
      [[design-agenda-full]] §7 Q3
- [ ] `design.primitive_documented_ratio` — **5 stories / 26 `.tsx`** in
      `apps/web/src/components/ui/`; **0 of 16** in `packages/ui/src`; **0** in `apps/mobile`
- [ ] `design.system_composition_pct` — **undefined**; the denominator does not exist → T2.3
- [x] `design.a11y_allowlist_files` — **47** (new metric, adopted 2026-08-28).
      `jsx-a11y/label-has-associated-control` is `'error'` (`.eslintrc.cjs:49`) with the
      OD-105 ratchet allowlist at `:58-106`. **Fix a file → delete its line; never add a
      line** → T2.2
- [ ] `design.a11y_rules_enforced` — **1 of 10** §X rows (`UX_PATHS_CATALOG.md:1498` —
      anchor corrected from the `:1493` cited in charter and schedule)
- [x] `design.resolved_question_rate` — **15 of 43** indexed sketches carry a winner;
      **28 `Winner: null`**
- [x] `design.sketch_index_completeness` — **43 rows / 53 directories**; 10 unindexed
      (005, 011–015, 017–019, 049); IDs `038` and `048` each used twice; row `039` has no
      directory. **~24 wave-3 canvases land on top of this** → T3.1
- [ ] `design.open_null_winner_count` — **28**, and the WIP limit **N is still unset**
      (`exploration-studio-directive:68`) → T3.2
- [ ] `design.winner_shipped_conversion` — **2 of 53** (038 → `/inventory`;
      052 → `scripts/docgen/templates/wineops_document.html`)
- [ ] `design.time_to_first_real_action_staff_min` — **unmeasured, and no event exists to
      compute it from** (`activation.real_action` publisher: NONE) → T4.1
- [ ] `design.role_default_coverage_pct` — **0**. Role-based defaults do not exist;
      `NEW-513` deferred at `UX_PATHS_CATALOG.md:63` → T4.3
- [ ] `design.blocked_on_endpoint_count` — **unread**, and published monthly once read so
      the cost of the open PROD-F5 fork is visible rather than absorbed → D5
- [x] `design.ux_optimizer_rows` — **0**, and **0 is the correct value**. Flag default at
      `ux-optimizer.service.ts:78`. Non-zero means [[AGENT_NATIVE_UI_DECISION]]:78 was
      reversed without a supersede-ADR → incident, routed to [[decision-office-charter]]

## Mechanical cards — declared, not yet running

Three of Design's four team cards are `routing_class: mechanical` and **none is in the
`IMPLEMENTED` dict at `scripts/agents/run_card.py:333`** (8 entries, none Design's). Until
they are, L-DSN-1/2/3 close at human reliability — the reliability that produced `:49`.

- [ ] `ux-ledger-reconciler` — T1.3, close **2026-10-09**
- [ ] `substrate-census` — T2.1, close **2026-10-09**
- [ ] `sketch-manifest-steward` — T3.4, close **2026-10-09**
- [x] `design-board-steward` — **will not be automated**; extraction cards stay designed
      ([[0038-cards-run-as-declared-scripts]])

## Locks in force

- [x] **Brand / landing visuals — HELD** until *"structure + brand exist"*
      (`decisions/README.md:81`). This department does the structure half and
      **commissions no visual**
- [x] **OD-106 — deferred, documentation only** (`OPEN-DECISIONS.md:64`). The co-design
      pack is built; the direction and the primary stay the founder's
- [x] **The voice guide is [[brand-identity-charter]]'s**, not Design's. Design owns the
      product-language corpus underneath it
- [x] **The optimizer stays dark**

## Open, blocking, named

- [ ] **Commissioning authority (PROD-F5)** — can [[ux-path-burn-down-charter]] commission
      the endpoints its deferred rows need? Unanswered → the largest team cannot function.
      First concrete instance escalates by **2026-09-18** (D5)
- [ ] **Commitment or inventory?** — the ledger has no *"will not build"* state (T1.4)
- [ ] **Migration budget for `token_source_count` 2 → 1** — without one the metric is
      decorative and comes off this board
- [x] **Fork ID collision resolved** — `product.md:858-862` proposed OD-20…OD-24 while
      OD-20…OD-23 were already issued; renamespaced to **PROD-F1…PROD-F5**
      ([[FORK-REGISTRY]])
- [x] **The count correction** — "760 paths" appears in [[engineering-premortem]] M5 and in
      founder notes. It is **910**, re-counted 2026-08-28

## The clock

`scripts/watch_loops.py:11-13`: all 198 agenda files shared `updated: 2026-08-24` and hit
the 60-day staleness rule together on **2026-10-23**. This file's re-date moves that to
**2026-10-27**. Every close-time in [[design-agenda-full]] sits before it.
