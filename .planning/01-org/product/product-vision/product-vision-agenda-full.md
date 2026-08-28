---
type: agenda-full
division: product
department: product-vision
status: active
metrics: [askai.refusal_correctness, askai.confirm_without_edit_rate, askai.entry_point_count, inbound.false_accept_count, surface.unowned_surface_count, floor.providers_emitting_kitchen_ready, supply.sku_dual_price_coverage_pct]
updated: 2026-08-28
links: ["[[product-vision-charter]]", "[[product-vision-premortem]]", "[[product-vision-agenda-board]]", "[[product-vision-directive]]", "[[product-vision-loops]]", "[[product-vision-schedule]]", "[[product-vision-agent-stack]]", "[[product-vision-questions]]", "[[ask-ai-charter]]", "[[inbound-understanding-charter]]", "[[surface-portfolio-charter]]", "[[service-floor-charter]]", "[[supply-discovery-charter]]", "[[0029-p3-plan-of-record]]", "[[0039-activation-plan-of-record]]", "[[0017-doneability-verdicts-are-sidecar-claims]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[FUTURES]]", "[[PAGE_MAP]]", "[[decision-office-charter]]", "[[pos-bridge-charter]]", "[[ai-surface-security-charter]]", "[[research-math-charter]]", "[[client-surfaces-charter]]", "[[ux-path-burn-down-charter]]", "[[knowledge-documentation-charter]]", "[[sales-charter]]"]
---

# Product & Vision — Agenda

**Dated 2026-08-28.** Written under [[0039-activation-plan-of-record]] Track B, against
[[0029-p3-plan-of-record]] — **P3's lanes are the product plan; everything below is
scheduled *into* them.** The forecast this file used to carry is gone: what replaces it is
24 tasks, each with a doneability line, a close time, and the evidence that makes it real.

---

## 0. What changed, and the finding that reorders this agenda

**The seed for this department was "the Ask AI stage is unlocked (P3.0 closed 2026-08-27) —
schedule it." Checking the tree before scheduling found that a substantial part of P3.C is
already built and graded, and that no planning document knows it.**

| Claimed | Measured on disk, 2026-08-28 |
|---|---|
| `STATE.md:94` — P3.C Ask AI, "blocked by design" | `apps/api-gateway/src/ask-ai/` — 9 files, 1,490 lines: controller with 4 guarded routes (`ask-ai.controller.ts:26-30`), 643-line service, allowlist, grounding, verdicts |
| [[ask-ai-charter]]:132-135 — "No server module… No allowlist file, no refusal test set, no audit trail" | The allowlist is a file and it is mechanical: `ask-ai-actions.ts:32` (`ACTION_FAMILIES = ["procurement","communications"]`), `validateAction` rejects rather than coerces (`:121-214`), reorder capped at 500 (`:112`) |
| [[product-vision-agenda-board]]:95 — "no composer exists; 0 of 44 api-gateway modules is an ask/action module" | The composer is mounted globally — `AskAiSurface` at `apps/web/src/components/layout/DashboardLayout.tsx:6,91`, with `AskAiBar.tsx` (276 lines) and `ProposalCard.tsx` (395) |
| `NEW-902` audit trail "deferred" | `supabase/migrations/20260827140000_ai_proposed_actions.sql` — a CHECK constraint refuses `executed` without `confirmed_by` + `confirmed_at`; `20260827170000_ai_proposed_actions_edits.sql` adds `executed_payload` so "the model was right" and "a human made it right" stay distinguishable |
| Verdict coverage on this surface "unmeasured" | Three bases recorded: `PROPOSAL_BASIS` at `ask-ai.service.ts:230`, `EDIT_BASIS` at `:475`, `CONFIRMATION_BASIS` at `:536`; `proposalVerdict` grades a correct decline as `null`, not failure (`ask-ai-verdict.ts:45-51`) |

**Grep, 2026-08-28: zero files under `.planning/` contain the string `ai_proposed_actions`.**
The build moved and the corpus did not. That is [[product-vision-premortem]]'s M-shaped
failure pointing the other way — not a padded doc, a *stale* one — and it is why **PV-01 is
the first task in this agenda rather than a footnote to it**.

**What this does not change.** [[AGENT_NATIVE_UI_DECISION]] §3's *don't build* verdict on the
agent-native UI rewrite **still holds and is not weakened by any of the above.** What shipped
is the narrow deterministic slice the charter always described: two allowlisted families,
typed payloads, ids grounded in a per-request candidate set (`ask-ai-grounding.ts:44-73`), a
database-enforced confirm. It is not a chat surface, and the free-text chat that does exist
(`apps/web/src/pages/SommelierAI.tsx`) is a **portfolio verdict** (PV-14), never a template
to extend. Superseding §3 needs its own ADR; nothing here is one.

---

## 1. Ask AI — the stage the gate was hiding (P3.C)

Seven tasks. The stage's own closing claim in [[0029-p3-plan-of-record]] §5 — *"no Ask AI
action can execute without a recorded human confirm"* — is already structural (the CHECK
constraint). What is **not** done is everything that tells us whether the thing works.

| ID | Task | Doneability — how we know it is done | close_time | Evidence it is real |
|---|---|---|---|---|
| **PV-01** | **Reconcile the corpus with the shipped slice.** The P3.C row in `STATE.md`, [[ask-ai-charter]] §Evidence, and this department's board all describe a feature that does not match the tree. Wave 3 forbids editing them here, so this is filed as a correction request with named owners | `grep -rl ai_proposed_actions .planning` returns **> 0** files (today: **0**); the P3.C row states what shipped and what did not; [[ask-ai-charter]]'s "no server module" line is corrected or dated | **2026-08-31** (3 turns of L6, daily) | The five-row table in §0, every cell a `path:line` read today · routes to [[decision-office-charter]] + [[knowledge-documentation-charter]] |
| **PV-02** | **The refusal corpus v1, and the first `askai.refusal_correctness` reading.** Six dangerous-intent classes drawn from what the code and the contract already forbid: cross-tenant id injection, quantity inflation past the 500 cap, mass delete, billing change, send-without-draft-review, guest-PII export | A versioned corpus of **≥ 40** labelled intents with expected outcomes, run by a spec in CI; the number publishes **beside** `askai.confirm_without_edit_rate` or **neither publishes** | weekly (L3); **first reading 2026-09-11** | `FUTURES.md:225` names the out-of-MVP set verbatim; `ask-ai-actions.ts:112` (the cap), `ask-ai-grounding.ts:44-73` (the id check); no refusal corpus exists anywhere in `apps/`, `scripts/`, `datasets/` (grep 2026-08-28) |
| **PV-03** | **Entry-point unification, 4 → 1.** Shipping the composer *added* a surface instead of replacing one. Live today: the global `AskAiSurface`, the Reports AI pill + palette, `/sommelier`, and the mobile Wine Agent FAB | `askai.entry_point_count` reads **1** in the weekly drift check, **or** each survivor carries a written verdict naming why it is not an AI entry point (the deterministic §A palette is the one legitimate sibling) | monthly; **verdicts by 2026-09-30** | `DashboardLayout.tsx:91`; `Reports.tsx:29,1107,1115`; `pages/SommelierAI.tsx`; `apps/mobile/src/guidance/WineAgentFab.tsx` · [[product-vision-schedule]]'s weekly drift check |
| **PV-04** | **Role-gate the allowlist (`NEW-900`).** Staff must see a smaller allowlist than owners. The service does not check a role today — the only `role` in it is the message-array field at `ask-ai.service.ts:196` | A test proves a staff token is **refused** a `procurement.reorder` proposal, and the refusal carries a reason. A code-review habit does not close this | **2026-09-15** | `ask-ai.service.ts` has no permission branch (grep 2026-08-28); [[ask-ai-charter]] §Boundaries owns role gating; [[FUTURES]]:232 |
| **PV-05** | **The first real ask.** The machinery is built, wired and graded; the input missing is a human. All 10 `restaurants` rows are fixtures | **≥ 1** `ai_proposed_actions` row created by a non-fixture operator, and the four Ask AI numbers published **with denominators** — `confirm_without_edit_rate`, `refusal_correctness`, `entry_point_count`, `allowlist_family_count` | monthly; **first attempt 2026-09-30** | [[AGENT_NATIVE_UI_DECISION]]:59 (`procurement_orders` = 1, `recommendation_actions` = 0, restaurants all fixtures) · needs a design partner from [[sales-charter]] — **this is the department gate applied to itself: name the restaurant this changes** |
| **PV-06** | **A family-widening *policy*, not families.** Two families shipped on a founder call (`ask-ai-actions.ts:31`). The premortem's M2 mechanism is one convenience at a time | A written rule that a third family lands with three things or not at all — a typed schema, refusal cases in PV-02's corpus, and an executor that is **already** human-gated. **No family is added under this agenda** | **2026-09-15** | [[product-vision-premortem]] M2; [[FUTURES]] §8.4 defers full inventory transfers; the `family` CHECK in `20260827140000_ai_proposed_actions.sql` makes widening a deliberate migration |
| **PV-07** | **Ask AI on mobile — into P3.A, not beside it.** The Wine Agent FAB is the mobile AI surface and speaks nothing of the action schema | The FAB either calls `POST /ask-ai/propose` or is retired; mobile `askai.entry_point_count` = **1**. Counted as a P3.A parity feature, in P3.A's 219-feature denominator, never as a second lane | monthly, reviewed with P3.A's census | `apps/mobile/src/guidance/WineAgentFab.tsx`; [[0029-p3-plan-of-record]] §2 (all 219, no carve-outs, OD-108) |

**Reach item, graded honestly.** PV-05 is aspiration pending someone else's decision — it
cannot close without a design partner, which is [[sales-charter]]'s seed, not ours. It stays
on the board as **blocked-with-a-named-unblocker** rather than as work, per
[[product-vision-loops]]' own rule about honest blocked rows.

---

## 2. Inbound understanding — Phase 1 on top of a shipped Phase 0

Phase 0 is merged (`07-reference/INBOUND_EMAIL_INTELLIGENCE_PLAN.md:1-11`). Phase 1 in that
plan is *triage*: classifier + reply gate + persist attachments + decouple analysis from
order-match. Two of those partly exist, which changes what Phase 1 means here.

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **PV-08** | **Promote the shadow classifier on a measured agreement rate, not on confidence.** `email_class` and `requires_reply` are persisted and logged and explicitly do **not** gate replies | A labelled sample of **≥ 200** inbound messages with a published agreement rate between the transport signals and the LLM class, and a written **promote / hold** verdict. The gate flips only on the verdict, never on a demo | monthly; **verdict 2026-09-30** | `inbound-responder.service.ts:125-128` (the shadow comment), `:422` (the reply gate), `:685` (the classification instruction), `common/orchestrator/email-triage.ts` (Layer A + light B, pure) |
| **PV-09** | **Build the correction path, and read `inbound.false_accept_count` once.** This is the department's oldest missing half: acceptance alone measures how tired the reviewer is | A corrected proposal writes a row the weekly sweep can count; the first weekly number publishes **with its denominator**. *Zero with a denominator is a pass; zero without one is the defect* | weekly (L2); **first number 2026-09-18** | [[inbound-understanding-charter]] §Evidence ("no correction path, therefore no `inbound.false_accept_count`"); [[product-vision-agent-stack]] §5 gap row — `proposal.corrected` has **no publisher** |
| **PV-10** | **One human-gate primitive, or a written two.** There are now two: `one-tap-actions/` and `ai_proposed_actions`. Premortem M5 is about three approval UXs; we are at two and nobody owns the question | A one-page contract naming which primitive each module uses and **why two is correct if it is**; a check fails the third | **2026-09-30** | `apps/api-gateway/src/one-tap-actions/`; `20260827140000_ai_proposed_actions.sql` (its header argues the split explicitly — founder call 2026-08-27) · [[product-vision-premortem]] M5 |
| **PV-11** | **Attachments persisted; analysis decoupled from order-match** (plan §5 Phase 1, findings A5/A7) | An inbound email carrying 3 attachments retains all 3, retrievable; an email that matches **no** order still produces a stored analysis | **2026-10-15** | `07-reference/INBOUND_EMAIL_INTELLIGENCE_PLAN.md:262` (the Phase 1 row) |

**Seam, stated not assumed.** [[0039-activation-plan-of-record]] Track A5 puts the **first
judgment rubric on the vendor-reply family** with RM-2 defining and aio-evaluation-gates
operating. PV-08 and PV-09 are the *corpus and the acceptance definition* that rubric needs —
they schedule **into** A5. This department does not write the rubric. Filed to
[[research-math-charter]]'s questions file, not decided here.

---

## 3. Surface portfolio — the count stops being the deliverable

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **PV-12** | **Route verdict sheet v1**, and its first act is to settle the denominator. Measured 2026-08-28: `06-pages/` holds **47** route notes (51 files less `PAGE-CONTRACT`, `PAGES-MAP`, `RETIRED`, `DESIGN-FOUNDATION`), matching `STATE.md:116` — while [[PAGE_MAP]]'s header still reads **48** and also cites 51 at the 2026-08-25 re-verification, which minus four retirements is 47. **A portfolio whose denominator is contested cannot report coverage** | The denominator is one number with one source; then **47 of 47** classified keep / merge / kill / make-reachable / intentionally-cold with an owning module. *Unclassified* is reported as unclassified, never absorbed; the headline publishes as **5 buckets**, never one number | monthly (L1); **v1 2026-09-30** | [[PAGE_MAP]] header (48, and the 51-minus-four line); `STATE.md:116` (47); `ls .planning/06-pages` (47 route notes) — three sources, two answers |
| **PV-13** | **The 12 unresolved route components.** They have sat since the 2026-08-24 scan | Each is resolved, or asked of [[client-surfaces-charter]] with a **named owner and a date**. An accepted "we keep it dynamic" is an honourable close | **2026-09-30** | [[PAGE_MAP]] header line; [[surface-portfolio-charter]] §Evidence |
| **PV-14** | **Does Ask AI need a route at all?** The composer is global and mounted in the layout; `/sommelier` is a separate free-text chat page | A written verdict on `/sommelier`; if it is *kill*, [[client-surfaces-charter]] executes and `surface.unowned_surface_count` moves for a reason rather than by regeneration | **2026-09-30** | `DashboardLayout.tsx:91` vs `pages/SommelierAI.tsx`; [[ask-ai-charter]] §Non-goals ("where Ask AI lives as a route" is portfolio's call) |
| **PV-15** | **Declare the correct cold entries.** Some cold routes are right — `/v/:slug`, `/invite/:code` are entered from outside the app | A committed target number for `surface.unowned_surface_count` that is **not zero**, with each intentionally-cold route named | **2026-09-30** | [[product-vision-premortem]] M4's counter-pressure, verbatim |

---

## 4. Service floor — the audit, and one creative unblock

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **PV-16** | **POS input audit v1** — provider × field, for `table_id`, `server_name`, and any kitchen-ready signal | Every cell reads *emitted* / *not emitted* / *unknown-needs-partner*; **never blank**; simulator rows never count as emitted | monthly; **v1 2026-09-12** | `apps/api-gateway/src/pos-hub/pos-provider.registry.ts` capability flags (`CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL`, `:17-26`) make this mechanically answerable today |
| **PV-17** | **The `generic_webhook` unblock — the ambitious read of a blocked loop.** L4 is blocked on "one non-simulator provider emitting `table_id` + `server_name`". The registry already ships a **universal, available-today** path that carries `CAP_FULL`: any POS or middleware can POST the canonical shape. The blocker is therefore a *counterparty*, not a capability | A one-page spec: exactly what a restaurant (or its middleware) must POST to `/pos-hub/webhook/generic_webhook/:restaurantId` for check-in timing to be real, and what it does **not** unlock (food-up still needs a kitchen-ready event) | **2026-09-30** | `pos-provider.registry.ts:29-43` — `generic_webhook`, tier universal, status available, `CAP_FULL`, with the endpoint named in its own notes |
| **PV-18** | **File the kitchen-ready canonical-shape request.** No `ready`/`fired`/`kitchen` concept exists in `pos-types.ts` | Filed in [[pos-bridge-charter]]'s questions file with an owner and a date. **A "no" is an acceptable close** — what is not acceptable is the ask living only in this agenda | **2026-09-15** | [[product-vision-premortem]] M3; [[service-floor-charter]] §Evidence (NEW, null inputs) |

**The null-input rule is not relaxed by any of the above.** No notification layer is
scheduled. PV-16 → PV-18 are the entry gate [[product-vision-directive]] already sets, and
PV-17 is a smaller product that can be true, not a larger one that cannot.

---

## 5. Supply discovery — a denominator before a crawl

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **PV-19** | **Define "needed SKU" for exactly one restaurant**, from its par levels or its menu | `supply.needed_sku_denominator_size` is an integer; `supply.sku_dual_price_coverage_pct` stops printing **undefined**. No crawl target is added to reach it | monthly (L5); **2026-09-30** | [[product-vision-loops]] L5 `blocked_on`; [[AGENT_NATIVE_UI_DECISION]]:59 (`procurement_orders` = 1) |
| **PV-20** | **A price without an age is a defect.** Freshness is published with coverage or neither is | Count of displayed prices carrying no age = **0**; `supply.price_freshness_p50_days` has a first reading | monthly | [[supply-discovery-charter]] §Metrics quality bar, transcribed into its card's `quality_bar` |

---

## 6. The department itself

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **PV-21** | **Publish the metric SET.** Five numbers on one board, never averaged, each carrying a value, the word *unmeasured*, or the word *undefined* | The board's standing counters are regenerated from a read rather than hand-entered; a metric with no denominator reads **undefined**, never 0% | monthly (agenda sync); **first rollup 2026-09-01** | [[product-vision-agent-stack]] `quality_bar`; ADR 0020 |
| **PV-22** | **Stand up the daily open-decision digest** — assigned to this department by name, as a job, not a team | A digest exists daily; every row carries an owner, an age, and a named unblocker, with rows missing any of the three listed first. Three consecutive no-action runs downgrade or delete the job | daily (L6) | foundation [[README]] §6; [[product-vision-schedule]] row 1; the past instance is real — five forks were minted under live OD ids because nothing read the register daily |
| **PV-23** | **The five team agendas are still `PROVISIONAL`.** Wave 3 covers department-level units; the teams under this department were not in scope, so this department is one dated agenda over five undated ones | Each team agenda is dated and task-carrying. **This is an ask, not self-serve** — a team's agenda is authored by its own agent | **2026-09-30** (L7, monthly) | [[product-vision-loops]] L7 baseline; [[0039-activation-plan-of-record]] Track B scope line |
| **PV-24** | **A new task type costs a grader.** `product_board_rollup` is declared in this department's card and does not exist yet | Either a verdict basis is designed **before** the emitter ships, or the task type is never declared. CI decides this, not a review | **before PV-21's first emitting run** | `scripts/check_task_types_are_graded.py` (P3.0's guard — it fails on a *redundant* exemption too); [[0017-doneability-verdicts-are-sidecar-claims]] |

---

## 7. Findings — things no card or loop can carry

Per [[0039-activation-plan-of-record]]: a task no card or loop can carry is a finding.
These four are filed to [[product-vision-questions]] rather than dressed as tasks.

1. **F1 — Nothing measures docs-vs-disk divergence for build state.** L7 measures *provisional
   decay* (an agenda not updated), not *correctness* (an agenda updated and wrong). §0's table
   is five instances of the second kind and no loop would have caught any of them. Routes to
   [[decision-office-charter]] and [[knowledge-documentation-charter]].
2. **F2 — "Which human-gate primitive" has no owner.** PV-10 schedules the contract; the
   ownership question itself is a boundary between [[inbound-understanding-charter]] and
   [[ask-ai-charter]] that neither card claims.
3. **F3 — `askai.entry_point_count` went *up* by shipping correctly.** The weekly drift check
   is designed to fire on a 5th surface; the composer is a legitimate 4th. The check is right
   and its verdict would be wrong until PV-03 retires the others — recorded here so the first
   firing is read properly.
4. **F4 — Every metric this department owns still lacks a real subject.** Ten restaurants, all
   fixtures. That is [[product-vision-premortem]] M1 unchanged by anything above, and it is why
   PV-05 exists as the honest close of the Ask AI stage rather than "the composer shipped".

---

## 8. Locks — what this agenda deliberately does not schedule

- **The pricing model is deferred.** No billing or subscription action family is proposed,
  and no per-ask cost model is scheduled. `FUTURES.md:225` already places "changing billing"
  outside the MVP allowlist; PV-06 keeps it there by policy rather than by omission.
- **Brand and landing visuals are held.** The composer's visual language stays
  [[design-charter]]'s and stays held. PV-03's unification is a *schema and count* task; not
  one pixel of it is a redesign.
- **[[AGENT_NATIVE_UI_DECISION]] §3 stands.** Nothing here moves toward a chat-surface rewrite
  or adaptive per-user layout. `/sommelier` is scheduled for a **verdict** (PV-14), which is
  the opposite of extension. Any proposal whose effect is to supersede §3 goes to
  `OPEN-DECISIONS.md` as a supersede request, per [[product-vision-directive]].
- **Open forks stay open.** PROD-F1 (team layer), PROD-F2 (Vendor Finder boundary), PROD-F5
  (Design's commissioning authority) are the founder's calls. No task above assumes an answer.

---

## 9. For the founder — three things this agenda cannot decide

1. **PV-05 needs a restaurant.** Every Ask AI number is unmeasurable until one non-fixture
   operator asks something. Is a design partner in reach this milestone, or should PV-05 be
   restated as "instrumentation ready, awaiting first tenant" and taken off the board?
2. **PV-08's promote/hold verdict overlaps Track A5.** The vendor-reply rubric is RM-2's; the
   corpus and the acceptance bar are this department's. Confirming that split now avoids two
   groups grading the same family two ways.
3. **PV-23 — the five team agendas.** Wave 3 scoped departments only. A follow-on wave for the
   76 team units, or do teams stay provisional until a team has actual work?
