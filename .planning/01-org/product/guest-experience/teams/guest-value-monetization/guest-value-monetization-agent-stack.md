---
type: agent-stack
division: product
department: guest-experience
team: guest-value-monetization
status: designed
updated: 2026-08-27
metrics: [nf_b.ops_conversion, nf_b.k_anonymity_pass_rate, nf_b.photo_consent_rate, nf_b.segment_to_decision_latency]
links: ["[[guest-value-monetization-charter]]", "[[guest-value-monetization-schedule]]", "[[guest-value-monetization-loops]]", "[[guest-value-monetization-directive]]", "[[guest-value-monetization-premortem]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[guest-experience-agent-stack]]", "[[compliance-privacy-charter]]", "[[product-vision-charter]]", "[[skills-charter]]"]
---

# Guest Value & Monetization — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only Guest team whose customer is the **restaurant**, not the guest — and the card
> inherits that inversion rather than hiding it: an agent that both protects guest data
> and extracts value from it resolves the conflict inside one process, unobserved. So
> escalation runs to [[compliance-privacy-charter]] by default and **it does not review
> its own privacy gates** ([[ORG_STRUCTURE]] §3). Three forks stay open and referenced,
> never picked: **PROD-F3**, **OD-07**, and **pricing** (founder-deferred — no pricing
> model appears below, deliberately). NF-B is **HELD**
> ([[0029-p3-plan-of-record]] §3), so there is nothing to aggregate, which is exactly
> the condition under which the k-threshold comes under pressure.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `guest-value-gatekeeper` | Hold the three counter-pressures that only work **before** the thing they guard exists — the k-threshold as a code constant, the unwritten advertising boundary as a blocking verdict, and the quarterly `nf_b.ops_conversion` zero reported as a finding rather than as silence | NEW |

## 2. Agent cards

```yaml
agent: guest-value-gatekeeper
unit: guest-value-monetization
triggers:
  - schedule: "per commit — k-threshold-constant-guard"     # active now; mirrored in [[guest-value-monetization-schedule]]
  - schedule: "quarterly — ops-conversion-review"           # active now, reporting 0
  - topic: surface.advertising_proposed                     # publisher: NONE (gap — no ad surface exists; the standing verdict is BLOCKED)
  - topic: guest_data.render_requested                      # publisher: NONE (gap — no restaurant-facing guest view exists)
consumes:
  - "apps/web/src/components/settings/ServicesPermissions.tsx:41,249 — the written no-advertising promise on the operator surface"
  - "the eleven specified restaurant-facing paths: NEW-659 … NEW-661 (07-reference/UX_PATHS_CATALOG.md:1489-1491), NEW-664 (:1494), NEW-665 (:1495), NEW-880/882/883/885 (:1801-1806)"
  - "NEW-865 (:1786) and the enrichment pipeline it would feed ([[FUTURES]] §4)"
emits:
  - "k_threshold_configurable (must be false) and boundary_statement_current → [[guest-experience-agent-stack]]'s rollup"
  - "nf_b.ops_conversion, reported quarterly as 0 with its reason — two consecutive zero quarters returns the sub-layer charter to [[product-vision-charter]]"
  - a BLOCKED verdict on any advertising design while no written boundary statement exists
  - nf_a events (task_type: privacy_gate_audit, advertising_boundary_check)
routing_class: judgment
quality_bar: "nf_b.k_anonymity_pass_rate = 100% with no admin exception — undefined today because no render exists. For the boundary verdict: NONE (gap) — nothing grades a 'does this surface fall inside the written boundary' finding, and the honest default while the statement is unwritten is BLOCKED, not pass"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant — and the least vacuous instance of it in the sub-layer: advertising is a money surface by construction
memory: guest-value-monetization
escalates_to: "[[compliance-privacy-charter]]"
```

**Hard rules.** The gatekeeper never reviews a privacy gate it operates — every verdict
goes to [[compliance-privacy-charter]], structurally and not as a courtesy. It proposes
**no pricing, rate card, CPM, revenue share, or yield model**; *a skill that optimises
ad yield is a pricing model with a different filename*
([[guest-value-monetization-schedule]]). It takes no position on PROD-F3 and states that
it is not neutral about it: keeping the team here maximises the sub-layer's scope. When
`nf_b.sub_k_render_attempts` rises, the response it may propose is **better empty-state
copy, never a lower threshold**. Its second escalation path is deliberately different
from the card's: the two-quarters-at-zero `nf_b.ops_conversion` finding goes to
[[product-vision-charter]] via the `nf-b-ops-conversion` loop, because that is a scope
decision and not a privacy review.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `k-anonymity-gate-check` | T2 | Any new or changed restaurant-facing view of guest-derived data | Confirms (a) the threshold is read from the code constant, (b) the sub-k path renders the empty state rather than an error or a partial, (c) the claim prints its n, (d) no admin or staging branch bypasses it | `NEW-659`, `NEW-660`, `NEW-661` (`07-reference/UX_PATHS_CATALOG.md:1489-1491`) and `NEW-665` (`:1495`) are restaurant-facing surfaces already specified and none built; verified 2026-08-27, **no k-threshold constant exists anywhere** — grepped `apps/`, `scripts/`, `supabase/migrations/`, `.github/` for `k_anonymity`/`kAnonymity`/`k-anonymity`: zero matches. After the first surface ships the check becomes a retrofit argued against a working screen | NEW |
| `photo-consent-scope-check` | T2 | Any code path that reads, copies, or publishes a guest-supplied photo | Verifies a live consent record **for the specific purpose** — catalog enrichment, restaurant promotion and paid placement are three purposes and one "yes" does not transfer — and that revocation propagates | `NEW-865` promises *"consent prompt for catalog reuse"* (`:1786`) and the enrichment pipeline it would feed already exists ([[FUTURES]] §4) while the consent plumbing does not. A working capability with a missing gate is one integration away from using a photo it has no right to | NEW |
| `advertising-boundary-check` | T2 | Any advertising or sponsored-placement design or implementation | Confirms a written boundary statement exists and that the surface falls inside it; greps for product copy promising no advertising and reports conflicts. **Blocks while the statement is unwritten** | Verified 2026-08-27: `apps/web/src/components/settings/ServicesPermissions.tsx:41` lists *"Any advertising or cross-site tracking"* under exclusions and `:249` states the product sets no advertising cookies — while this team's charter names advertising as its revenue model. Found by grep in the 2026-08-24 session and absent from the team layer, which is precisely how it would be found by someone outside the company later | NEW |
| `segment-traceability-check` | T2 | Any restaurant-facing recommendation or insight surface | Confirms the surface carries the segment id that produced it and that acting on it writes back — the chain `nf_b.ops_conversion` needs to be computable at all | `NEW-664` (`:1494`, digest → menu experiment) and `NEW-882`/`NEW-883` (`:1803-1804`, advocacy → par and promotion suggestions) all **end** at a restaurant decision with no write-back specified. Without the chain the metric is unmeasured rather than zero, and unmeasured reads as neutral for four quarters | NEW |

**Not proposed:** anything that computes, optimises, or forecasts revenue — see the
card's hard rule.

Consumed, owned elsewhere: segment methodology ([[analytics-bi-charter]]); the licence
question on reusing a person's content ([[legal-charter]] + [[compliance-privacy-charter]]);
the skill envelope ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
  `advertising-boundary-check` is expected to sit at BLOCKED indefinitely: the skill
  working, not the skill going stale.
- **Episodic** — nf_a `task_type: privacy_gate_audit` and `advertising_boundary_check`,
  with `context.surface` and `context.purpose` as jsonb keys: "which purpose was
  consented" is the question the photo gate turns on, and it must be queryable rather
  than reconstructed. NF-B contributes nothing today — no segments exist.
- **Semantic** — `memory/` beside this file, one fact per file with `source` /
  `confidence` / `last_verified`; index `guest-value-monetization-MEMORY.md`. Founding
  facts are already known: the two promise strings and their lines; that
  `provider_promotions` is **supply-side, not advertising**
  (`apps/api-gateway/src/providers/provider-intelligence.service.ts:135,222`, dormant —
  the name is the whole trap); the k value once chosen, and that it is a constant; and
  PROD-F3's state. Every write is a PR — here the PR is also the review trail
  [[compliance-privacy-charter]] reads.
- **Working** — this card, the MEMORY index, charter §Boundaries and §Non-goals. The UX
  catalog and the promise copy are `path:line` retrieval targets.

**Consolidation** — quarterly, matching `ops-conversion-review`: read the NF-A slice;
distil **failures first** — a sub-k render attempt becomes a fact naming the surface and
the question it was trying to answer, never "pressure increased"; expire facts unverified
90 days; propose skill candidates. One PR, and a quarter with nothing else to report
still files the `nf_b.ops_conversion` zero: here silence and zero are different findings.

## 5. Async contract

Interaction is loops ([[guest-value-monetization-loops]]: `nf-b-k-anonymity-gate`,
`photo-consent-integrity`, `nf-b-ops-conversion`, `advertising-boundary-integrity`),
NF-A events, and vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `guest_data.render_requested` has no publisher | No restaurant-facing guest view exists; the gate would have nothing to intercept. Building the guard first is the point — the alternative is retrofitting it against a shipped screen |
| `surface.advertising_proposed` has no publisher | Zero ad groundwork — grepped 2026-08-27 across all three apps and every migration for `advertis|sponsored|ad_slot|ad_campaign`: no inventory, no sponsor model, no placement schema. The standing BLOCKED verdict is the only live mechanism |
| Nothing to aggregate | `nf_b.subject_coverage` is structurally zero and no NF-B event has been emitted, so segments do not exist. The k-threshold is under pressure **before** its first use, not after |
| The compliance review is a doc exchange | Escalation to [[compliance-privacy-charter]] is a vault PR and nothing notifies them; their schedule must carry the `self-review-audit` row or the structural separation degrades into an intention |
| PROD-F3 has no publisher | A division-boundary fork tracked in prose. If it resolves toward Commercial, this stack moves with the team — but the k-threshold and the photo-consent contract must not move with it (charter §PROD-F3) |

## 6. Evidence today

- **NEW — the gatekeeper and all four skills.** Nothing runs. Two are buildable now and
  should be, because both are counter-pressures that only work if they precede what they
  guard: the k-threshold constant with its CI guard, and the written boundary statement.
- **EXISTS — only what it checks against.** The no-advertising promise copy
  (`ServicesPermissions.tsx:41,249`) and the photo-enrichment pipeline ([[FUTURES]] §4).
- **PARTIAL — restaurant-side insight**, as specification only: eleven paths, none built.
- **⛔ NEW — advertising**, zero groundwork, re-verified 2026-08-27. Ambition with
  nothing beneath it, and this stack says so rather than sizing it.
