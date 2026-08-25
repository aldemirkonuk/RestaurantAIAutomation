---
type: audit
id: OD-AUDIT-PRODUCT
title: OD audit — product, process and founder-call entries
status: complete
updated: 2026-08-25
scope: OD-24, OD-25, OD-27, OD-28, OD-30/42, OD-32, OD-34, OD-38, OD-41, OD-47, OD-48, OD-50
links: ["[[OPEN-DECISIONS]]", "[[FORK-REGISTRY]]", "[[ORG_STRUCTURE]]", "[[OBSIDIAN_VAULT]]", "[[TIER-MAP]]", "[[0009-loop-vocabulary-contract]]"]
---

# OD audit — the product, process and founder-call entries

> **The failure pattern being hunted.** An entry is marked resolved because the
> *specific artifact it named* was fixed, while the *outcome it was pointing at*
> survives untouched. Confirmed elsewhere today on OD-56 (Python CVEs patched, 6 of 7
> Node CVEs unreachable by the named fix) and OD-63 (regex fallback fixed, but the
> destination table does not exist in production).
>
> **Method.** Audited against `origin/main` (`8c9301fb`) in an isolated worktree.
> No application code was changed. Every number below was re-counted by this audit,
> not copied from the entry. Commands are given so each is re-runnable.
>
> **Retire-to-write (CLAUDE.md §4).** This document is added; it names
> `.planning/foundation/VAULT_CLEANUP_AUDIT.md` as its retirement candidate — a
> point-in-time audit of the same vault whose findings are superseded by §OD-32 below.
> Retirement is *proposed*, not executed: retiring it is not this session's mandate.

---

## Verdict table

| OD | Verdict | One-line reason |
|---|---|---|
| OD-24 | **HALF-CLOSED** | Trigger written into the right file; the watcher that would fire it is `proposed`. |
| OD-25 (resolved half) | **NEVER-ACTED-ON** | "Fixed to one department" named no department; both source docs still conflict, unamended. |
| OD-27 | **CLOSED (as a deferral)** | Deferral is honest, an owner exists — but the burndown loops are `proposed` and the count grew. |
| OD-28 | **CLOSED** | Research & Math is a division on disk and in `ORG_STRUCTURE` §2; ADR 0001's term honoured. |
| OD-30/42 | **HALF-CLOSED** | Registry real and citations clean — and a *new* ID collision happened the same week. |
| OD-32 | **WRONG** | The link half was fixed; the ambiguity the entry actually named got **worse** (45→46 files, 171→226). |
| OD-34 | **NEVER-ACTED-ON** | 328 documents added since adoption, **0** retired. Its own enforcement loop is `proposed`. |
| OD-38 | **HALF-CLOSED** | Docs reframed correctly; the Toast-first framing a *customer reads* was never in scope. |
| OD-41 | **HALF-CLOSED** | 100 files exist, but the corpus's own manifest counts **99** — the 100th is malformed and invisible. |
| OD-47 | **CLOSED** | Every number re-verified, and it is the only entry here with a blocking CI gate that I ran. |
| OD-48 | **CLOSED** | 16 `core` / 1 `plus` / 0 `pro` across S01–S17, exactly as claimed. |
| OD-50 | **CLOSED** | Recorded in the TIER-MAP axis section; nothing downstream can contradict it yet. |

---

## OD-24 — Skills self-retirement trigger · HALF-CLOSED

**Adopted:** *"fewer than 5 committed, firing skills by 2026-11-24 → collapse Skills into
AI Orchestration."*

**What did change.** The trigger is written where it binds, not only where it was agreed:

- `.planning/01-org/applied-ai/skills/skills-directive.md:76` — *"2026-11-24 checkpoint:
  fewer than 5 committed, firing skills."* Numbered M5, "Pre-agreed, dated."
- `.planning/02-advisory/decision-office/decision-office-loops.md:137` — the trigger is
  registered with its source citation.
- `.planning/02-advisory/decision-office/decision-office-schedule.md:30` — recorded as an
  L2 escalation, noting four dated triggers collide on that one day.

**The precondition is currently met.** `.claude/skills/` contains exactly one file,
`README.md` — **zero** committed skills. On today's evidence the trigger fires.

**What did not change — the outcome.** The watcher is not running:

```
$ python3 -c "import json;[print(l['id'],l['status']) for l in
  json.load(open('.planning/00-index/loops.json')) if l['unit']=='decision-office']"
dated-trigger-watch   proposed
```

`decision-office-schedule.md:108` marks `dated-trigger-calendar` "✅ **This session**"
and notes the four triggers *"none had a watcher"* — but the loop that carries it into
the index is `status: proposed`. A `proposed` loop is a paragraph. Nothing scans a date,
nothing raises an alarm on 2026-11-24, and by then the corpus will be three months old.
The decision took effect **as text**; it has no mechanism.

---

## OD-25 — Weekly skill-health job owner · resolved half NEVER-ACTED-ON

The register correctly carries OD-25 in **both** tables. The Open row is honest and
self-aware. The question is whether the Resolved half happened. It did not.

Resolved row: *"Agreed — weekly skill-health job owner to be fixed to one department
(Decision Office to reconcile the two conflicting docs)."* A resolution that names no
department is a resolution to decide later. Both documents are unchanged:

- `.planning/foundation/README.md:272` — `| Weekly | Skill health … | **Research & Math** | NF-A |`
- `.planning/foundation/teams/technology.md:498` — Skill Lifecycle & Anti-Sprawl's mandate
  includes *"the weekly skill-health job ([[README]] §6)"*

The contradiction is now also **replicated into the loop layer**, which the entry never
mentions: the same loop id exists twice, under two owners, both stalled.

```
skills                       blocked  monthly  skill-staleness-review
skill-lifecycle-anti-sprawl  blocked  monthly  skill-staleness-review
skills                       blocked  weekly   skill-firing-telemetry
skill-lifecycle-anti-sprawl  blocked  weekly   skill-firing-telemetry
```

Two units, one job, `blocked` on both sides — which is what "two owners means no owner"
looks like once it reaches the index. **Nothing to fix in the Open row; the Resolved row
should not have been written.**

---

## OD-27 — `wineops` on user-facing surfaces · CLOSED as a deferral

Resolved as *"Deferred by founder — `wineops` strings stay for now; full recalibration
into Mudavym is a planned migration, not a hotfix."* That is a legitimate outcome and the
audit does not fault it. Two things are worth recording anyway.

**The named artifact is still exactly as described** (this is expected under a deferral):

```
apps/web/src/pages/Privacy.tsx:23  "What WineOps stores, what leaves your browser…"
apps/web/src/pages/Privacy.tsx:31  "WineOps sets no tracking or advertising cookies…"
apps/web/src/pages/Privacy.tsx:43  "Connecting Google Drive … grants WineOps permission…"
```

**Re-counted scope** (`grep -rioh "wineops[-_a-z]*" apps/ packages/`):

| Form | Count | Note |
|---|---|---|
| `WineOps` (prose brand) | 245 | user-visible text, comments, titles |
| `wineops_basic_v*` | 203 | model/schema identifiers |
| `wineops` (lowercase) | 73 | domains, slugs, scopes |
| localStorage keys (`wineops_*`) | ~20 | renaming these signs users out — the reason it is a migration |
| **Total across 175 files** | **598** | |

**An owner exists and did real work.** `01-org/commercial/media-brand/teams/brand-identity/`
carries a genuine analysis — `brand-identity-directive.md:54-59` even builds the right
triage rule (*is this identifying a thing, or naming it to a human?*), and the agenda
raises `apps/mobile/app.json:4` (`"slug": "wineops-ai"`) as the one that orphans installed
apps. This is the best-owned entry in the set.

**But nothing will move it.** All four burndown loops are `proposed`:
`legacy-name-burndown`, `legacy-domain-burndown`, `brand-guard-regression`,
`legacy-brand-surface-burndown`. A deferral with no re-raise date and no running loop is
indistinguishable from a drop. `brand-guard-regression` (`per-pr`) is the cheap one — it
would at least stop the count going *up* while the migration waits.

---

## OD-28 — Research & Math: division or department · CLOSED

The strongest entry in the set. All three legs verified.

1. **On disk.** `ls .planning/01-org/` → `applied-ai commercial corporate intelligence
   platform product research-math` — **7 division directories**, R&M among them.
2. **In the contract.** `foundation/ORG_STRUCTURE.md:36` — *"**7 divisions** · 19
   departments · 2 sub-layers · 3 advisory · 75 teams"*, with `:38-43` recording the
   promotion and naming the earlier draft as the error.
3. **Against ADR 0001.** `0001-mudavym-single-entity.md:59` states the compensation term
   *"Research & Math holds its own division"*. The org text no longer contradicts it, so
   the founding argument stands on its own record. The ADR needed no amendment.

**Two stale numbers found in passing** (drift, not a failed decision — filed here rather
than fixed, since editing `.planning/decisions/` was out of scope):

- `ORG_STRUCTURE.md:3` still reads *"division count (5 vs 6) pending team-layer evidence"*,
  33 lines above the line that says 7.
- `:36`'s roster: **20** department-level charters exist on disk (18 departments +
  2 sub-layers), and **76** team charters, not 75. Counted by charter file, which is the
  only unambiguous unit marker:

```
$ find .planning/01-org .planning/02-advisory -name "*-charter.md" | wc -l
100        # 4 advisory + 20 department-level + 76 team-level
```

---

## OD-30/42 — Fork numbering reconciled · HALF-CLOSED

**Closed correctly, and better than claimed.** `02-advisory/decision-office/FORK-REGISTRY.md`
exists (690 lines) and is the authoritative map. Re-counted today:

- **484** namespaced citations across **190** files (the entry said 337 across 171 — it
  has grown, which is the healthy direction: new work uses the namespace).
- **26 distinct** namespaced IDs (`TECH-F1..6`, `PROD-F1..5`, `INTEL-F1..7`, `CORP-F1..8`).
- **Zero** orphaned `OD-` IDs. Every `OD-nn` cited anywhere in `.planning/` resolves to a
  register row; the single exception is `OD-42`, deliberately folded into the `OD-30/42`
  row:

```
$ comm -23 <all OD- ids cited in .planning> <ids in OPEN-DECISIONS.md>
OD-42
```

**The larger problem survived, and recurred within the same week.** The registry fixed the
*collisions that had already happened* and wrote a prose rule against one cause
(generator agents minting `OD-` prefixed forks). It did not address the other cause, and
that cause fired: `OPEN-DECISIONS.md:9-19` records that `main` and
`fix/od-57-retired-model-sweep` **both allocated OD-57…OD-60 from the same next-free
number while apart**, producing six rows wearing three IDs, requiring a manual
reconciliation across `v3.0-TECH-DEBT.md`, ADR 0010 and `spend_logger.py`.

The register is a shared mutable counter with no allocation protocol and no checker.
`fork-namespace-integrity` (decision-office, `per-event`) is `proposed`. The next parallel
session collides again.

---

## OD-32 — The vault's filename rule · WRONG

This is the clearest instance of the pattern in the set.

**What the entry said:** *"`OBSIDIAN_VAULT.md` §3 calls unique filenames 'the single most
important convention here'; `.planning` holds **45 files named `README.md`** and **171
files write an ambiguous `[[README]]`**. Obsidian resolves wikilinks by name, so every one
of those links is unresolvable or wrong."*

**What was marked resolved:** *"519 broken `[[links]]` repaired → 33 remain, all prose
examples inside contract docs."*

Those are two different metrics. **Broken** links (no target) were repaired. **Ambiguous**
links (many targets) — the thing the entry actually named — were not touched.

Full resolver run over the vault, resolving basenames *and* path-form links the way
Obsidian does:

```
distinct wikilink targets:      845
total wikilink occurrences:  15,462
BROKEN     16 distinct /   45 occurrences
AMBIGUOUS   1 distinct /  566 occurrences   →  [[README]], 46 candidate files
```

| Metric | OD-32 said | Today | Direction |
|---|---|---|---|
| files named `README.md` | 45 | **46** | worse |
| files writing `[[README]]` | 171 | **226** | worse |
| `[[README]]` occurrences | not counted | **566** | — |
| broken-link occurrences | 33 remain | **45** | worse |

**On the broken half, "all prose examples" is also not quite true.** Most are
(`[[link]]`×10, `[[links]]`×7, `[[wikilinks]]`×6, `[[slug]]`×3, `[[:space:]]`×6). Three
are real defects: `[[SCHEMA_DRIFT_INVENTORY]]`×2 (the file is `.txt`, not `.md`) and
`[[backtests-charter\]]`×1 — an escaped-bracket typo, in the same unit that also carries
the OD-41 defect below.

`foundation/OBSIDIAN_VAULT.md:88-91` still states the rule it is violated by, 46 times.
`kd-convention-violated-at-birth` (knowledge-documentation, `monthly`) is `proposed`.

---

## OD-34 — Retire-to-write, org-wide · NEVER-ACTED-ON

Adopted at `83c2234d` (2026-08-24 14:17:58), with the initial 693-document generation
explicitly exempt. Measured from that commit to `HEAD`:

```
$ git diff --diff-filter=A --name-only 83c2234d..HEAD -- '.planning/**/*.md' '.planning/*.md' | wc -l
328
$ git diff --diff-filter=D --name-only 83c2234d..HEAD -- '.planning/**/*.md' '.planning/*.md' | wc -l
0
$ git diff --diff-filter=DR --name-status 83c2234d..HEAD -- .planning
(empty)
```

**328 added · 0 retired · 0 renamed · 0 merged away.**

Being generous and treating everything under `01-org/` and `02-advisory/` as continuation
of the exempt generation (**207** files) still leaves **121 documents squarely inside the
rule**: all of `00-index/` (8), `03-scenarios/` (20), `04-specs/` (5), `05-library/` (26),
`06-pages/` (52), 8 new ADRs, 2 new `foundation/` docs. Not one of the 121 named a
retirement.

**The single genuine application of the rule is the one that invented it.**
`FORK-REGISTRY.md`'s frontmatter carries a real `supersedes:` block naming 13 in-document
collision notices it absorbed — and it is honest about doing so *"per the retire-to-write
rule (CLAUDE.md §4)"*. That is 1 in 121. It was also net **+1 file**: the notices were
merged, but several source documents still carry an "ID collision" paragraph
(`foundation/teams/product.md`, `design-charter.md`, `ai-orchestration-charter.md` and
five more), so the supersession is partial.

`kd-retire-to-write` (knowledge-documentation, `monthly`) is `proposed`. A rule adopted
org-wide, written into `CLAUDE.md`, with a 328:0 compliance record and a dormant checker,
is a rule that exists only in the sentence that announced it.

---

## OD-38 — POS-agnostic positioning · HALF-CLOSED

**The docs half genuinely happened, and the underlying claim checks out.**

`PROJECT.md:129-132` — *"**Positioning (locked 2026-08-24):** Mudavym is **POS-agnostic —
a bridge, not a POS, and not Toast-only.** The provider registry carries 27 providers;
Toast is `partial`, Square and Clover are `scaffolded`"* — plus a Key Decisions row at
`:165`, and `:33`/`:127` re-qualified to *"as one adapter among many"* / *"first via the
Toast adapter"*.

Every number in that paragraph is correct.
`apps/api-gateway/src/pos-hub/pos-provider.registry.ts`:

```
27 providers:  2 available · 1 partial · 2 scaffolded · 22 planned
```

Toast is the `partial`; Square and Clover are the `scaffolded`. Verified, not assumed.

**What survives is the framing a customer actually reads.** The resolution scoped itself
to *"strip Toast-first framing from **docs**"*, so the product surface was never in range.
Two strings tell a user the product is Toast-only:

- `apps/web/src/pages/Dashboard.tsx:1448` — *"Connect your POS system to see real sales
  data for this day. Go to Settings to configure your **Toast POS** integration."*
- `apps/web/src/pages/Reports.tsx:798` — *"No sales data available. Connect your **Toast
  POS system** in Settings to see real revenue and order data."*

These are the empty-state messages on the two highest-traffic pages — the exact moment a
restaurant that does not use Toast is told what to connect. Positioning that is
POS-agnostic in `PROJECT.md` and Toast-only in the empty state is not locked positioning;
it is a locked document. OD-64 reports `pos_checks` at **0 rows** (cited, not re-verified —
no production query was run by this audit), which would mean every user who has ever
reached these empty states saw the Toast-only version.

Remaining `.planning/` mentions (`STATE.md` 13, `ROADMAP.md` 13, `REQUIREMENTS.md` 6) were
spot-checked and are historical build-log entries and env-var names — correctly out of
scope for a framing strip. `ANALYTICS_FEATURE_CATALOG.md:922` (*"Toast vs WineOps —
strategic read"*, with `toast_overlap` / `wineops_bridge` as taxonomy keys for 300+ rows)
is genuine Toast-anchored framing, but it is also OD-27 territory and a data-schema change,
so it is named here rather than counted against OD-38.

> **Not conflated:** `wineops` branding is OD-27 and was deferred separately. Nothing
> above asks for a rename.

---

## OD-41 — `questions.md` as artifact #8 · HALF-CLOSED

**The retrofit was real.** `f96fa8af` (2026-08-24 14:37) added
`scripts/build_questions_files.py` and 99 files; `foundation/ORG_STRUCTURE.md:93` records
artifact 8 with its own rationale; `:98` restates the volume as 99 × 8 = 792.

**Do 99 exist?** No — **100** `*-questions.md` files exist on disk, one per unit, and the
corpus is now 801 documents (100 units × 8 + `FORK-REGISTRY.md`). Every artifact type is
at exactly 100:

```
charter 100 · directive 100 · loops 100 · agenda-board 100
agenda-full 100 · premortem 100 · schedule 100 · questions 100
```

**But the corpus's own index counts 99, and it is right to.** The 100th unit —
`research-math/teams/backtests`, created at `67258830` (17:21, three hours *after* the
retrofit) — was hand-written, not generated, and its frontmatter never closes:

```
.planning/01-org/research-math/teams/backtests/backtests-questions.md:9
    open_questions: 1---
```

The `---` terminator is glued to the value. The YAML block is unterminated, so the file
has **no parseable frontmatter at all**: no `type: questions`, no `open_questions`. It is
therefore invisible to both surfacing mechanisms — the Dataview roll-ups at
`00-index/ORG-MAP.md:150` and `00-index/AGENDA.md:73`
(`WHERE type = "questions" AND open_questions > 0`), and the manifest:

```
$ python3 -c "…UNIT-MANIFEST.json…"
units missing questions in manifest: 1  ['backtests']
```

The generator was never re-run and nothing checks that a new unit gets 8 artifacts.
**OD-41 regressed within three hours of being closed, and 24 hours later nothing had
noticed.**

**Are any non-empty?** Yes — this is the half that worked. **18 of 100** carry real
content; **82** still hold the `*(none yet)*` placeholder.

```
open_questions: 0   × 81      (+ 1 malformed: backtests)
open_questions: 1   × 13
open_questions: 2   × 2
open_questions: 3   × 1
open_questions: 4   × 1
open_questions: 6   × 1
```

The 18 are genuine deliveries, correctly attributed — e.g.
`decision-office-questions.md` carries `RT-1` (fork-ID collision, from Red Team), `DO-1`
(register grew 23→35 at a 7:1 fill-to-drain ratio) and `RT-3` (ADR 0007 is unfalsifiable),
each with a next action and a 2026-10-05 age-out. So the advisory layer is **not** inert:
it was specified, instantiated, and used. The verdict is HALF-CLOSED for the count and the
unguarded 100th unit, not for the mechanism.

---

## OD-47 — Loop vocabulary normalised and enforced · CLOSED

Every claim re-counted from `00-index/loops.json`, which is machine-generated:

| Claim | Verified |
|---|---|
| `close_time` 102 → 9 values | **9** — monthly 150, weekly 147, per-event 52, quarterly 46, per-pr 38, daily 26, fortnightly 21, one-shot 3, hourly 2 |
| `status` 11 → 6 values | **6** — proposed 438, blocked 29, dormant 9, gated 4, active 3, running 2 |
| live count 6 → 5 | **5** — 3 `active` + 2 `running`, and all five cite a CI file:line as evidence |
| 112 `close_time_note` lines added | **115** today (3 added since, consistent with 3 new loops) |
| hard CI gate | **yes, and it blocks** |

The gate is real and I ran it:

```
$ python3 scripts/build_loop_index.py --check
ok — 485 loops in 100 units; vocabulary and index current
$ echo $?
0
```

Wired at `.github/workflows/ci.yml:31-47` as the `loop-contract` job — a required job that
*fails* rather than reports, deliberately unlike `loop-watcher.yml`. Loop total is **485**,
not the 482 the entry cites; three loops were added afterwards and the gate accepted them,
which is the gate working.

**This is the only entry in the set with an enforcement mechanism I could execute.** It is
also the reason every other verdict on this page could be measured: `loops.json` is
generated, checked, and therefore trustworthy.

---

## OD-48 — Tiers assigned across all 17 scenarios · CLOSED

```
$ for f in .planning/03-scenarios/S[01][0-9]-*.md; do grep -m1 '^tier:' $f; done | sort | uniq -c
  16 tier: core
   1 tier: plus
```

**16 `core` · 1 `plus` (S08, vendor price drift) · 0 `pro`** across S01–S17 — exactly as
claimed. `TIER-MAP.md:72` states the same. (A naive `S*.md` glob returns a third value —
`tier: core | plus | pro | undecided   # OD-48` — but that is the unfilled placeholder in
`SCENARIO-CONTRACT.md`, the template, and is correct there.)

The map is also honest about what the tiers contain rather than only labelling them:
`TIER-MAP.md:84-86` records ~10 of 16 Core, ~8 of 17 Plus, ~2–3 of 17 Pro as real, and
`:118` carries OD-51's constraint forward. Assignment happened *and* the buildability
caveat travelled with it.

---

## OD-50 — POS connector in Core, free · CLOSED

`03-scenarios/TIER-MAP.md:22-24`, under a section headed **"Tier axis — LOCKED 2026-08-24
(founder)"**:

> *"**Core = operate**, and it includes the **POS connector, free and frictionless**
> (OD-50): connection moves a restaurant from 25.1% → 100% of the catalogue, so the
> connector is the acquisition lever, never the gate."*

Recorded in the right document, in the locked section, with its rationale and its OD
citation.

**Could it have been contradicted downstream? Not yet.** There is no pricing or
entitlement layer in the product to gate a connector with — no plan/tier check exists in
`apps/api-gateway/src` outside `spend-tiers` (an internal model-spend ceiling, unrelated).
Pricing itself is still open under OD-23. So OD-50 is a positioning decision with nothing
able to violate it today. **CLOSED, with the caveat that it is untested rather than
proven** — the day an entitlement layer is built is the day this decision can fail, and
nothing currently watches for that.

---

## The cross-cutting finding: what is decaying right now

Eleven of these twelve decisions were recorded correctly. The ones that failed did not
fail at the moment of decision — they failed because **the mechanism that would carry them
forward is a document, and every one of those documents is `status: proposed`.**

| Decision | Its enforcement loop | Status | Consequence measured today |
|---|---|---|---|
| OD-34 retire-to-write | `kd-retire-to-write` | `proposed` | **328 added · 0 retired** |
| OD-32 filename uniqueness | `kd-convention-violated-at-birth` | `proposed` | 46 `README.md`, 226 files, 566 links |
| OD-30/42 fork IDs | `fork-namespace-integrity` | `proposed` | fresh OD-57…60 collision, same week |
| OD-24 skills trigger | `dated-trigger-watch` | `proposed` | nothing fires on 2026-11-24 |
| OD-27 legacy brand | `legacy-name-burndown` ×4 | `proposed` | 598 occurrences, 175 files |
| OD-25 skill-health owner | `skill-staleness-review` ×2 | `blocked` ×2 | one job, two owners, both stalled |
| OD-41 artifact #8 | *(none exists)* | — | unit #100 malformed, unseen for 24h |
| **OD-47 loop vocabulary** | **`loop-contract` CI job** | **blocking** | **all five numbers hold** |

That last row is the control. It is the only decision here whose numbers are all still
true a day later, and it is the only one wired into `ci.yml`. The pattern is not that
decisions are recorded badly; it is that **a decision without a blocking check decays at
roughly the rate the corpus grows** — and the corpus grew by 328 documents in 24 hours.

The single highest-leverage move available is not on any of these twelve entries: it is
promoting three `proposed` loops (`kd-retire-to-write`, `fork-namespace-integrity`,
`dated-trigger-watch`) into `scripts/` checks behind the `loop-contract` job that already
exists and already passes. Each is a ten-line stdlib script against data that is already
generated. That is a proposal, not a decision — per CLAUDE.md §0.1 it is the founder's
call, and it is not recorded anywhere yet.

---

## Not verified, and why

- **Whether `dated-trigger-watch` would work if promoted.** No implementation exists to
  test; the verdict rests on `status: proposed`, not on a failed run.
- **Whether the founder intended OD-25's Resolved row to be a placeholder.** Read as a
  resolution because it sits in the Resolved table with a date; if it was meant as
  "agreed in principle, pick later", the Open row already says so and only the Resolved
  row is misleading.
- **The `[[README]]` ambiguity's real-world impact in Obsidian.** Obsidian disambiguates
  same-name links by proximity (nearest folder wins), so some of the 566 may resolve to
  the *intended* README by luck of location. Determining which would require the vault's
  resolution order; the count of ambiguous links is exact, the count of *wrong* ones is not.
- **`ANALYTICS_FEATURE_CATALOG.md`'s Toast-anchored taxonomy** (`toast_overlap`,
  `wineops_bridge`, `wineops_only` across 300+ rows) was identified but not fully audited —
  it straddles OD-27 and OD-38 and is a schema question, not a framing one.
- **Production database state** was not queried; every claim here is from the repo at
  `8c9301fb` and from commands re-runnable in a clean worktree.
- **No application code was read for correctness**, only for the strings and counts cited.
  This was an audit; nothing was changed outside this file.
