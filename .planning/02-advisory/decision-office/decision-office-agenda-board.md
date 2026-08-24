---
type: agenda-board
division: advisory
department: decision-office
status: provisional
metrics: [decisions.open_count, decisions.unowned_count, decisions.median_age_days, decisions.close_rate_per_week, decisions.decided_here_count, decisions.namespace_collisions, decisions.unfiled_fork_count, triggers.dated_unwatched_count, loops.undefined_close_time_count, corpus.contradiction_count]
updated: 2026-08-24
links: ["[[decision-office-charter]]", "[[decision-office-premortem]]", "[[decision-office-agenda-full]]", "[[decision-office-directive]]", "[[decision-office-loops]]", "[[decision-office-schedule]]", "[[OPEN-DECISIONS]]", "[[ORG_STRUCTURE]]", "[[OBSIDIAN_VAULT]]", "[[LOOP-MAP]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[skills-charter]]", "[[sales-charter]]", "[[legal-charter]]", "[[analytics-bi-charter]]", "[[standards-verification-charter]]"]
---

# Decision Office — Board

> **PROVISIONAL — no work done yet.**

## Live queries

These are queries, not a hand-maintained list — [[OBSIDIAN_VAULT]] §4 makes Dataview
the anti-sprawl mechanism, because a board that re-derives itself cannot silently
drift the way a bullet list does.

**This unit — all 7 artifacts:**

```dataview
TABLE type, status, updated
FROM "02-advisory/decision-office"
SORT type ASC
```

**The 60-day agenda sweep — [[ORG_STRUCTURE]] §4, org-wide.** *"An agenda that has
not changed in 60 days is either finished or fiction."* This office runs the
detection; the owning unit answers.

```dataview
TABLE division, department, status, updated,
      (date(today) - date(updated)).days AS "age (days)"
FROM "01-org" OR "02-advisory"
WHERE (type = "agenda-full" OR type = "agenda-board")
  AND date(today) - date(updated) > dur(60 days)
SORT updated ASC
```

⚠️ **Returns 0 rows today and will return ~166 on 2026-10-23.** Every unit document
carries `updated: 2026-08-24`, so the whole corpus's 60-day clock starts and expires
together. Empty is not healthy here; it is *pre-cliff*.

**Units still at `status: new` — chartered against no evidence:**

```dataview
TABLE division, department, team, updated
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND status = "new"
SORT division ASC, department ASC
```

**Loop coverage — which units have written loops at all:**

```dataview
TABLE division, department, status, updated
FROM "01-org" OR "02-advisory"
WHERE type = "loops"
SORT division ASC
```

⚠️ **This query reaches the file, never the loops inside it.** All **396** loop
blocks — the six on [[decision-office-loops]] included — sit in fenced ` ```yaml `
regions in the document **body**, and Dataview indexes frontmatter and inline
fields, not fenced code. `close_time` and `status` per loop are therefore **not
queryable**, `[[LOOP-MAP]]` (**56 inbound links, file absent**) cannot be a query,
and [[decision-office-loops]] L4 runs by grep. Filed as a founder question, not
fixed here — moving 396 blocks is corpus-wide.

---

## Register — as of 2026-08-24

- **`open_count` — 23.** OD-01, 03–08, 11, 14, 18–31
- **`unowned_count` — 23 of 23.** No open row names an owner
- **`median_age_days` — undefined.** No open row carries a filed date
- **`close_rate_per_week` — unmeasured.** All 12 resolved rows share one date: a burst, not a rate
- **`decided_here_count` — 0.** Target **0**, permanently ([[decision-office-premortem]] M3)
- **`intake_returned_count` — 0.** Target **0**, not "low" (M1)
- ⚠️ **Register mutated mid-session** — OD-28…OD-31 appended by parallel agents; **OD-23 rewritten in place** while **83 documents cite it**

## Inbox this function was handed before it existed

- **222 of 581** unit documents reference `decision-office`
- **329** `[[decision-office-charter]]` wikilinks — all unresolved until this session
- **168** loop blocks route `outputs_to: [decision-office]`
- **OD-30**, filed by a parallel session: *"Decision Office's first assignment; mechanical to fix"*
- `privacy-engineering-loops.md:188` — `owner: UNASSIGNED`, `close_time: UNDEFINED`, `outputs_to: [decision-office]`

## Fork namespaces — 7 in use

- [ ] **`OD-nn`** canonical — `decisions/OPEN-DECISIONS.md`
- [ ] **`OD-19…24`** local — `technology.md:842-848` ⚠️ collides
- [ ] **`OD-20…24`** local — `product.md:858-862` ⚠️ collides with both
- [ ] **`OD-C1…C5`** — `corporate.md:494-498` ✅ namespaced, worked
- [ ] **`OD-C6…C8`** — minted in-session, **unfiled**
- [ ] **`CM-F1…F6`** — `commercial.md:629-634` ✅ namespaced, worked
- [ ] **`F-1…F-5`** — `intelligence.md:515-521` ⚠️ ambiguous against `CM-Fn`
- [ ] **`DEP-06`** — unit-local, **64 references**, defined `PROJECT.md:101`

**Collision damage:** OD-20/21/22/23/24 carry **3 meanings each**; OD-19 carries 2.
Citations per ID: OD-23 **83** · OD-21 **79** · OD-20 **81** · OD-24 **45** ·
OD-22 **40** · OD-19 **45**.

**Self-corrected in place by three generators** — `product-vision-charter.md:133`,
`design-agenda-board.md:104`, `supplier-distributor-network-charter.md:73`.
Good culture, missing registrar.

## Dated triggers — 6 known, 0 watched

- [ ] **2026-11-24** — [[skills-charter]]: <5 firing skills → collapse into AI Orchestration
- [ ] **2026-11-24** — [[skill-harvesting-charter]]: registry <15, no trigger re-evaluation
- [ ] **2026-11-24** — [[sales-charter]]: `DEP-06` unchecked + `$0` recovered → fold into Growth, delete 14 of 21 docs
- [ ] **2026-11-24** — [[outbound-engine-charter]]: no landed credit → folds with Sales
- [ ] **≈2026-11-22** — [[supplier-distributor-network-charter]]: day-90, CM-F3 + OD-21 open, 0 counterparties
- [ ] **second quarterly review** — [[legal-charter]]: merge trigger, the written counter to OD-26

**Two org-wide cliffs, one month apart:** ~2026-10-23 (60-day agenda staleness,
~166 documents) then 2026-11-24 (four retirement triggers). Both currently unwatched.

## Loop health — 396 blocks, 82 files

- [ ] `status: exists` **4** · `running` **2** — **6 of 396 loops are running**
- [ ] `status: proposed` **356** — 90% of the org's feedback loops are forecast
- [ ] `blocked` **25** · `provisional` **63**
- [ ] `close_time: UNDEFINED` — `privacy-engineering-loops.md:188`
- [ ] Status-field drift — `content-production-loops.md:58` reads `status: monthly`
- [ ] ~60 distinct free-text close-time phrasings: informative, unparseable

## Contradictions open — 4, verified against the live tree

- [ ] **C1** — insight types: **375** (`LLM_INSTRUCTION_PROMPTS.md:166`) vs **573** (`YC_WEDGE_PLAN.md:324`) → [[analytics-bi-charter]]
- [ ] **C2** — skill-health owner: `foundation/README.md:269` vs `technology.md:497` → **OD-25**, registered, unowned
- [ ] **C3** — Seating Density widget: `UX_PATHS_CATALOG.md:49` says absent, `:1013` ships it. **`SeatingDensityPanel.tsx` exists.** One file contradicting itself — **routed, not ruled**
- [ ] **C4** — `.claude/skills/`: ~99 `schedule.md` files say absent (**OD-C7**); it now exists, tracked, 0 `SKILL.md`. **An open item half-closed by a side effect**

## Stale citations open — 1, and it inverted

- [ ] `YC_WEDGE_PLAN.md:401` → `ReceivingWorkspace.tsx:233,265`; live `:400-401`, `:438-440`
- [ ] Same sentence: *"`:92` defaults `invoiceQty` to `stockedQty`"* — `:168` reads `useState<number|null>(null)`; `stockedQty` seeds `acceptedQty` at `:174`. **The claim reversed, not just moved**

## Next 3 — need nobody's permission

- [ ] **1.** Owner + filed-date + severity on all 23 rows → `unowned_count` 23 → 0
- [ ] **2.** Digest #1: oldest item first; `open_count` and `intake_rate` on one line
- [ ] **3.** Dated-trigger calendar live → `dated_unwatched_count` 6 → 0

## Escalations standing open

- [ ] **Fork scheme** — proposal only; applying it is a founder call (83 OD-23 citations)
- [ ] **≥19 staged forks unfiled** — OD-C1…C8, CM-F1…F6, F-1…F-5
- [ ] **OD-26** — merge triggers org-wide? **This office declines to author its own standing rule**
- [ ] **OD-25** and the `README.md:269` daily-digest owner — two foundation documents, two owners, same shape
- [ ] **OD-C6** — [[standards-verification-charter]] reparenting: **declined in writing**
- [ ] **Loop blocks → frontmatter?** 396 blocks; [[architecture-review-charter]] should see it
- [ ] **OD-03 (146 refs) and OD-11 (142 refs)** — the two most-cited open items, both blocked on *a session being scheduled*
- [ ] **L6 authority audit must be owned by [[red-team-charter]]**, not by this office
