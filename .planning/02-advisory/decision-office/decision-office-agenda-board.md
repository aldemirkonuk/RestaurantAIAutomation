---
type: agenda-board
division: advisory
department: decision-office
status: active
metrics: [decisions.open_count, decisions.unowned_count, decisions.median_age_days, decisions.close_rate_per_week, decisions.decided_here_count, decisions.intake_returned_count, decisions.namespace_collisions, decisions.unfiled_fork_count, triggers.dated_unwatched_count, triggers.fired_but_unactioned_count, loops.undefined_close_time_count, corpus.contradiction_count, corpus.stale_citation_count]
updated: 2026-08-28
links: ["[[decision-office-charter]]", "[[decision-office-agenda-full]]", "[[decision-office-premortem]]", "[[decision-office-directive]]", "[[decision-office-loops]]", "[[decision-office-schedule]]", "[[decision-office-agent-stack]]", "[[decision-office-questions]]", "[[FORK-REGISTRY]]", "[[OPEN-DECISIONS]]", "[[ORG_STRUCTURE]]", "[[OBSIDIAN_VAULT]]", "[[LOOP-MAP]]", "[[0002-documentation-first-operating-mode]]", "[[0025-citations-must-disagree-loudly]]", "[[0035-wave2-seam-reconciliation]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0038-cards-run-as-declared-scripts]]", "[[0039-activation-plan-of-record]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[standards-verification-charter]]", "[[skills-charter]]"]
---

# Decision Office — Board

How the 2026-08-28 agenda is watched. Tasks live in [[decision-office-agenda-full]];
this file is the instrument panel. Queries re-derive themselves; the counters below the
queries are the ones no query can compute yet, and each names the command that produces it.

---

## Live queries

### This unit — all nine artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "02-advisory/decision-office"
SORT type ASC
```

Expect `charter`, `directive`, `loops`, `schedule`, `premortem` to still read
`updated: 2026-08-24`. That is correct and it is also the point: the agenda moved and
the documents behind it have not been re-graded. Several of their claims are corrected
in [[decision-office-agenda-full]] §The frame rather than edited in place, because
correcting a charter mid-wave is a different operation from writing an agenda.

### The 60-day staleness sweep — org-wide, and this office runs the detection

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  division AS Division,
  department AS Dept,
  updated AS "Last touched",
  (date(today) - date(updated)).days AS "Age (days)"
FROM "01-org" OR "02-advisory"
WHERE (type = "agenda-full" OR type = "agenda-board")
  AND date(today) - date(updated) > dur(60 days)
SORT updated ASC
```

⚠️ **Returns 0 today, and it fires in two waves rather than one.** Measured 2026-08-28
with `scripts/watch_loops.py --asof`: **2026-10-23 → 160 agendas** carrying
`updated: 2026-08-24`, then **2026-10-27 → 40 agendas** carrying `updated: 2026-08-28`.
The 2026-08-24 charter predicted a single cliff of 194. Wave 3 split it — department
agendas were rewritten, team agendas were not. Empty here is **pre-cliff**, not healthy.

### Units still chartered against no evidence

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  division AS Division,
  default(team, "— dept —") AS Unit,
  status AS Evidence
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND status = "new"
SORT division ASC, department ASC
```

### Every unit's open questions — the advisory delivery target

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  open_questions AS Open,
  updated AS Updated
FROM "01-org" OR "02-advisory"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```

This is where this office's findings land. It is also this office's own blind spot:
writing into another unit's `questions.md` **notifies nobody**
([[decision-office-agent-stack]] §5). The weekly digest is the only push mechanism.

---

## The guard panel — run 2026-08-28, this worktree

Four register-facing guards exist. CI runs all four (`.github/workflows/ci.yml:196-205`).
The `claim-auditor` card runs **three** (`scripts/agents/run_card.py:279-294`).

- [x] `scripts/check_decision_claims.sh` — **exit 0** · 111 executable claims, 111 holding
- [ ] `scripts/check_citation_pairing.py` — **exit 1** · 125 citations vs 107 rows ·
      12 UNANCHORED · 1 DISAGREEING *(re-run minutes later: 157 · 14 · 2)*
- [ ] `scripts/check_od_ids_exist.py` — **exit 1** · 2 ids name nothing · 7 references,
      all inside `04-specs/REGISTER-AUDIT-2026-08-26.md`
- [x] `scripts/build_agent_card_index.py --check` — the card contract, 100 units / 102 cards

⚠️ **Two of four are red, and every flagged citation site is a wave-3 agenda.**
`media-brand-agenda-full.md` ×4 + its board · `design-agenda-full.md` ×2 ·
`analytics-bi-agenda-full.md` ×2 · `finance-pricing-agenda-full.md` ×2 ·
`architecture-review-agenda-full.md` ×2 · `ai-orchestration-agenda-full.md` ·
`knowledge-documentation-agenda-full.md` · `strategy-fundraising-agenda-board.md`.
The wave that writes agendas is minting the defect [[0025-citations-must-disagree-loudly]]
exists to catch. **This board's own two documents contribute 0 flagged sites** — checked
before shipping.

⚠️ `check_od_ids_exist.py` is **absent from the `claim-auditor` card's guard set.**
That card belongs to [[standards-verification-charter]]; the finding is routed, not fixed.

---

## Register — as of 2026-08-28

- **`open_count` — 39.** `resolved_count` — 72
- **`unowned_count` — 39 of 39.** The `## Open` table is still four columns:
  ID · Question · Why it matters now · What unblocks it. **No owner column, no
  filed-date column**
- **`median_age_days` — undefined**, four days and six ADRs after the last time it was
  reported undefined. [[0002-documentation-first-operating-mode]]'s own tripwire —
  *"grows faster than it drains"* — still cannot fire
- **`close_rate_per_week` — unmeasured**, same cause
- **Severity:** 13 of 39 rows carry a 🔴 / 🟠 / 🟡 band · **26 carry none**
- **`decided_here_count` — 0.** Target **0**, permanently ([[decision-office-premortem]] M3)
- **`intake_returned_count` — 0.** Target **0**, not "low" (M1)

### Register defects open — found 2026-08-28, filed not fixed

- [ ] **One id in two tables.** Open at OD-25 (`OPEN-DECISIONS.md:35`), resolved at
      OD-25 (`OPEN-DECISIONS.md:35`) — the only such row in the file, and **no guard
      checks for it.** A real past instance for a `register-table-integrity` candidate
- [ ] **A row that says Resolved inside the Open table.** OD-29's cell opens
      *"✅ Resolved in two cuts"* (ADR 0035, then ADR 0036) and the row has not moved.
      [[0036-cost-routing-two-plans-in-harmony]] is indexed as *"OD-29 closed"*
- [ ] **An ADR header naming the wrong row.**
      `0023-email-verification-is-enforced.md:12,16` says it closes a row that today is
      *Design foundation direction*. `check_od_ids_exist.py`'s own docstring says it
      cannot catch **names-the-wrong-thing** — this is that half, live
- [ ] **Two dead ids, seven references**, all inside `04-specs/REGISTER-AUDIT-2026-08-26.md`

---

## The two carried forks

- [ ] **OD-25 — weekly skill-health job owner.** `foundation/README.md:269` says
      Research & Math · `foundation/teams/technology.md:498` routes it through Skills ·
      [[0039-activation-plan-of-record]] **A4 adds a third pair** (RM-3 + SRE). Three
      candidates, one job, **open since 2026-08-24 and never once re-raised**
- [ ] **TECH-F3 — the evaluation seam.** `FORK-REGISTRY.md:64` defines it; `:200` records
      *26 citations in 17 files*; **re-measured 2026-08-28 at 54 occurrences in 30 files**
      — the registry's citation index is dated 2026-08-24 (`:165`) and has drifted by
      thirteen files. [[0039-activation-plan-of-record]] A5 already executes across this seam
- [ ] **Precedent exists and is deliberately not applied.**
      [[0036-cost-routing-two-plans-in-harmony]]`:24` says it draws *"the same line
      TECH-F3 draws for evaluation, one seam over."* Applying it here would be deciding
      ([[decision-office-directive]] node T). It is reported, and it is the founder's

---

## Calendar — the watcher exists, and its trigger arm is noisy

`scripts/watch_loops.py` runs in CI (`.github/workflows/loop-watcher.yml:36`).

- [x] **Staleness arm — sound.** Two cliffs, four days apart: **2026-10-23 (160)** ·
      **2026-10-27 (40)**. Blind to a date-only bump (`watch_loops.py:74`)
- [ ] **Trigger arm — 5 events inside 30 days, nearest in 7.** It classifies as a
      retirement trigger *any* line containing `merge|retire|collapse|fold|disband|
      sunset|dissolution` near any date from September onward (`watch_loops.py:97-113`)
- [ ] **The three lines behind "2026-09-04 — 3 units must judge whether they should still
      exist" are ordinary task rows:** `knowledge-documentation-agenda-full.md:77` ·
      `security-agenda-full.md:202` · `finance-pricing-agenda-full.md:80`
- [ ] **The real cluster is invisible** — 8 units on **2026-11-24**, 3 on **2026-11-22**,
      both outside the 30-day horizon
- [ ] **Corroborated independently, same day.** [[red-team-charter]]'s new agenda files
      the identical two facts as **F-W1** (two mass staleness events) and **F-W2**
      (*"dated-trigger events went 0 → 6, 18 unit-slots, all false"*), names this office
      as loop owner for both, and asks for a dated row in
      `decision-office-questions.md`. Accepting those two rows is DO-12/DO-13's first
      deliverable
- [ ] ⚠️ **`02-advisory/decision-office` is itself listed as facing a trigger** — because
      `decision-office-charter.md:259-263` and `decision-office-loops.md:137-140`
      *catalogue other units' triggers*. **The register of triggers reads as having
      them.** That is the argument for declaring a trigger rather than grepping for one

---

## Loop health — 485 loops, `00-index/loops.json`

- [x] `loops.undefined_close_time_count` — **0.** The blocker
      [[decision-office-schedule]] recorded is closed; the index exists and parses
- [ ] `proposed` **438** · `blocked` **29** · `dormant` **9** · `gated` **4** ·
      `active` **3** · `running` **2** — **5 of 485 running**
- [ ] This unit's six loops are **all `proposed`**: `decision-register-health` (weekly) ·
      `dated-trigger-watch` (weekly) · `fork-namespace-integrity` (per-event) ·
      `loop-close-time-audit` (monthly) · `contradiction-register` (monthly) ·
      `decision-office-authority-audit` (quarterly, **owner: red-team**)
- [ ] **One field in 485 records is polluted, and it is the one ADR 0035 changed.**
      `nfb-research-store-erasability`'s `owner` carries its whole YAML inline comment.
      `scripts/build_loop_index.py` does not strip comments, so a filter on
      `owner == "privacy-engineering"` misses it

---

## Seam verification — ADRs 0034 → 0039

[[0035-wave2-seam-reconciliation]] asserts every affected line was amended the same day
*"so no doc still states the conflict as open."* 25 files cite `0035` today. The pass
that re-reads them is DO-9.

- [x] Item 1 (nf-a-coverage split) — **says what the ADR says**
      (`ai-orchestration-agent-stack.md:65`, `observability-telemetry-plumbing-agent-stack.md:67-74`)
- [ ] Item 5 (NF-B erasability owner) — **amended but diverges**: correct in
      `privacy-engineering-loops.md:193`, polluted in `00-index/loops.json`
- [ ] Items 2, 3, 4, 6, 7, 8 — **ungraded.** Nothing has re-read them
- [ ] ADRs 0034, 0036, 0037, 0038, 0039 — **ungraded**

---

## Intake standing open

- [ ] **RT-F1 … RT-F6** — staged in `red-team-agenda-full.md:296-301`, namespace
      acknowledged at `FORK-REGISTRY.md:125`, **and not one of the six has a row or a
      disposition.** Two have moved underneath the registry:
      [[0037-nfb-erasure-is-crypto-shredding]] largely answers RT-F1 (NF-B stays HELD),
      and RT-F3 restates OD-26 (`OPEN-DECISIONS.md:36`)
- [ ] **≥19 staged forks** — `OD-C1…C8`, `CM-F1…F6`, `F-1…F-5` — still unfiled
- [ ] **`FORK-REGISTRY.md` §5.1's thirteen filing proposals** — written 2026-08-24, none
      filed, none rejected
- [ ] **CORP-F6** — reparenting [[standards-verification-charter]] under this office:
      **declined in writing.** Declining is ours; accepting is not

---

## Restraint counters — reported whether or not they move

- [x] `decisions.decided_here_count` — **0** (target 0, permanently)
- [x] `decisions.intake_returned_count` — **0** (target 0, not "low")
- [x] *"should"* in a finding — **0**; greppable, and checked at the quarterly self-audit
- [ ] ⚠️ **L6 is unclaimed.** [[red-team-charter]]'s agenda landed during this session
      (`status: active`, `updated: 2026-08-28`) with eleven tasks — and
      `decision-office-authority-audit`, the one loop in this unit owned by red-team,
      appears **zero times** in either of their two new files. The one external check on
      this office's most likely failure mode is unstaffed by an *active* agenda, which is
      worse than pending. This office is the wrong unit to staff it
- [ ] **`decision-register-clerk` is not implemented.** Declared
      `routing_class: mechanical`; `run_card.py`'s `IMPLEMENTED` map holds 8 of 36
      mechanical cards and this is not one of them
- [ ] **0 of this office's 4 eligible skills written.** `.claude/skills/` holds four —
      `fleet-census`, `harness-contract-audit`, `model-pin-census`,
      `registry-index-refresh` — and none is ours ([[0038-cards-run-as-declared-scripts]])

---

## Next three — need nobody's permission

- [ ] **1.** Owner · filed_date · severity on all 39 rows → `median_age_days` becomes a number
- [ ] **2.** Digest #1, oldest first, with the four-guard panel on it → **2026-09-04**
- [ ] **3.** OD-25 and TECH-F3 evidence packs in front of the founder, with a re-raise
      date attached to each → **2026-09-04 / 2026-09-11**
