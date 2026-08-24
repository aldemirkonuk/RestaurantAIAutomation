---
type: contract
title: Scenario Contract
status: proposed
updated: 2026-08-24
links: ["[[ORG-MAP]]", "[[LOOP-MAP]]", "[[ORG_STRUCTURE]]", "[[analytics-bi-charter]]", "[[synthetic-generation-simulation-charter]]"]
---

# Scenario Contract — the operational rituals

> The third structural plane. The **line org** (divisions → teams) says *who owns what*.
> The **advisory layer** says *who reviews whom*. **Scenarios** say *what actually
> happens in a restaurant* — and thread horizontally through every unit that touches it.
> This is the layer the vision demanded in §7.3: *a constrained set of standard
> situations, each flexible enough to bend to a specific restaurant* — a small library
> of adaptable patterns, not one rigid process and not infinite bespoke ones.

## 1. Why this layer exists

The 792-document org answers *who* and *how we decide*. It did not answer the founder's
lifecycle test: **problem → answer → query → output → solution → analytics → decision →
deployment**. Auditing the 8 artifacts against that chain:

| Lifecycle corner | Covered by | Gap |
|---|---|---|
| Problem | `premortem.md` (unit failure) | ❌ No *operational* problems — a premortem knows how a *team* fails, not what happens when a truck is late |
| Answer / query | `charter.md` metrics | ❌ Nothing lists the questions the *product* must answer mid-service |
| Output | — | ❌ No artifact names what surfaces to whom, in the moment |
| Solution / decision | `directive.md` (how the unit decides) | ❌ Nothing maps the *operator's* decision + the system's proposal (ask→propose→confirm→execute) |
| Analytics | Analytics & BI charters | ❌ No binding from a real-world event to the insight the owner sees — the commercial payoff was unowned |
| Deployment | `release-engineering` | ❌ No gate saying "this scenario passes in simulation before it ships" |

Scenarios close all six. **Each scenario is a ritual**: the same event, walked end to
end, every corner named.

## 2. Anatomy — 11 sections, every scenario, no exceptions

| § | Section | The corner it closes |
|---|---|---|
| 1 | **Trigger** | The real-world event, precisely bounded |
| 2 | **Actors** | Guest, staff, owner, vendor, POS, agents — who is in the room |
| 3 | **Signals** | What the system must capture (webhooks, emails, NF-A/NF-B events) — *if nothing is captured, the scenario is invisible and everything below is fiction* |
| 4 | **Queries** | The questions the product must answer during and after |
| 5 | **Outputs** | What surfaces to whom, in the moment (alert, draft, one-tap card) |
| 6 | **Insights** | What the **owner sees later** — the analytics story. This is what they pay for |
| 7 | **Decisions** | What the human decides; what the system may *propose* (never silently execute — FUTURES §8.1) |
| 8 | **Failure modes** | What goes wrong in *this* scenario — feeds the owning units' premortems |
| 9 | **Simulation & deploy gate** | How we run it synthetically (SimPOS, synthetic engine) — and the rule that a scenario-touching change ships only when its sim run passes |
| 10 | **Tier cut** | **Core / Plus / Pro** — the entitlement axis runs *through scenarios*, not pages. **Core = operate** (checklists, alerts, one-tap). **Plus = understand** (scorecards, drafts, digests). **Pro = optimize** (cross-entity intelligence, proposals, forecasting). Price points still open (OD-23) |
| 11 | **Evolution feedback** | What this scenario teaches the app — the signal that drives how the AI-native product evolves |

## 3. Frontmatter

```yaml
type: scenario
id: S02
slug: vendor-delivery-arrives
class: happy-path | problem
actors: [vendor, receiver, inventory-system]
modules: [inbound-understanding, inventory-ledger]   # owning units, [[linked]]
signals: [pos_webhook, email, photo, nf_a]
insights_class: [stockout-risk, cogs, vendor-reliability]
tier: core | plus | pro | undecided                  # OD-48
sim_harness: simpos | synthetic-engine | none-yet
status: proposed | simulated | live
updated: 2026-08-24
```

`status` is earned, never asserted: **`simulated`** requires a recorded synthetic run;
**`live`** requires the ritual observed end-to-end at a real restaurant. Everything
starts `proposed`.

## 4. The ecosystem loop this creates

```
scenario (ritual) → synthetic run (SimPOS + synthetic engine)
     → signals → insights rendered → shown to owner
     → feedback (what convinced, what confused, what was missing)
     → app evolves → scenario re-run → …
```

This is the founder's testbed: every pro/con of the product observed **in simulation
first**, against the scenario library, before a real restaurant ever depends on it.
SimPOS already exists for exactly this (`apps/api-gateway/src/simpos/` — non-production
only since PR #32); the synthetic engine is Data's `synthetic-generation-simulation`
team; phase 37 (synthetic restaurant engine) is the prior art.

## 5. Rules

- **A scenario without named signals is rejected.** If nothing is captured, nothing
  downstream is real.
- **§6 Insights is mandatory and concrete** — name the insight *classes* the owner sees,
  and check them against satisfiability: today only **25.1%** of the 573 insight types
  are satisfiable without POS data ([[analytics-bi-charter]]). A scenario promising
  insights its signals cannot feed is fiction.
- **Simulation before live — locked 2026-08-24.** *Every* scenario must reach `status:
  simulated` (a recorded synthetic run through SimPOS + the synthetic engine) before it
  may reach `status: live`. No exceptions, including light scenarios. Release Engineering
  owns the gate; Data owns the harness. This is the founder's testbed made mandatory.
- **Scenarios are patterns, not processes.** Each names its **flex points** — the places
  a specific restaurant bends it — so the library stays small while fitting many kitchens.
- Retire-to-write applies: this layer was paid for by retiring 44 byte-identical
  duplicate files from `md_files/`.

## 6. Index

Live index: [[SCENARIO-MAP]]. Files: `S<nn>-<slug>.md`, unique across the vault.
