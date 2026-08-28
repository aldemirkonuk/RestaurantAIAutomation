---
type: agenda-full
division: product
department: partnerships-integrations
status: active
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, pi.unblocking_agreements, pi.doc_corrections_carried, pi.canonical_shape_drift]
updated: 2026-08-28
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partnerships-integrations-directive]]"
  - "[[partnerships-integrations-premortem]]"
  - "[[partnerships-integrations-loops]]"
  - "[[partnerships-integrations-schedule]]"
  - "[[partnerships-integrations-agent-stack]]"
  - "[[partnerships-integrations-agenda-board]]"
  - "[[partnerships-integrations-questions]]"
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-agent-stack]]"
  - "[[connector-platform-trust-charter]]"
  - "[[supplier-distributor-network-charter]]"
  - "[[partner-alliance-development-charter]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[engineering-charter]]"
  - "[[design-partner-operations-charter]]"
  - "[[decision-office-charter]]"
  - "[[0035-wave2-seam-reconciliation]]"
  - "[[0039-activation-plan-of-record]]"
  - "[[ENDPOINTS]]"
  - "[[PAGE_MAP]]"
  - "[[OPEN-DECISIONS]]"
---

# Partnerships & Integrations — Agenda

**Dated 2026-08-28.** First real agenda; supersedes the forecast of 2026-08-24, which carried the
no-work-done-yet banner and is now retired.
Authored under [[0039-activation-plan-of-record]] Track B. This department owns no Track-A
item, so nothing here competes with the hardening track — but two of its tasks are *consumers*
of Track A4 (`nf_a.skill_id` + the runner cron), and they say so.

> **The thesis is unchanged: be the bridge, not another POS.** What changed is that the
> bridge now demonstrably works and still carries no traffic. The agenda below is therefore
> not a build programme. It is: **make the second provider actually connectable, make the
> four counterparty classes legible as one object, and make four zeroes readable.**

---

## 0. Re-measured 2026-08-28 — the department is stale about itself

The department's standing rule is that *a correction is carried back to the source in the same
week it is found* ([[partnerships-integrations-directive]] §"How this department handles being
wrong"). This session applied that rule to **our own artifacts** and the result is uncomfortable:
three of the four facts below were already known elsewhere in the vault — in the decision
register or in `04-specs/POS-BRIDGE-AUDIT.md` — and **none of them ever reached this
department's charter, premortem or loops.** The doc-drift loop this department chartered to
catch other units' rot has been rotting in our direction the whole time.

| # | What our docs say (2026-08-24) | Verified 2026-08-28 | Where it was already known |
|---|---|---|---|
| C1 | *"`toast` verifies only if a signature is present — fail-closed helper, fail-open call site"* — charter §Correction 2, premortem M2, [[partnerships-integrations-loops]] L2 | **Stale twice over.** The call site is now fail-closed (`toast.service.ts:221-237`), it carries an undocumented carve-out (`enforceSignature()` at `:121-123` — `!mockMode \|\| NODE_ENV === "production"`), **and** `TOAST_WEBHOOK_SECRET` is unset everywhere, so today *every* Toast webhook is rejected | **OD-64**, open in the register, which also flags our citation as drift. Its own line numbers (`:117-119`, `:217-233`) no longer match this worktree either |
| C2 | *"the catalogue-match approve/reject routes are callable by anyone on the internet"* — charter §Evidence, agenda-full 2026-08-24 step 3 | **Fixed.** Class-level `@UseGuards(JwtAuthGuard)` on `pos-hub.controller.ts`; only the HMAC-authenticated webhook is `@Public()`, with a code comment naming the exact gap it closed | **OD-40**, marked ✅ Resolved 2026-08-26 in the register — *"it was fixed and never closed"* |
| C3 | *"`inbound-email` at `apps/api-gateway/src/inbound-email/`"* — charter §Correction 2, [[connector-platform-trust-charter]] §gap table | **Moved, not fixed.** The module is at `common/orchestrator/`; the `?secret=` query path — a credential that lands in access logs — is **still there** | OD-19's 2026-08-26 re-measure already lists it as `common/orchestrator/inbound-email` |
| C4 | *"`POST /pos-hub/webhook/:provider/:restaurantId` verifies correctly and fails closed"* — charter §Correction 2, loops L2, [[connector-platform-trust-charter]] §gap table, all unqualified | **It verifies the wrong thing.** `verifyWebhookSignature(rawBody, signature)` takes no provider argument and keys off one global `POS_HUB_WEBHOOK_SECRET` for all 27 providers **and all restaurants**; the route reads `restaurantId` from the path and never binds it to the key | **OD-B**, drafted `POS-BRIDGE-AUDIT.md:496` on 2026-08-24: *"a signature valid for restaurant A is valid for restaurant B's URL… Not in OD-19's endpoint census because the endpoint does verify — it verifies the wrong thing"* |

**C4 is the finding that reframes the seed theme** (§2) — and it is worse than a stale citation,
because this department's own trust evidence calls that route *correct* while the audit calls it
cross-tenant forgeable.

**And the register does not know about it.** OD-A, OD-B, OD-C and OD-D were drafted at
`POS-BRIDGE-AUDIT.md:493-498` as *"draft rows for `OPEN-DECISIONS.md` — another session owns that
file… renumber to follow OD-60."* The register has since grown past OD-60 to **OD-110 across 107
rows**, and none of the four is in it — verified this session by grepping the register for
`pos_connections`, `webhook secret`, `per-connection`, `historyOnly`, `backfill` and
`capabilities`. Four forks that block this department's spine live only in a spec file. PI-23.

`pi.doc_corrections_carried` therefore stands at **0 of 7** today (three found 2026-08-24, four
found 2026-08-28). PI-19 is what moves it.

---

## 1. The spine

Unchanged and deliberately inconvenient: **`pi.merchant_backed_providers` moving from 0 to 1.**
While it reads 0, [[partnerships-integrations-directive]] rule 1 holds — no new provider adapter
may begin. Nothing in this agenda breaks that rule, and §2 explains why the seed theme does not
need to.

The four zeroes, restated so they are readable rather than discouraging
([[partnerships-integrations-agent-stack]] §5: *"three of four metrics are moved by
counterparties, not by us"*):

| Metric | Today | Moved by | What this agenda does about it |
|---|---|---|---|
| `pi.merchant_backed_providers` | **0** | a merchant | Removes the technical reasons a merchant *could not* connect (PI-01…PI-04) |
| `pi.verified_ingress_ratio` | **contested — see C1/C4** | us | The hand-kept "1 of 3" is wrong in both directions: Toast now fails closed (C1) and pos-hub verifies the wrong thing (C4). PI-05 replaces the hand count with a generated one and PI-05a decides whether cross-tenant forgeability counts as *verified* |
| `pi.live_counterparties` | **0** | a distributor | Builds the graph that makes the zero legible and states which half of it is Sales' (PI-09…PI-12) |
| `pi.unblocking_agreements` | **0** of 9 | a counterparty | Builds the **recorder**, not outreach. Zero attempts is a staffing fact and gets recorded as one (PI-13…PI-16) |

### Task index — 24 tasks, every one with a close date and a carrier

`R` = reach item, graded in its own entry. `⚑` = named as aspiration pending a decision.

| ID | Task | Team | Close | Carried by |
|---|---|---|---|---|
| PI-01 | `pos-adapter-scaffold` as a written skill | pos-bridge | 2026-09-11 | `pos-registry-truth` |
| PI-02 | Per-provider ingress auth contracts (Square, Clover) `R` | connector-trust | 2026-09-25 | `cpt-ingress-classification` |
| PI-03 | Throughput metric as a query, not prose | pos-bridge | 2026-09-04 | `pos-real-throughput` |
| PI-04 | A consumer for `pos_unresolved_lines` | pos-bridge | 2026-10-09 | `pos-catalog-match-gate` |
| PI-05 | Generated ingress inventory | connector-trust | 2026-09-11 | `cpt-ingress-classification` |
| PI-05a | Define `verified` for a cross-tenant signature | connector-trust | 2026-09-11 | `pi-ingress-verification` |
| PI-06 | Contract the `enforceSignature()` carve-out | connector-trust | 2026-09-11 | `cpt-ingress-classification` |
| PI-07 | Close the `?secret=` query path | connector-trust | 2026-09-25 | `cpt-ingress-classification` |
| PI-08 | CI ingress guard specification | connector-trust | 2026-10-09 | `cpt-ingress-classification` |
| PI-09 | **Vendor-network graph v1** `R` | supplier-distributor | 2026-10-23 | `sdn-counterparty-liveness` |
| PI-10 | Counterparty state model | supplier-distributor | 2026-09-25 | `sdn-counterparty-liveness` |
| PI-11 | Publish-state as a relationship property | supplier-distributor | 2026-10-09 | `sdn-publish-state` |
| PI-12 | CM-F3 boundary memo + the 90-day clock | supplier-distributor | 2026-09-25 | `sdn-boundary-pressure` |
| PI-13 | The blocker ledger, zero recorded as zero | partner-alliance | 2026-09-11 | `pad-counterparty-ledger` |
| PI-14 | Attempts beside outcomes, or no report | partner-alliance | 2026-09-25 | `pad-counterparty-ledger` |
| PI-15 | OD-07 option memo + decay check | partner-alliance | 2026-10-09 | `pad-od07-decay` |
| PI-16 | Counterparty reachability index `R` ⚑ | partner-alliance | 2026-10-23 | `pad-counterparty-ledger` |
| PI-17 | `pi-bridge-board` v1 | department | 2026-10-09 | `pi-bridge-board` |
| PI-18 | Close the nf_a hole, or state it ⚑ | department | 2026-11-20 | `pi-bridge-board` |
| PI-19 | Carry seven corrections back to source | department | 2026-09-04 | `pi-doc-drift-repair` |
| PI-20 | Our 8 routes inside OD-19's census | connector-trust | 2026-10-09 | `cpt-ingress-classification` |
| PI-21 | PROD-F4 memo | department | 2026-09-25 | `pi-open-fork-staleness` |
| PI-22 | Registry audit #1, demotion on the table | pos-bridge | 2026-09-28 | `pos-registry-truth` |
| PI-23 | Hand OD-A…OD-D to the decision office | department | 2026-09-11 | `pi-open-fork-staleness` |

Two tasks are graded **aspiration pending a decision** and say so in their entries: PI-16's
Türkiye half (waits on founder Q1) and PI-18 (waits on Track A4). Nothing else here is contingent.

---

## 2. Lane A — POS Bridge: the second provider, described honestly

**The seed said: *second POS provider scaffold (Square and Clover normalizer paths exist in
code)*. Verified — and the honest reading is sharper than the seed.**

Square and Clover are not half-built adapters awaiting more adapter work. Their normalizers are
**written and registered**: `squareAdapter` at `apps/api-gateway/src/pos-hub/pos-adapters.ts:72`,
`cloverAdapter` at `:116`, both wired into `ADAPTERS` at `:198-202`, with a money convention
already reconciled (`:6` — minor units divided). The registry says what is missing in its own
words: *"Orders API normalizer implemented; needs merchant OAuth token"* and *"Orders v3
normalizer implemented; needs merchant API token"* (`pos-provider.registry.ts:71-88`). The
`pos-adapter-scaffold` procedure that produced both is real but **unwritten** —
[[pos-bridge-agent-stack]] §3 grades it T1/NEW with the note *"executed twice already, in
code… the procedure exists in the repo, just not as a written skill."*

**And then C4.** The one ingress route a real merchant would push through verifies with a single
global HMAC secret and has no idea which provider — or which restaurant — is calling
(`pos-hub.service.ts:208-231`). Square signs with its own scheme and its own key; Clover with
another. The audit said it plainly and it has sat unread in this department since:
*"no real vendor's signature scheme is implemented, so 'any POS can push' requires a re-signing
middleware nobody has specified"* (`POS-BRIDGE-AUDIT.md:496`).

So the honest state of "scaffolded" is: **a correct normalizer behind an ingress door that a real
merchant of that provider cannot open, and that any holder of one secret can open for any
tenant.** That is not adapter work — it is trust-contract and ingress work, which rule 1
explicitly permits, and it is the actual distance to `pi.merchant_backed_providers = 1`.

It is also the sharpest thing this department can say to the founder: **the second POS provider
is not blocked on engineering effort or on a partner signature. It is blocked on one unregistered
fork (OD-A/OD-B) about where a per-connection secret lives.**

### PI-01 — Write `pos-adapter-scaffold` as a skill, with the section it is missing

- **Doneability:** `.claude/skills/pos-adapter-scaffold/` exists and its procedure reproduces
  the Square and Clover scaffolds step-for-step from the registry entry alone; it carries a
  mandatory **§Ingress authentication** step that the two existing executions skipped, and it
  refuses to mark an entry `scaffolded` until that step names a scheme or the words "generic
  HMAC only, provider cannot self-sign".
- **Close:** 2026-09-11 (2 weeks).
- **Carried by:** [[pos-bridge-agent-stack]] §3 (`pos-adapter-scaffold`, T1) → `pos-registry-truth` (monthly).
- **Evidence:** `pos-adapters.ts:72, :116, :198-202`; `pos-provider.registry.ts:71-88`;
  the missing-skill grade at [[pos-bridge-agent-stack]] §3.
- **Depends on Track A4** for `nf_a.skill_id` and the runner cron, without which
  `skills.firing_rate_30d` for this skill is unmeasurable ([[0039-activation-plan-of-record]] A4).

### PI-02 — Per-provider ingress authentication contract for Square and Clover

- **Doneability:** two written trust contracts exist — data in, auth model, signature scheme,
  header name, replay window, failure posture, deprecation path — co-signed with
  [[perimeter-ingress-integrity-charter]], each stating explicitly whether the current global-HMAC
  door can serve it and what a re-signing middleware would have to do if not. Each contract states
  its dependency on OD-A/OD-B **without presupposing either outcome**.
  **Specification only; the runtime is [[engineering-charter]]'s.**
- **Close:** 2026-09-25 (4 weeks).
- **Carried by:** `cpt-ingress-classification` (per-pr) + `pi-ingress-verification` (weekly);
  `connector-trust-contract` skill ([[connector-platform-trust-schedule]]).
- **Evidence:** C4 — `pos-hub.service.ts:208-231` takes no provider argument;
  `pos-provider.registry.ts:71-88` names OAuth/API-token as the two auth models; OD-B's
  unspecified re-signing middleware at `POS-BRIDGE-AUDIT.md:496`.
- **Lock respected:** contracts describe data and auth. They set no commercial terms — pricing is
  founder-deferred ([[partnerships-integrations-directive]] §Decided elsewhere).

### PI-03 — Make the corrected throughput metric computable, not just correct

- **Doneability:** one committed query returns real-venue `pos_checks` rows **excluding**
  SimPOS-sourced `generic_webhook` **and** the 66 `P3PROOF-*` proof rows, plus
  `pos_checks.distinct_real_sources`; running it today returns **0 rows and says so**, and
  `pos-real-throughput` reads that query rather than a hand count.
- **Close:** 2026-09-04 (1 week) — it is small, and until it exists the department's headline
  number is asserted rather than queried.
- **Carried by:** `pos-real-throughput` (weekly), `pos-bridge-warden`.
- **Evidence:** the exclusion rule was fixed by the founder on 2026-08-27 under **ADR 0035**
  ([[0035-wave2-seam-reconciliation]]:49; [[pos-bridge-schedule]]:25; [[pos-bridge-agent-stack]] §5
  — *"the metric can no longer read 66 while meaning 0"*), citing `POS-BRIDGE-AUDIT.md:622-628`.
  The correction landed in prose; this task lands it in a query. Independently corroborated by the
  register: OD-64 records the 2026-08-26 production re-measure — `pos_checks` holds **66 rows,
  every one a `generic_webhook` `P3PROOF-*`**, which is exactly the 66 ADR 0035 excludes.

### PI-04 — Give `pos_unresolved_lines` a consumer

- **Doneability:** the 39 lines parked by the 2026-08-24 proof run are readable as a queue with a
  reason per line, and a non-wine line is no longer silently skipped; the weekly gate loop reports
  queue depth beside approval rate.
- **Close:** 2026-10-09 (6 weeks).
- **Carried by:** `pos-catalog-match-gate` (weekly), `catalogue-match-proposer`.
- **Evidence:** publisher with no consumer — `pos-hub.service.ts:341-367` writes them, `:329` skips
  the line, *"nobody is ever asked about it"* ([[pos-bridge-agent-stack]] §5, citing
  `POS-BRIDGE-AUDIT.md:310-322`). The proof run parked 39 (`:558-568`).

---

## 3. Lane B — Connector Platform & Trust: ingress truth, generated not asserted

### PI-05 — Publish the generated ingress inventory and reset the ratio

- **Doneability:** one generated artifact classifies every route in `pos-hub`, `toast`, `simpos`,
  `common/orchestrator/inbound-email`, `integrations-oauth` and `vendor-portal` as
  ingress / management / simulator with its verification posture; a rerun on the same commit yields
  the same classification; an unclassified route fails the run. `pi.verified_ingress_ratio` becomes
  a computed number, and its first computed value replaces the hand-kept "1 of 3".
- **Close:** 2026-09-11 (2 weeks).
- **Carried by:** `cpt-ingress-classification` (per-pr) + `pi-ingress-verification` (weekly);
  `ingress-route-audit` skill.
- **Evidence:** the hand count is already wrong by one — C1. The quality bar is the card's own:
  *"the inventory is generated, not hand-kept"* ([[connector-platform-trust-agent-stack]],
  `ingress-cartographer`).

### PI-05a — Decide what `verified` means when the signature is cross-tenant

- **Doneability:** the definition of `pi.verified_ingress_ratio` is amended, in
  [[partnerships-integrations-loops]]'s metric registry, to state whether a route that verifies a
  signature **not bound to the tenant it writes for** counts as verified. Whichever way it lands,
  the pos-hub row in every ingress inventory carries that qualifier in words. This is a
  *definition*, not a fix — the fix is OD-B's and is the founder's.
- **Close:** 2026-09-11 (2 weeks) — it gates PI-05's first computed value.
- **Carried by:** `pi-ingress-verification` (weekly) — the loop whose metric is currently
  undefined for this case; co-checked by `cpt-boundary-nonduplication` so Security's number and
  ours stay the same number.
- **Evidence:** C4; `POS-BRIDGE-AUDIT.md:496` — *"Not in OD-19's endpoint census because the
  endpoint does verify — it verifies the wrong thing."* A metric that scores this route 1.0 is a
  control that looks green, which is premortem M2's exact failure with the sign flipped.

### PI-06 — Contract the `enforceSignature()` carve-out before it is inherited

- **Doneability:** the Toast trust contract states in writing that fail-closed is conditional on
  `!mockMode || NODE_ENV === "production"`, names which deployments satisfy it, and either accepts
  the carve-out with an owner and a date or asks Engineering to remove it. **A posture that
  depends on `NODE_ENV` is a posture with a hole, and an undocumented hole is the M2 mechanism
  with the fix already applied.**
- **Close:** 2026-09-11 (2 weeks).
- **Carried by:** `cpt-ingress-classification`; `connector-trust-contract` skill.
- **Evidence:** `toast.service.ts:121-123` (`enforceSignature`), `:221-237` (the three rejection
  branches it guards).

### PI-07 — Close the `?secret=` query-parameter credential path

- **Doneability:** the inbound-email trust contract requires the header form only; the query form
  is either removed by Engineering or accepted in writing with a named owner and an expiry date.
  Our deliverable is the contract and the evidence, never a second verifier
  ([[partnerships-integrations-charter]] §Non-goal 2).
- **Close:** 2026-09-25 (4 weeks).
- **Carried by:** `cpt-ingress-classification`; escalates via [[partnerships-integrations-questions]].
- **Evidence:** still live at `common/orchestrator/inbound-email.controller.ts:38-39, :57-58` — C3.

### PI-08 — Specify the CI ingress guard (the recurrence guard, not the fix)

- **Doneability:** a written guard specification exists and is accepted by
  [[engineering-charter]] and [[perimeter-ingress-integrity-charter]]: a PR adding a route to a
  module classified as ingress fails the build unless the route reaches a verification call or is
  explicitly listed as management/simulator. Ours is the spec; the wiring is Engineering's.
- **Close:** 2026-10-09 (6 weeks).
- **Carried by:** `cpt-ingress-classification` (per-pr) — the loop that cannot actually close
  until this exists; `cpt-boundary-nonduplication` (fortnightly) checks we did not build Security's
  control twice.
- **Evidence:** premortem M2's counter-pressure names the guard as *the* deliverable and notes the
  defect class *"has now been documented three times in this repo without a guard being added"*.
  C1 makes it four: the fix landed, the guard did not.
- **Standing note:** the department's own declared gap is that `route.added_or_changed` has **no
  publisher** ([[connector-platform-trust-agent-stack]] declared_gaps) — this task is what gives it one.

---

## 4. Lane C — Supplier & Distributor Network: the vendor-network graph

**The seed's second half.** Today this department's counterparties live in four unjoined
substrates: the 27-entry POS registry, the distributor/vendor surfaces
(`vendor-portal/`, `vendor-catalogue/`, `distributor-discovery/`, `vendor-intel/`,
`providers/`), the 9 partner-agreement blockers, and the 2-provider OAuth connector set. **No
object in the repo says who our counterparties are, what state each is in, and what flows between
them.** That absence is exactly why four zeroes read as discouragement instead of as information.

### PI-09 — The vendor-network graph, v1: one generated object

- **Doneability:** one generated artifact (JSON + a rendered view) whose **nodes** are
  counterparties (registry provider, distributor/vendor, OAuth connector, restaurant) and whose
  **edges** are data flows (webhook ingress, csv import, feed refresh, portal login, OAuth
  connection). Every edge carries a trust-contract reference or the literal words `no contract`;
  every node carries a state from PI-10's model. It reconciles: node count for POS providers equals
  `registrySummary()`'s 27, and the live-edge count equals `pi.live_counterparties`. Regenerating on
  the same commit yields the same graph. **v1 renders today's answer honestly: many nodes, almost
  no live edges.**
- **Close:** 2026-10-23 (8 weeks) — the most ambitious task on this agenda and dated accordingly.
- **Carried by:** `sdn-counterparty-liveness` (weekly) + `pi-merchant-pull` (weekly); it becomes the
  substrate `pi-bridge-board` rolls up, which is the department card's stated whole job —
  *"keeping four zeroes readable"* ([[partnerships-integrations-agent-stack]] §preamble).
- **Evidence:** `registrySummary()` at `pos-provider.registry.ts:328`; the six dormant-table reads at
  `provider-intelligence.service.ts:135, :159, :179, :197, :222, :414`; `procurement_orders = 1` and
  `pos_checks` real rows = 0 (`AGENT_NATIVE_UI_DECISION.md:56, :59`); the vendor surfaces at
  `PAGE_MAP.md:55, 115, 129, 130, 158`.
- **Graded:** the graph is a **reach item that is fully carried** — every input above exists and was
  verified. What is *not* claimed is that it moves any counterparty metric; it makes them readable.

### PI-10 — A counterparty state model, because the code cannot tell three states apart

- **Doneability:** one enumerated state model — `never_contacted` / `contacted_no_reply` /
  `declined` / `agreed_not_flowing` / `live` / `stale` / `dormant` — applied to every node in PI-09,
  with the rule that **dormant, empty and stale are three different answers**. A node whose state
  cannot be determined is rendered `unknown`, never defaulted.
- **Close:** 2026-09-25 (4 weeks) — precedes PI-09's completion because PI-09 consumes it.
- **Carried by:** `sdn-counterparty-liveness` (weekly), `counterparty-liveness-keeper`.
- **Evidence:** the card's own quality bar — *"dormant, empty and stale come back as three distinct
  states — the code today cannot tell them apart, since all six `provider_promotions` reads return
  nothing gracefully"* ([[supplier-distributor-network-agent-stack]]). The card also declares
  `counterparty state transitions → NO STORE (gap)`; this task is the model that gap needs before a
  store is worth asking for.

### PI-11 — Publish-state as a relationship property

- **Doneability:** a written rule for when a vendor page at `/v/:slug` may be visible, expressed as a
  fact about the agreement rather than about the route; slug enumerability is measured once and
  reported. Not a guard — the routes are `@Public()` **by intent** and that is settled.
- **Close:** 2026-10-09 (6 weeks).
- **Carried by:** `sdn-publish-state` (per-event).
- **Evidence:** `vendor-portal.controller.ts:20-21, 39-40` (both `@Get`, both `@Public()`);
  `ENDPOINTS.md:656` — *"intentionally public, not a gap"*; SEC-2 independently named slug
  enumeration and unpublished-page leakage as the residual risk. Also closes the stale assignment at
  `foundation/teams/product.md:733-735`, which still asks this team to "classify these".

### PI-12 — The CM-F3 boundary memo, and the 90-day clock stated out loud

- **Doneability:** one memo proposes the seam — *signed intent to send data*; before it Sales, after
  it us — with the cost of each alternative, handed to the founder jointly with
  [[design-partner-operations-charter]]. The memo makes CM-F3 **decidable**; it does not decide it.
  The memo also records the dissolution clock: if CM-F3 and PROD-F2 are both open on **2026-11-22**
  (day 90 from founding) with `pi.live_counterparties` still 0, this department files its own
  team-dissolution proposal.
- **Close:** memo 2026-09-25 (4 weeks); clock reads 2026-11-22.
- **Carried by:** `sdn-boundary-pressure` (monthly) + `pi-open-fork-staleness` (monthly).
- **Evidence:** CM-F3 at `commercial.md:631` citing `YC_WEDGE_PLAN.md:41`; the clause is
  premortem M4's own counter-pressure — *"a team that cannot state what it controls should be
  merged, not staffed."*

---

## 5. Lane D — Partner & Alliance Development: schedule the recorder, not the outreach

**This team's zeroes are a staffing fact, and this agenda says so rather than dressing them.**
Its charter grades the *function* NEW against the evidence source's EXISTS, on the explicit basis
that *"zero outreach, zero agreements, zero recorded contact"* is what the repo backs. Its own
metric definition makes the distinction the point: *"zero agreements with 12 attempts and a 40-day
median response is a market signal; zero agreements with zero attempts is a staffing fact."*

**Standing rule for this lane, without exception:** no message reaches a counterparty without a
human sending it. Drafts are drafted and never sent
([[partner-alliance-development-agent-stack]] — *"outreach drafts — drafted only, never sent"*;
`mutate_stock_money_outbound: confirm`). And no task here names a first target — that is
founder-deferred ([[partnerships-integrations-charter]] §Non-goal 5).

### PI-13 — The blocker ledger, with zero recorded as zero

- **Doneability:** nine rows exist, one per `authModel: "partner_agreement"` entry, each carrying its
  `registry:line`, its PI-10 state, days-in-state, and what was attempted. Every row reads
  `never_contacted` on the first run **and the ledger says that is a staffing fact, not a market
  reading.** A row is complete only when it distinguishes "never contacted" from "contacted, no
  reply" — the charter's own test.
- **Close:** 2026-09-11 (2 weeks). This is the whole team's first deliverable and it needs nobody's
  permission.
- **Carried by:** `pad-counterparty-ledger` (monthly), `blocker-ledger-keeper`.
- **Evidence:** the nine lines are enumerable and were re-grepped this session —
  `pos-provider.registry.ts:119, :171, :192, :222, :232, :242, :254, :264, :298` (count verified: 9);
  registry sequencing at `:10` — *"Tier 2+ — only when selling into chains (partner agreements
  needed)"*.

### PI-14 — Report attempts beside outcomes, or do not report

- **Doneability:** `pi.unblocking_agreements` and `pi.time_to_first_response` are emitted **as a
  pair, never one alone**, plus `ledger.attempts` and `ledger.state_distribution`; a board cell with
  no data carries the words `not emitted` rather than a zero that could be misread as an outcome.
- **Close:** 2026-09-25 (4 weeks), then monthly.
- **Carried by:** `pad-counterparty-ledger` (monthly) → `pi-bridge-board`.
- **Evidence:** the card's emit rule — *"…as a pair → pi-bridge-board — never one alone"*; ADR 0020's
  `not emitted` convention, restated in [[partnerships-integrations-agent-stack]]'s quality bar.
- **Anti-sprawl note:** [[partnerships-integrations-schedule]] exempts this monthly loop from the
  3-run deletion rule **once**, and deletes it at six consecutive zeros. That exemption is now
  running; first read 2026-09-25, deletion review 2027-02.

### PI-15 — The OD-07 option memo, and its decay check running from today

- **Doneability:** a written memo states what a Beli collaboration would and would not buy, at what
  cost, and what it costs to hold the option open — so OD-07 becomes **answerable**. Separately and
  starting now, the decay check reports OD-07 days-since-touched **beside** the count of
  guest-experience commits landed in the same window; the conjunction at 60 days files a
  *decision-by-drift* finding with [[decision-office-charter]] naming those commits.
- **Close:** memo 2026-10-09 (6 weeks); decay check monthly from 2026-09-28.
- **Carried by:** `pad-od07-decay` (monthly) + `pi-open-fork-staleness` (monthly).
- **Evidence:** OD-07 verified open in the register this session — *"Founder call after guest MVP
  scope exists (FUTURES.md §7.5)"*, with a 2026-08-27 note that the vision anchor resolves to no repo
  file. Premortem M3 is the mechanism; the memo is its counter-pressure.
- **Lock respected:** the memo does not open a conversation. Whether to open one is OD-07 and is the
  founder's.

### PI-16 — Counterparty reachability index (research, not contact)

- **Doneability:** for each of the nine blocked providers plus the five Türkiye entries, one recorded
  fact with a URL and a date: does a public partner/developer programme with an application path
  exist, and what does it require? Nothing is submitted, nothing is sent, no target is named or
  ranked. The index states plainly that it **does not move `pi.unblocking_agreements`** — it removes
  "we do not know how one would even apply" as a reason for zero.
- **Close:** 2026-10-23 (8 weeks).
- **Carried by:** `pad-counterparty-ledger` (monthly) — it is a column on the ledger, not a new store.
- **Evidence:** `pos-provider.registry.ts:119-298` (the nine) and `:268-322` (the five Türkiye
  entries, one of which the registry itself annotates *"start with file export → csv_import
  bridge"* — i.e. a conversation, not an agreement).
- **Graded:** **aspiration pending a decision on Q5** (Türkiye in or out of v0 scope). The nine-provider
  half is unconditional; the Türkiye half waits.

---

## 6. Lane E — Department: the board, the drift repair, the forks

### PI-17 — `pi-bridge-board` v1: four metrics as a set, never an average

- **Doneability:** one board renders the four department metrics **as a set**, each cell carrying a
  measured value or the literal `not emitted`, with `pi.merchant_backed_providers` reported with the
  second half of its phrase intact — *merchant-backed*, not *scaffolded*. It also reports
  days-since-touched for OD-07, PROD-F2, PROD-F4 and CM-F3. First run is expected to be mostly
  `not emitted`, and that is the correct output.
- **Close:** 2026-10-09 (6 weeks) — after PI-03, PI-05 and PI-13 give it three real inputs.
- **Carried by:** `pi-bridge-board` (the department's only card), weekly + monthly triggers.
- **Evidence:** the card's quality bar, verbatim, in [[partnerships-integrations-agent-stack]] §2;
  its declared gap — `registry.provider_status_changed` has **no publisher**, bounded at 30 days by
  the monthly registry audit.

### PI-18 — Close the department's own nf_a hole, or state it

- **Doneability:** either the two department task families (`pi_board_rollup`, `doc_drift_sweep`)
  emit nf_a events with `context.team` as a jsonb key, or the agenda records in writing that they do
  not and that `nf_a.task_success_rate` for this department stays unmeasurable until they do.
- **Close:** 2026-11-20 (12 weeks) — deliberately the longest, because it depends on **Track A4**.
- **Carried by:** `pi-bridge-board`; consumer of [[0039-activation-plan-of-record]] A4.
- **Evidence:** *"nothing in this department emits nf_a today"* ([[partnerships-integrations-agent-stack]]
  §4, §6); `pos-hub` emits none either ([[pos-bridge-agent-stack]] §4).
- **Graded:** **aspiration pending Track A4.** If A4 slips, this task states the hole and does not slip
  quietly with it.

### PI-19 — Carry all seven corrections back to source, four of them against ourselves

- **Doneability:** seven corrections land in their source documents with the `path:line` that
  disproves each — the three from 2026-08-24 (27 providers not 30, `product.md:658`; the "0 of 32
  verify" claim, `product.md:783`; vendor-portal already reclassified, `product.md:733-735`) and the
  four from 2026-08-28 (C1–C4 above, all of which are corrections to **our own** charter, premortem,
  loops and connector-trust charter). `pi.doc_corrections_carried` moves from 0 of 7.
- **Close:** 2026-09-04 (1 week) — the standing rule is *same week*, and three of these are already
  four days late.
- **Carried by:** `pi-doc-drift-repair` (weekly); `doc-code-drift-check` skill (T3).
- **Evidence:** §0 above; the standing rule at [[partnerships-integrations-directive]] §"How this
  department handles being wrong".
- **The uncomfortable half, stated:** four of the seven are corrections to **us**, and three of
  those four were already known elsewhere in the vault. The skill's trigger is therefore widened in
  the same run — *whenever a foundation doc is cited* is not enough; it must also fire on **our own
  artifacts** against the register and `04-specs/`. A drift-repair loop that only looks outward is
  the private-knowledge failure its own charter names, pointed the other way.

### PI-20 — Register the department's eight routes inside OD-19's re-measured census

- **Doneability:** of the 40 routes on the five class-guard-free controllers in OD-19's 2026-08-26
  re-measure, the **8 on this department's surfaces** — `integrations-oauth` (5),
  `common/orchestrator/inbound-email` (1), `vendor-portal` (2) — each carry a one-line trust-contract
  statement confirming public-by-intent or naming the gap. Security owns the classification; we
  supply the contract. We do not resolve OD-19.
- **Close:** 2026-10-09 (6 weeks).
- **Carried by:** `cpt-ingress-classification` + `cpt-boundary-nonduplication` (fortnightly).
- **Evidence:** OD-19 re-measured 2026-08-26 — 459 route decorators, 17 `@Public()`, 419 class-guarded,
  40 on five unguarded-by-omission controllers; the earlier "94" arithmetic is struck in the register
  itself. Three of those five controllers are ours.

### PI-21 — PROD-F4 memo: assert, then get it ratified or overruled

- **Doneability:** a one-page memo states the asserted boundary — Partnerships owns the per-connector
  trust contract, Engineering the runtime, Security the control — with the cost of each alternative,
  and is filed for the founder. It is currently **asserted, not decided**, and every contract in
  Lane B stands on it.
- **Close:** 2026-09-25 (4 weeks).
- **Carried by:** `pi-open-fork-staleness` (monthly); escalates to [[decision-office-charter]].
- **Evidence:** [[partnerships-integrations-charter]] §Entry conditions — *"Asserted, not decided."*

### PI-22 — Registry audit #1, with demotion actually on the table

- **Doneability:** all 27 statuses reconciled against what builds and connects; any `scaffolded`
  claim that no longer holds is **demoted in the same run**, as a proposal in a PR — the warden never
  edits what it counts. First run publishes the census: 2 available, 1 partial, 2 scaffolded,
  22 planned.
- **Close:** 2026-09-28, then monthly.
- **Carried by:** `pos-registry-truth` (monthly), `pos-bridge-warden`; `pos-registry-audit` skill (T2).
- **Evidence:** counted this session — `grep 'status: "'` over `pos-provider.registry.ts` returns
  2 / 1 / 2 / 22 = **27**, confirming the 2026-08-24 correction against `product.md:658`'s "30".
  The warden's hard rule is at [[pos-bridge-agent-stack]] §2.

### PI-23 — Hand OD-A…OD-D to the decision office as register candidates

- **Doneability:** one hand-off note carries the four drafted forks — connection model (OD-A),
  webhook secret scope (OD-B), `capabilities` behavioural-or-documentation (OD-C), backfill
  semantics (OD-D) — to [[decision-office-charter]] with, for each, its current `path:line`
  re-verified against this worktree and a one-line statement of what it blocks in this department.
  **We do not write register rows.** ADR 0025 is locked: adding one `OPEN-DECISIONS.md` row
  re-anchors every citation below it, so the register's owner adds them, or declines and says why.
- **Close:** 2026-09-11 (2 weeks).
- **Carried by:** `pi-open-fork-staleness` (monthly), which then tracks all four alongside OD-07,
  PROD-F2, PROD-F4 and CM-F3; escalates to [[decision-office-charter]].
- **Evidence:** the drafts and their own hand-off note at `POS-BRIDGE-AUDIT.md:490-498`
  (*"another session owns that file — these are handed over as text, not written… renumber to
  follow OD-60"*); the register has since reached **OD-110 / 107 rows** with none of the four
  present, verified by keyword grep this session.
- **Why it is this department's task and not the audit's:** the audit is a finished spec. The forks
  block *our* spine — OD-A/OD-B gate PI-02 and every second-provider path in §2 — and a fork that
  nobody polls is premortem M3's mechanism with a different subject.

---

## 7. Findings, not tasks

Recorded here because **no card or loop in this department can carry them** (§8.1 of the
generation brief). Each is addressed to a unit's questions file, not scheduled as our work.

| # | Finding | Why it is not a task here | Addressed to |
|---|---|---|---|
| F1 | **No pull path exists at all.** 13 of 27 providers declare `webhooks: false`, no `@Cron` calls a POS, no cursor is stored, and `pullPosCatalog()` throws for every source but `simpos` (`catalog-matcher.service.ts:187-190`) | Blocked on **OD-A**, which is drafted and unregistered. Scheduling a pull path would presuppose its outcome — forbidden by §8.4. PI-23 gets it polled; it does not resolve it | [[pos-bridge-questions]] POS-Q4 (age-out 2026-10-05); [[decision-office-charter]] |
| F1b | **The cheapest path to a second live provider may not be a provider at all.** The audit ranks a real file/CSV ingestion path as covering *"the 13 pull-only providers and the entire file-export long tail… cheaper than one adapter and covers more venues than all 22 planned adapters combined"* (`POS-BRIDGE-AUDIT.md:476`) — and the registry itself routes `akinsoft_wolvox` through it | It is a **build** ranked against adapters, and rule 1 permits *hardening* the two available paths, not building a new ingestion surface, while `pi.merchant_backed_providers == 0`. Raising it as a finding is the honest move; scheduling it would be the department deciding its own gate | [[pos-bridge-questions]]; founder Q6 below |
| F2 | **`pos_checks.correlation_id` is never set**, so an nf_a event and the check that caused it cannot be joined (`POS-BRIDGE-AUDIT.md:614-620`) | A schema change owned by [[engineering-charter]]; we are a consumer, not the owner | [[engineering-charter]] via [[pos-bridge-questions]] |
| F3 | **The `>= 0.9` auto-map writes `pos_item_mappings`, which `applyStockEffects` later reads to move stock** (`pos-hub.service.ts:371`) — the one write by this department's agents that reaches inventory with no human in the loop | Whether that is a stock mutation under FUTURES §8.1 is not ours to decide; it is Track A3's surface | [[action-safety-the-human-gate-charter]] |
| F4 | **Three of four department metrics are moved by counterparties, not by us.** No amount of internal work moves them | Structural, not schedulable. It is why PI-14 exists in the form it does | recorded here; consumed by [[partnerships-integrations-agenda-board]] |
| F5 | **`canonical-shape-review` still has no past instance.** It sits on [[partnerships-integrations-schedule]] as a proposal and was deliberately kept off both agent stacks | A premortem is a trigger, not an instance. It is the first candidate for deletion if the 30-day rule bites | [[skills-charter]] |

---

## 8. Questions for the founder

1. **Q5 carried forward — Türkiye in or out of v0 scope?** (`pos-provider.registry.ts:268-322`,
   five providers, a different clock.) PI-16's second half waits on this and is graded aspiration
   until it is answered. Asked as scope, not as a target list.
2. **PROD-F4 — is the asserted trust boundary right?** Every Lane B contract stands on it (PI-21).
3. **CM-F3 — ratify the *signed intent to send data* seam, overrule it, or assign both halves to one
   unit?** If one unit, this department would rather lose the team than run a shared metric
   (PI-12; premortem M4).
4. **The no-new-adapters rule.** §2 shows the seed theme can be advanced *without* breaking it —
   the distance to a second live provider is a trust contract, not an adapter. Does the rule stand as
   written?
5. **OD-07 — memo now or after guest MVP scope exists?** Not asking for the answer. PI-15 assumes
   *now*, on premortem M3's ground that waiting has a compounding cost; say so if that is wrong.
6. **The four unregistered POS forks (OD-A…OD-D).** They were drafted 2026-08-24 with a note that
   another session owned the register; four days and fifty register rows later they are still not in
   it, and **OD-A/OD-B are the actual blocker on a second live provider** (§2). PI-23 hands them
   over. Do you want them registered, or answered directly — OD-B especially, where the recommended
   answer is already written in the audit?
7. **F1b — does the CSV/file ingestion path count as *hardening* the two available paths, or as a
   new build?** Rule 1 turns on that word, and the department will not adjudicate its own gate.

**Not asked, deliberately:** pricing, and who to contact first. Both are founder-deferred and this
agenda proposes neither.

---

## 9. What this agenda deliberately does not schedule

- **Any outbound contact with any counterparty.** Lane D schedules the *recorder* and the *drafting
  machinery*; a human sends, always. No target is named or ranked.
- **Any new provider adapter.** Rule 1 holds while `pi.merchant_backed_providers == 0`. Square and
  Clover need no new adapter — see §2.
- **A second signature-verification implementation.** [[perimeter-ingress-integrity-charter]] owns the
  control. We ship contracts and evidence.
- **Pricing, commercial terms, or any integration fee.** Founder-deferred; not ours.
- **Any resolution of OD-07, OD-19, OD-A, PROD-F2, PROD-F4 or CM-F3.** This agenda produces
  decidability. The decisions are the founder's.
