---
type: charter
division: applied-ai
department: ai-orchestration
team: action-safety-the-human-gate
status: partial
metrics: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
updated: 2026-08-24
links: ["[[action-safety-the-human-gate-premortem]]", "[[action-safety-the-human-gate-agenda-full]]", "[[action-safety-the-human-gate-agenda-board]]", "[[action-safety-the-human-gate-directive]]", "[[action-safety-the-human-gate-loops]]", "[[action-safety-the-human-gate-schedule]]", "[[ai-orchestration-charter]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[agent-evaluation-gates-charter]]", "[[compliance-and-privacy-charter]]", "[[product-and-vision-charter]]", "[[technology]]", "[[README]]"]
---

# Action Safety & the Human Gate — Charter

Team of [[ai-orchestration-charter]] · Division: **Applied AI** · Alias in the team
corpus: `[[aio-action-safety]]` (`technology.md:425`).

## Mandate

The boundary between **propose** and **execute**: the
`ask → propose → confirm → execute` action schema, the typed allowlist, per-action
autonomy tiers, and the guarantee that **stock, money and outbound email are never
mutated without a human tap**.

The principle is `.planning/FUTURES.md` §8.1, verbatim:

> **Ask → propose → confirm → execute.** AI never silently mutates stock, money, or
> outbound vendor email. Confirmation is the gate; existing services are the executors.

**Distinct from siblings because every sibling asks "did it work"; this team asks "was
it allowed to run at all".** Folding it into [[harness-runtime-charter]] would put the
same team in charge of executing actions and of deciding whether execution is
permitted (`technology.md:431-433`).

## Boundaries

Owns outright:

- **The action schema** — one typed, allowlisted shape behind every entry point
  ([[README]] §5.1, `FUTURES.md` §8.1). *"One action schema behind all entry points,
  not three chatbots."*
- **The allowlist** — the action families of `FUTURES.md` §8.2 (procurement,
  inventory, communications, calendar/ops, catalog/menu, insights→act, navigation
  assist) and what is gated harder: *"mass deletes, changing billing, granting
  permissions, sending email without draft review, guest PII exports."*
- **Per-action autonomy tiers** — which families may auto-propose, which require a tap,
  which are role-restricted (*"staff see a smaller allowlist than owners/managers"*).
- **The audit trail of confirmation** — that `executed_by` and `executed_at` exist,
  are real, and mean something.
- **The behavioural integrity of the gate.** Not only that a confirmation was recorded,
  but that a **decision** happened. See §Metrics.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| Executing the action | [[engineering-charter]] | *"Existing services are the executors"* (`FUTURES.md` §8.1). We gate; they execute |
| Lifecycle, retry, DLQ | [[harness-runtime-charter]] | Deliberately separate — see mandate |
| What an agent proposes | [[agent-fleet-charter]] | We own whether it may run, not what it says |
| Whether the proposal was *good* | [[agent-evaluation-gates-charter]] | Permitted ≠ correct. A bad proposal that is correctly gated is their finding, not ours |
| Endpoint authentication | [[security-charter]] + `[[eng-platform-api]]` | Who you are vs. what you may mutate. Both matter; they are different gates |
| The UX of the confirmation surface | [[design-charter]] *(Product)* | **Contested — see below** |
| Data-protection law on guest PII | [[compliance-and-privacy-charter]] | We enforce the allowlist; they say what belongs on it |

### The seam with Design, named rather than assumed

`FUTURES.md` §8.3 specifies *"action cards, not walls of text… intent summary, fields
to edit, Confirm / Edit / Discard"*. That is a UX specification with a **safety
consequence**: a confirmation surface optimised purely for speed produces
[[action-safety-the-human-gate-premortem]] #1, and a surface optimised purely for
caution produces a gate people route around.

This team's position: **Design owns the surface; this team owns the friction floor on
the families that mutate money and stock.** Those are different decisions and both
need an owner. Raised in [[action-safety-the-human-gate-agenda-full]] §Questions.

## Metrics it moves

| Metric | Definition | Nature |
|---|---|---|
| **`safety.unconfirmed_mutation_count`** | Any agent-initiated write to stock, money, or an outbound channel with no recorded human confirmation | **Target hard zero.** Any non-zero is a *reportable incident, not a bug* (`technology.md:443-445`) |
| `safety.median_time_to_confirm` | Seconds between an action appearing and `executed_at` | **A trend line, and the real subject of this team** |
| `safety.rejection_rate` | Share of proposals edited or discarded rather than confirmed | A gate that never rejects anything is not gating |
| `safety.schema_coverage` | Share of mutation entry points behind the single action schema | Today: **partial** — four conventions, not one mechanism |

**The second and third metrics are why this team is not just a lint rule.** Counting
unconfirmed mutations is easy and will read zero almost always. Whether the
confirmations that *did* happen were **decisions** is the hard question, and it is the
one [[action-safety-the-human-gate-premortem]] #1 is about.

## Evidence today

**EXISTS as a pattern, NEW as a single enforced schema** (`technology.md:435`).

**EXISTS — the one-tap action center.**
`apps/api-gateway/src/one-tap-actions/` — 9 routes, `@UseGuards(JwtAuthGuard)` at the
controller (`one-tap-actions.controller.ts:64`), including `@Post(":actionId/execute")`
(`:214`) and `@Post(":actionId/cancel")` (`:246`).
`one-tap-actions.service.ts:230` `executeAction`, writing `executed_at` and
`executed_by` (`:245-246`) and emitting an `action_executed` event (`:267`).
**The timestamps needed for `median_time_to_confirm` already exist** — the measurement
is a query, not a feature.

**EXISTS — tiered autonomy, already implemented once.**
`agents/drift_agent.py:8-12`:
> *"Safe / auto-healable → `pos_catalog_match_proposals`… **Money / stock →
> `drift_findings` with status `open` (never auto-applied).**"*

And `:17`: *"Every run and every finding writes a `decision_log` row."* This is the
pattern the schema should generalise, not replace.

**EXISTS — governance tiers.** `services/governance.py:20 GovernanceTier`
(`CANONICAL` → `UNRESOLVED`), `:227 compute_overall_confidence`.

**EXISTS — vendor-reply AI drafts but never auto-sends** (project memory:
*autonomous-email-replies* — one-tap approve, never auto-send, 4 guardrails).

**EXISTS — the UX optimizer is human-gated and never auto-applies**
(`apps/api-gateway/src/ux-optimizer/`; project memory: *recommendations-actions-ux-optimizer*).

**NEW — the single schema.** `technology.md:441`: *"Today the guarantee is upheld by
**four independent conventions, not one mechanism**."* That is the founding finding.
Four conventions each hold today and each can be forgotten independently by the next
feature that writes to stock.

### The gap verified this session

`agents/recurring_order_agent.py:14` is a plain class — no `BaseAgent`, registered
nowhere, referenced by nothing but its own test — and its own docstring lists
**"Auto-execution with manager approval"** among its features, alongside
*"Daily checks for due orders"* and *"2-day advance notifications"*.

A scheduled purchaser with an auto-execution path, outside the harness contract and
outside the one-tap action center, is the single clearest instance of the thing this
team exists to prevent. It is named in [[harness-runtime-charter]] as a harness gap and
here as a gate question, deliberately — it is both, and neither team alone would fix
it.

## Status

`partial` — a real pattern, implemented four times, enforced once nowhere.
