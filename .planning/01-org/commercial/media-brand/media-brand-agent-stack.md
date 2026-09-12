---
type: agent-stack
division: commercial
department: media-brand
status: designed
updated: 2026-08-27
metrics: [nf_b.choice, nf_b.context]
links: ["[[media-brand-charter]]", "[[media-brand-schedule]]", "[[media-brand-loops]]", "[[media-brand-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[brand-identity-agent-stack]]", "[[narrative-collateral-agent-stack]]", "[[social-community-agent-stack]]", "[[customer-relationship-research-agent-stack]]", "[[editorial-gate-charter]]", "[[compliance-privacy-charter]]"]
---

# Media & Brand — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This department owns **outward** surfaces, so its stack carries one rule the technical
> departments do not need: **every card here drafts and proposes; a human publishes.**
> Mechanisms are referenced, never restated — the mutation gate →
> [[action-safety-the-human-gate-charter]], model choice →
> [[model-routing-inference-economics-charter]], harness →
> [[harness-runtime-charter]] (**OD-03 open**), skills → [[skills-charter]].
>
> **A standing hold applies here specifically.** *Blender / landing-page visuals: hold until
> structure + brand exist* (`decisions/README.md:76`, Vision capture §13/§14.5, 2026-08-24).
> No card in this department or its four teams may un-hold it; proposing visual treatment is
> out of contract, not merely early.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `mb-outward-warden` | Keep one register of every place a third party meets this company, roll the four team metric sets onto one board without averaging them, and refuse to let anything cross the outward line without a named human | NEW |

One row deliberately. A department agent that scanned strings, wrote decks, or read consent
records would be doing M1/M2/M4's job under a second name.

## 2. Agent cards

```yaml
agent: mb-outward-warden
unit: media-brand
triggers:
  - schedule: "quarterly — outward surface inventory"     # mirrored in [[media-brand-schedule]]
  - schedule: "weekly — board refresh across the four teams"
  - topic: brand.surface_added                            # publisher: NONE (gap — nothing announces a new email template, notification channel, feed, or handle)
consumes:
  - the four team agenda-boards (Dataview output) and their loop ids in [[media-brand-loops]]
  - "the 50-host runtime list in `foundation/EXTERNAL_CONNECTIONS.md`"
  - "the tier-1 surface table in [[brand-identity-charter]] (`brand-identity-charter.md:70-104`)"
emits:
  - "[[media-brand-agenda-board]] rollup — the metric SET; the name and domain counts stay two numbers, never one (charter §Metrics)"
  - "`outward-surface-inventory` loop output (close_time quarterly, [[media-brand-loops]])"
  - escalation notes into [[media-brand-agenda-full]] §Questions
routing_class: extraction        # enumerating surfaces and reading boards; the judgment calls belong to the teams
quality_bar: "every board row carries a value or the words 'not measurable' with the dependency named (charter §Metrics: three of four metrics are not measurable today); an inventory reporting a count without its `path:line` rows is a failed run"
autonomy:
  read: autonomous
  propose: autonomous            # inventory and board edits land as vault PRs
  mutate_stock_money_outbound: confirm   # constant — and in this department it is the load-bearing line: every surface in the register is by definition outbound
memory: media-brand
escalates_to: "[[02-advisory/decision-office/decision-office-charter|decision-office-charter]]"   # CM-F5 and CM-F6 are open forks, not this agent's to close
```

**The card's own hard rule.** `mb-outward-warden` never edits an outward string, never sends,
posts, or presents, and never reclassifies a tier-3 identifier into its own scope — those are
Engineering's under fork **CM-F5** ([[brand-identity-charter]] §Tier 3).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `outward-surface-inventory` | T2 | Quarterly, and whenever a surface class is added (a new email template, notification channel, feed, or handle) | Every surface a third party can meet is enumerated with `path:line` and its owning team, or the class is named as unenumerated; a count without rows fails | The 2026-08-24 audit. A host-scoped enumeration reported **10** (`foundation/EXTERNAL_CONNECTIONS.md:15`) and structurally could not see the surfaces people actually meet; the hand-built tier-1 table (`brand-identity-charter.md:70-104`) is the first complete pass, and it is what surfaced the outbound `From:` (`apps/api-gateway/src/communications/gmail.service.ts:78`), the crawler UA in other companies' logs (`apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:17`), and the public API production server (`apps/api-gateway/src/main.ts:127,128,130`) | NEW |

One row. The department's other five scheduled skills have team owners
([[media-brand-schedule]] §Skills owned) and are referenced, not duplicated.

Consumed, owned elsewhere: `brand-surface-scan` and `brand-guard-ci`
([[brand-identity-schedule]]) · `headline-claim-check` ([[narrative-collateral-schedule]]) ·
`consent-register-check` ([[customer-relationship-research-schedule]]) · the envelope and
registry ([[skills-charter]]) · application of the voice guide ([[editorial-gate-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates go to [[skill-harvesting-charter]]'s queue and
  still face the §3.3 gate.
- **Episodic** — nf_a `task_type: outward_surface_inventory`, plus read access to the four
  teams' task families. Needs `context.surface_class` as a jsonb key so "rendered /
  transmitted / identifier" is one filter. **The department's declared metrics are NF-B, and
  NF-B emits nothing** — L4 is architecturally locked and uninstrumented ([[media-brand-charter]]
  §Metrics); until it emits, this layer is inventory runs only, and the board says so.
- **Semantic** — `memory/` beside this file, `media-brand-MEMORY.md` as the index. Its
  founding facts are already known: the two-number rule and why one aggregate is a failure;
  the three metrics that are not measurable and what each waits on (product analytics for M3,
  the approval register for M4); the standing visuals hold. Provenance frontmatter per
  ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters and
  the 193-file name surface are retrieval targets by `path:line`, never preloaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored on the agenda-sync row in [[media-brand-schedule]]:
read the quarter-to-date inventory and the four boards; write one fact per durable finding,
**failures first** — a surface that reappeared after being cleared becomes a fact naming the
mechanism (copied-from-old-code, regenerated artifact), not "the count went up"; expire facts
unverified for 90 days; propose skill candidates. One PR; "no delta" is stated, never silent.

## 5. Async contract

Cross-unit interaction is loops ([[media-brand-loops]]), NF-A events, vault PRs, and skill
candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `brand.surface_added` has no publisher | Nothing announces a new outward surface; the quarterly inventory bounds the blind spot at one quarter, which is long for a mail template |
| The four team boards are Dataview renders, not events | Nothing notifies this department when a team's number moves; the weekly refresh is a poll |
| NF-B publishes nothing | Both declared metrics name NF-B fields; the substrate is locked and uninstrumented, so the department's own metrics row reads "not measurable" by construction |
| G3 clearance is a chartered function, not a signal | M3's entry trigger depends on [[editorial-gate-charter]] clearing an article; no event exists, so [[social-community-schedule]]'s weekly watch is the only detector |

## 6. Evidence today

- **NEW — the warden and the inventory skill.** Nothing runs either; the closest artifact is
  the agenda-board Dataview, which renders and does not escalate.
- **EXISTS — what it would enumerate.** The tier-1 table (`brand-identity-charter.md:70-104`)
  and the 50-host list (`foundation/EXTERNAL_CONNECTIONS.md`) are both real and both read from
  the working tree on 2026-08-24.
- **NEW — everything in §4.** No `memory/` directory, no consolidation job, no NF-A task family.
- **Not measurable, not missing.** Three of the four team metrics have named dependencies
  (product analytics, the approval register, an artifact to audit). The board shows that, per
  ADR 0020, rather than substituting a number that exists for the one that matters.
