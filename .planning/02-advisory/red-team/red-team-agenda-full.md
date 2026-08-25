---
type: agenda-full
division: advisory
department: red-team
status: provisional
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.undeclared_decision_count, rt.self_selected_target_share]
updated: 2026-08-24
links: ["[[red-team-charter]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-schedule]]", "[[red-team-agenda-board]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[compliance-privacy-charter]]", "[[regulatory-posture-charter]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[skills-charter]]", "[[growth-charter]]", "[[sales-charter]]", "[[finance-pricing-charter]]", "[[0001-mudavym-single-entity]]", "[[0006-neural-footprint-architecture]]", "[[0007-org-structure]]", "[[ORG_STRUCTURE]]", "[[README|foundation-README]]"]
---

# Red Team — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.
>
> Everything below is a *plan to attack*. Not one finding has been filed, no
> `questions.md` exists anywhere in the corpus, and the attacks sketched in §First seven
> targets are openings — the reconstruction step in [[red-team-directive]] has not been run
> on any of them. Read the target sketches as *"here is where an attacker would start"*,
> never as *"here is what is wrong."*

## What

Attack the reasoning behind decisions, and run premortems, so that the org's mistakes are
found in a document rather than in a quarter. Output is **findings**: a named decision, a
named owner, the reconstructed conditions the decision depends on, the evidence that does
or does not support them, and one next action.

The founder's phrasing of the requirement — *output must make "what's next" easy to
navigate* (`ORG_STRUCTURE.md:61`) — is why this agenda is organised as a **ranked target
list with the next step already attached**, rather than as a work plan. A red team's agenda
*is* its queue.

## How

Four intake channels feed one scored queue; three slots per cycle are reserved before any
referral is read; at most seven findings are open at once. The mechanics are in
[[red-team-charter]] §How a target is selected and the graph is in [[red-team-directive]].

Cycle shape — weekly select, attack, return; monthly sweep; quarterly re-read and
self-audit ([[red-team-schedule]]).

## Why now

Three reasons, in order of force:

1. **The surface is at its cheapest to attack and it will never be this cheap again.**
   Seven ADRs locked on a single day (2026-08-24), 23 open forks, and a 693-document
   structure that has produced **536 documents so far** and is still being written by
   parallel sessions as this file is saved. Attacking ADR 0007 today costs a conversation.
   Attacking it after all 693 documents exist costs a migration.
2. **The corpus is already asking.** 82 referral lines across 67 units name
   `[[red-team-charter]]` as the attacker of a specific mechanism, before this function has
   filed anything. That is not a mandate — see [[red-team-premortem]] M4 — but it is
   evidence the org expects the seam to be covered.
3. **The failure mode is already visible, unprompted.** OD-20 is flagged 🔴 *"Founder call
   — urgent"*; its fix exists as PR **#31** and is **open and unmerged**, with `main` still
   carrying the unguarded controller. A finding that was made, fixed on a branch, and never
   landed is [[red-team-premortem]] M3 running before the function that names it exists.

## First seven targets

Ranked by [[red-team-charter]]'s selection rule. Each carries the opening of an attack and
a **navigable next step** — the thing the founder or the owner would actually do next. The
step is the deliverable; the sketch is only the reason for it.

---

### T1 · ADR 0006 — the research store is append-only, and NF-B is personal data

**Channel** C1 (locked ADR) · **Owner** [[compliance-privacy-charter]] +
[[research-math-charter]] + the founder · **Score drivers** irreversibility HIGH,
blast_radius HIGH, evidence_strength LOW

`0006-neural-footprint-architecture.md:53-57` locks the research store as *"append-only,
deliberately wide, never migrated. New fields are added; old rows keep their shape."* That
is excellent ML architecture and the correct call for NF-A. NF-B is guest behaviour —
dish and wine exposure, choice, repeat, rating, context (foundation README §4.2) — which
is **personal data**, and personal data carries an erasure right that "never migrated"
cannot satisfy.

**What would have to be true** for the ADR to be complete as written: either (a) NF-B never
enters the research store, or (b) erasure can be honoured without ever mutating a row, or
(c) the data is genuinely anonymised at write time rather than pseudonymised at read time.
The ADR asserts none of the three, and its Consequences section does not mention erasure at
all.

**What exists.** [[compliance-privacy-charter]]'s own artifacts already carry the collision
(`compliance-privacy-premortem.md:100,128`; `compliance-privacy-directive.md:30,67`) and
route it to the founder. `compliance-privacy-agenda-board.md:57` states plainly: *"NF-B
erasability vs append-only research store — no `OPEN-DECISIONS.md` entry yet."* The
strongest single fact about this target is that **the most consequential unresolved tension
in the locked architecture is not in the register.**

**What would break the current position.** One guest erasure request. Not a hypothetical
regulator — one request, which the system currently has no path to satisfy against a store
whose defining property is that it is never migrated.

**Next step — one action.** Register it. This is a founder fork spanning three units and it
must be an `OPEN-DECISIONS.md` row, not a paragraph inside Compliance's premortem. Staged
here as **RT-F1** (see §Forks to register); [[decision-office-charter]] assigns the ID.
Pair it with OD-11, which already owns the research log's retention/rollup policy — the two
cannot be decided independently.

---

### T2 · OD-23 — $20k MRR in 30 days, rated under 10% by the plan that proposed it

**Channel** C2 (open fork) · **Owner** founder + [[growth-charter]] / [[sales-charter]] /
[[finance-pricing-charter]] · **Score drivers** blast_radius HIGH, evidence_strength LOW,
freshness HIGH

`OPEN-DECISIONS.md` OD-23 records the target and its own assessment: **under 10% likely**
against locked $20–50/mo pricing, implying **400–1,000 paying restaurants in 30 days**.

**What would have to be true.** A self-serve funnel that converts at volume; a
30-day-repeatable acquisition channel; onboarding that does not require the founder per
restaurant; and a product whose named blocker is not data. The last condition is
contradicted directly — foundation README §1 grades L0, the data substrate, as **the named
blocker**, with wine enrichment in progress and food and sales thin.

**What breaks it.** Not the target — the **derivation**. A goal rated <10% by its own author
does not fail quietly; it silently re-specifies every Commercial decision underneath it,
because a plan that must produce 400 restaurants in 30 days cannot choose founder-led sales,
cannot choose a slow onboarding, and cannot choose a high-touch wedge. The distortion
arrives before the miss does, and it arrives in decisions nobody labels as consequences of
OD-23.

**Attack the framing, not the number.** *"Is $20k in 30 days achievable"* is the wrong
question and is why the fork is still open. The useful question is: **which decisions has
this target already made for us?** Enumerate those; then ask whether each survives the
target being wrong. That converts an unanswerable morale question into a list.

**Next step — one action.** Ask the founder to choose one of three concrete framings
already proposed in OD-23 — higher-ACV founder-led sales, counting committed deals rather
than collected MRR, or keeping the target as a stretch with a written second number that
Commercial actually plans against — and record the choice as an ADR. The third option is
legitimate and is the one that most needs writing down, because it is the one everyone
currently assumes.

---

### T3 · ADR 0007 — 693 documents chartered against near-zero evidence

**Channel** C1 + O3 (founder-locked, mandatory) · **Owner** founder ·
**Score drivers** irreversibility MEDIUM, blast_radius MAXIMUM, evidence_strength LOW

**This is the O3 slot, and it is deliberately the most uncomfortable target available.**
The founder chose ambition over capacity explicitly, overruled Claude's contrary
recommendation, and both are on the record (`0007-org-structure.md:84-88`). Red Team's job
is not to relitigate the choice — it is to attack the *reasoning*, and there is a real
defect in it that is separable from the choice itself.

**What would have to be true.** That 99 units × 7 artifacts produces more value than 30
units × 7 would, at 3× the upkeep; that the anti-sprawl rules will actually fire; and —
the load-bearing one — that **there is an observation which would tell us the structure
was too large.**

**What exists.** Charter grades across the generated corpus today: **32 `exists` · 35
`partial` · 17 `new`**. That is a better evidence base than the phrase "chartered against
zero evidence" suggests, and the finding should say so — but the 17 NEW charters are the
ones with the largest document footprint per unit of demonstrated need, and the anti-sprawl
rule they are subject to is a **60-day staleness sweep that a date bump defeats**.

**The actual defect: the decision is currently unfalsifiable.** "Optimize for quality and
ambition, not for one person's capacity" names no observation that could disconfirm it. A
decision no evidence could overturn is not a strong decision; it is an unexamined one —
and by [[red-team-directive]]'s graph, `UNFALSIFIABLE` is a finding rather than a pass.

**Next step — one action.** Ask the founder for **one number**: at what count of units
whose agendas show no content change in two consecutive 60-day sweeps does the structure
get trimmed? Any number makes ADR 0007 falsifiable. Refusing to name one is also an answer,
and a recordable one. Note that OD-26 is the same defect seen from the other side, which is
why T4 is next.

---

### T4 · OD-26 — structures only ratchet upward, and the ratchet is still turning

**Channel** C2 · **Owner** [[decision-office-charter]] + founder ·
**Score drivers** irreversibility HIGH (compounding), blast_radius HIGH

OD-26 recorded **11** documents naming split triggers against **3** naming merge triggers.
Re-measured while writing this file: **15 split · 3 merge · 2 retirement · 2
self-retirement.** The corpus grew by four split triggers and zero merge triggers *in the
hours the fork has been open* — the two greps were minutes apart and disagreed, which is
the finding stated more sharply than OD-26 states it.

**What would have to be true** for the asymmetry to be benign: that units which should
shrink will be noticed by some other mechanism. The only such mechanism is the 60-day
staleness sweep, which [[legal-premortem]] M1 and this function's own board both note is
defeated by a date-only edit.

**What breaks it.** Nothing, and that is the problem — the asymmetry has no failure mode
that arrives loudly. It arrives as 693 documents that are individually defensible and
collectively unmaintained, which is precisely the sprawl the anti-sprawl rules were written
against.

**Next step — one action.** Recommend adopting the symmetric rule as a Decision Office
standing rule: **every unit whose charter names a split trigger must name a merge or
retirement trigger in the same document.** Cheap to apply, mechanically checkable by a
Dataview query, and worth noting that three units have already done it unprompted —
[[red-team-charter]] §Entry and exit triggers is one of them, [[legal-loops]] L-LEG-5 and
the Skills self-retirement proposal are the others.

---

### T5 · OD-24 — 28 documents for a department with zero committed skills

**Channel** C2 · **Owner** founder · **Score drivers** evidence_strength MINIMUM

`.planning/01-org/applied-ai/skills/` contains **28 markdown files**. `git ls-files`
returns **zero** `SKILL.md` in the repository. The one `SKILL.md` on disk lives at
`.agents/skills/railway-config/SKILL.md` and is **gitignored** — `.gitignore:100` excludes
`.agents/` wholesale as CLI-installed vendor tooling (foundation README §3.1). The
department's de-facto template is borrowed from a vendor CLI.

The generator proposed its own self-retirement trigger: *fewer than 5 committed, firing
skills by 2026-11-24 → collapse Skills into AI Orchestration*. That proposal is the single
best artifact produced by any generator in this corpus, and it is **unadopted**.

**What would have to be true.** That a skill layer is coming, and that 28 documents help it
arrive. The second half is the weak claim: 28 documents describing skills is a substitute
for one committed skill, and it is a *comfortable* substitute — which is exactly why the
self-retirement trigger matters more than the documents do.

**Next step — one action.** Founder yes/no on OD-24, unchanged. Red Team adds one argument:
**adopting it is the cheapest available test of whether the org's anti-sprawl rules are
real**, because it applies them to the department that owns them. A no is fine; a no with a
reason converts OD-24 into an ADR and closes it either way.

---

### T6 · The decision index disagrees with the decision register — and with ADR 0007

**Channel** C4 (undeclared / drift) · **Owner** [[decision-office-charter]] ·
**Score drivers** blast_radius MEDIUM, cost-to-fix MINIMAL

Three verifiable contradictions inside the decision layer itself, as of 2026-08-24:

| Claim | Says | Actually |
|---|---|---|
| `decisions/README.md:45` | *"Currently 8 items"* | **23** open rows in `OPEN-DECISIONS.md` |
| `decisions/README.md:29` | ADR 0007 = *"5 divisions, 20 departments"* | ADR 0007 says **6 divisions, 19 departments** and explicitly corrects the arithmetic (`0007-org-structure.md:63-65`) |
| `foundation/README.md:94` | *"canonical for the org: 5 divisions · 20 departments"* | `ORG_STRUCTURE.md:35` says **6 divisions · 19 departments** |

Low stakes individually; the *finding* is not the typo. `decisions/README.md:5` states the
governing rule: **"A decision not written here has not been made."** An index carrying that
much authority while being wrong about both the decision it points to and the size of its
own queue is a decision-layer defect, and it is the corpus's clearest instance of channel
C4 — nobody decided to let the index drift, which is why nothing caught it.

**Next step — one action.** Hand all three to [[decision-office-charter]] as its founding
correction, and recommend that the index become a **generated artifact** rather than a
hand-maintained one — the same reasoning that made `agenda-board.md` a Dataview query
instead of a bullet list (`OBSIDIAN_VAULT.md:100-105`).

---

### T7 · Staged fork IDs that never reached the register

**Channel** C4 · **Owner** [[decision-office-charter]] · **Score drivers** blast_radius
MEDIUM, freshness HIGH

Eight decision-shaped items — `OD-C1` through `OD-C8` — exist only inside Corporate's unit
documents. **None appears in `OPEN-DECISIONS.md`.** `OD-C5` is referenced **38 times**;
`OD-C2` **17 times**. Documents across four departments treat them as live forks the
register has never heard of.

`OPEN-DECISIONS.md` OD-30 already records a **different flavour** of the same defect —
Engineering's generated docs using local fork numbers that *collide* with canonical OD IDs,
so nine files cite "OD-23" meaning something other than the revenue target. Two independent
generators produced two variants of one failure, which makes it a **process defect, not two
mistakes**: generators have somewhere to put forks locally and no obligation to register
them.

**What breaks it.** A reader following `OD-C5` to the register, finding nothing, and
concluding either that the document is wrong or that the register is. Both conclusions are
corrosive and one of them is correct.

**Next step — one action.** Sweep and register or dismiss all eight, then adopt the
generator-side rule that a locally staged fork must carry a non-OD prefix and appear in a
single `§Forks to register` section of the unit's agenda. **This function follows that rule
below** — see [[red-team-directive]] R7.

---

## Forks to register — RT-F#, explicitly not OD IDs

Per [[red-team-directive]] R7, Red Team stages proposed forks under an `RT-F` prefix that
cannot be confused with a register ID, and lists every one of them in this single section.
[[decision-office-charter]] takes, renumbers, or rejects them. Nothing here is decided, and
nothing here should be cited as though it were.

| ID | Proposed fork | From |
|---|---|---|
| **RT-F1** | **NF-B erasability vs the append-only research store.** Does an erasure request reach the NF-B research log, and if so, how — given ADR 0006 locks it as never migrated? Spans Compliance & Privacy, Research & Math, Data. Pair with OD-11 | T1 |
| **RT-F2** | **What number makes ADR 0007 falsifiable?** At what count of stale units does the structure get trimmed | T3 |
| **RT-F3** | **Symmetric trigger rule** — every charter naming a split trigger must name a merge or retirement trigger. Extends OD-26 from a question to a proposal | T4 |
| **RT-F4** | **Generate `decisions/README.md` rather than maintain it**, and fix the three drifted claims | T6 |
| **RT-F5** | **Locally staged forks must carry a non-OD prefix and a `§Forks to register` section.** Generalises OD-30 to cover the `OD-Cx` variant | T7 |
| **RT-F6** | **Is Red Team's 7-finding cap right?** Asserted in [[red-team-charter]] with zero evidence. First self-attack | [[red-team-premortem]] |

## Next steps

1. **Nothing above is a finding yet.** Run [[red-team-directive]] phase 2 on T1 —
   reconstruct the conditions *before* opening the evidence — and file the first finding
   into [[compliance-privacy-charter]]'s `questions.md`, which will also be the first
   `questions.md` in the corpus.
2. Run the L-RT-1 backlog sweep across all seven ADRs and record it **as a backlog sweep**,
   not as a clean `rt.locked_decision_challenge_rate` of 100%.
3. Run the first L-RT-3 undeclared-decision sweep; T6 and T7 are its known seeds, not its
   expected total.
4. Hand RT-F1–RT-F6 to [[decision-office-charter]] and stop referring to them once they
   have real IDs.
5. Attack [[red-team-charter]] (RT-F6). The claim that a scored queue with a 7-item cap
   produces signal rather than noise has no evidence behind it, and this function's own
   standards do not permit that from anyone else.

## Questions for the founder

1. **T1 / RT-F1 is the one that cannot wait.** Does a guest erasure request reach the NF-B
   research log? If yes, ADR 0006 needs an amendment; if no, it needs a sentence saying so.
   It is currently silent, and silence in a locked architecture reads as "not considered."
2. **OD-23 — which framing?** Not *"is $20k achievable"* but *"which Commercial decisions
   has this target already made for us, and do they survive the target being wrong?"*
3. **T3 / RT-F2 — one number.** What observation would tell you the org structure is too
   large? Any answer makes ADR 0007 falsifiable. "None" is a real answer and worth recording
   as such.
4. **OD-24 — yes or no on the Skills self-retirement trigger.** It is the cheapest available
   test of whether the anti-sprawl rules bind the department that owns them.
5. **Is Red Team permitted to attack decisions you have personally locked?**
   [[red-team-directive]] R8 assumes yes and makes it mandatory. If the answer is no, this
   function should fold into [[decision-office-charter]] now rather than discover it in
   quarter three — see [[red-team-premortem]] M2.
