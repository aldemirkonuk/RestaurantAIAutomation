---
type: agent-stack
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: designed
updated: 2026-08-27
metrics: [fin.cost_to_serve_per_restaurant_month, fin.gross_margin_per_restaurant_month, fin.non_design_partner_restaurant_count, fin.external_price_quotes_logged]
links: ["[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-schedule]]", "[[unit-economics-pricing-loops]]", "[[unit-economics-pricing-directive]]", "[[unit-economics-pricing-premortem]]", "[[0034-agent-stack-artifact]]", "[[0016-ledgers-must-express-unknown]]", "[[finance-pricing-agent-stack]]", "[[inference-cost-agent-stack]]", "[[model-routing-inference-economics-charter]]", "[[strategy-fundraising-charter]]", "[[decision-office-charter]]"]
---

# Unit Economics & Pricing — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> ⏸ **The team is chartered dormant and this card proposes no price.** Pricing is
> founder-deferred (`commercial.md:296-298`); the deferral is enforced **mechanically**
> by a grep guard ([[unit-economics-pricing-directive]]), not by this document's good
> intentions. Cost-per-task is **produced by**
> [[model-routing-inference-economics-charter]] (`:54`) and **consumed here, never
> recomputed** — a second derivation on this side would be a second footprint.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pricing-trigger-warden` | Watch the entry trigger and record its count even when it is zero, keep the price-quote register, and publish the one cost-to-serve number as a single inseparable string — while proposing no price | NEW |

One row, deliberately small: a dormant team whose agent grew a second job would be
[[unit-economics-pricing-premortem]] M4 — writing a pricing model anyway — through the
back door.

## 2. Agent cards

```yaml
agent: pricing-trigger-warden
unit: unit-economics-pricing
triggers:
  - schedule: "weekly — entry-trigger watch (L-UEP-1) and the founder deferral question"  # mirrored in [[unit-economics-pricing-schedule]]
  - schedule: "weekly — price-quote register sweep (L-UEP-2)"
  - schedule: "quarterly — dormancy review"
  - topic: restaurant.onboarded            # publisher: NONE (gap — the non-design-partner query is unverified, §5)
  - topic: fin.price_quoted_externally     # publisher: NONE (gap — disclosure-dependent, §5)
consumes:
  - "restaurant records queryable for non-design-partner accounts — publisher: [[catalogue-identity-charter]] / Engineering; the exact query is NOT verified ([[unit-economics-pricing-schedule]] §Dependencies)"
  - "api_spend.restaurant_id attribution (baseline:2236, partial index :8555) — publisher: spend_logger.py:365-377, owned by [[inference-cost-charter]]"
  - "the callsite coverage fraction from [[inference-cost-agent-stack|spend-ledger-auditor]] (L-IC-3) — this GATES the cost-to-serve publication"
  - "cost-per-task from [[model-routing-inference-economics-charter]] — consumed, never recomputed; today NOT emitted (their charter :66), so the input is absent rather than approximated"
  - "the founder's written answer to the weekly deferral question — publisher: the founder"
emits:
  - "fin.non_design_partner_restaurant_count (recorded even at zero) → [[finance-pricing-agent-stack|fin-orchestrator]] board"
  - "fin.external_price_quotes_logged, fin.unregistered_quote_incidents → the same board, and [[decision-office-charter]] on an unregistered quote"
  - "fin.cost_to_serve_per_restaurant_month as ONE string — lower bound + coverage % + 'excluding infrastructure' → [[strategy-fundraising-charter]] and Sales ([[unit-economics-pricing-loops]] outputs_to). ⛔ GATED"
  - nf_a events (task_type: pricing_trigger_watch | quote_register_sweep)
routing_class: mechanical      # counting accounts and recording quotes. The moment a task here needs judgment, it is the pricing decision — which is not this agent's
quality_bar: "the zero is recorded (a missing count and a counted zero are different — ADR 0016 at report level); the cost-to-serve string never ships split ([[unit-economics-pricing-directive]]); `no-price-proposed-guard` passes on every PR touching this directory. NONE (gap) — ADR 0017 defines no verdict grader here"
autonomy:
  read: autonomous
  propose: autonomous          # EXCEPT pricing: no price, tier, rate or per-unit charge may be proposed — enforced by grep, not by this card
  mutate_stock_money_outbound: confirm   # constant — and this agent has no outbound surface at all: it records quotes, it never sends one
memory: unit-economics-pricing
escalates_to: "[[finance-pricing-charter]]"
```

**The card's own hard rule.** The **entry trigger is the only thing that changes this
card** (`commercial.md:313-316`). Until it fires, `propose: autonomous` covers exactly
three outputs — a count, a register row, a gated string; when it fires, the first act is
to demand the provenance of any price already circulating, **not** to propose one.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `price-quote-register` | T2 | Any externally-quoted number | The quote — value, date, recipient, whether framed as final — is in the register within one close-time of being sent | **Live case:** `$20–50/mo` is described as *locked* in [[OPEN-DECISIONS]]:27 with no ADR behind it, and its cited source document `MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md` is **not present in the repo** ([[unit-economics-pricing-charter]] §Evidence, §Open forks) | NEW |
| `no-price-proposed-guard` | T2 | Per PR touching `teams/unit-economics-pricing/` | No proposed price, tier, rate or per-unit charge under this directory; the guard's allowlist decision is recorded, not implied | Same live case, plus the in-repo precedent it copies: `scripts/check_no_direct_stock_writes.sh` and `scripts/check_no_guest_name_matching.sh` — this codebase already enforces invariants with cheap greps | NEW |
| `cost-to-serve-report` | T2 | Monthly L-UEP-3, **after un-gating** | The figure ships as one inseparable string — lower bound + coverage % + "excluding infrastructure" — or does not ship | ADR 0016 / OD-61 (2026-08-25): `api_spend.cost_usd` booked a false `$0.000000` for an unpriced model — one row, `1d73fe73…`, worth $0.000309 — while the NF ledger correctly held `NULL`. A finance figure that was unknown read as a number; the coverage caveat is that same rule one layer up | NEW |

**Deliberately absent:** `pricing-trigger-check`, which [[unit-economics-pricing-schedule]]
lists with the past-instance cell "None yet, by construction". §3.3 rule 3 deletes such a
row rather than keeping it as an aspiration — so it is not here, while **the weekly count
still runs** as a schedule trigger on the card above. It becomes a skill the first time
the count is read and recorded. The guard's own unsolved problem is likewise named, not
solved: a naive `$`-and-number grep would flag the very evidence this team must cite
(`$20–50/mo`, `$10-20/mo`), so it needs an allowlist or a structural rule
([[unit-economics-pricing-directive]]).

## 4. Memory

- **Procedural** — the three §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: pricing_trigger_watch | quote_register_sweep`, with
  `context.count` and `context.deferral_state`. A dormant team's layer is mostly
  **recorded zeros** and must store them: the zero is the evidence the check ran
  ([[unit-economics-pricing-schedule]], anti-sprawl exception), and a skipped row is
  indistinguishable from a skipped week — ADR 0016 at the memory layer.
- **Semantic** — `memory/` beside this file, index `unit-economics-pricing-MEMORY.md`.
  Four facts exist on day one, each with provenance: the `$20–50/mo` range cited as locked
  with no ADR and its source document missing from the repo (charter §Evidence,
  2026-08-24); `restaurant_id` optional by signature (`spend_logger.py:267`) with non-UUID
  values deliberately nulled (`:294-295`), making cost-to-serve a lower bound; and
  `fin.non_design_partner_restaurant_count = 0`, DEP-06 unchecked (`PROJECT.md:101`).
  `source` / `confidence` / `last_verified` per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Entry trigger. **Explicitly not
  loaded: any pricing material at all** — competitor prices, tier structures, willingness-
  to-pay research. A dormant team that preloads pricing context has quietly started
  working, which is [[unit-economics-pricing-premortem]] M4.

**Consolidation** — quarterly, alongside the dormancy review; a faster cadence would only
consolidate a column of zeros. **Failures first**: a quote discovered after the fact
becomes a fact naming who quoted it, when, and how long the register took to learn (M1);
a week the count was not recorded becomes a fact, not a blank (M2). Expire facts
unverified for 90 days; propose skill candidates. One PR — and here "no delta" is the
*expected* outcome, which makes stating it the whole point.

## 5. Async contract

Loops ([[unit-economics-pricing-loops]]), NF-A events, board rows and memory PRs only.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| `fin.price_quoted_externally` has no publisher | The register depends on disclosure by the founder, Sales and Media & Brand — [[unit-economics-pricing-schedule]] §Dependencies calls it the register's weakest point, and `fin.unregistered_quote_incidents` detects only after the anchor has landed ([[unit-economics-pricing-premortem]] M1) |
| The non-design-partner query is unverified | "The exact query is **not verified** by this session" (schedule §Dependencies). A watch reading a wrong query and a watch reading a right one look identical from the board — the count could be correct, wrong, or unrunnable |
| Cost-per-task has a producer that does not emit | [[model-routing-inference-economics-charter]] produces it (`:54`) and reports it **not emitted** (`:66`). This card consumes and never recomputes, so the input is simply absent — recorded as "not derivable", never estimated (ADR 0016, ADR 0020) |
| The coverage fraction that un-gates L-UEP-3 does not exist yet | [[inference-cost-charter]]'s callsite census is not started (schedule §Dependencies). Until it runs, the one number this team owns cannot ship with its caveat, so it does not ship |
| The trigger's own definition is ambiguous | Is a signed-but-unbilled account a trigger? Open, and the founder's — Q2 of [[unit-economics-pricing-agenda-full]]. **This card cannot resolve it**, and a warden watching an ambiguous trigger is the honest description of today |

## 6. Evidence today

- **NEW across the board**, as [[unit-economics-pricing-charter]] says: no revenue, no
  payment processor among the 50 runtime hosts ([[EXTERNAL_CONNECTIONS]]), no billing
  code, no `/pricing` route among the 51 pages ([[PAGE_MAP]]), one restaurant and it is
  not connected (`DEP-06` unchecked, `PROJECT.md:101`).
- **EXISTS — exactly one ingredient.** `api_spend.restaurant_id` (`baseline:2236`) with
  its partial index (`:8555`), written by `spend_logger.py:365-377` and owned by
  [[inference-cost-charter]]. Nulls are by design — `Optional` (`:267`), non-UUID values
  diverted and nulled (`:294-295`) — which is why the number is a lower bound, not a
  cost. (The charter's `spend_logger.py:59` predates the ADR 0016 / P1 rewrite: the
  behaviour holds, the line moved.)
- **EXISTS — the guard precedent** the `no-price-proposed-guard` copies in shape, not in
  content: `scripts/check_no_direct_stock_writes.sh`,
  `scripts/check_no_guest_name_matching.sh`.
- **NEW — the warden, all three skills, every memory layer.** Only one metric has a
  value, and it is a *counted* zero: `fin.non_design_partner_restaurant_count = 0`. The
  register does not exist, cost-to-serve is gated, and gross margin is undefined until
  the founder un-defers pricing — none of which is 0 (ADR 0016).
