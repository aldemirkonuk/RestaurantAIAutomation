---
type: charter
division: product
department: product-vision
team: ask-ai
status: partial
metrics: [askai.confirm_without_edit_rate, askai.refusal_correctness, askai.entry_point_count, askai.allowlist_family_count, nf_a.doneability_verdict]
updated: 2026-08-24
links: ["[[ask-ai-premortem]]", "[[ask-ai-agenda-full]]", "[[ask-ai-agenda-board]]", "[[ask-ai-directive]]", "[[ask-ai-loops]]", "[[ask-ai-schedule]]", "[[product-vision-charter]]", "[[inbound-understanding-charter]]", "[[surface-portfolio-charter]]", "[[ai-orchestration-charter]]", "[[design-charter]]", "[[security-charter]]", "[[FUTURES]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Ask AI — Action Composer — Charter

Parent: [[product-vision-charter]] (Product division). Siblings:
[[inbound-understanding-charter]], [[service-floor-charter]],
[[supply-discovery-charter]], [[surface-portfolio-charter]].

## Mandate

Own the **single typed, allowlisted action schema** behind every AI entry point in the
product: `ask → propose → confirm → execute` ([[FUTURES]] §8.1). The deliverable is a
**schema and a refusal policy**, not a screen — this is the one Product & Vision team whose
output is a contract other teams implement against.

The constraint that gives the team its shape, quoted from the design contract:

> **AI never silently mutates stock, money, or outbound vendor email.** Confirmation is the
> gate; existing services are the executors. ([[FUTURES]] §8.1)

## Boundaries

Owns outright:

- **The typed allowlist** — one file, one closed set of action families, CI-diffed. An
  intent outside it is *refused*, not attempted-and-caught.
- **The refusal policy** — what is refused, why, and what the user is told
  (`NEW-906`: dangerous intents refused **with explanation**).
- **The confirm-card contract** — Confirm / Edit fields / Discard; never free-text-only
  execute (`NEW-899`); idempotent confirm so a double-click does not create two orders
  (`NEW-907`).
- **The audit requirement** — proposed-vs-confirmed history per restaurant (`NEW-902`),
  shipped **with** the first executing action, not after it.
- **Entry-point unification** — Reports Ask AI pill, Wine Agent FAB, and contextual
  "ask about this page" behind **one** action schema. [[FUTURES]] §8.3 states the
  requirement plainly: *not three incompatible chatbots.*
- **Role gating** — staff see a smaller allowlist than owners/managers (`NEW-900`).

**Why this is distinct.** It is cross-module *by construction* — it composes actions
belonging to procurement, inventory, communications, and calendar. Housed inside any one
module team it becomes that module's chatbot, which is exactly the outcome
[[FUTURES]] §8.3 forbids (`teams/product.md:212-218`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Executing the action | The owning module + [[engineering-charter]] | We propose through **existing** backend paths; no shadow writes |
| The agent runtime, model routing, tool-calling | [[ai-orchestration-charter]] *(Applied AI)* | We own the schema and the refusal policy; they own how the model reaches it |
| The composer's visual design and motion | [[design-charter]] | Action cards, not walls of text, is our constraint; pixels are theirs |
| Human review of *machine* extraction | [[inbound-understanding-charter]] | Theirs: document arrives → propose. Ours: human intent → propose. **One shared confirm primitive** |
| Where Ask AI lives as a route | [[surface-portfolio-charter]] | `/wine-agent`, `/wineagent`, `/sommelier` are portfolio verdicts before they are our surface |
| Endpoint auth on whatever we call | [[security-charter]] / [[platform-api-charter]] | An allowlisted action calling an unguarded endpoint is their finding, our dependency |
| **A chat-surface rewrite of the app** | **Nobody — settled** | See below |

**The settled decision this team must not drift into.**
[[AGENT_NATIVE_UI_DECISION]] §3 reached a **"don't build"** verdict on the agent-native UI
rewrite, with a premortem and a statistical argument. *AI-native* here means **this action
composer plus agents behind existing surfaces** — not a chat surface, not adaptive per-user
layout (foundation [[README]]:237-253). Superseding that needs its own ADR. A team whose
mandate is "the AI entry point" is the single most likely place for that verdict to erode by
increment, so it is written into the charter rather than left to memory.

## Metrics it moves

**Primary — `askai.confirm_without_edit_rate`**: proposed action cards confirmed without the
user editing a field. High means the proposal understood the intent.

**Hard gate — `askai.refusal_correctness`**: dangerous intents correctly refused ÷ dangerous
intents attempted. This is **a gate, not an optimization target**, published beside the
primary every time. A rising confirm rate next to a shrinking refusal set is the product
getting more dangerous, not better.

**Structural counters, both currently wrong:**

- `askai.entry_point_count` — **4 today, target 1**
- `askai.allowlist_family_count` — target is *stable*, not growing. Growth is the premortem.

Neural-footprint tie: every proposal is a complete NF-A event —
`stimulus` (the user's intent) → `internal_state` (which action family was selected, what
alternatives were considered) → `choice` (confirm / edit / discard) → `outcome` +
`doneability verdict` (foundation [[README]] §4.4). A refusal is an NF-A event too, and
counting refusals as absences is how `askai.refusal_correctness` would quietly become
unmeasurable.

## Evidence today

**PARTIAL — the contract is written, the entry points exist and diverge, the composer does
not exist.**

**Written contract**
- [[FUTURES]]:203-245 §8 — principle (§8.1), allowlisted action families (§8.2),
  complexity-easing contract (§8.3), MVP vs north star (§8.4)
- `.planning/ROADMAP.md:677` — Phase 999.5, BACKLOG, **0 plans**
- **25 paths specified:** `UX_PATHS_CATALOG.md:1803-1830` §AC, `NEW-886…NEW-910` — including
  `NEW-903` (Wine Agent FAB and Ask AI share one action schema), `NEW-906` (dangerous
  intents refused with explanation), `NEW-907` (idempotent confirm), `NEW-902` (audit
  history), `NEW-899` (Confirm / Edit / Discard, never free-text-only execute),
  `NEW-900` (role-gated allowlist)

**Divergent entry points live today — verified this session, and the count is higher than
the team doc records**

| Entry point | Path | Note |
|---|---|---|
| Reports AI pill + palette | `apps/web/src/components/reports/organisms/AICommandPalette.tsx` (`AICommandPill` at `:191`) | Used only at `apps/web/src/pages/Reports.tsx:29,959` |
| Wine Agent FAB | `apps/mobile/src/guidance/WineAgentFab.tsx` | Mobile, separate |
| Sommelier chat | `apps/web/src/pages/SommelierAI.tsx`, route `/sommelier` (`apps/web/src/App.tsx:292`) | Free-text chat surface |
| Placeholder routes | `/wine-agent`, `/wineagent` — both `PlaceholderPage` (`App.tsx:293-294`, `:349`) | Two URLs, one placeholder |

📋 **Correction to `teams/product.md:226`:** it cites the Reports entry point as
`apps/web/src/components/command/`. That directory is a **different** surface — the
deterministic §A command palette (`CommandPalette.tsx`, `CommandProvider.tsx`,
`commands.ts`, `recents-store.ts`, `ShortcutsSheet.tsx`, `RecentlyViewed.tsx`). Ask AI has
**four** divergent AI entry points plus one adjacent deterministic palette, not three. The
deterministic palette is a *sibling to unify with*, not a chatbot to absorb.

**The confirm primitive exists**
- `apps/api-gateway/src/one-tap-actions/` — controller, service (+ spec), module, dto
- `recommendation_actions` — shipped P0 Recommendations act/dismiss/snooze/done/pin

**What does not exist**
- ⚠️ **No server module.** Of the 44 directories in `apps/api-gateway/src/`, none is an
  ask/assistant/action-composer module, and [[ENDPOINTS]] lists no ask route. The composer is
  a contract with nothing behind it.
- No allowlist file, no refusal test set, no audit trail.
- `SommelierAI.tsx` is a chat UI; [[ROADMAP]]:677 describes the Reports palette as a
  **mock**. Both are Q&A, not action composition.

## Entry condition

Active now, **as a schema**. Third in the department activation order
([[product-vision-agenda-full]]). The allowlist file and the refusal test set are writable
today against [[FUTURES]] §8 and the 25 specified paths — they should not wait for the
composer, because the composer is built *against* them.
