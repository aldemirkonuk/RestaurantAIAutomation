---
type: agent-stack
division: commercial
department: sales
team: design-partner-operations
status: designed
updated: 2026-08-27
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.design_partner_touch_streak, sales.time_to_first_connection, nf_b.source_count]
links: ["[[design-partner-operations-charter]]", "[[design-partner-operations-schedule]]", "[[design-partner-operations-loops]]", "[[design-partner-operations-premortem]]", "[[design-partner-operations-directive]]", "[[0034-agent-stack-artifact]]", "[[sales-agent-stack]]", "[[skills-charter]]", "[[action-safety-the-human-gate-charter]]", "[[pos-bridge-charter]]", "[[media-brand-charter]]", "[[analytics-bi-charter]]"]
---

# Design Partner Operations — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The team with the org's only real counterparty gets the most socially constrained card in
> the vault: **this agent never contacts the restaurant.** It prepares the touch, counts the
> blockers, and holds the requested-vs-landed line; the founder makes the contact. The
> relationship is the scarce resource ([[design-partner-operations-charter]] §The seam), and
> an agent spending it would be [[design-partner-operations-premortem]] M4 on a schedule.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `dpo-account-steward` | Keep four numbers about one account true — connection state, touch streak, blocker ages, and credits *landed* versus *requested* — without ever being the one who calls | NEW |

## 2. Agent cards

```yaml
agent: dpo-account-steward
unit: design-partner-operations
triggers:
  - schedule: "weekly (Mon) — connection check"                     # [[design-partner-operations-schedule]]
  - schedule: "weekly (Fri) — touch prep and blocker sweep"
  - schedule: "monthly — credit reconciliation, on the distributor's billing cycle, not ours"
  - topic: toast.first_real_data          # publisher: NONE (gap — nothing emits on a first successful getSalesData)
consumes:
  - ".planning/PROJECT.md:101 (DEP-06) and :127 (the account) — publisher: the founder, by hand"
  - "env.example:51-56 (TOAST_API_URL, CLIENT_ID, CLIENT_SECRET, RESTAURANT_GUID, WEBHOOK_SECRET, ENVIRONMENT)"
  - "apps/api-gateway/src/toast/toast.service.ts — read-only: is real data arriving for TOAST_RESTAURANT_GUID?"
  - "the account's invoices and open credit requests (procurement) — publisher: [[pos-bridge-charter]] / procurement, once connected"
  - "apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400,438 — blank-invoice-field rate"
  - "product analytics for unprompted sessions — publisher: NONE (gap — no analytics key in env.example, 187 lines)"
emits:
  - "the blocker queue, every row with an age and an owner → [[design-partner-operations-agenda-board]]"
  - "the requested/landed split → [[sales-agent-stack|sales-board-keeper]]"
  - "verified facts and quote candidates → [[media-brand-charter]] (facts only; never prose)"
  - "the landed-credit signal → [[outbound-engine-agent-stack|outbound-sentinel]]'s entry-trigger check"
  - "nf_a events (task_type: design_partner_touch, credit_reconcile, connection_check)"
routing_class: extraction
quality_bar: "a credit counts as landed only when the later invoice it landed on is named (`.planning/YC_WEDGE_PLAN.md:31-33`); a touch counts only with an observed usage moment or a named blocker; NONE (gap) — ADR 0017 has no grader for either"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm
memory: design-partner-operations
escalates_to: "[[sales-charter]]"
```

**The card's own hard rules.** It never sends the restaurant anything — no email, no
reminder, no survey; outbound to a human counterparty is behind the tap in FUTURES §8.1
(`.planning/FUTURES.md:211`) and here it is behind the founder as well. It never edits
`apps/api-gateway/src/toast/` — a broken adapter is filed to [[pos-bridge-charter]], not
fixed ([[design-partner-operations-charter]] §Non-goals). It never marks a credit landed
from a request, and it never writes a sentence about the customer for publication.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `credit-memo-reconcile` | T2 | A new design-partner invoice arrives with prior credit requests outstanding | Every open request marked *landed* (naming the invoice) or *outstanding*; the two counters updated separately, never summed | The confusion is documented in this repo's own analysis: `.planning/YC_WEDGE_PLAN.md:31-33` — until an X12 812 memo lands, "dollars recovered" means *"we asked"* | NEW |
| `toast-connection-verify` | T3 | After any Toast credential change | One live `getSalesData` call returns real rows for `TOAST_RESTAURANT_GUID`, or it fails loudly — "configured" may never resolve to "connected" | The read-side half was run by hand on 2026-08-24 and corrected [[commercial]] §3 upward: the blocker is five environment variables and a conversation, not an integration project (`env.example:51-56`; [[design-partner-operations-charter]] §Evidence). The live-call half has never run — stated rather than implied | NEW |

Two rows, not four. [[design-partner-operations-schedule]] also lists `design-partner-weekly`
and `blocker-age-sweep`; neither can cite a past instance — no cadence has ever existed to
decay, no blocker queue has ever held an age — so README §3.3 deletes them here rather than
parking them. Both become authorable the first week either job actually runs.

Consumed, owned elsewhere: `claim-provenance-check` ([[sales-agent-stack]]); the recovery
number's definition ([[analytics-bi-charter]]); invoice parsing and matching (Engineering /
Data, T1 per [[README]] §3.2).

## 4. Memory

- **Procedural** — the §3 skills; consolidation candidates go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: design_partner_touch`, `credit_reconcile`,
  `connection_check`. Needs `context.blocker_id` so a blocker's whole life is one filter,
  and `context.credit_request_id` so a request and the invoice that settled it join without
  a query this team has to invent.
- **Semantic** — `memory/` beside this file, index
  `design-partner-operations-MEMORY.md`. Its first files are already known: the account
  (`.planning/PROJECT.md:127`), DEP-06's open date (`:101`), the landed-versus-asked rule
  (`.planning/YC_WEDGE_PLAN.md:31-33`), and the patience budget — how many substantive asks
  the account absorbed in a week and from which units. Frontmatter `source` / `confidence` /
  `last_verified` per ADR 0034; every write is a PR, which is what makes an agent's read of
  a friendship reviewable by a person.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics, the open blocker
  rows. The 33KB `toast.service.ts` is a grep target (CLAUDE.md §2).

**Consolidation** — monthly, after the credit reconciliation so the month's hardest fact is
fresh. **Failures first:** a broken streak becomes a fact naming the mechanism ("the week
the ask was made and nothing was observed"), never "streak dipped"; a credit that aged past
a billing cycle becomes a fact about the distributor's cycle, not about our patience. Expire
facts unverified for 90 days; propose candidates — `design-partner-weekly` re-enters §3 the
month it has an instance. One PR; "no delta" stated.
[[design-partner-operations-schedule]] does not carry this row yet: wave 2 may not edit the
eight existing artifacts (GENERATION_BRIEF §7.3), so the mirror is a named follow-up.

## 5. Async contract

Cross-unit interaction is loops ([[design-partner-operations-loops]] `dpo-connection-countdown`
… `dpo-patience-budget`), NF-A events, vault PRs, and skill candidates — never a synchronous
call, and never a call to the restaurant. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `toast.first_real_data` has no publisher | Nothing emits when data first arrives; credentials that are set but wrong produce an empty dashboard, which is indistinguishable from a quiet restaurant ([[design-partner-operations-schedule]]) |
| The unprompted-session signal has no producer | `env.example` (187 lines) has no analytics key; Sentry is the only telemetry SDK (`.planning/foundation/EXTERNAL_CONNECTIONS.md`). L3 — the loop the charter calls the one that decides the outcome — cannot close until [[analytics-bi-charter]] ships one event |
| The invoice half has no machine producer | `overbilled_vs_ship` needs a machine-read invoice; today it is typed by hand per line item (`ReceivingWorkspace.tsx:400,438`). This team owns the escalation, not the pipeline — so its primary metric sits behind someone else's queue |
| The patience ledger has no publisher but this team | Other units' asks on the account arrive as messages to a person, not as events; until [[customer-relationship-research-charter]] books through this team as a written step, `dpo.asks_per_week` is self-reported |

## 6. Evidence today

- **NEW — the steward and both skills.** No cadence, no blocker queue, no reconciliation has
  ever run ([[design-partner-operations-charter]] §Evidence). The 2026-08-24 generation
  session is the one real past instance either skill can cite, and it is cited as what it
  was: a read, not a call.
- **EXISTS — everything the steward would read.** The account (`.planning/PROJECT.md:127`),
  the connector (`apps/api-gateway/src/toast/`), the config placeholders
  (`env.example:51-56`), the match (`invoice-match.ts`, 406 lines), the receiving inputs
  (`ReceivingWorkspace.tsx:400,438` — verified live 2026-08-27; `commercial.md:365-368` says
  `:401,:440` and is stale).
- **NEW — the connection itself.** `DEP-06` is unchecked (`.planning/PROJECT.md:101`), and
  every number on this card is zero or unmeasurable until it is not.
- **PARTIAL — the episodic substrate.** NF-A tables exist (ADR 0006/0008); this team emits
  nothing into them yet.
