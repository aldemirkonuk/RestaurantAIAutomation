---
type: agent-stack
division: commercial
department: media-brand
team: narrative-collateral
status: designed
updated: 2026-08-27
metrics: []
links: ["[[narrative-collateral-charter]]", "[[narrative-collateral-schedule]]", "[[narrative-collateral-loops]]", "[[narrative-collateral-directive]]", "[[0034-agent-stack-artifact]]", "[[media-brand-agent-stack]]", "[[editorial-gate-charter]]", "[[strategy-fundraising-charter]]", "[[skills-charter]]"]
---

# Narrative & Collateral (M2) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Everything this unit produces is outward, so the card's shape is fixed by that: **it drafts
> and it checks; a human sends, presents, or exports.** Nothing here is a publishing mechanism,
> and no card may acquire one. The standing visuals hold (`decisions/README.md:76`) applies —
> this card builds the **structure of the argument**, which is reference-independent, and defers
> visual treatment rather than guessing at it.
>
> `metrics: []` is copied verbatim from [[narrative-collateral-charter]]. The primary metric is
> real and has no NF namespace: **one headline claim** — binary, per artifact, does it lead with
> the sentence at `.planning/YC_WEDGE_PLAN.md:312`. The failure it measures is proliferation, so
> a percentage would hide exactly what it is for.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `nc-claim-warden` | Draft the argument in order, prove every artifact leads with the same sentence, flag every number that has no source line — and hand the result to a human, who is the only one who sends it | NEW |

## 2. Agent cards

```yaml
agent: nc-claim-warden
unit: narrative-collateral
triggers:
  - topic: artifact.draft_ready            # publisher: NONE (gap — no artifact pipeline exists; today a person asks)
  - schedule: "weekly — blocked-input watch: visual reference, recovery number, DEP-06; report days blocked"   # mirrored in [[narrative-collateral-schedule]]
  - schedule: "monthly — headline-claim audit across every outward artifact; count distinct headline claims"
consumes:
  - "`.planning/YC_WEDGE_PLAN.md:312` (the sentence), `:315` (the metric to lead with), §3 (the sixty-second demo and the competitive read), `:323` (the surface-area constraint)"
  - "the verified recovery number from [[design-partner-operations-charter|Sales S1]]"   # publisher: chartered owner, emits no event today (gap)
  - "M1's voice guide"                     # publisher: [[brand-identity-charter]] — does not exist yet (gap)
  - "`PROJECT.md:101` — DEP-06 (Toast credentials for the design partner), still unchecked"
emits:
  - "drafts as vault PRs → consumed by [[editorial-gate-charter|G3]], which fact-checks every number before anything leaves"
  - "`claim-substantiation` (per-event), `collateral-blocked-inputs` (weekly), `headline-claim-consistency-m2` (monthly), `narrative-freshness` (quarterly) — [[narrative-collateral-loops]]"
routing_class: judgment      # ordering an argument for a named room is judgment; the number-source-line half is a mechanical check and is where the quality bar bites
quality_bar: "two outputs per artifact: (a) does it lead with the sentence at `.planning/YC_WEDGE_PLAN.md:312`, yes or no; (b) every number listed with its source line or `MISSING` — any `MISSING` fails the run. Whether a claim is *true* is NOT this agent's bar; that is G3's, and a team may not fact-check its own deck"
autonomy:
  read: autonomous
  propose: autonomous        # drafts and check reports land as PRs, never as sends
  mutate_stock_money_outbound: confirm   # constant — exporting, sending, or presenting an artifact is the outbound act, and it is a human's
memory: narrative-collateral
escalates_to: "[[media-brand-charter]]"
```

**The card's own hard rules.** It never produces or estimates the recovery number — S1 owns
*verified dollars recovered*, and `.planning/YC_WEDGE_PLAN.md:31-33` establishes that "dollars
recovered" today means *we asked*, not *we received*. It never lets an artifact marked internal
leave outward: the two decks have different claim standards and confusing them is the
premortem's second mechanism (charter §The two deliverables). It does not decide whether to
apply to YC — that path is [[strategy-fundraising-charter]]'s.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `headline-claim-check` | T2 | Any outward artifact before it leaves; in bulk during the monthly audit | (a) leads with the sentence at `.planning/YC_WEDGE_PLAN.md:312`, yes/no; (b) every number with its source line or `MISSING`; any `MISSING` fails | `.planning/YC_WEDGE_PLAN.md:323` records the product already failing this test — a sommelier AI, a calendar, promotions, 573 insight types, an 860-path UX catalogue, a UX optimizer, and a reader who concludes there is no wedge. The collateral inherits that instinct because every one of those is real work someone did | NEW |

One row. Two candidates were dropped rather than aspirationally listed:

- **`artifact-preflight`** — its justification is premortem mechanism 2 (an internal deck going
  out because it was the only deck on a deadline), which is a documented *mechanism*, not a past
  instance. Built when the first artifact exists ([[narrative-collateral-schedule]]).
- **`demo-script-render`** — deferred, with a concrete reason: the invoice half of the
  sixty-second demo is still typed by hand per line item
  (`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:401,440`), so the demo cannot yet
  be filmed honestly, and a script for it would describe something that does not happen.

Consumed, owned elsewhere: fact-checking a claim ([[editorial-gate-charter]]) · the voice guide
([[brand-identity-charter]]) · the envelope ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate intact.
- **Episodic** — nf_a `task_type: artifact_preflight`, one event per checked artifact, with
  `context.artifact` and `context.audience` (internal | outward) as jsonb keys — the
  internal/outward distinction has to be queryable, because the failure it guards is an artifact
  crossing that line. A `MISSING` number is a failure outcome, not a warning.
- **Semantic** — `memory/` beside this file, `narrative-collateral-MEMORY.md` as index. The
  facts this layer exists to hold are unusual for this vault: **the current wording of the one
  sentence, and every second sentence that was ever drafted and retired**, each with the room it
  was written for. Proliferation is the metric's failure mode, so a retired claim that nobody
  recorded is how it comes back. Also held: the blocked inputs with days-blocked (the ElevenLabs
  reference lives in the founder's personal Instagram saves and **must be supplied by hand** —
  nothing in this org has or should have access to a personal account), and DEP-06's state,
  because a case study written before it is a case study about a demo.
- **Working** — this card, the MEMORY index, charter §Mandate, and the sentence itself.
  `.planning/YC_WEDGE_PLAN.md` is a grep target by `path:line`, never loaded whole (CLAUDE.md §2).

**Consolidation** — monthly, mirrored on the headline-claim audit row in
[[narrative-collateral-schedule]]: count distinct headline claims across every artifact;
**failures first** — a second claim that appeared and was not retired becomes a fact naming the
room that produced it, since "both were defensible" is precisely how proliferation happens;
expire facts unverified for 90 days; propose skill candidates. One PR; "no delta" stated — and
while there are zero artifacts, "no delta" will be the true answer for a while.

## 5. Async contract

Cross-unit interaction: loops ([[narrative-collateral-loops]]), NF-A events, vault PRs, and
skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `artifact.draft_ready` has no publisher | There is no artifact pipeline. Drafting starts because a person asks, so the per-artifact loop's close_time depends on a human noticing |
| The recovery number has an owner but no channel | [[design-partner-operations-charter|S1]] owns *verified dollars recovered*; nothing emits it, so the weekly blocked-input watch is the only detector, and estimating it in the meantime is the premortem's third mechanism |
| The voice guide does not exist | M1 owns writing it; until it does, "conforms to voice" is unverifiable and the check reports it as such rather than passing silently |
| G3 receives drafts by PR, not by event | An acceptable async path, but nothing notifies the gate; their pass has to be scheduled from their side |
| The visual reference is unfetchable by this org | Founder's personal Instagram saves. Recorded as a **blocked input**, never as an assumption |

## 6. Evidence today

- **EXISTS — the argument.** `.planning/YC_WEDGE_PLAN.md:312` (the sentence), `:315` (dollars
  recovered), §3 (the sixty-second demo and an honest read against MarginEdge), `:323` (surface
  area as the central constraint), `:31-33` (asked ≠ received). Written and peer-reviewed.
- **NEW — every artifact.** No deck, no case study, no recorded demo, no story document anywhere
  in the repo, which is why three of this unit's four scheduled jobs return empty by construction.
- **NEW — the warden, the skill, and all of §4.** The past instance cited in §3 is a documented
  failure of the *product* to lead with one thing, not a prior run of the skill.
