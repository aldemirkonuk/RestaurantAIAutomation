---
type: agent-stack
division: commercial
department: media-brand
team: social-community
status: designed
updated: 2026-08-27
metrics: []
links: ["[[social-community-charter]]", "[[social-community-schedule]]", "[[social-community-loops]]", "[[social-community-directive]]", "[[0034-agent-stack-artifact]]", "[[media-brand-agent-stack]]", "[[editorial-gate-charter]]", "[[conversion-funnel-charter]]", "[[skills-charter]]"]
---

# Social & Community (M3) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> ⏸ **This unit is chartered dormant** until the first long-form article clears
> [[editorial-gate-charter|G3]]'s gate ([[social-community-charter]] §Entry trigger, fork
> **CM-F6**). **While dormant it runs no agent at all**: the weekly one-bit watch stays a line
> on somebody's calendar, because a one-bit check does not need a skill
> ([[social-community-schedule]]). The card in §2 is what the unit **would** run once the
> trigger fires — written now so the launch week executes a list instead of inventing one, and
> gated in its own triggers so it cannot start early.
>
> `metrics: []` is copied verbatim from the charter. The primary metric — *referred sessions
> reaching an activated account* — is **not measurable**: Sentry is the only telemetry SDK among
> the 50 runtime hosts in `foundation/EXTERNAL_CONNECTIONS.md`, so no funnel step can be
> attributed. The honest interim is to report nothing, never follower counts.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `sc-post-proposer` | **Gated on the entry trigger.** Once an article clears G3: propose a post from the cleared item, verify it links to something that exists and that the reply-routing address is current, and hand it to a human — who posts it | NEW |

Zero agents run today. One row, gated, rather than an empty roster: the failure this unit's
premortem names is the trigger firing and nobody noticing, and a card that does not exist
cannot be pointed at when it does.

## 2. Agent cards

```yaml
agent: sc-post-proposer
unit: social-community
triggers:
  # every trigger below is inert until the entry trigger fires — the first long-form article
  # cleared by G3 ([[social-community-charter]] §Entry trigger). Nothing here starts early.
  - topic: content.cleared_by_g3           # publisher: [[editorial-gate-charter]] owns the clearance as a chartered function and emits no event (gap)
  - schedule: "weekly — entry-trigger watch: has an article cleared G3? one line, yes or no"   # human today; mirrored in [[social-community-schedule]]
  - schedule: "quarterly — handle and name availability check"
consumes:
  - G3-cleared long-form items            # publisher: [[editorial-gate-charter]], no channel (gap)
  - "M1's voice guide"                     # publisher: [[brand-identity-charter]] — does not exist yet (gap)
  - "the reply-routing address: `apps/web/src/pages/Help.tsx:18`, today still `support@wineops.ai`"
  - "referrer→activation attribution from [[conversion-funnel-charter|G5]]"   # publisher: does not exist — no product analytics (gap)
emits:
  - post drafts as vault PRs → consumed by a named human, who is the only publisher
  - "`social-entry-trigger-watch` (weekly) and `social-name-availability` (quarterly) — [[social-community-loops]]"
  - "after launch: `social-reply-routing` (weekly), `social-referred-activation` (monthly)"
routing_class: judgment      # a post has to earn attention from someone who was not searching; the preflight half is mechanical and its failures are terminal
quality_bar: "post-preflight: the item cleared G3, the link resolves to something that exists, the voice clause is cited rather than felt, and the routing address is current. NONE (gap) for the outcome metric — referred activation is unmeasurable until G5 instruments the funnel"
autonomy:
  read: autonomous
  propose: autonomous        # drafts land as PRs
  mutate_stock_money_outbound: confirm   # constant — and here it is the entire safety story: posting is outbound. A human posts. This card holds no account, no handle, and no token, and acquiring one is a change to this document, not a configuration detail
memory: social-community
escalates_to: "[[media-brand-charter]]"
```

**The card's own hard rules.** It writes no source material ([[content-production-charter|Growth
G2]]'s) and clears nothing for publication (G3's, posts included). It routes product-help replies
to the in-product support address rather than an unstaffed feed
([[social-community-directive]]) — and cannot publish that rule at all while the address points
at the previous company. It **never researches anyone who interacts with the feed**: a reply, a
follow, or a mention is not consent ([[customer-relationship-research-charter]] §Non-goals), and
the register that would make such research permissible does not exist.

## 3. Skills

*(none)*

**This table is deliberately empty, and it is the correct answer.** README §3.3 requires a real
past instance before a skill is committed, and this unit has no past — zero posts, zero accounts,
zero artifacts. A posting or scheduling skill here would be the clearest case of the speculative
skill the rule exists to prevent, and under the 30-day staleness rule it would be reviewed for
deletion before its first firing ([[social-community-schedule]] §Skills owned). `post-preflight`
is specified there with trigger, doneability, and owner so it is ready the moment there is an
instance; `trigger-watch` is deliberately not a skill.

Consumed, owned elsewhere: clearance ([[editorial-gate-charter]]) · the voice guide
([[brand-identity-charter]]) · funnel instrumentation ([[conversion-funnel-charter]]) · the
envelope ([[skills-charter]]).

## 4. Memory

- **Procedural** — none, per §3. The first entry will arrive through
  [[skill-harvesting-charter]]'s queue after the unit has actually done something worth repeating.
- **Episodic** — nf_a `task_type: entry_trigger_check` while dormant: a one-bit weekly row whose
  value is almost always "no", which is the row doing its job. After launch, `task_type:
  post_preflight` with `context.platform` and `context.cleared_item` as jsonb keys. The unit's
  own outcome metric has no episodic source until G5 instruments the funnel.
- **Semantic** — `memory/` beside this file, `social-community-MEMORY.md` as index. While dormant
  it holds very little on purpose: the trigger's state and its blockers — G3 has cleared nothing,
  the routing address is still M1's defect, and no handle is reserved because reserving one is a
  founder decision ([[social-community-charter]] §Evidence). Provenance per ADR 0034; writes are PRs.
- **Working** — this card, the MEMORY index, charter §Entry trigger. Nothing else, because there
  is nothing else.

**Consolidation** — quarterly while dormant (monthly is theatre for a unit doing one bit of work
a week), mirrored on the handle-availability row in [[social-community-schedule]]; monthly once
the trigger fires. Read the quarter's trigger checks and any blocked dependency; **failures
first** — if the trigger fired and the watch missed it, that becomes a fact naming the mechanism,
because it is premortem mechanism 2 realised. Expire facts unverified for 90 days. One PR;
"no delta" is the expected output and is stated, never left silent.

## 5. Async contract

Cross-unit interaction: loops ([[social-community-loops]]), NF-A events, vault PRs, and skill
candidates. Gap rows — this unit is mostly gaps, and saying so is the point:

| Gap | Why it is a gap |
|---|---|
| `content.cleared_by_g3` has no publisher | G3 is a chartered gate, not a mechanism that emits. The weekly human watch is the only detector, so the trigger can fire up to seven days before anyone acts |
| Referrer→activation attribution does not exist | The unit's primary metric depends on instrumentation [[conversion-funnel-charter|G5]] owns and this unit cannot build. If the trigger fires first, M3 launches with a metric it cannot report |
| The reply-routing address belongs to another unit's defect | `apps/web/src/pages/Help.tsx:18` still reads `support@wineops.ai`; no routing rule can be published pointing at the previous company |
| The voice guide does not exist | Preflight would cite a clause; there are no clauses |
| No handle is reserved and none is claimed | Dormancy has a cost, and a defensive registration for a just-renamed company is still a founder decision — raised as a question in [[social-community-agenda-full]], not decided here |

## 6. Evidence today

- **NEW — everything.** Zero artifacts. No social account, handle, scheduling tool, or
  link-tracking service appears among the 50 runtime hosts in
  `foundation/EXTERNAL_CONNECTIONS.md`; nothing in the repo references a social presence. The
  agent is gated shut and has no trigger it can act on today, by design; §4 has no `memory/`
  directory, no NF-A task family, and no consolidation run.
- **The one thing that EXISTS is the blocker**: `apps/web/src/pages/Help.tsx:18`, verified
  2026-08-24 in [[brand-identity-charter]] §Tier 1 — a sibling's defect standing between this
  unit and its first publishable rule.
