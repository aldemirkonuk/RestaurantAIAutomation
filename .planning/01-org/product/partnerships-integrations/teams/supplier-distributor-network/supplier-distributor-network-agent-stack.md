---
type: agent-stack
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: designed
updated: 2026-08-27
metrics: [pi.live_counterparties]
links: ["[[supplier-distributor-network-charter]]", "[[supplier-distributor-network-schedule]]", "[[supplier-distributor-network-loops]]", "[[supplier-distributor-network-directive]]", "[[0034-agent-stack-artifact]]", "[[partnerships-integrations-agent-stack]]", "[[design-partner-operations-charter]]", "[[skills-charter]]"]
---

# Supplier & Distributor Network — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team carries **two open boundary forks at once** — PROD-F2 and CM-F3 — so its card is
> written to make a blocker's true owner visible rather than to work around it. Neither fork
> is resolved here. Harness → [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], the outbound gate →
> [[action-safety-the-human-gate-charter]] (FUTURES §8.1).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `counterparty-liveness-keeper` | Give every distributor a current state with a date — **live / stale / lapsed**, and separately *dormant* vs *empty* for its feed — and log every blocker whose true owner is another unit | NEW |

One row. The outbound half of a supplier relationship — the drafted vendor reply threaded
through `procurement_conversations`, one-tap approve, **never auto-send** — is real and
shipped, but it is chartered elsewhere (charter §Non-goals 4). This stack consumes it and
does not claim it.

## 2. Agent cards

```yaml
agent: counterparty-liveness-keeper
unit: supplier-distributor-network
triggers:
  - schedule: "daily — feed freshness sweep"          # [[supplier-distributor-network-schedule]]
  - schedule: "weekly — counterparty liveness + declined-work log review"
  - schedule: "monthly — boundary pressure (CM-F3, PROD-F2 days-since-touched)"
  - topic: vendor.page_created                        # publisher: NONE (gap — both vendor-portal routes are @Get (vendor-portal.controller.ts:20-21, 39-40); nothing emits on page creation)
consumes:
  - "provider_promotions — via provider-intelligence.service.ts:135, :159, :179, :197, :222, :414 (six reads against a dormant table)"
  - "procurement_orders (= 1) and the vendor pages surfaced at /v/:slug (PAGE_MAP.md:55, 129)"
  - "distributor-discovery outputs — shared with [[supply-discovery-charter]] pending PROD-F2"
emits:
  - "pi.live_counterparties → [[partnerships-integrations-agent-stack|pi-bridge-board]]"
  - "counterparty state transitions → NO STORE (gap — no state model exists; today the emit has nowhere to land)"
  - "publish-state findings → [[supplier-distributor-network-questions]]"
  - "pre-seam blockers → [[design-partner-operations-charter]], recorded and handed off, never shadow-worked"
  - "nf_a events (task_type: feed_freshness_sweep)"
routing_class: extraction    # comparing refresh timestamps to cadences and classifying the result
quality_bar: "dormant, empty and stale come back as three distinct states — the code today cannot tell them apart, since all six provider_promotions reads return nothing gracefully. NONE (gap): no verdict basis, and pi.live_counterparties = 0 so nothing has ever been graded"
autonomy:
  read: autonomous
  propose: autonomous        # state changes, findings and blocker rows land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: supplier-distributor-network
escalates_to: "[[partnerships-integrations-charter]]"
```

**Two card-level prohibitions.** This agent **never sends a distributor anything** — outbound
vendor mail is human-gated always (FUTURES §8.1), and the shipped drafter it borrows already
works that way. And it **does not work the pre-seam ask**: under the proposed CM-F3 line,
persuading a distributor to send data at all is [[design-partner-operations-charter]]'s. The
line is proposed, not ratified; the agent logs the blocker and stops either way.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `feed-freshness-check` | T3 | Daily, per counterparty feed | Every feed's last refresh compared to its cadence; *dormant*, *empty* and *stale* reported as three distinct states | `provider-intelligence.service.ts` makes six reads against a dormant `provider_promotions` (`:135, :159, :179, :197, :222, :414`), all returning nothing gracefully. The inability to tell those states apart is live in the code today | NEW |
| `publish-state-audit` | T2 | A vendor page is created, or its relationship state changes | The page renders only in a published relationship state; the slug is confirmed non-enumerable | Security's SEC-2 found `ENDPOINTS.md` had prescribed **signature verification** for `vendor-portal` — the wrong control entirely; the real risks are slug enumeration and unpublished-page leakage. The correction landed (`ENDPOINTS.md:656`); the control it implies did not | NEW |
| `counterparty-state-sync` | T2 | Weekly, and on any feed or login event | Every distributor carries a current state with a date; decayed relationships transition rather than persist as "live" | Negatively, and checkably: there is no state model, and `procurement_orders` = 1 (`AGENT_NATIVE_UI_DECISION.md:59`) with `pi.live_counterparties` = 0 means every record in the system sits in an unstated state | NEW |
| `boundary-blocker-log` | T2 | Any blocker owned by another unit | The blocker is recorded with its true owner and handed off, not shadow-worked | CM-F3 (`commercial.md:631`) and PROD-F2 both cross this team and neither has an owner; the 2026-08-24 charter session is the first time the overlap was written down from this side | NEW |

Consumed, owned elsewhere: the vendor-reply drafter and `procurement_conversations`
(Product & Vision, per charter §Non-goals 4); `connector-trust-contract` for any distributor
feed ([[connector-platform-trust-schedule]]); the envelope ([[skills-charter]]).

**Honest note, transcribed:** `boundary-blocker-log` is an organizational skill, not a
technical one. If the org grows a general mechanism for recording cross-unit blockers, this
row is deleted in favour of it rather than maintained in parallel.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3
  gate unchanged.
- **Episodic** — nf_a `task_type: feed_freshness_sweep` and `counterparty_state_sync`. Needs
  `context.counterparty_id` and `context.state` as jsonb keys, or the only question that
  matters — *how long has this one been stale?* — cannot be asked. **Nothing here emits nf_a
  today**, and with `pi.live_counterparties` = 0 the layer would be empty even if it did.
- **Semantic** — `memory/` beside this file, index
  `supplier-distributor-network-MEMORY.md`. Founding facts, all verified 2026-08-24:
  *`provider_promotions` is dormant while six live reads target it* (source:
  `provider-intelligence.service.ts:135–414`; also the correction that there are **six**
  reads, not the five `product.md:739` claims); *`procurement_orders` = 1* (source:
  `AGENT_NATIVE_UI_DECISION.md:59`); *the vendor-portal routes are intentionally `@Public()`,
  not a gap — the real risk is slug enumeration* (source: `ENDPOINTS.md:656`,
  `vendor-portal.controller.ts:21, :40`). Provenance frontmatter per ADR 0034; every write is
  a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and the CM-F3 boundary table.
  The vendor modules are retrieval targets by `path:line`.

**Consolidation** — monthly, mirrored in [[supplier-distributor-network-schedule]]. **Failures
first**, defined for this team as a counterparty that decayed without transitioning: the fact
names the mechanism — a feed whose cadence was never recorded, a portal login that lapsed
unnoticed — not "went stale". Expire facts unverified 90 days; propose skill candidates. One
PR; "no delta" stated when true. **Consolidation is not the day-90 dissolution review** —
that is a dated one-off in the schedule; consolidation only supplies it evidence.

## 5. Async contract

Loops ([[supplier-distributor-network-loops]] — `sdn-counterparty-liveness`,
`sdn-feed-freshness`, `sdn-publish-state`, `sdn-boundary-pressure`), nf_a events, vault PRs,
skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `vendor.page_created` has no publisher | Both `vendor-portal` routes are `@Get` (`vendor-portal.controller.ts:20-21, 39-40`); nothing emits on creation, so the per-page publish-state check falls back to the weekly sweep |
| Counterparty state has no store | There is no state model. The agent's central emit — a state transition — has no table to land in, so today it can only report into a vault PR |
| The daily freshness sweep has no feeds | `pi.live_counterparties` = 0. The sweep is scheduled anyway so the instrumentation exists before the first feed, and is exempt from the 3-run rule only until that feed lands (schedule) |
| Most blockers this agent logs are owned elsewhere | Pre-seam distributor work is [[design-partner-operations-charter]]'s under the **proposed** CM-F3 line; `distributor-discovery` is shared pending **PROD-F2**. Both stay open — a team reporting blockers that are entirely other units' actions is [[supplier-distributor-network-premortem]] M1, and `boundary-blocker-log` exists to make that measurable rather than invisible |

## 6. Evidence today

- **PARTIAL — a real supply-side surface with nothing flowing through it.**
  `apps/api-gateway/src/vendor-portal/` (controller, service, module; 2 `@Public()` GET
  routes), `vendor-catalogue/`, and `distributor-discovery/` with **four spec files** — the
  best-tested surface this team touches, and the one PROD-F2 may hand to another team.
- **EXISTS — the outbound human gate, as a shipped pattern.** Vendor-reply drafts with
  one-tap approve that **never auto-send**, threaded through `procurement_conversations`
  (charter §Evidence). Owned elsewhere; consumed here, unchanged.
- **EXISTS — the correction this team's first assignment turned into.** The vendor-portal
  routes are intentionally public, not a gap (`ENDPOINTS.md:656`,
  `vendor-portal.controller.ts:21, :40`); the residual risk SEC-2 named — slug enumeration
  and unpublished-page leakage — is the real job, and it belongs here because publish state
  is a *relationship* property.
- **NEW — the agent, all four skills, the `memory/` layer, every nf_a emission, and any
  counterparty state model at all.** The number that governs the rest is unchanged:
  **`pi.live_counterparties` = 0**, with `procurement_orders` = 1.
