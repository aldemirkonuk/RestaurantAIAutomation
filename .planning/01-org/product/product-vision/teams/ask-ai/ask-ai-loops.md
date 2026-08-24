---
type: loops
division: product
department: product-vision
team: ask-ai
status: provisional
metrics: [askai.refusal_correctness, askai.confirm_without_edit_rate, askai.entry_point_count, askai.allowlist_family_count]
updated: 2026-08-24
links: ["[[ask-ai-charter]]", "[[ask-ai-directive]]", "[[ask-ai-premortem]]", "[[ask-ai-schedule]]", "[[product-vision-loops]]", "[[inbound-understanding-loops]]", "[[ai-orchestration-charter]]", "[[security-charter]]", "[[surface-portfolio-charter]]"]
---

# Ask AI — Action Composer — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**Two of these run today without a composer**, and that is the point: the schema, the
refusal set, the entry-point count, and intent logging are all measurable before a single
action executes.

---

## L1 — Refusal-correctness loop (the hard gate)

```yaml
type: loop
id: ask-ai-refusal-correctness
owner: product-vision
team: ask-ai
measures: [askai.refusal_correctness, askai.dangerous_intents_attempted, askai.dangerous_intents_refused, askai.wrongly_refused_count]
changes: [refusal.policy, action.allowlist_file, refusal.test_set]
inputs_from: [ai-orchestration, security, red-team]
outputs_to: [ai-orchestration, engineering, product-vision]
close_time: weekly
status: blocked
blocked_on: "no refusal test set; refusals are not logged as events"
unblocked_by: "the dangerous-intent corpus + treating refusals as first-class NF-A events — both writable today, no composer required"
baseline: "unmeasurable"
```

**A gate, not an optimization target.** `askai.wrongly_refused_count` is tracked so the gate
cannot be tightened into uselessness — but the two errors are never summed. An over-refusal
costs thirty seconds; an under-refusal can move money.

---

## L2 — Confirm-quality loop

```yaml
type: loop
id: ask-ai-confirm-quality
owner: product-vision
team: ask-ai
measures: [askai.confirm_without_edit_rate, askai.discard_rate, askai.edit_field_distribution]
changes: [action.schema, card.field_ordering, context.injection_rules]
inputs_from: [design, ai-orchestration]
outputs_to: [design, ai-orchestration]
close_time: weekly
status: blocked
blocked_on: "no composer; 0 of 44 api-gateway modules is an ask/action module"
unblocked_by: "the four schema artifacts, then a first non-mutating family (NEW-897 navigation assist)"
baseline: "unmeasurable"
```

`askai.edit_field_distribution` is the useful diagnostic: *which* field users always fix
tells you what the proposal misunderstands, and it is far more actionable than the headline
rate. Per the pairing rule, this loop never reports without L1.

---

## L3 — Entry-point convergence loop

```yaml
type: loop
id: ask-ai-entry-point-convergence
owner: product-vision
team: ask-ai
measures: [askai.entry_point_count, askai.surfaces_calling_shared_schema]
changes: [entry.migration_order, action.schema]
inputs_from: [design, surface-portfolio, client-surfaces]
outputs_to: [design, surface-portfolio, engineering]
close_time: weekly
status: proposed
baseline: "4 divergent entry points, 0 calling a shared schema; target 1 (or 4 surfaces all calling 1 schema)"
```

**Runs today, weekly, with no composer.** It is a grep: does a new AI entry surface exist
that does not call the shared schema? A fifth surface appearing is
[[ask-ai-premortem]] M3, and the weekly cadence exists so it is caught in a week rather than
a quarter.

---

## L4 — Allowlist-stability loop

```yaml
type: loop
id: ask-ai-allowlist-stability
owner: product-vision
team: ask-ai
measures: [askai.allowlist_family_count, askai.families_added_without_refusal_test, askai.families_touching_stock_money_email, askai.client_side_confirm_findings]
changes: [action.allowlist_file, ci.allowlist_diff_check]
inputs_from: [security, red-team, engineering]
outputs_to: [security, decision-office, founder]
close_time: weekly
status: proposed
baseline: "0 families; allowlist file does not exist"
```

The second measure should be **0 permanently** — its first non-zero reading is
[[ask-ai-premortem]] M1 beginning. Family count is reported as **stability**: growth is a
signal to investigate, never a milestone. The fourth measure is a
[[security-charter]] co-owned finding.

---

## L5 — Intent-observation loop

```yaml
type: loop
id: ask-ai-intent-observation
owner: product-vision
team: ask-ai
measures: [askai.intents_logged, askai.intent_families_observed, askai.top_unserved_intents]
changes: [action.allowlist_file, roadmap.999_5_scope]
inputs_from: [design, growth]
outputs_to: [product-vision, ai-orchestration, design]
close_time: monthly
status: proposed
baseline: "0 intents logged; [[FUTURES]] §8.2's 7 families are plausible and unvalidated"
```

**The cheapest useful version of this team**: an entry point that captures what people ask
for and refuses everything. `recommendation_actions` = 0 rows means nobody has ever acted on
a recommendation, so every workflow assumption behind the §8.2 families is untested.
`askai.top_unserved_intents` is what converts guesses into evidence, and it is the only
input that lets a new family name the restaurant that asked for it.

---

## L6 — Audit-integrity loop

```yaml
type: loop
id: ask-ai-audit-integrity
owner: product-vision
team: ask-ai
measures: [askai.executed_actions_without_audit_row, askai.idempotency_violations, askai.phantom_drafts]
changes: [audit.schema, confirm.idempotency_rule]
inputs_from: [engineering, security]
outputs_to: [engineering, security, decision-office]
close_time: weekly
status: proposed
baseline: "no executing actions yet, so all three are trivially 0 — and must stay 0 after the first one ships"
```

All three measures should be **0 forever**. They are trivially zero today, which is exactly
why the loop is stood up now: `NEW-902` is specified as ships-**with**, not ships-after, and
an audit trail added later cannot cover the period a post-incident investigation would need
([[ask-ai-premortem]] M1).

---

## L7 — Settled-decision integrity loop

```yaml
type: loop
id: ask-ai-settled-decision-integrity
owner: product-vision
team: ask-ai
measures: [askai.cardless_turn_features_proposed, askai.chat_surface_proposals]
changes: [OPEN-DECISIONS.md]
inputs_from: [red-team, design, decision-office]
outputs_to: [decision-office, founder]
close_time: quarterly
status: proposed
baseline: "AGENT_NATIVE_UI_DECISION §3 don't-build verdict intact; /sommelier is a live chat UI awaiting a verdict"
```

The verdict is not defended by anyone remembering it — it is defended by the
card-termination rule and by counting the proposals that would erode it. A non-zero reading
is not a violation; it is a **supersede-ADR request**, which is the correct way for a locked
decision to change.
