---
type: premortem
division: product
department: product-vision
status: provisional
metrics: [surface.unowned_surface_count, askai.refusal_correctness, floor.misroute_rate, inbound.false_accept_count]
updated: 2026-08-24
links: ["[[product-vision-charter]]", "[[product-vision-loops]]", "[[product-vision-directive]]", "[[inbound-understanding-premortem]]", "[[service-floor-premortem]]", "[[supply-discovery-premortem]]", "[[surface-portfolio-premortem]]", "[[ask-ai-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[FUTURES]]"]
---

# Product & Vision — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Product & Vision has failed. What happened?

### M1 — The department defined modules for a product with no users pulling on it

This is the mechanism the repo has already documented against itself.
[[AGENT_NATIVE_UI_DECISION]] §2 counted the tables: `pos_checks` **0**,
`analytics_insights` **0**, `recommendation_actions` **0**, `procurement_orders` **1**,
`restaurants` 10 — *all test fixtures*. A definition department in that environment writes
beautiful module contracts that no real workflow ever contradicts. Twelve months later
there are five polished charters, three shipped modules, and still no restaurant whose
month got easier — the exact failure §3 of that document names: *combinatorially impressive
systems built without a paying customer pulling on them.*

**Earliest observable signal.** Two consecutive close-times in which the department's
deliverables are all definitional (a spec, a boundary, a schema) and none is a change a
named restaurant asked for. Concretely: `procurement_orders` still equal to 1 while
[[supply-discovery-charter]]'s catalogue coverage metric moves.

**Counter-pressure.** Every team's primary metric is defined so that it **cannot move
without a real subject**: [[supply-discovery-charter]] measures SKUs a restaurant actually
needs, not distributors crawled; [[pos-bridge-charter]]'s sibling metric is providers
*with a merchant behind them*, not providers scaffolded. [[product-vision-directive]]
adds a standing test at the department gate — *name the restaurant this changes* — and a
proposal that cannot name one is scoped as research, and labelled as such on
[[product-vision-agenda-board]].

---

### M2 — Ask AI's allowlist grew one convenience at a time until it stopped being a gate

[[FUTURES]] §8.1 states the one non-negotiable: *AI never silently mutates stock, money, or
outbound vendor email.* The allowlist is the mechanism. It is also the most reasonable thing
in the world to extend by one entry, in a Friday PR, because a manager asked. Twelve months
of one-entry extensions and the confirm card is a formality on an action set nobody has
re-read. The audit trail (`NEW-902`) was the half that got deferred, so nothing can even
reconstruct when it happened.

**Earliest observable signal.** The **first** action family added to the allowlist without a
corresponding refusal test — not the tenth. Also: the first Ask AI action that executes
against a service where the confirm step is implemented client-side.

**Counter-pressure.** `askai.refusal_correctness` is a **hard gate, not a metric to
optimize**: dangerous intents correctly refused ÷ dangerous intents attempted, published
next to the acceptance number on the board. The allowlist lives in one file that CI diffs,
so adding an action is a reviewed change to a single artifact rather than a decorator in a
PR of forty — the same mechanism [[engineering-premortem]] M2 prescribes for `@Public()`.
And `NEW-902` (proposed-vs-confirmed audit history) ships **with** the first executing
action, not after it. See [[ask-ai-premortem]] for the team-level version.

---

### M3 — Floor Checker was built against `simpos` fixtures and died on contact with a kitchen

The blocker is measured, not suspected: in the only POS corpus that exists, `server_name`,
`covers`, `table_id` and `total` are **0 of 47 rows**
(`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14`). Floor
Checker's entire input is currently null. The simulator (`apps/api-gateway/src/simpos/`)
is good enough to demo against, push exists (`apps/api-gateway/src/push/expo-push.service.ts`),
and websockets exist (`apps/api-gateway/src/websocket/websocket.gateway.ts`). So the
notification layer gets built first — it is the fun part and it is unblocked — and only
afterwards does anyone check whether a shipped POS in the registry emits a "food is up"
event at all. No `ready`/`fired`/`kitchen` concept exists in
`apps/api-gateway/src/pos-hub/pos-types.ts` today.

**Earliest observable signal.** A Floor Checker demo that runs end-to-end while
`floor.kitchen_ready_to_waiter_p95_seconds` still has no definition of where "kitchen-ready"
comes from in a non-simulator provider.

**Counter-pressure.** [[service-floor-charter]]'s **entry gate is an input audit, not a
build**: before any notification code, the team publishes, per provider in
`pos-provider.registry.ts`, whether a kitchen-ready signal exists and through what
mechanism. If the answer for every `available` provider is "no", the module's honest v0 is
check-in timing (which needs only `table_id` + `server_name`) and the food-up alert waits
on [[pos-bridge-charter]]. That is a smaller product, and it is the one that can be true.

---

### M4 — Surface Portfolio became a spreadsheet-keeping function

The unowned-surface count is the department's only *measured* metric today: **24 + 13**.
That makes it the easiest thing to report and the easiest thing to fake progress on. The
team regenerates [[PAGE_MAP]] monthly, the count does not move because moving it requires
deleting somebody's page or commissioning an endpoint, and after 60 days the agenda is
fiction by foundation §3.3's own rule.

**Earliest observable signal.** Three consecutive [[PAGE_MAP]] regenerations where
`surface.unowned_surface_count` changes by less than 2 and no route was killed or merged.
Also: `/wine-agent` and `/wineagent` still both rendering `PlaceholderPage`
(`apps/web/src/App.tsx:293-294`) at the second regeneration.

**Counter-pressure.** [[surface-portfolio-charter]]'s deliverable is a **verdict per route**
— keep / merge / kill / make-reachable / intentionally-cold — not a count. The count is the
by-product. The three live duplications (`/wine-agent`+`/wineagent`,
`/inventory`+`/inventory-legacy`, `/calendar`+`/calendar-classic`) are the first three
verdicts and are due in the first close-time, because each is a product call that needs no
engineering permission to decide. And the target is a **number the team commits to, not
zero** — some cold entries (`/v/:slug`, `/invite/:code`) are correct and must be declared
correct rather than quietly carried.

---

### M5 — Grouping by shape held on paper and dissolved in practice

The department's central bet is that Email + Order + Invoice are **one** guardrail contract
(`teams/product.md:74-79`). The pressure against that is constant and reasonable: the
invoice extractor has an X12 path and a credit ledger; the email watcher has a triage
classifier and a reply gate; the order watcher has recurring orders. Each grows its own
confidence threshold because each has a different corpus. Within a year there are three
approval UXs — *the exact failure [[FUTURES]] §8.3 names for chatbots*, reproduced one layer
down.

**Earliest observable signal.** A second confidence-threshold constant appearing anywhere in
`apps/api-gateway/src/procurement/documents/` or `communications/` that is not read from the
shared gate. Also: a second approve/reject UI component that is not the one-tap primitive
(`apps/api-gateway/src/one-tap-actions/`).

**Counter-pressure.** The guardrail contract is a **single artifact with a single owner** —
one confidence/gate standard, one approval component, one false-accept audit, versioned in
[[inbound-understanding-charter]]. Per-module thresholds are permitted only as *parameters
of that contract*, never as separate contracts. If a module genuinely needs a different
gate shape, that is evidence the shape-grouping was wrong and it goes to
`OPEN-DECISIONS.md` as a team-split proposal — which is a decision, not a drift.

---

## Cross-cutting counter-pressure

- **Three of five teams are hard-blocked or thin.** [[service-floor-charter]] is NEW with
  null inputs; [[ask-ai-charter]] has a contract and no server;
  [[supply-discovery-charter]]'s consumer has one order in it. Standing all five up at equal
  weight is how a department produces five provisional agendas and no work
  (`teams/product.md:832-848`). [[product-vision-agenda-full]] states the activation order.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] attacks the
  *decisions* above — especially M2's allowlist design and M5's shape-grouping bet — and its
  findings land in `questions.md` and `OPEN-DECISIONS.md`, not in a veto.
- **[[decision-office-charter]] owns close-times**, and owes this department a renumbering:
  `teams/product.md` §6's fork IDs collide with live OD-20…OD-23.
- **Anti-sprawl applies to this document.** If nothing here has been revisited in 60 days,
  it is fiction (foundation §3.3, §6).
