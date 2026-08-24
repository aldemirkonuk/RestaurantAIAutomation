---
type: premortem
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: partial
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[agent-fleet-charter]]", "[[agent-fleet-loops]]", "[[agent-fleet-directive]]", "[[ai-orchestration-premortem]]", "[[harness-runtime-charter]]", "[[agent-evaluation-gates-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[technology]]"]
---

# Agent Fleet — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this team has failed. What happened?

### 1. A stub was sold as a capability

The seed premortem, `technology.md:352-354`: *"The five stubs are counted as
capability in a deck or a roadmap because they are registered and 'healthy'; a
customer commitment is made against `compliance_agent`, and the gap is discovered at
demo time."*

Expanded, because the mechanism is more specific than "someone was careless".
`auto_pilot_agent`, `compliance_agent`, `ghost_inventory_agent`,
`negotiation_playbook_agent` and `shrinkage_detective_agent` are **registered**
(`agent_registry.py:123-147`) and have real-sounding names and real descriptions in
`DEFAULT_AGENT_SPECS`. Anyone reading the registry — a new engineer, a deck author, an
agent summarising the codebase — sees nineteen entries with descriptions. Nothing in
that view says five of them only log. A compliance commitment was made against
`compliance_agent` in a sales conversation, and the discovery happened in front of a
customer.

**Earliest observable signal.** An agent count appearing **anywhere outside
`services/agent-orchestrator/`** without the live/stub split. A README line, a deck, a
status page, a roadmap row. The signal is the *bare number*, not its value — by the
time the number is wrong, the trap has already been set.

**What would have prevented it.**
`nf_a.task_success_rate` **never averages stubs into the fleet figure**
(`technology.md:348-350`) — a stub that logs and returns posts a perfect score, so
averaging moves the number the wrong way. Plus `fleet.live_agent_ratio` on the board
as a first-class number, and — cheapest of all — a `stub: true` flag in
`DEFAULT_AGENT_SPECS` so the registry itself cannot be read as a capability list. The
warning already exists as prose at `core/orchestrator.py:214-217`; the fix is to make
it a field.

---

### 2. Registered, enabled, subscribed to nothing — and the pipeline was dead the whole time

**This has already happened once, and the repo wrote it down.**
`core/orchestrator.py:198-206`: `EmailIntelAgent` and `EmailParsingAgent` were *"fully
implemented and absent from this registry, so nothing consumed inbound vendor email at
all."* Registering them was necessary but not sufficient: `EmailIntelAgent` subscribed
to `email.inbound.raw`, **which had zero publishers**, and
`EmailParsingAgent.process_message` took two arguments where `BaseAgent` passes one.
*"Three defects, each of which alone would have made the pipeline dead, and the
missing registration hid the other two."*

It recurs because nothing prevents it. There is no check that a subscribed topic has a
publisher. An agent can be registered, enabled, healthy, and subscribed to a topic
that no code publishes — and every dashboard this team builds will show it green,
because it is not failing. It is not doing anything at all.

**Earliest observable signal.** `fleet.subscription_coverage` — registered agents
whose subscribed topics have at least one publisher. Today: unmeasured. A second,
even cheaper signal: an enabled agent with **zero messages processed** over a week.
Idle is not the same as broken, and this team must be able to tell them apart.

**What would have prevented it.** A static topic-graph check in CI: every subscription
resolves to at least one publisher, every publish resolves to at least one subscriber.
Both directions. It is a grep-shaped problem, not a platform problem, and it is the
single highest-value CI gate this team can add.

---

### 3. Prompts drifted and nobody could say when

Twelve months of small, sensible prompt edits — a clarification here, a few-shot
example there, a "be more concise" after a complaint. Each was fine. In aggregate,
`procurement_agent`'s extraction quality declined, and there was no way to attribute
it, because prompts are edited inline in Python, changes are not versioned separately
from code, and `nf_a.task_success_rate` was not emitting. The team ended up bisecting
git history against a gold set built after the fact.

**Earliest observable signal.** A prompt edit merged with no eval run attached. Same
shape as the model-substitution signal in
[[ai-orchestration-premortem]] #4, one layer in: the commit is the signal, not the
metric three months later.

**What would have prevented it.** Prompts treated as **versioned artifacts with an
attached eval verdict**, gated the way `.github/workflows/ci.yml:226-230` already
gates merge policies. This team does not own defining the verdict —
[[agent-evaluation-gates-charter]] does — but it owns refusing to merge a prompt
change that has none.

---

### 4. Three orphan modules rotted in place and one of them was buying wine

`book_scraper_agent.py`, `dataset_creator_agent.py` and `recurring_order_agent.py` are
referenced by nothing but their own tests. They kept passing CI, so nothing flagged
them. They drifted out of sync with `BaseAgent`, with the schema, and with the
services they call. Two were harmless. The third — `recurring_order_agent` — was a
scheduled purchaser running outside the harness with no idempotency
([[harness-runtime-premortem]] #3), and when it was finally wired up, it was wired up
against a year-old set of assumptions.

**Earliest observable signal.** `fleet.orphan_modules` — modules referenced nowhere
but their own tests. **Today: 3.** Computable in one grep, right now.

**What would have prevented it.** A monthly registration audit that treats an orphan
as requiring a **decision** — adopt, delete, or document the exemption — rather than
as a neutral fact. Passing tests are what make orphans invisible; the audit exists
precisely because CI will never complain.

---

### 5. The guardian seam went slack in the middle

`state_invariant_enforcer`, `drift_agent` and `inequality_detector` are owned by this
team as **code**, and by `[[state-integrity-invariants-charter|sre-state-integrity]]` as **findings** (OD-24, open,
`technology.md:848`). The seam held for a quarter. Then a detector's recall degraded —
it stopped catching a class of POS/inventory mismatch — and neither side owned
noticing. SRE watched the findings queue, which stayed quiet, and quiet looked like
health. This team watched agent liveness, which was green. **A detector that detects
nothing looks identical to a clean system from both sides.**

**Earliest observable signal.** A guardian agent's finding rate dropping to zero and
**staying** there. Zero findings is either excellent news or a broken detector, and
nothing in either team's current view distinguishes them.

**What would have prevented it.** Guardians get **synthetic canaries** — a known
violation injected on a cadence that must be caught. Then zero findings means
something. Ownership of the canary is the concrete test of whether OD-24's split
works: if neither team will own it, the split has failed and the answer is to give
guardians to one team end to end.
