---
type: charter
division: advisory
department: decision-office
status: new
metrics: [decisions.open_count, decisions.median_age_days, decisions.unowned_count, decisions.close_rate_per_week, decisions.namespace_collisions, loops.undefined_close_time_count, triggers.dated_unwatched_count]
updated: 2026-08-24
links: ["[[decision-office-premortem]]", "[[decision-office-directive]]", "[[decision-office-loops]]", "[[decision-office-schedule]]", "[[decision-office-agenda-full]]", "[[decision-office-agenda-board]]", "[[ORG_STRUCTURE]]", "[[OPEN-DECISIONS]]", "[[0002-documentation-first-operating-mode]]", "[[0007-org-structure]]", "[[foundation-README]]", "[[OBSIDIAN_VAULT]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[knowledge-documentation-charter]]", "[[standards-verification-charter]]", "[[skills-charter]]", "[[sales-charter]]", "[[legal-charter]]", "[[analytics-bi-charter]]", "[[people-agent-ops-charter]]", "[[supplier-distributor-network-charter]]", "[[LOOP-MAP]]"]
---

# Decision Office — Charter

> **NEW as a unit — and that is the unusual part.** Before this file, the directory
> `.planning/02-advisory/decision-office/` was empty: 0 of 7 artifacts. Yet **222 of
> the 581 generated unit documents already reference this function**, carrying
> **329 `[[decision-office-charter]]` wikilinks** that resolved to nothing, and
> **168 loop blocks route `outputs_to: [decision-office]`**. This function starts
> with no artifacts and a full inbox. See §Evidence today before reading anything
> here as a going concern.

## Mandate

The Decision Office owns the **ADR log, the open-decision register, and loop
close-times** — the three places where a decision can be recorded, queued, or
timed. Its single purpose is that decisions **close** rather than drift. That is
not an inferred purpose: [[ORG_STRUCTURE]] §3 states the function exists to ensure
*"decisions actually close rather than drifting — the failure mode this whole
chapter exists to prevent"*, and the chapter in question is
[[0002-documentation-first-operating-mode]], whose own `Consequences` section names
the exact tripwire: *"Revisit if: the register's founder-queue grows faster than it
drains for a sustained period."*

**Nobody has been measuring that ratio.** The register has run for two sessions
with no triage, no owner per item, and no age on any row. This charter's first
claim is therefore small and literal: the condition ADR 0002 said to watch is
currently unwatched, and watching it is this function's job.

## Authority — findings-only, and this is the load-bearing sentence

**The Decision Office decides nothing.** It has no approve, no block, no veto, no
tie-break. It produces written findings against a named unit; the finding lands in
that unit's documents and, if it implies a decision, in `OPEN-DECISIONS.md` for the
founder ([[ORG_STRUCTURE]] §3 *Engagement model — LOCKED findings-only*; OD-16,
Resolved 2026-08-24).

This is not modesty and it is not a formality. Deciding would invert
[`CLAUDE.md`](../../../CLAUDE.md) §0 non-negotiable #1 — *"nothing is decided until
it is decided together"* — using the very office built to enforce it. A decision
office that starts deciding is the most obvious way this function goes wrong, and
it would go wrong helpfully: the first three times would each look like unblocking
someone. The counter-pressure is written into [[decision-office-directive]] as an
explicit graph branch and audited quarterly in [[decision-office-loops]] L6.

The office **tracks, surfaces, and escalates**. Those three verbs are the whole
authority. Where this charter says "the office will reconcile the fork registry,"
it means *produce one authoritative proposal and hand it to the founder* — not
*renumber the corpus on its own judgement*. The one narrow exception, and the line
it must not cross, is stated in [[decision-office-directive]] §Decision rights.

## Boundaries — owned outright

| Owned | What that means concretely |
|---|---|
| **ADR log integrity** | Numbering, status transitions (Locked → Superseded), supersede chains, and whether `decisions/README.md` still matches the files on disk. Not the content of any ADR. |
| **The open-decision register** | Intake format, triage state, **an owner per item**, **an age per item**, and the drain-vs-growth ratio ADR 0002 named. |
| **One authoritative fork namespace** | Today there are **seven**. See §Evidence today. |
| **Loop close-time watch** | Not the loops — [[ORG_STRUCTURE]] §5 says every loop names a close-time; this office audits whether they do, and whether they close. 396 loop blocks exist; 4 have `status: exists`. |
| **The dated-trigger calendar** | Every dated retirement, merge, survival, or re-evaluation trigger written anywhere in the corpus. **Nothing currently watches these dates.** |
| **The contradiction register** | Recording that two documents disagree and naming which unit owns reconciliation. Never performing the reconciliation. |
| **Stale-citation surfacing** | Recording that a `path:line` citation no longer points at what it claims. The owning unit fixes it. |

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Making any decision at all** | Founder ([`CLAUDE.md`](../../../CLAUDE.md) §0.1) | The whole point. See §Authority. |
| Resolving the substance of a contradiction — e.g. *is it 375 insight types or 573?* | [[analytics-bi-charter]] / [[insight-narrative-generation-charter]] | We record that two numbers exist and who owns the answer. Picking one would be deciding. |
| Layer-dependency and architecture violations | [[architecture-review-charter]] | L0–L6 is theirs ([[ORG_STRUCTURE]] §3). A layer violation is an architecture finding that may *become* a decision; only then does it reach our register. |
| Attacking a decision's reasoning; premortem thinking | [[red-team-charter]] | They test whether a decision is *good*. We test whether it *closed*. Adjacent, easily confused, deliberately separate. |
| Document accuracy, freshness, and verification as a discipline | [[knowledge-documentation-charter]] → [[standards-verification-charter]] | They verify claims across 693 documents. We only care about the subset that is a **decision** claim: an ADR that contradicts another ADR, or a register row that no longer means what its citers think. |
| Writing or fixing any unit's loops | Each unit | We audit close-times. A loop we authored is a loop we cannot audit ([[decision-office-premortem]] M3). |
| The `.planning/` restructure (OD-01) | Founder + [[corpus-archive-charter]] | We are a **row** in that decision, not its owner. |

### One offer this office must decline

[[standards-verification-charter]] proposes, as **OD-C6**
(`knowledge-documentation-agenda-full.md:115`), that it should sit *under* the
Decision Office as an advisory team rather than inside Knowledge & Documentation.
The argument is reasonable — verification is cross-cutting and an auditor reporting
into the corpus it audits has an independence problem, which is the same argument
[[ORG_STRUCTURE]] §3 uses to put advisory outside the line.

**This office's position is: decline.** Not because the argument is wrong, but
because accepting it converts findings-only into line authority over an executing
team, and does so through the most sympathetic possible door. If the independence
argument holds, the answer is a fourth advisory function or a different parent —
not this one quietly growing an org chart. That is a founder call, and OD-C6 is
recorded, not answered. Declining it is the first live test of
[[decision-office-premortem]] M3 and this office intends to pass it in writing
before the pressure is real.

## Metrics it moves

| Metric | Definition | Value today |
|---|---|---|
| `decisions.open_count` | Rows in the `## Open` table of `OPEN-DECISIONS.md` | **23** (OD-01, 03–08, 11, 14, 18–31) — and see the volatility note below |
| `decisions.median_age_days` | Median days since an open row was filed | **undefined** — no row carries a filed date |
| `decisions.oldest_age_days` | Age of the oldest open row | **undefined**, same reason |
| `decisions.unowned_count` | Open rows with no named owner | **23 of 23.** The `What unblocks it` column names a *mechanism*, never a person or unit for most rows |
| `decisions.close_rate_per_week` | Rows moving Open → Resolved per week | **unmeasured**; 12 resolved rows all dated 2026-08-24 |
| `decisions.namespace_collisions` | Distinct meanings assigned to one fork ID | **3** each for OD-20, OD-21, OD-22, OD-23, OD-24; **2** for OD-19 |
| `decisions.unfiled_fork_count` | Forks staged in a document but never entered in the register | **≥19** (OD-C1…C8, CM-F1…F6, F-1…F-5) |
| `loops.undefined_close_time_count` | Loop blocks whose `close_time` is not a cadence | **≥1** explicit `UNDEFINED`, plus vocabulary drift across 396 blocks |
| `triggers.dated_unwatched_count` | Dated retirement/merge/survival triggers with no watcher | **6 of 6** |
| `corpus.contradiction_count` | Recorded live contradictions between documents | **4** (§Evidence today) |

No `nf_a.*` / `nf_b.*` metric belongs here. The neural footprint measures agent and
guest behaviour ([[foundation-README]] §4); this office measures the corpus's own
decision hygiene. Claiming an NF metric would be borrowing credibility from a
system that emits nothing yet.

## Evidence today

Graded **EXISTS** = running with an artifact · **PARTIAL** = stub or fraction ·
**NEW** = proposal only.

**Roll-up: NEW — with an inherited, non-hypothetical backlog on day one.** This is
the honest grade and it is unusual. Most NEW units in this corpus are chartered
against a hypothesis. This one is chartered against a queue that already exists,
already has 23 items, already collided its own identifiers, and is already cited
329 times by documents written before it did.

### EXISTS — the substrate it inherits

- **The ADR log.** `.planning/decisions/` holds `README.md`, `TEMPLATE.md`, and
  ADRs `0001`–`0007`. `README.md:19-30` lists 7 locked in-log decisions;
  `:31-41` lists 7 more locked *elsewhere* (pre-log), deliberately not copied.
  The structure is sound. It was set up by [[0002-documentation-first-operating-mode]]
  and it is the one thing here that works.
- **The open-decision register.** `decisions/OPEN-DECISIONS.md` — 23 open rows,
  12 resolved rows.
- **396 loop blocks** across **82 `*-loops.md` files** in `01-org/`. Close-time
  vocabulary is wide (`weekly` ×129, `monthly` ×111, and ~60 one-off phrasings).
  Status vocabulary: `proposed` ×356, `provisional` ×63, `blocked` ×25, and only
  **`exists` ×4 / `running` ×2**.
- **The anti-sprawl rules themselves**, already written and already unenforced:
  60-day agenda staleness ([[ORG_STRUCTURE]] §4), 30-day skill staleness
  ([[foundation-README]] §3.3), 3-run scheduled-job downgrade
  ([[foundation-README]] §6).

### PARTIAL — the register, as an instrument

- **No owner column.** 23 of 23 open rows name no owner.
- **No date column.** No row records when it was filed, so no row can age, so
  ADR 0002's "grows faster than it drains" tripwire cannot fire.
- **No triage state.** OD-20 carries 🔴 and the word *urgent* (live unauthenticated
  spend on the founder's API key); OD-27 is a one-line brand-string fix on
  `Privacy.tsx:23,31`. They sit in the same undifferentiated list.
- **The register mutates in place.** `OD-23` was filed as *"$20k MRR in 30 days"*
  and has since been **rewritten** to *"Revenue target and pricing, both
  unverified"* with three corrections folded in. The rewrite is better than the
  original. It is also invisible: **83 references to OD-23** exist across `01-org/`,
  written against text that no longer says what they cite. An open-decision row is
  a shared identifier; editing its meaning silently is the register's own version
  of a stale citation.
- **The register is a concurrent write target.** Rows **OD-28 through OD-31 were
  appended by other sessions while this charter was being written.** OD-30's
  `What unblocks it` column reads, verbatim: *"Decision Office's first assignment;
  mechanical to fix."* This function was handed work by a parallel agent before it
  had a charter.

### NEW — everything this office is supposed to run

- **No triage cadence, no owner assignment, no age tracking, no close-rate.**
- **No dated-trigger watch.** Six dated triggers exist in the corpus (below) and
  nothing reads a calendar.
- **`00-index/LOOP-MAP.md` and `00-index/DECISION-INDEX.md` do not exist.**
  [[OBSIDIAN_VAULT]] §2 specifies both. `00-index/` currently contains exactly one
  file: `UNIT-MANIFEST.json`. There are **56 `[[LOOP-MAP]]` links** in `01-org/`
  pointing at a file nobody has written.
- **The loop blocks are not machine-readable in practice.** [[ORG_STRUCTURE]] §5
  calls the loop block *"machine-readable frontmatter"*, and [[OBSIDIAN_VAULT]] §4
  makes Dataview the anti-sprawl mechanism. But every generator wrote the loop
  block inside a fenced ` ```yaml ` code block in the document **body**, not in
  frontmatter — Dataview indexes frontmatter and inline fields, not fenced code.
  **None of the 396 loop blocks is queryable.** LOOP-MAP therefore cannot be a
  Dataview query; it must be scripted, or the loop blocks must move to frontmatter.
  That is a decision, and it is filed, not made ([[decision-office-agenda-full]]
  §Questions).

### The inherited backlog, itemised

**1. Fork numbering has collided across seven namespaces.** Not one clash — a
structural one. Three documents independently minted `OD-19`…`OD-24`:

| ID | Canonical register (`OPEN-DECISIONS.md`) | `foundation/teams/technology.md` §7 | `foundation/teams/product.md` §6 |
|---|---|---|---|
| OD-19 | 94 endpoints unguarded by omission | 25 teams for one division | — |
| OD-20 | 🔴 Analytics consultant endpoints unauthenticated, costing money | Engineering at 8 teams | Product division team layer |
| OD-21 | Obsidian structural workflow | The evaluation seam | Vendor Finder boundary |
| OD-22 | Tooling & reference library | Skills at 3 vs 2 | Guest monetization ownership |
| OD-23 | Revenue target and pricing unverified | 7-artifact anatomy for teams | Connector trust boundary |
| OD-24 | Skills self-retirement trigger | Guardian-agent co-ownership | Design's commissioning authority |

Two more namespaces were created *specifically to avoid this*, and worked:
`OD-C1`…`OD-C5` (`corporate.md:494-498`) and `CM-F1`…`CM-F6`
(`commercial.md:629-634`). A sixth, `F-1`…`F-5` (`intelligence.md:515-521`), is
ambiguous against `CM-Fn` to a fast reader. A seventh is unit-local: `DEP-06`,
**64 references**, defined in `PROJECT.md:101` and used by [[sales-charter]] as a
gating condition.

The `OD-C` namespace has also **grown without registration**: the Knowledge &
Documentation generator minted `OD-C6`, `OD-C7`, `OD-C8` in-session. They are
correctly namespaced and entirely unfiled.

Scale of the misreading risk, by division, for the six colliding IDs:

| ID | applied-ai | commercial | corporate | intelligence | platform | product |
|---|---|---|---|---|---|---|
| OD-19 | 2 | 1 | — | 7 | 8 | 7 |
| OD-20 | — | 3 | 2 | 32 | 10 | 8 |
| OD-21 | 9 | — | 10 | 4 | — | 15 |
| OD-22 | 11 | — | 11 | — | — | 5 |
| OD-23 | 3 | 12 | 5 | — | 9 | 11 |
| OD-24 | 12 | — | — | — | 8 | 5 |

*(files citing the ID, per division)*

Three generators caught it themselves and said so in place —
`product-vision-charter.md:133-143`, `design-agenda-board.md:104`,
`supplier-distributor-network-charter.md:73-75` (which corrects its own brief:
the distributor fork is **CM-F3**, `commercial.md:631`, not CM-F6 —
CM-F6 is Social & Community). Self-correction by three agents out of many is
evidence of a good corpus culture and of a missing registrar.

**Reconciling this into one authoritative numbering is this office's first
assignment** — as a *proposal*, per §Authority.

**2. Register growth with no triage.** 23 open rows across two sessions, growing
during this one. No owner, no age, no severity ordering.

**3. Structures only ratchet upward — OD-26.** The corpus names **split triggers in
11 documents and merge triggers in 3** (raised by the Legal generator,
`legal-loops.md:149`). Several units wrote themselves dated retirement triggers
anyway, unprompted and independently. **Nothing watches those dates:**

| Date | Unit | Condition | Written at |
|---|---|---|---|
| 2026-11-24 | [[skills-charter]] | <5 committed, firing skills → collapse into [[ai-orchestration-charter]] | `skills-directive.md:76`, `skills-loops.md:107,147` |
| 2026-11-24 | [[skill-harvesting-charter]] | Registry <15 **and** no scheduled trigger re-evaluation → paper team | `skill-harvesting-premortem.md:90` |
| 2026-11-24 | [[sales-charter]] | `DEP-06` unchecked **and** `verified_dollars_recovered == $0` → fold into [[growth-charter]], delete 14 of 21 docs | `sales-schedule.md:25`, `sales-directive.md:112` |
| 2026-11-24 | [[outbound-engine-charter]] | No landed credit → folds with Sales | `outbound-engine-schedule.md:29` |
| day 90 (≈2026-11-22) | [[supplier-distributor-network-charter]] | CM-F3 **and** OD-21 both open with `pi.live_counterparties == 0` → its own merge proposal | `supplier-distributor-network-directive.md:117,124` |
| second quarterly review | [[legal-charter]] | Merge trigger, stated as the counter to the ratchet | `legal-premortem.md:38-41` |

Four of six land on the same day. Each was written by a unit proposing its own
possible deletion — the hardest thing to write and the easiest thing to let lapse.
**A close-time problem is exactly this office's mandate**, and this is the clearest
instance of one in the corpus.

**4. Documents contradict each other, with no named reconciler.** All four verified
against the live tree this session:

| Contradiction | A | B | Verdict |
|---|---|---|---|
| Insight-type count | `LLM_INSTRUCTION_PROMPTS.md:166` — **375** | `YC_WEDGE_PLAN.md:324` — **573** | Both live. Owner: [[analytics-bi-charter]]. Filed as a contradiction, **not** resolved here. |
| Weekly skill-health job owner | `foundation/README.md:269` — **Research & Math** | `foundation/teams/technology.md:497-498` — **Skills** | This is **OD-25**, already registered, still unowned. |
| Seating Density widget | `UX_PATHS_CATALOG.md:49` — *"does not exist yet"* | `UX_PATHS_CATALOG.md:1013` — ships it | **B is right.** `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx` exists and is mounted in `Reports.tsx`. Same file contradicts itself. |
| `.claude/skills/` existence | ~99 `schedule.md` files assert it does not exist (**OD-C7**) | It now exists, tracked, with `README.md` and zero `SKILL.md` | An open item **half-closed by a side effect**, with nobody noticing. This is the failure this office exists to catch. |

**5. Stale citations drift silently.** `YC_WEDGE_PLAN.md:401` cites
`ReceivingWorkspace.tsx:233,265` for the manual invoice-qty and unit-price inputs.
Live lines are **`:400-401`** (`aria-label="Quantity invoiced"`, `value={invoiceQty}`)
and **`:438-440`** (`aria-label="Invoice unit price"`). The same sentence adds
*"`:92` defaults `invoiceQty` to `stockedQty`"* — `:92` is now unrelated JSX, and
`:168` reads `useState<number | null>(null)`. **The claim is not merely
line-shifted; it is inverted.** `stockedQty` seeds `acceptedQty` at `:174`, not
`invoiceQty`. A citation that rots into its own opposite is the strongest available
argument for a citation watch, and it is one file out of a corpus of ~1.2MB.

### What this adds up to

Nothing above is hypothetical and none of it is this office's to fix by decree.
Every item is a **tracking, surfacing, or escalation** task, which is precisely the
authority the founder granted. A NEW unit with a real backlog on day one is a
better founding position than a NEW unit with a hypothesis — provided it resists
the one temptation the backlog creates, which is to start deciding. See
[[decision-office-premortem]] M3.
