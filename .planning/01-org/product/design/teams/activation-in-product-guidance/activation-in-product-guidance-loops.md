---
type: loops
division: product
department: design
team: activation-in-product-guidance
status: provisional
metrics: [design.time_to_first_real_action_staff_min, design.role_default_coverage_pct, design.first_run_completion_rate_by_role, design.surface_items_cut_by_role]
updated: 2026-08-24
links: ["[[activation-in-product-guidance-charter]]", "[[activation-in-product-guidance-premortem]]", "[[activation-in-product-guidance-directive]]", "[[design-loops]]", "[[LOOP-MAP]]", "[[analytics-bi-charter]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[growth-charter]]", "[[decision-office-charter]]"]
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["act-time-to-first-real-action", "act-surface-cut-by-role", "act-guidance-efficacy", "act-blocker-truth"]
loop_close_times: ["monthly", "monthly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Activation & In-Product Guidance — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops. **The first one cannot close today**, and says so every month rather than
reporting nothing — an activation loop that quietly omits an unmeasurable number is how a
team spends a year unable to evaluate itself.

---

## L-ACT-1 — Time to first real action, by role

```yaml
type: loop
id: act-time-to-first-real-action
owner: activation-in-product-guidance
measures: [design.time_to_first_real_action_staff_min, design.time_to_first_real_action_manager_min, design.time_to_first_real_action_owner_min, design.first_run_completion_rate_by_role]
changes: [onboarding.sequence, guidance.tour_policy, onboarding.role_defaults]
inputs_from: [analytics-bi, growth, guest-experience]
outputs_to: [design, product-vision, growth, decision-office]
close_time: monthly
status: proposed
```

**Three numbers, never averaged.** Averaging hides staff behind owner, which is
[[activation-in-product-guidance-premortem]] M1 arriving as a reporting decision rather than
a design one. **Staff is the number that matters** — turnover makes it recur forever, while
owner time-to-value is measured once per account.

**This loop cannot close today.** The "real action" event does not exist; the closest thing
on disk is `apps/mobile/src/guidance/analytics.ts`, native-only and unaggregated. Until the
event lands, the loop reports **unmeasured** every month, out loud, on
[[activation-in-product-guidance-agenda-board]]. Reporting *unmeasured* honestly for three
months is the loop working. Reporting nothing is the failure.

Monthly because activation cohorts are monthly-sized at 11 restaurants. A weekly reading
would be noise presented as signal, and noise presented as signal is how a team justifies
whatever it already wanted to do.

---

## L-ACT-2 — Surface cut by role

```yaml
type: loop
id: act-surface-cut-by-role
owner: activation-in-product-guidance
measures: [design.role_default_coverage_pct, design.surface_items_cut_by_role, design.cut_reversal_rate, design.support_questions_post_cut]
changes: [onboarding.role_defaults, navigation.default_visibility]
inputs_from: [ux-path-burn-down, surface-portfolio, sales, growth]
outputs_to: [design, product-vision, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M5 — cuts vetoed one feature at a time. Baseline: coverage **0**, items
cut **0**.

Carries `design.cut_reversal_rate` deliberately: every default is reversible via a
discoverable control, so **how often users reverse a cut is the honest test of whether the
cut was right**. A low reversal rate says the cut was correct; a high one says it was wrong
and the mechanism worked. Both are useful; neither is available without the metric.

`design.support_questions_post_cut` is the counter-argument's own number. The objection to
cutting is always *"it will generate support questions"* — measuring that turns a
recurring debate into a reading.

---

## L-ACT-3 — Guidance efficacy

```yaml
type: loop
id: act-guidance-efficacy
owner: activation-in-product-guidance
measures: [design.tip_completion_rate, design.tour_skip_rate, design.first_visit_guidance_coverage, design.guidance_events_aggregated]
changes: [guidance.tour_policy, guidance.content, mobile.guidance_provider]
inputs_from: [analytics-bi, design-system-motion-substrate, exploration-studio]
outputs_to: [design, activation-in-product-guidance, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M4 — the one-shot tour. Sketch **051** already resolved this with
*"B — first-visit overrides session cap"*, and the code does not exist.

`design.tour_skip_rate` is expected to be **high** at baseline; that is the finding, not a
disappointment. A tour that fires once during service and is skipped is a tour that never
happened, and its completion rate will look fine because the denominator is people who did
not skip.

`design.guidance_events_aggregated` tracks the plumbing:
`apps/mobile/src/guidance/analytics.ts` exists on native, web first-run does not feed the
same series, and until they merge this loop sees half a product.

---

## L-ACT-4 — Blocker truth

```yaml
type: loop
id: act-blocker-truth
owner: activation-in-product-guidance
measures: [design.blocked_deliverables_with_named_blocker, design.role_matrix_row_has_id]
changes: [ux_paths_catalog.deferred_log, activation-in-product-guidance.queue]
inputs_from: [ux-path-burn-down, engineering]
outputs_to: [ux-path-burn-down, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M3, and it is small on purpose — it exists to stop one specific sentence
from becoming permanent: *"role defaults are blocked on backend."*

They are not. Role **defaults** are client-side. The roles **matrix** is backend-blocked
(§O log, `UX_PATHS_CATALOG.md:62`, *"Backend/schema absent"*), and — checked this session —
**that row carries no identified `NEW-` ID at all**: the §O row lists a block of IDs
without mapping item to ID, and `NEW-513` is in fact *2FA enrollment and recovery codes*
(`:1234`).

`design.role_matrix_row_has_id` is a boolean that reads **false** today. A dependency nobody
can point at cannot be chased, commissioned, or closed — it can only be re-derived as
blocked, once per planning session, forever.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-ACT-1 time to first real action | monthly | M1, M2 | **No** — the event does not exist. Reports *unmeasured*, out loud |
| L-ACT-2 surface cut by role | monthly | M5 | **Yes** — counting cuts needs no instrumentation |
| L-ACT-3 guidance efficacy | monthly | M4 | Partly — native events exist, web is not aggregated |
| L-ACT-4 blocker truth | monthly | M3 | **Yes** — it is a documentation check |

One loop closes today, one partly, one is a documentation check, and the primary one cannot
close at all. That distribution is what `status: partial` honestly means for this team: live
surfaces, resolved decisions, and no way to tell whether any of it works.
