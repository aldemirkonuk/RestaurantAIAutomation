---
type: agent-stack
division: product
department: product-vision
team: ask-ai
status: designed
updated: 2026-08-27
metrics: [askai.confirm_without_edit_rate, askai.refusal_correctness, askai.entry_point_count, askai.allowlist_family_count, nf_a.doneability_verdict]
links: ["[[ask-ai-charter]]", "[[ask-ai-schedule]]", "[[ask-ai-loops]]", "[[ask-ai-premortem]]", "[[0034-agent-stack-artifact]]", "[[product-vision-agent-stack]]", "[[action-safety-the-human-gate-agent-stack]]", "[[0029-p3-plan-of-record]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[FUTURES]]"]
---

# Ask AI — Action Composer — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> **And gated.** Ask AI is **P3.C, behind the P3.0 doneability-coverage gate**
> ([[0029-p3-plan-of-record]] §2) — the first feature that *creates actions* rather than
> text, and an action-creating agent whose success signal is "HTTP 200" is this repo's
> signature defect promoted to a product surface. Nothing here composes or executes an action
> while that gate is open. Mechanisms stay elsewhere: the mutation gate →
> [[action-safety-the-human-gate-charter]], harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[model-routing-inference-economics-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `askai-schema-warden` | Keep the entry-point count and the allowlist honest — count every divergent AI surface, fail any allowlist diff arriving without a refusal test and an audit row — and compose nothing until P3.0 closes | NEW, and **gated**: pre-gate scope is read-and-report only ([[0029-p3-plan-of-record]] §2) |

One row, and deliberately a *warden* rather than a composer: the team's deliverable is a
**schema and a refusal policy, not a screen** (charter §Mandate), and an agent that proposed
actions here would be the composer, built before its gate.

## 2. Agent cards

```yaml
agent: askai-schema-warden
unit: ask-ai
triggers:
  - schedule: "weekly — entry-point drift check"        # mirrored in [[ask-ai-schedule]]; runs today
  - schedule: "quarterly — settled-decision integrity check"
  - topic: allowlist.diff_opened                        # publisher: NONE (gap — no allowlist file exists yet; today the trigger is PR review)
  - schedule: "weekly — refusal-set run"                # ⏸ inert until the refusal corpus exists
consumes:
  - "apps/web/src/App.tsx route table + the four live entry points (AICommandPalette.tsx:191, Reports.tsx:29,959, WineAgentFab.tsx, SommelierAI.tsx) — disk census, EXISTS"
  - "[[FUTURES]]:203-245 §8.1-8.4 and UX_PATHS_CATALOG.md:1803-1830 §AC (NEW-886…NEW-910, 25 paths) — grep targets, CLAUDE.md §2"
  - "the typed allowlist file and the refusal corpus — publisher: NONE (gap; neither exists)"
  - "the route verdicts for /wine-agent, /wineagent, /sommelier — publisher: [[surface-portfolio-agent-stack]] (gap: the verdict sheet does not exist yet)"
emits:
  - "askai.entry_point_count (4 today, target 1) and askai.allowlist_family_count → [[product-vision-agent-stack|pv-orchestrator]]'s board row"
  - "askai.families_added_without_refusal_test + client-side-confirm findings → the PR check on the offending diff"
  - "askai.chat_surface_proposals → [[product-vision-agent-stack|pv-orchestrator]]'s quarterly settled-decision check"
  - "unconfirmed-mutation surface findings → [[action-safety-the-human-gate-agent-stack|gate-auditor]]"
  - "nf_a events (task_type: askai_surface_audit)"
routing_class: extraction        # grep the surfaces, diff the list, count. Whether a refusal was *correct* is graded by the corpus, not by this agent's opinion
quality_bar: "askai.refusal_correctness is published beside askai.confirm_without_edit_rate or neither is published (charter §Metrics) — a rising confirm rate next to a shrinking refusal set is the product getting more dangerous. Verdict basis: NONE (gap) until P3.0; P3.C's own closing claim is 'no Ask AI action can execute without a recorded human confirm' ([[0029-p3-plan-of-record]] §5)"
autonomy:
  read: autonomous
  propose: autonomous            # counts, diff verdicts, and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant, and doubly load-bearing here — see the hard rules
memory: ask-ai
escalates_to: "[[product-vision-charter]]; a supersede request against [[AGENT_NATIVE_UI_DECISION]] §3 goes to [[decision-office-charter]], never resolved in-team"
```

**Three hard rules the card carries in its own right.**

1. **The gate.** Anything that composes, proposes, or executes an allowlisted action is inert
   until P3.0's closing claim lands (`nf_a_verdict_coverage > 0` for every non-exempt gateway
   task type, [[0029-p3-plan-of-record]] §5). Scaffolding the composer "just to start" is
   that ADR's own premortem #3 — *the gate quietly walked around*.
2. **No auto-execute at any confidence.** [[FUTURES]] §8.1 is non-negotiable. This agent
   grades the list; it never runs an item on it.
3. **No conversation tooling.** [[AGENT_NATIVE_UI_DECISION]] §3 is a **don't build** verdict;
   threads and follow-up turns are not built here, because making cardless turns cheap is how
   it erodes by increment ([[ask-ai-premortem]] M4).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `ai-entry-point-scan` | T3 | Weekly, or any diff under `apps/web/src/components/`, `apps/mobile/src/` | Lists every AI entry surface and whether it calls the shared schema; a surface that does not is named with its file | Four divergent entry points exist today and the division doc undercounted them at three, misciting the Reports pill's location (`teams/product.md:226`) — nothing was watching | NEW |
| `action-allowlist-review` | T2 | Any diff touching the allowlist file, or a new AI entry surface appearing | The diff carries a typed schema, a refusal test, and an audit row; families touching stock / money / outbound vendor email escalate rather than being approved | `/wine-agent` and `/wineagent` shipped as two duplicate placeholder routes (`apps/web/src/App.tsx:293-294`, `:349`) — AI-surface divergence already happened once, unnoticed, with no gate | NEW |
| `refusal-set-run` | T2 | Weekly, and before any allowlist change ships | Dangerous-intent corpus run against the live policy; `askai.refusal_correctness` published **beside** confirm rate, never alone | `NEW-906` (dangerous intents refused *with explanation*) has been specified since `UX_PATHS_CATALOG.md:1803-1830` was written, with no test, no corpus, and no owner | NEW (⏸ gated — no corpus) |
| `intent-log-digest` | T2 | Monthly | Top intents, top refusals, top unserved intents — each unserved intent naming the restaurant that asked | `recommendation_actions` = **0 rows**: nobody has ever acted on a recommendation, so every workflow assumption behind [[FUTURES]] §8.2's seven families is currently a guess | NEW |

Consumed, owned elsewhere: gate metrics and the mutation sweep
([[action-safety-the-human-gate-agent-stack]]); the runtime reaching the schema
([[ai-orchestration-charter]]); the route verdicts ([[surface-portfolio-agent-stack]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate still applying.
- **Episodic** — nf_a `task_type: askai_surface_audit` today; post-gate, every proposal is a
  complete NF-A event (intent → family selected and alternatives → confirm/edit/discard →
  outcome). Needs `context.action_family` as a jsonb key, and **a refusal must be emitted as
  an event** — counting refusals as absences is how `askai.refusal_correctness` quietly
  becomes unmeasurable (charter §Metrics).
- **Semantic** — `memory/` beside this file, index `ask-ai-MEMORY.md`. First facts: the four
  entry points and which is a mock ([[ROADMAP]]:677 calls the Reports palette one); the
  deterministic §A palette under `apps/web/src/components/command/` is a **sibling to unify
  with, not a chatbot to absorb**; the allowlist family list per close-time, so growth is
  diffable. `source`, `confidence`, `last_verified` per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, and [[FUTURES]] §8.1-8.3 verbatim: small enough
  to preload, load-bearing enough to always have. The 25 catalogue paths are retrieved by
  line range.

**Consolidation** — monthly, mirrored in [[ask-ai-schedule]]: read the audit slice,
**failures first** — each new entry point becomes a fact naming *why adding was cheaper than
unifying* ([[ask-ai-premortem]] M3), and each family added without a refusal test a fact
naming the convenience behind it (M1); expire facts unverified for 90 days; propose skill
candidates. One PR; "no delta" stated when true.

## 5. Async contract

Board rows, PR checks, supersede requests, memory PRs, NF-A events; loops with close_times in [[ask-ai-loops]] (L3 is `status: blocked`, and says so). Gap rows:

| Gap | Why it is a gap |
|---|---|
| No allowlist file and no server module | **0 of 44** `apps/api-gateway/src/` directories is an ask/assistant/action module and [[ENDPOINTS]] lists no ask route — so `allowlist.diff_opened` has no publisher and the composer is a contract with nothing behind it |
| No refusal corpus → `askai.refusal_correctness` unmeasured | The gate metric has no producer. It reads **unmeasured**, never 0 or 100% — a refusal set that does not exist cannot be passed |
| `askai.confirm_without_edit_rate` has no producer | Nothing executes, so there is nothing to confirm. It stands up **with** the first non-mutating family after the gate, not before |
| The audit-integrity check will read `0, 0, 0` indefinitely | And must **not** be deleted for it: a guard reading zero because nothing has gone wrong is working, unlike a report reading zero because nothing is happening ([[ask-ai-schedule]] anti-sprawl) |

## 6. Evidence today

- **PARTIAL — the contract.** [[FUTURES]]:203-245 §8 and 25 paths
  (`UX_PATHS_CATALOG.md:1803-1830`, `NEW-886…NEW-910`) are written; `.planning/ROADMAP.md:677`
  has Phase 999.5 in BACKLOG with **0 plans**.
- **EXISTS — the divergence, and the confirm primitive.** `AICommandPalette.tsx:191` (used
  only at `Reports.tsx:29,959`), `WineAgentFab.tsx`, `SommelierAI.tsx` (`App.tsx:292`), the
  `/wine-agent` + `/wineagent` pair (`:293-294`); plus `apps/api-gateway/src/one-tap-actions/`.
- **NEW — the warden, all four skills, the allowlist, the refusal corpus, the audit trail,
  and every `askai.*` number except `entry_point_count`.**
- **GATED — the composer itself** (P3.C behind P3.0, [[0029-p3-plan-of-record]]): this page
  describes what may be measured meanwhile, and explicitly not what may be built.
