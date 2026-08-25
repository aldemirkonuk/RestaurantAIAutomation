---
type: audit
title: OD audit — the structural / org / planning entries
status: complete
audited: 2026-08-25
scope: OD-02, OD-08, OD-09, OD-10, OD-11a, OD-12, OD-13, OD-14, OD-15, OD-16, OD-17, OD-21, OD-22
links: ["[[OPEN-DECISIONS]]", "[[0007-org-structure]]", "[[0006-neural-footprint-architecture]]", "[[0008-nf-column-contract]]", "[[ORG_STRUCTURE]]", "[[OBSIDIAN_VAULT]]"]
---

# OD audit — the structural / org / planning entries

Audited against `origin/main` @ `8c9301fb` in an isolated worktree. No application
code changed. Every number below was re-counted here; nothing is quoted from a doc
without checking it against disk, git, or production.

**The pattern being hunted:** an entry marked resolved because the *specific artifact
it named* was fixed, while the *outcome it was pointing at* did not change. Confirmed
today in OD-56 (Node transitives) and OD-63 (`provider_important_dates` absent from
production).

**Verdict summary**

| Entry | Verdict | One line |
|---|---|---|
| OD-02 | **WRONG** | Row says *5 divisions, 20 departments*. Disk and ADR 0007 say **7 / 19**. Corrected twice, register never amended. |
| OD-08 | **HALF-CLOSED** | Folded into OD-21, which answered 1 of its 3 named mechanics. Graphify and sync were never decided. |
| OD-09 | **CLOSED** | Sales survives as its own department with 2 teams. Only the *citing* doc is stale. |
| OD-10 | **HALF-CLOSED** | `subject_type` reservation verified live in production. The **entry trigger was never written** — 3 unit docs still ask for it. |
| OD-11a | **HALF-CLOSED** | Production store built and live. The research store — the other half of "the split" — does not exist. ADR 0008 says so; the register row does not. |
| OD-12 | **CLOSED + ENFORCED** | 485 loops in real frontmatter, `loops.json` carries routing fields, CI blocks on drift. The only one of these with a real guard. |
| OD-13 | **WRONG** | Commit record shows **792 of 801** Wave-1 unit files landed *before* the third Wave-0 contract (ADR 0008) existed. |
| OD-14 | **HALF-CLOSED** | Tombstone exists, but its stated reason is false and **11 planning docs still carry OD-14 as open**, incl. `foundation/README.md:345`. |
| OD-15 | **CLOSED** | 3 advisory units on disk, no Ethics unit, and 23 advisory findings actually delivered. |
| OD-16 | **CLOSED** | Findings-only stated in all 3 charters and in ORG_STRUCTURE §3; no blocking authority claimed anywhere. |
| OD-17 | **UNENFORCED** | Anatomy is 8 on disk (100/100) but ADR 0007 still says 7, and the provisional banner is set on **100/100** units incl. ones whose work is in production. |
| OD-21 | **CLOSED (with 2 breaks)** | Vault root, Dataview, prefixed filenames all real. One file breaks frontmatter; the machine index is stale. |
| OD-22 | **CLOSED** | Counts re-verified exactly: 26 files, 0 adopted, 23 candidate, 2 unverified. Unenforced, but honest. |

---

## OD-02 — "Department structure decided — 5 divisions, 20 departments, 2 sub-layers" · **WRONG**

The structure exists and is good. The row's numbers are wrong, and were wrong twice over
before the row was written.

Counted on disk (`.planning/01-org`, dirs containing a `*-charter.md`):

| | Count | Detail |
|---|---|---|
| Divisions | **7** | applied-ai, commercial, corporate, intelligence, platform, product, research-math |
| Departments | **19** | 2+3+5+2+3+3+1 (Applied AI 2 · Commercial 3 · Corporate 5 · Intelligence 2 · Platform 3 · Product 3 · Research & Math 1) |
| Sub-layers | **2** | `commercial/finance-pricing`, `product/guest-experience` ✅ matches |
| Advisory | **3** | `02-advisory/{architecture-review,red-team,decision-office}` |
| Teams | **76** | see OD-17 |

`foundation/ORG_STRUCTURE.md:36` already says **"7 divisions · 19 departments · 2 sub-layers
· 3 advisory · 75 teams"** and `:45-48` explicitly corrects *"earlier drafts said 20
departments"*. `decisions/0007-org-structure.md:38` agrees. **The Resolved row in
`OPEN-DECISIONS.md:75` was never amended** — it still records the superseded numbers as the
decision.

Three further stale citations of the same superseded pair, all still on `main`:

- `foundation/ORG_STRUCTURE.md:3` — status line still reads *"division count (5 vs 6)
  pending team-layer evidence"*, on the same page whose `:36` says 7. Superseded by OD-28.
- `foundation/README.md:339` — *"OD-09 … expanded to **20**, not trimmed"*.
- `OPEN-DECISIONS.md:30` — **OD-18 is still an Open row** asking *"Division count — 5, or
  split Technology into Platform + Applied AI? … Five departments under Technology is the
  widest span"*. That split **already happened** (`ORG_STRUCTURE.md:46-48`); Technology is
  not a division any more and there is no `01-org/technology/`. OD-18 is an open fork whose
  question no longer has a subject.

Also stale, same root cause: `foundation/teams/` holds `technology.md` (pre-split) and has
no `platform.md`, `applied-ai.md`, or `research-math.md`.

Red Team already filed this class of defect — `red-team-schedule.md:88` and
`red-team-agenda-board.md:123` name `decisions/README.md` carrying *"5 divisions, 20
departments"*. That specific line **has since been fixed** (`decisions/README.md:30` now
says 7/19), which is why the survivors matter: the finding was closed against the file it
named, and four other carriers of the same wrong pair are untouched. Same shape as OD-56.

---

## OD-08 — "Folded into OD-21 and resolved with it" · **HALF-CLOSED**

Recovered the original text from `git show e8bf31c4:.planning/decisions/OPEN-DECISIONS.md`:

> **Obsidian vault mechanics** — vault root (`.planning/` as-is vs dedicated vault dir),
> **Graphify plugin**, **sync strategy**.

OD-21 answered the vault root and added Dataview. It says nothing about the other two.

- **Graphify — not installed.** `.planning/.obsidian/community-plugins.json` lists
  dataview, obsidian-tasks-plugin, templater-obsidian, obsidian-excalidraw-plugin,
  table-editor-obsidian, obsidian-git, obsidian-style-settings, omnisearch. No Graphify.
  `.planning/graphs/` does not exist. Yet **two locked contract docs state Graphify
  clustering as fact**: `OBSIDIAN_VAULT.md:84` and `ORG_STRUCTURE.md:139`
  (*"so Graphify and Obsidian's graph view cluster on `type` + `division`"*).
  `VAULT_AND_LOOPS.md:60` is the only honest one — *"Recommended, not yet configured."*
- **Sync strategy — never decided, but incidentally answered.** `obsidian-git` is
  installed and `core-plugins.json` has `"sync": true`. Two sync mechanisms enabled, no
  ADR choosing either.

The *precondition* Graphify needs does hold: **801/801** files under `01-org`+`02-advisory`
carry `type:` frontmatter, 800/801 carry `division:` and `links:` (the exception is
`FORK-REGISTRY.md`, not a unit artifact). So the clustering claim is one plugin install
away from being true — but today it is a claim about software nobody has run.

---

## OD-09 — "Department set expanded, not trimmed" · **CLOSED**

`01-org/commercial/sales/` exists with all 8 artifacts and 2 teams
(`design-partner-operations`, `outbound-engine`). The founder's overrule held; Sales was
never merged into Growth. Genuinely closed.

The only defect is in a citing doc, not the outcome: `foundation/README.md:339` says
*"expanded to **20**"* against the real 19 (§OD-02).

---

## OD-10 — "NF-C = gated research track — reserved via `subject_type`, entry trigger required" · **HALF-CLOSED**

**The reservation half is real and verified in production**, not just in a migration file.
Queried `SUPABASE_POOLER_URL` on 2026-08-25:

```
public.neural_footprint_event   EXISTS   15 columns   9 rows
CHECK (subject_type = ANY (ARRAY['agent','guest','operator','bio']))
```

The `'bio'` slot is live in the production constraint. This is the *opposite* of the OD-63
failure — the mechanism was checked and it is really there. (`provider_important_dates`
confirmed absent from the same database, consistent with OD-68; 226 public tables total.)

`supabase/migrations/20260824141116_neural_footprint_event.sql:23-24` matches, and `:46-57`
adds partial indexes per `subject_type`.

**The gating half was never written.** OD-10's row says *"entry trigger required"*. There
is no entry trigger anywhere — only an example:

- `decisions/0006-neural-footprint-architecture.md:64-65` — *"Entry trigger must be
  explicit (**e.g.** a funded study partner or a consumer biosignal device with an API)."*
- `foundation/README.md:214-217` — the same sentence, also as an *e.g.*, in a section that
  is explicitly Claude's proposal (*"⬦ FORK — this is yours to overrule"*).

And three unit documents are **still asking for it as an open question**:

- `01-org/research-math/research-math-agenda-full.md:125` — *"What is the entry trigger for NF-C, in your words?"*
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-agenda-full.md:111` — same question
- `.../neural-footprint-instrumentation-directive.md:71,91` — lists *"Declaring the NF-C entry trigger met"* as a thing it cannot do, and *"The NF-C entry trigger's wording"* as blocked on the founder

So the named artifact (`subject_type`) shipped; the gate it was supposed to enable does not
exist, and the missing half is **not tracked as an open fork** — it lives only inside three
unit docs. This is the pattern, in its documentation form.

---

## OD-11a — "NF storage split — narrow polymorphic production table + wide append-only research log" · **HALF-CLOSED**

Production store: **built and live** (see OD-10 — table exists in production, 9 rows).

Research store: **does not exist.** Searched:

- `grep -rn "research_log|nf_research|footprint_research|research_store"` across
  `supabase/`, `services/`, `apps/` → **0 hits**.
- Only one `create table` in either NF migration:
  `20260824141116_neural_footprint_event.sql:17`. `20260824153600_nf_a_readout.sql`
  creates none.
- Production, by pattern: `confidence_thresholds`, `neural_footprint_event`,
  `nf_a_cost_per_completed_task`, `nf_a_readout_provenance`, `research_run_stats`,
  `research_runs`, `v_sku_conflicts`. The two `research_*` tables are the agent research
  runner, unrelated to NF. **No wide append-only NF research log.**

**ADR 0008 is honest about this** — `0008-nf-column-contract.md:123`: *"The research store
(wide, append-only) is **still unbuilt** and remains out of P1."*

The register row is not. `OPEN-DECISIONS.md:78` reads *"narrow polymorphic production table
+ wide append-only research log; production and research workloads separated"* with no
caveat. A reader of the register believes the split shipped. Half of it is a sentence.

That half also carries ADR 0006's load-bearing claim `:77-79` — that the split is *"the
structural answer to 'should research be a separate company'"* (ADR 0001). The structural
answer is currently one table.

---

## OD-12 — "Loop graph = documentation now, executable later" · **CLOSED + ENFORCED**

The strongest entry in this set, and the only one with a guard that blocks.

- `scripts/build_loop_index.py --check` run here: `ok — 485 loops in 100 units;
  vocabulary and index current` (exit 0).
- Wired as a blocking CI job: `.github/workflows/ci.yml:32-46`, job `loop-contract`.
- `00-index/loops.json` is a real machine index — 485 entries, each with
  `id, owner, close_time, status, evidence, measures, changes, inputs_from, outputs_to,
  unit, division, department, file`. `inputs_from`/`outputs_to` are exactly the fields
  "executable later" needs; the "without a rewrite" claim holds.
- Vocabulary is closed as OD-47 promised: `status` has **6** distinct values across all 485
  (`proposed` 438, `blocked` 29, `dormant` 9, `gated` 4, `active` 3, `running` 2 — live
  count **5**, matching OD-47's stated 6→5). `close_time` is drawn from a fixed set
  (`monthly` 150, `weekly` 147, `per-event` 52, `quarterly` 46, `per-pr` 38, `daily` 26,
  `fortnightly` 21, `one-shot` 3).

Honest note, not a defect: 438/485 loops (90%) are `proposed` — the graph is documented
and enforced, not yet running. That is precisely what the entry claimed.

---

## OD-13 — "Wave 0 first (lock contracts), then wide parallel Wave 1" · **WRONG**

`foundation/README.md:320-321` defines Wave 0 as locking three contracts: *"§2.1 department
anatomy, §3.1 skill anatomy, §4.4 metric schema. That is the contract."* Wave 1 is the wide
parallel unit generation.

Commit record, `git log --diff-filter=A --date=iso`, all 2026-08-24:

| Time | Commit | What |
|---|---|---|
| 12:42 | `313481d6` | `foundation/README.md` — the wave plan itself |
| **13:29** | `05ca383f` | **ADR 0007** — department anatomy (Wave 0 #1) |
| **14:12** | `0e83952b` | first Wave 1 unit files (*"Sales + Reliability/SRE departments (56 files)"*) |
| **16:04** | `66c5aae0` | **ADR 0008** — the NF column contract, i.e. §4.4 metric schema (Wave 0 #3) |
| 17:21 | `67258830` | Backtests team added by founder direction |

Department anatomy did precede Wave 1 (13:29 → 14:12) ✓. **The metric schema did not.**

```
files added under 01-org/02-advisory before ADR 0008 (66c5aae0^):  792
total unit .md files ever added:                                   801
```

**792 of 801 Wave-1 files — 99% of the corpus — were committed before the third Wave-0
contract existed.** The sequencing decision was recorded as resolved and then not followed
for two of its three contracts:

- §4.4 metric schema — locked 1h52m *after* Wave 1 began, 99% of the way through it.
- §3.1 skill anatomy — **never locked in any ADR**. It is prose at
  `foundation/README.md:131,158`, and `.claude/skills/` contains a README and zero skills
  (`.claude/skills/README.md:6`: *"Current state: zero committed skills"*). So the contract
  Wave 1 was supposed to be written against for artifact #7 (`schedule.md` = *"index of
  skills owned (`.claude/skills/`)"*, `ORG_STRUCTURE.md:92`) indexes an empty directory in
  all 100 units.

The Wave 0 → Wave 1 ordering is exactly the sort of claim git can settle, and nobody did.

---

## OD-14 — "Root `SKILLS.md` retired — replaced with a tombstone (path kept: `.github/copilot-instructions.md` referenced it)" · **HALF-CLOSED**

The named artifact was fixed. Two things around it were not.

**1. The stated reason for keeping the path is false in the current tree.**
`.github/copilot-instructions.md` exists (903 bytes) and contains **zero** references to
`SKILLS.md` — checked with `grep -rn "SKILLS\.md" .github/` → no matches. The whole
justification for the tombstone-rather-than-delete is a referrer that does not refer.
(`SKILLS.md:3` repeats the claim.) Whether the referrer was removed later or never existed,
the register row and the tombstone both assert something that is not true on `main`.

That same file is stale in its own right: it is titled *"WineOps AI - Copilot
Instructions"*, describes *"17 AI agents"* (OD-31 counts 19/23/24/26), and names
`Gemini Pro` in the stack — a model id OD-04 records as **retired and 404ing**. The
`wineops` branding is deliberately deferred (OD-27); the retired model name is not.

**2. Eleven planning documents still carry OD-14 as an open item.** The decisive one:

- `foundation/README.md:345` — `| OD-14 root SKILLS.md | **Open** — retire or rewrite |`

and ten more across eight units, all describing a file that no longer exists in the form
they describe:

`01-org/corporate/knowledge-documentation/knowledge-documentation-charter.md:84,152` ·
`…/knowledge-documentation-agenda-full.md:82,95` ·
`…/teams/standards-verification/standards-verification-charter.md:53,140` ·
`…/standards-verification-agenda-full.md:84,93` ·
`…/standards-verification-agenda-board.md:84` (cites `SKILLS.md:3` *"the WineOps AI
project"* and an mtime of 2026-02-15) ·
`01-org/corporate/strategy-fundraising/strategy-fundraising-charter.md:263` and
`-agenda-board.md:134` (both as a live **diligence-surface** item) ·
`intelligence/security/security-schedule.md:50` ·
`foundation/README.md:141` · `foundation/teams/corporate.md:218` ·
`foundation/teams/technology.md:458,482`.

Two units are therefore still routing work at a closed decision, one of them on the
fundraising diligence surface.

Note `foundation/README.md`'s §9 table declares itself *"a pointer only"* (`:335`), which
mitigates — but it is wrong on **4 of its 8 rows**: OD-09 (*20* vs 19), OD-11 (*"column
detail still open"* — closed by ADR 0008), OD-14 (*Open* — closed), OD-20 (*"🔴 Open,
urgent"* — closed 2026-08-25). A pointer that is wrong half the time is a second register.

---

## OD-15 — "3 advisory functions adopted … Ethics considered and not adopted" · **CLOSED**

- `02-advisory/` contains exactly three unit directories: `architecture-review`,
  `red-team`, `decision-office`. Each has all 8 artifacts.
- `find .planning/01-org .planning/02-advisory -type d -iname "*ethic*"` → **0**. Ethics was
  not adopted and was not smuggled back in as a team.
- `ORG_STRUCTURE.md:71` records the non-adoption with its reasoning (falls to Compliance &
  Privacy).

**And it is not decorative.** The obvious way this entry could have failed — three units
chartered, zero findings ever produced — did not happen. Counting finding IDs in the 100
`*-questions.md` files:

```
AR- 6   RT- 4   DO- 13    (23 advisory findings delivered)
self-raised (<UNIT>-Q<n>)  7
18 of 100 units have real content; 82 still carry the "(none yet)" placeholder
```

82/100 empty is expected, not a defect — `red-team-loops.md:158` states the sweep is
deliberately *a sample, not a sweep*.

Worth recording: `architecture-review-loops.md:45` is still `blocked_by: "AR-0 — a finding
has no defined destination … no such file exists in any of the 99 units"`, and
`architecture-review-agenda-board.md:91` says *"`questions.md` exists in **0** of 99
units"*. Both were true when written and are now false — `questions.md` exists in 100 of
100 (OD-41). AR-0 is a resolved blocker still marked blocking.

---

## OD-16 — "Advisory authority = findings-only, escalating to the founder" · **CLOSED**

- `ORG_STRUCTURE.md:73-75` states it: *"Advisory functions do not approve or block. They
  produce written findings against a named unit."*
- All three advisory charters restate it in their own text (2, 3, and 3 matching lines for
  architecture-review, red-team, decision-office respectively).
- No advisory doc claims approval or blocking authority.
- The routing the rule specifies is real: 23 advisory findings landed in unit
  `questions.md` files (§OD-15), and the escalation path to `OPEN-DECISIONS.md` is the one
  actually used — e.g. `red-team-agenda-board.md:123` → the register.

Genuinely closed, and the closest thing here to a decision that changed behaviour.

---

## OD-17 — "7-artifact unit anatomy, agendas banner-marked provisional until real work exists" · **UNENFORCED**

Two separate decays.

### (a) The anatomy is 8, and the ADR still says 7

`OD-41` (resolved same day) added `questions.md` as artifact #8 and moved the corpus 693 →
792. On disk today:

```
units (dirs with a *-charter.md):   100
anatomy files present:              800 / 800 expected   (all 8, in all 100)
all .md under 01-org + 02-advisory: 801 (the extra is 02-advisory/decision-office/FORK-REGISTRY.md)
```

`ORG_STRUCTURE.md:81` was updated to *"the same **eight** artifacts"* and `:93` documents
artifact #8. **`decisions/0007-org-structure.md` was not**:

- `:64` — *"**Unit anatomy: 7 artifacts** — `charter`, `premortem`, `agenda-full`,
  `agenda-board`, `directive`, `loops`, `schedule`."*
- `:79` — *"99 units × **7** artifacts = **693** documents."*
- `:98` review trail — *"Locked findings-only authority and **7-artifact** anatomy"*
- `decisions/README.md:30` — index row still reads *"**7-artifact** unit anatomy"*
- `OPEN-DECISIONS.md:103` — OD-17's own Resolved row still reads *"7-artifact unit anatomy"*

**The locked decision record and the decision index both still say 7 while the corpus is
8.** CLAUDE.md §5 makes ADRs binding; the binding document is the stale one.

### (b) The counts moved and nothing followed

`backtests` was added by founder direction at 17:21 (`67258830`), **2h44m after**
`ORG_STRUCTURE.md`'s roster line was last touched (14:37, `f96fa8af`). It was the 76th team
and the 100th unit. Every hand-written count is now off by one team / one unit / 8 docs:

| Claim | Where | Real |
|---|---|---|
| "75 teams" | `ORG_STRUCTURE.md:36`, `0007-org-structure.md:38`, `decision-office-loops.md:335` | **76** |
| "99 units" | `ORG_STRUCTURE.md:98`, `VAULT_AND_LOOPS.md:22,40,63`, `red-team-loops.md:158`, `architecture-review-agenda-full.md:40,48`, `-agenda-board.md:91`, `FORK-REGISTRY.md:646` | **100** |
| "792 documents" | `ORG_STRUCTURE.md:98`, `VAULT_AND_LOOPS.md:40,78` | **800** anatomy files (801 .md) |
| "693 documents" | `0007-org-structure.md:79` + 6 advisory docs | superseded by 792, now 800 |

The sharpest evidence that this is a *guard* problem and not a care problem: the generated
`00-index/LOOP-MAP.md:11` already says **"485 loops across 100 units"** — correct, and
regenerated on every CI run — sitting beside hand-written contract docs that say 99. The
one number a script owns is right; every number prose owns is wrong. `git log -S "75 teams"`
shows the roster line has not been touched since 14:37.

### (c) The provisional banner is set on 100% of units and nothing clears it

OD-17's second clause: agendas carry `> PROVISIONAL — no work done yet` **until the unit
does real work**. Scanned all 200 agenda files:

```
agenda-full  100 files — 100 carry the PROVISIONAL banner (0 without)
agenda-board 100 files — 100 carry the PROVISIONAL banner (0 without)
```

It has never been cleared once, including for units whose work is in production:

- `02-advisory/red-team/red-team-agenda-board.md:13` — *"PROVISIONAL — no work done yet."*
  The same file at `:120-123` carries filed findings T3/T6, and 4 `RT-` findings have been
  delivered into other units' `questions.md`.
- `02-advisory/decision-office/decision-office-agenda-full.md:13` — same banner. 13 `DO-`
  findings delivered; the function owns the register this audit is auditing.
- `01-org/research-math/teams/neural-footprint-instrumentation/…-agenda-full.md:14` — same
  banner, while P1 NF-A shipped, the migration is applied, and the table has 9 production
  rows.

A flag set on 100% of documents carries zero information. The rule was written to prevent
forecast being read as fact; today every agenda in the corpus asserts it has done nothing,
so a reader learns nothing from either state. `status: provisional` in frontmatter is
likewise 100/100 — a Dataview query on it returns everything.

---

## OD-21 — "Obsidian structure locked — `.planning/` vault root, Dataview adopted, unique prefixed filenames" · **CLOSED, with two mechanical breaks**

The decision was built, not just described.

- **Vault root** — `.planning/.obsidian/` exists and is **tracked in git** (`git ls-files`
  returns app.json, appearance.json, community-plugins.json, core-plugins.json,
  graph.json…), so the config travels with the repo.
- **Dataview adopted, and actually used** — installed and enabled
  (`community-plugins.json`, `plugins/dataview/`). Not decorative:

  | Artifact | Files | Contain a ` ```dataview ` block |
  |---|---|---|
  | `agenda-board.md` | 100 | **100** |
  | `questions.md` | 100 | **99** |
  | `00-index` MOCs | 8 | 6 |

  `OBSIDIAN_VAULT.md:100,104,117` justified adoption as *"the real anti-sprawl
  enforcement — board agendas become live queries"*. The boards really are queries.
- **Unique prefixed filenames** — the org corpus is 100% compliant: all 800 anatomy files
  are `{slug}-{artifact}.md` and unique. Vault-wide there are 7 duplicate basenames
  (46× `README.md`; `01-01-PLAN.md`, `01-02-PLAN.md`, `02-01-PLAN.md`, `02-02-PLAN.md`,
  `01-RESEARCH.md`, `01-01-SUMMARY.md` ×2 each, all in `.planning/phases/`) against
  `OBSIDIAN_VAULT.md:88` *"unique across the vault"*. These are pre-existing corpus files
  and `OBSIDIAN_VAULT.md:115` (F2) explicitly leaves the existing corpus in place until
  OD-01 — so this is a **scoped, stated exception**, not a violation. Charters already work
  around it by hand (`[[README|foundation-README]]`).

**Break 1 — one file's frontmatter does not parse.** Of 801 files under `01-org` +
`02-advisory`, exactly one has no closing `---` on its own line:

`.planning/01-org/research-math/teams/backtests/backtests-questions.md:9`
```
open_questions: 1---
```
The terminator is welded to the value. Obsidian and Dataview will not index this file's
frontmatter, so its real finding (`BT-1`, on `outcome_basis: call_level_v0` becoming the
definition of done) is invisible to every board query that filters on `open_questions > 0`
— which is the exact mechanism OD-21 adopted Dataview *for*. It is also the only one of 100
`questions.md` files with no ` ```dataview ` block.

**Break 2 — the machine index is stale.** `00-index/UNIT-MANIFEST.json` (110KB, described
at `VAULT_AND_LOOPS.md:22` as *"Machine index of all 99 units and their 8 files"*) lists 100
units (7 divisions; 76 team / 21 department / 3 advisory) but records **99 units with 8
files and 1 with 7** — `backtests`, missing its `questions` entry, though the file exists on
disk.

Both breaks trace to the same commit: `67258830`, the hand-added Backtests team, which
bypassed `scripts/build_questions_files.py`. That script cannot be re-run to repair them —
`scripts/build_questions_files.py:5` hardcodes
`R = pathlib.Path("/Users/aldemirkonuk/Projects/restaurant-ai-automation/.planning")`, an
absolute path to one machine's checkout. It runs on no CI runner and in no worktree.
Nothing in `.github/` references `UNIT-MANIFEST.json` at all.

---

## OD-22 — "Tooling library built — `.planning/05-library/`, 26 files: 0 adopted, 23 candidate, 2 unverified" · **CLOSED**

Re-counted every number. **All correct** — the one entry in this set whose arithmetic
survived re-counting:

```
$ ls .planning/05-library | wc -l                          26
$ grep -h "^status:" *.md | sort | uniq -c
   23 candidate     2 unverified     1 live   (= README.md)
```

`05-library/README.md:17-18` states it slightly differently — *"24 tool/resource entries —
0 adopted · 23 candidate · 1 unverified · 0 rejected … plus one shared page covering 8
unverified named references. 25 notes in total"* — which reconciles exactly: 24 entries + 1
shared page (`unverified-references.md`, itself `status: unverified`) + README = 26 files.
Both counts are right; they count different things.

The "0 adopted" is honest rather than a bookkeeping fiction, and the README says so at
`:29-31`: *"a thing is adopted only when an ADR in `.planning/decisions/` says so. **No ADR
adopts any of these**, so the `adopted` column is empty — including for Playwright, which is
already installed."* It names its own awkward case. `base-agent.md` sits at `candidate`
while `services/agent-orchestrator/core/base_agent.py` is the live base class for 24 agent
modules — but that is precisely OD-03's open fork, not a mislabel.

**Unenforced.** Nothing checks the `adopted`-requires-an-ADR rule, and nothing enforces
`README.md:124`'s stated staleness rule (*"an entry unverified for 180 days is stale"*)
against the `verified: 2026-08-24` frontmatter dates. Both are trivially checkable — see
below. Today the rule holds by nobody having broken it yet.

---

## The most useful output: which of these can become executable claims

`.planning/decisions/CLAIMS.jsonl` (arriving on `feat/executable-decision-claims`) is the
right home. Every command below was **run in this worktree** — the HOLDS/FAILS column is
observed, not predicted. The four FAILS are exactly the four live defects above, so each
one is a guard that would have caught its finding on the day it appeared.

| Entry | status | Claim | `verify` | Today |
|---|---|---|---|---|
| OD-02 | resolved | the org has 7 divisions on disk | `test "$(find .planning/01-org -mindepth 1 -maxdepth 1 -type d \| wc -l \| tr -d ' ')" = 7` | HOLDS |
| OD-02 | resolved | ORG_STRUCTURE's roster line matches the team count on disk | `grep -q "$(find .planning/01-org -path '*/teams/*' -name '*-charter.md' \| wc -l \| tr -d ' ') teams" .planning/foundation/ORG_STRUCTURE.md` | **FAILS** (76 vs "75 teams") |
| OD-09 | resolved | Sales survived as its own department | `test -f .planning/01-org/commercial/sales/sales-charter.md` | HOLDS |
| OD-10 | resolved | the NF-C `bio` slot is reserved in the shipped schema | `grep -q "subject_type in ('agent','guest','operator','bio')" supabase/migrations/20260824141116_neural_footprint_event.sql` | HOLDS |
| OD-10 | **open** | the NF-C entry trigger is still unwritten (strike the "entry trigger required" half when this stops failing) | `grep -qE '^\| *NF-C-TRIGGER' .planning/decisions/OPEN-DECISIONS.md` | correctly absent |
| OD-11a | **open** | the research store is still unbuilt — flips the moment it lands | `! grep -rqE 'create table.*(nf_research\|research_log\|footprint_research)' supabase/migrations/` | HOLDS as open |
| OD-12 | resolved | loop vocabulary and index are current | `python3 scripts/build_loop_index.py --check` | HOLDS (already CI) |
| OD-14 | resolved | root SKILLS.md is a tombstone, not a live protocol | `head -1 SKILLS.md \| grep -q retired` | HOLDS |
| OD-14 | resolved | no doc still lists OD-14 as open | `! grep -rn 'OD-14.*Open' .planning --include='*.md'` | **FAILS** (`foundation/README.md:345`) |
| OD-15 | resolved | exactly 3 advisory units, no Ethics unit | `test "$(find .planning/02-advisory -mindepth 1 -maxdepth 1 -type d \| wc -l \| tr -d ' ')" = 3` | HOLDS |
| OD-17 | resolved | every unit carries all 8 anatomy artifacts | `test "$(find .planning/01-org .planning/02-advisory -name '*-charter.md' \| wc -l)" = "$(find .planning/01-org .planning/02-advisory -name '*-questions.md' \| wc -l)"` | HOLDS |
| OD-17 | resolved | ADR 0007 records the anatomy the corpus actually has | `grep -q 'Unit anatomy: 8 artifacts' .planning/decisions/0007-org-structure.md` | **FAILS** (still says 7) |
| OD-21 | resolved | every org-corpus file has parseable frontmatter | `python3 -c "import glob,sys; bad=[p for p in glob.glob('.planning/01-org/**/*.md',recursive=True)+glob.glob('.planning/02-advisory/**/*.md',recursive=True) if open(p).read().split(chr(10))[0].strip()!='---' or '---' not in [l.strip() for l in open(p).read().split(chr(10))[1:31]]]; sys.exit(len(bad))"` | **FAILS** (backtests-questions.md) |
| OD-21 | resolved | UNIT-MANIFEST.json matches disk | `python3 -c "import json,sys; m=json.load(open('.planning/00-index/UNIT-MANIFEST.json')); sys.exit(0 if all(len(u['files'])==8 for u in m['units']) else 1)"` | **FAILS** (backtests: 7) |
| OD-22 | resolved | nothing is `adopted` in the library without an ADR | `! grep -lq '^status: adopted' .planning/05-library/*.md` | HOLDS |

**The single highest-value one is the OD-02 roster claim**, because it is the general form
of the count-rot this audit kept hitting: it re-derives the number from disk and diffs it
against the prose that asserts it. The same one-liner shape covers "99 units", "792
documents", and "693 documents" — four stale numbers across eight documents, all fixed by
one guard that nobody has to remember to run.

Second: the **frontmatter-parses** claim. It is the only mechanical check that protects the
Dataview machinery OD-21 adopted as *"the real anti-sprawl enforcement"* — and it is already
red.

Structural recommendation, not a claim: **`scripts/build_questions_files.py:5`'s hardcoded
absolute path should become repo-relative.** Two of the four live defects exist because the
generator cannot be re-run anywhere except one laptop, so a hand-added unit is never
reconciled. A guard that says the manifest is stale is not much use if the repair tool only
runs in one directory on one machine.

---

## What I could not verify

1. **Whether `.github/copilot-instructions.md` ever referenced `SKILLS.md`.** I verified it
   does not today. Establishing whether the reference was removed after OD-14 closed, or
   was never there, needs a history walk of that file that I did not run; either way the
   register row and `SKILLS.md:3` are wrong about `main` as it stands.
2. **Whether the Backtests team is a genuine 76th team or a duplicate of an existing one.**
   Its charter looks distinct and the commit says *"founder direction"*, so I treated it as
   real and the counts as stale — but I did not audit team-roster semantics, only the count.
3. **OD-13's §3.1 "skill anatomy" contract.** I established no ADR locks it and
   `.claude/skills/` is empty. I did not determine whether the founder considers
   `foundation/README.md` §3.1/§3.3 to *be* the lock, in which case Wave 0 #2 was satisfied
   by prose and only #3 (the metric schema) was out of order.
4. **Nothing about the `.planning/phases/` duplicate-basename files** beyond counting them —
   they are OD-01's territory and out of scope here.
5. I did **not** re-audit OD-11 (Path C / ADR 0008) itself, only its OD-11a storage-split
   half, since the column contract belongs to the NF audit track.
