---
type: agenda-full
division: product
department: product-vision
team: ask-ai
status: provisional
metrics: [askai.entry_point_count, askai.refusal_correctness, askai.confirm_without_edit_rate, askai.allowlist_family_count]
updated: 2026-08-24
links: ["[[ask-ai-charter]]", "[[ask-ai-premortem]]", "[[ask-ai-agenda-board]]", "[[ask-ai-directive]]", "[[ask-ai-loops]]", "[[ask-ai-schedule]]", "[[product-vision-agenda-full]]", "[[inbound-understanding-charter]]", "[[surface-portfolio-charter]]", "[[ai-orchestration-charter]]", "[[FUTURES]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Ask AI — Action Composer — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

**Four artifacts, none of which is a composer.** The composer is built against them; writing
it first is how a product gets three chatbots and one audit trail added late.

| Artifact | Contents | Writable today? |
|---|---|---|
| **The typed allowlist** | One file. A closed set of action families, each with a typed schema, a role gate (`NEW-900`), and an execution target that is an **existing** backend path | **Yes** — against [[FUTURES]] §8.2 |
| **The refusal policy + test set** | What is refused, why, and the explanation given (`NEW-906`). A dangerous-intent corpus the gate is measured against | **Yes** |
| **The confirm-card contract** | Confirm / Edit / Discard, never free-text-only execute (`NEW-899`); idempotent confirm (`NEW-907`); discarded proposals leave no phantom draft (`NEW-901`). **Shared with [[inbound-understanding-charter]]** | **Yes** |
| **The audit requirement** | Proposed-vs-confirmed history per restaurant (`NEW-902`), shipped **with** the first executing action | **Yes** |

Plus one structural number to move: **`askai.entry_point_count` — 4 today, target 1.**

| Entry point | Where |
|---|---|
| Reports AI pill + palette | `apps/web/src/components/reports/organisms/AICommandPalette.tsx:191`, used at `Reports.tsx:29,959` |
| Wine Agent FAB | `apps/mobile/src/guidance/WineAgentFab.tsx` |
| Sommelier chat | `apps/web/src/pages/SommelierAI.tsx`, `/sommelier` (`App.tsx:292`) |
| Placeholder routes | `/wine-agent`, `/wineagent` (`App.tsx:293-294`) |

📋 Note the correction carried in [[ask-ai-charter]]: `apps/web/src/components/command/` is
the **deterministic §A command palette**, a sibling to unify *with*, not a fourth chatbot to
absorb.

## How

**Schema first, composer second, chat never.**

- **Write the allowlist before the composer.** The composer is built against the schema; the
  order matters because a composer built first defines the schema by accident.
- **Start deliberately small and navigation-heavy.** `NEW-897` — *"where do I set par?"* →
  deep-link + short coach, **no mutation** — is the one family that is useful on day one and
  cannot corrupt anything. It is also the family that directly serves the stated purpose:
  easing complexity as the surface grows.
- **Log intents before building actions.** The cheapest useful version of this team is an
  entry point that captures what people ask for and refuses everything. That turns
  [[FUTURES]] §8.2's plausible-but-guessed families into an observed distribution
  ([[ask-ai-premortem]] M5). `recommendation_actions` = 0 rows today; nobody has ever acted
  on a recommendation, so the workflow assumptions are untested.
- **Refusals are logged NF-A events from line one.** A refusal that produces no row makes
  `askai.refusal_correctness` permanently unmeasurable (M2).
- **Migrate entry points incrementally behind the schema** rather than in one migration
  nobody schedules. Each existing surface calls the shared schema and keeps its own
  affordance.
- **Every interaction terminates in a card.** Action cards, not walls of text
  ([[FUTURES]] §8.3). This is the practical mechanism that keeps the composer from becoming
  a chat surface and eroding [[AGENT_NATIVE_UI_DECISION]] §3 by increment.
- **Share the confirm primitive with [[inbound-understanding-charter]]** —
  `apps/api-gateway/src/one-tap-actions/` already exists and is already the house pattern.

## Why now

- **The contract is written and the entry points are already diverging.** Four surfaces
  exist; [[FUTURES]] §8.3 requires one schema. Every month adds surface to unify later.
- **The schema costs nothing to write and gates everything downstream.** It is writable
  today against [[FUTURES]] §8 and the 25 specified paths at
  `UX_PATHS_CATALOG.md:1803-1830` (`NEW-886…NEW-910`).
- **Two placeholder routes are sitting there.** `/wine-agent` and `/wineagent` render the
  same placeholder. [[surface-portfolio-charter]] needs to know which slug survives, and this
  team owns what eventually lives there.
- **The one non-negotiable is easiest to protect before anything executes.** Writing the
  refusal policy now is cheap; retrofitting it onto seven shipped action families is not
  ([[ask-ai-premortem]] M1).
- **`NEW-902` deferred is the audit gap.** An audit trail added later cannot audit the
  period before it existed — and that is exactly the period a post-incident investigation
  would need.

## Next steps

- [ ] Write the typed allowlist file — closed set, role gates, existing execution targets ·
      [[ask-ai-directive]]
- [ ] Write the refusal policy and build the dangerous-intent test set (`NEW-906`)
- [ ] Define refusals as first-class logged NF-A events · [[ask-ai-loops]]
- [ ] Agree **one** confirm-card contract jointly with [[inbound-understanding-charter]] —
      one card, two callers
- [ ] Stand up intent logging behind the existing entry points; refuse everything ·
      [[ask-ai-schedule]]
- [ ] Stand up the weekly entry-point drift check (target: no 5th surface)
- [ ] Publish `askai.entry_point_count` = 4 as a committed baseline, with a target of 1
- [ ] Decide `/wine-agent` vs `/wineagent` jointly with [[surface-portfolio-charter]]
- [ ] Carry the `teams/product.md:226` correction back — the Reports entry point is
      `components/reports/organisms/AICommandPalette.tsx`, not `components/command/`
- [ ] Specify `NEW-902` as ships-with, not ships-after
- [ ] Do **not** build the composer until the four artifacts exist. Listed as a non-action
      on purpose.

## Questions for the founder

1. **What is in the v0 allowlist?** [[FUTURES]] §8.2 lists inventory transfers and waste
   logs in MVP; §8.4 defers "full inventory transfers". The two do not agree. The answer
   determines whether `askai.refusal_correctness` gates stock and money from day one, or
   only billing and permissions.
2. **Is navigation-only an acceptable v0?** `NEW-897` (deep-link + coach, no mutation) is
   useful immediately, serves the stated complexity-easing purpose, and cannot corrupt
   anything. It is also much less impressive in a demo.
3. **Does `/sommelier` get absorbed, kept, or killed?** It is a chat UI today. Absorbing it
   into the composer is the [[FUTURES]] §8.3 answer; keeping it is a standing exception to
   the one-schema rule; killing it is a [[surface-portfolio-charter]] verdict. Three
   different products.
4. **Is a chat-like follow-up turn allowed?** `NEW-905` (multi-step: *"reorder X and email
   the provider"* → sequenced cards) is in the spec and is genuinely useful. It is also the
   thin end of the wedge toward the chat surface [[AGENT_NATIVE_UI_DECISION]] §3 rejected.
   Proposed rule: follow-up turns are allowed **only** when each produces a card. Confirm.
5. **Who owns the refusal explanation's wording?** *"I can't change billing"* is a product
   voice decision with real trust consequences. Us, or [[design-charter]]?
