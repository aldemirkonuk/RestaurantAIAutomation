---
type: schedule
division: product
department: product-vision
team: ask-ai
status: provisional
metrics: [askai.entry_point_count, askai.refusal_correctness, askai.allowlist_family_count]
updated: 2026-08-24
links: ["[[ask-ai-charter]]", "[[ask-ai-loops]]", "[[ask-ai-agenda-board]]", "[[product-vision-schedule]]", "[[inbound-understanding-schedule]]", "[[security-charter]]", "[[red-team-charter]]"]
---

# Ask AI — Action Composer — Schedule & Skills

## Recurring work

Three jobs run **today, without a composer**. That is the team's whole operating premise:
the schema, the entry-point count, and the intent distribution are all measurable before a
single action executes.

| Cadence | Job | Emits | State |
|---|---|---|---|
| **Weekly** | **Entry-point drift check** — grep for any AI entry surface not calling the shared action schema. Today: 4 divergent (`AICommandPalette.tsx:191`, `WineAgentFab.tsx`, `SommelierAI.tsx`, `/wine-agent`+`/wineagent`). A 5th is [[ask-ai-premortem]] M3. | `askai.entry_point_count` | **Running** |
| **Weekly** | **Allowlist diff review (CI)** — any change to the allowlist file arrives with a typed schema, a refusal test, and an audit row, or it fails. Also flags any confirm gate found enforced client-side. | `askai.families_added_without_refusal_test`, `askai.client_side_confirm_findings` | **Running** once the file exists (target: this close-time) |
| **Monthly** | **Intent observation** — what people actually asked for, what was refused, and the top unserved intents. Converts [[FUTURES]] §8.2's guessed families into an observed distribution. | `askai.intents_logged`, `askai.top_unserved_intents` | **Running** once intent logging is behind the existing entry points |
| Weekly | **Refusal-set run** — the dangerous-intent corpus against the live policy; correctness published beside confirm rate or neither is published | `askai.refusal_correctness` | ⏸ **Suspended** — unblocked by the refusal test set |
| Weekly | **Confirm-quality read** — confirm-without-edit, discard rate, and which fields users always edit | `askai.confirm_without_edit_rate` | ⏸ **Suspended** — unblocked by a first non-mutating family shipping |
| Weekly | **Audit-integrity check** — executed actions with no audit row, idempotency violations, phantom drafts. All three must be 0. | `askai.executed_actions_without_audit_row` | ⏸ **Suspended** — trivially 0 until something executes; stands up **with** the first executing action, not after |
| **Quarterly** | **Settled-decision integrity check** — proposals whose value is conversational continuity rather than a completed action. Non-zero is a supersede-ADR request against [[AGENT_NATIVE_UI_DECISION]] §3, not a violation. | `askai.chat_surface_proposals` | **Running** |

**Anti-sprawl rule:** a scheduled job producing no action for **3 consecutive runs** is
downgraded or deleted. The honest exception is the audit-integrity check: it will read `0, 0,
0` indefinitely and must **not** be deleted for it — a guard that reads zero because nothing
has gone wrong is doing its job, unlike a report that reads zero because nothing is
happening. That distinction is written here because the anti-sprawl rule, applied
mechanically, would delete exactly the wrong job.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion. Per
foundation §3.3 each names a trigger, doneability criteria, a **real past instance**, and an
owner — no speculative skills. The repo has exactly one project skill today
(`.agents/skills/railway-config/SKILL.md`), so everything below is **proposed, not built**.

| Skill (proposed) | Tier | Trigger | Doneability | Past instance that justifies it |
|---|---|---|---|---|
| `action-allowlist-review` | T2 | Any diff touching the allowlist file, or a new AI entry surface appearing | The diff carries a typed schema, a refusal test, and an audit row; families touching stock / money / outbound vendor email are escalated rather than approved | `/wine-agent` and `/wineagent` shipped as two duplicate placeholder routes (`App.tsx:293-294`) — AI-surface divergence already happened once, unnoticed, with no gate |
| `ai-entry-point-scan` | T3 | Weekly, or on any diff under `apps/web/src/components/`, `apps/mobile/src/` | Lists every AI entry surface and whether it calls the shared schema; a surface that does not is named with its file | Four divergent entry points exist today and the division doc undercounted them at three, misciting the Reports pill's location (`teams/product.md:226`) — nothing was watching |
| `refusal-set-run` | T2 | Weekly, and before any allowlist change ships | Dangerous-intent corpus executed against the live policy; `askai.refusal_correctness` published **beside** confirm rate, never alone | `NEW-906` (dangerous intents refused with explanation) has been specified since the catalogue was written and has no test, no corpus, and no owner |
| `intent-log-digest` | T2 | Monthly | Top intents, top refusals, top unserved intents — each unserved intent naming the restaurant that asked | `recommendation_actions` = **0 rows**: nobody has ever acted on a recommendation, so every workflow assumption behind [[FUTURES]] §8.2's seven families is currently a guess |

**Deliberately not proposed:**

- **No auto-execute skill at any confidence level.** [[FUTURES]] §8.1's non-negotiable and
  [[ask-ai-directive]]'s closed-set rule both forbid it. A skill is not the place to
  relitigate a locked decision.
- **No conversation-management skill** (threads, context carry-over, follow-up turns).
  Building that tooling would make the chat surface [[AGENT_NATIVE_UI_DECISION]] §3 rejected
  cheap to arrive at by accident — the card-termination rule is what keeps that verdict
  intact, and a skill that eases cardless turns would quietly undo it.
