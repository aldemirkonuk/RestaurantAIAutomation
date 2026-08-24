---
type: agenda-full
division: product
department: guest-experience
team: consumer-app-points-economy
status: provisional
metrics: [nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.verified_visit_rate, nf_b.abuse_hold_rate]
updated: 2026-08-24
links: ["[[consumer-app-points-economy-charter]]", "[[consumer-app-points-economy-premortem]]", "[[consumer-app-points-economy-agenda-board]]", "[[consumer-app-points-economy-directive]]", "[[consumer-app-points-economy-loops]]", "[[consumer-app-points-economy-schedule]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[guest-value-monetization-charter]]", "[[design-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[partnerships-integrations-charter]]", "[[FUTURES]]", "[[UX_PATHS_CATALOG]]", "[[OPEN-DECISIONS]]"]
---

# Consumer App & Points Economy — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.
>
> ⬦ **This team is unstaffed and gated on OD-07.** Everything below is what it would
> do *if* the gate opens, written now so the reasoning exists when the founder call
> lands rather than being assembled under time pressure afterwards.

## What

The signal source: a consumer-grade guest app — profile, rate, photo, follow,
discover, share — and the append-only points ledger that pays for contribution.

The design contract is **complete**: [[FUTURES]] §7 plus 41 enumerated paths across
§W (`UX_PATHS_CATALOG.md:1471-1491`) and §AB (`:1771-1801`). The expensive thinking
is done. What is missing is a decision, not a specification.

## How

**Verification before earning. This is the build order and it is a gate, not a
preference.** The default order is the opposite — points demo, verification does not —
and reversing it is the single decision that separates this program from
[[consumer-app-points-economy-premortem]] C1. Concretely: the confirmation state
machine, one verified-visit channel, and the review quality gate exist and are
measured *before* the first point is earnable, and no perk is redeemable until
`nf_b.points_confirm_rate` has been stable for a quarter.

**Abuse as a standing posture, not a control set.** The adversary is a human who
observes the defence and adapts, which is the reason this is a separate team. So:
weekly abuse review, detection tuned against **held credits and appeal outcomes**
rather than a fixed rule list, and the standing assumption that a control which has
never fired is untested rather than proven.

**Consumer-grade as a rejection right.** The staff app, its design system, and its
components all exist, and reuse is faster at every individual decision. The failure is
cumulative, not decided ([[consumer-app-points-economy-premortem]] C3). This team
holds an explicit right to reject a reskinned console, exercised with
[[design-charter]] and measured against retention — which is instrumented **before**
points, because a points economy on a surface nobody returns to is a ledger of
nothing.

**Guest-visible integrity.** `NEW-871` (provisional vs confirmed visually distinct),
`NEW-872` (expiry notice *before*, not after), `NEW-878` (suspected abuse → held plus
an appeal path, never silent zeroing), `NEW-863` (ledger view showing every credit
with its source event). These are not polish. A provisional state a guest can see is
much harder to quietly treat as real than a back-office flag, and an appeal path is
the highest-signal abuse data the team will ever get.

## Why now

**It is not now, and that is the honest answer.** Two conditions must hold and neither
does:

1. **OD-07 is open.** Building against an unresolved fork risks authoring an abuse
   posture for the wrong threat surface — a partner platform brings its own identity
   model, its own farming vectors, and its own defences
   ([[consumer-app-points-economy-premortem]] C4).
2. **There is nobody to attribute a choice to.** `nf_b.subject_coverage` is
   structurally 0%; no application code writes the guest identity tables. An app
   emitting events for guests who do not exist as subjects produces engagement
   metrics and zero NF-B events.

**What is worth doing now, at near-zero cost:** surface OD-07 in the open-decision
digest until it closes. [[FUTURES]] §7.5 already provides the guest MVP scope the
decision was waiting on, so the blocker is smaller than it looks. And write the
ledger CI guard before the first ledger table exists — see step 1 below.

## Next steps

Everything from step 2 is **gated**. Step 1 is not.

| # | Step | Gate | Done when |
|---|---|---|---|
| 1 | Write the **no-direct-balance-write CI guard**, modelled on `scripts/check_no_direct_stock_writes.sh` | **none — do this now** | The guard exists and passes trivially, before any ledger table |
| 2 | Resolve **OD-07** | Founder | The fork is closed either way |
| 3 | Confirm `nf_b.subject_coverage` non-zero for ≥1 restaurant | [[guest-identity-consent-charter]] step 4 | There is a subject to attribute choices to |
| 4 | Build the **verification spine** — one verified-visit channel, the provisional→confirmed state machine, the review quality gate | 2, 3 | `nf_b.points_confirm_rate` is computable **before** anything is earnable |
| 5 | Ship the **append-only ledger**, balance derived | 1, 4, [[engineering-charter]] | A correction is a compensating entry; no path writes a balance |
| 6 | Guest profile + rating + photo, on a **separately-judged consumer surface** | 4, [[design-charter]] | Retention instrumented before points are visible |
| 7 | Earning rules per [[FUTURES]] §7.2, provisional by default | 4, 5 | No credit path defaults to `confirmed` |
| 8 | `NEW-871` · `NEW-872` · `NEW-878` · `NEW-863` — the guest-visible integrity set | 7 | A guest can see what is provisional, why, and how to appeal |
| 9 | Abuse posture: rate limits, attribution, device signals, **weekly review** | 7, [[security-charter]] | `nf_b.abuse_hold_rate` is on the board with appeal outcomes beside it |
| 10 | Tiers and badges — **status only**. No perks yet | 8 | [[FUTURES]] §7.4 honoured |
| 11 | Restaurant-funded opt-in perks | 10 + a **full stable quarter** of `nf_b.points_confirm_rate` | The gate in [[consumer-app-points-economy-directive]] is satisfied |

**Not doing, at any point in this list:** cash-value rewards, a redemption
marketplace, platform-funded perks. [[FUTURES]] §10 (`FUTURES.md:282`) forbids them
before points integrity is proven, and "proven" means step 11's gate, not a judgment
call.

## Questions for the founder

1. **OD-07 — the decision this team is made of.** Build independently, or explore a
   Beli collaboration? This team **takes no position and should not**: an independent
   build maximises its own scope. What it can say is that the two branches are
   genuinely different work — under collaboration much of this charter becomes an
   integration contract, and the abuse posture is partly inherited rather than
   authored. [[FUTURES]] §7.5 already supplies the MVP scope the call was waiting on.

2. **Is the verification-before-earning gate endorsed?** It is the one rule standing
   between this program and [[consumer-app-points-economy-premortem]] C1, and it will
   be under pressure from the first demo onward, because points are the visible half.
   Endorsing it now — while there is no roadmap pressure and no demo date — is what
   makes it hold later.

3. **A full stable quarter before the first redeemable perk — confirmed?** It reads as
   cautious and it is priced against a specific outcome: one perk redeemed by an
   abuser is a story that reaches every restaurant in the city, and restaurant-funded
   perks are opt-in, so the program dies by operator word of mouth rather than by
   metric.

4. **⚠️ Where does the operator preference signal live?** Raised here because this
   team would be the natural builder of *any* human-preference capture surface, and
   because it changes what this team is for. `recommendation_actions` already collects
   a manager's dismiss / snooze / done / pin / `helpful` · `not_helpful`
   (`supabase/migrations/20260805000000_baseline_from_production.sql:4908`;
   `apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`) and has
   **no `subject_type` home** — the NF schema allows `agent | guest | bio`. An
   operator is a human whose preferences we already record and cannot classify.
   **OD-11 fixes the per-`subject_type` index strategy**, after which adding a value
   is a migration against live indexes. Not this team's to decide; this team's to
   flag, because it is the one that would otherwise build the second one by accident.
