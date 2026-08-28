# ACTION-SCHEMA-SPEC — the one typed action shape

> **Mandated by:** ADR 0039, Track A3.
> **Status:** spec of record for A3. First increment landed
> (`recurring_order_agent` under the harness); the rest of A3 builds against
> this document.
> **Supersedes:** nothing. This is the retire-to-write rationale — there is no
> document to retire because **the four conventions this unifies were never
> written down**. They exist only as four independent implementations that
> arrived at the same principle and expressed it in four incompatible shapes.
> Writing them down *is* the retirement: after this, "how does an agent propose
> something a human confirms?" has one answer instead of four undocumented ones.
> **Governs:** FUTURES §8.1 (`Ask → propose → confirm → execute`) and the §8.2
> allowlist. Where this spec and FUTURES §8 disagree, FUTURES wins and this file
> is wrong.

---

## 0. Why one shape

Four subsystems independently built propose→confirm→execute. Each is correct in
isolation. None can see the others:

| Convention | Proposal lives in | Confirmation record | Who executes |
|---|---|---|---|
| One-tap action center | `one_tap_actions` | `executed_by` + `executed_at` | `triggerWorkflow()` in the gateway |
| `drift_agent` tiered findings | `drift_findings` / `pos_catalog_match_proposals` | `status` transition off `open`/`pending` | a human, by hand |
| Vendor-reply approval | `procurement_conversations` | `status: PENDING_APPROVAL → SENT` | `approveDraft()` → GmailService |
| UX-optimizer human gate | `ux_proposals` | `reviewed_by` + `reviewed_at` | `reviewProposal()` → `ux_overrides` |

Four tables, four status vocabularies, four confirmation stamps, four audit
trails. The cost is not aesthetic:

1. **No global answer to "what is this AI waiting on me for?"** A manager has
   four inboxes and no union query. The Ask-AI action composer FUTURES §8 asks
   for cannot be built on four schemas.
2. **A new proposer picks a convention by proximity, not by fit.** Track A3's
   first increment had to choose one for scheduled purchasing, and the only
   basis for choosing was which file the author had open.
3. **The gate is per-implementation, so it can be lost per-implementation.**
   This already happened: `recurring_order_agent` had *no* convention, executed
   purchases directly on a boolean column, and its own test suite asserted that
   behaviour was correct. Four written conventions and one unwritten violation
   is exactly the failure mode a single schema prevents.

---

## 1. The shape

One row, one vocabulary. Every AI-originated action a human must confirm is an
**action envelope**:

```jsonc
{
  // identity
  "action_id":      "uuid",
  "restaurant_id":  "uuid",          // tenant scope, taken from the token/agent context, never from the payload

  // what kind of thing this is
  "action_family":  "procurement",   // FUTURES §8.2 allowlist — see §2
  "action_kind":    "procurement.recurring_order.place",  // family-prefixed, dotted, stable

  // who proposed it
  "proposer": {
    "type":         "agent",         // agent | service | user
    "name":         "recurring_order_agent",
    "correlation_id": "…",           // joins to decision_log + neural footprint
    "decision_log_id": "uuid|null"
  },

  // what it would do
  "payload":        { /* family-specific, validated against the kind's schema */ },

  // how much autonomy it has
  "autonomy_tier":  "propose_only",  // §3

  // the confirmation record — the whole point
  "status":         "pending",       // pending | confirmed | rejected | expired | cancelled
  "executed_by":    null,            // uuid of the authenticated human, written by the executor only
  "executed_at":    null,            // timestamptz, written by the executor only
  "execution_result": null           // whatever the executing service returned
}
```

### Invariants

1. **A proposer may never write `executed_by`, `executed_at`, or
   `execution_result`.** Those three fields are the confirmation record. An
   agent that can write them can forge consent, and a forged approval is
   indistinguishable at rest from a real one. This is not a convention to be
   respected — it must be an *assertion at the write site*. Reference
   implementation:
   `services/agent-orchestrator/agents/recurring_order_agent.py:397-429`, which
   validates the caller-supplied row and raises `RecurringOrderSafetyError`.
2. **`status` starts at `pending` and only a confirm path moves it.** The
   confirm path is authenticated, and it takes the user id from the token, not
   from the request body — see
   `apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:436-441` for the
   argument, which applies verbatim to every family.
3. **Every proposal and every confirmation writes a `decision_log` row**
   (`BaseAgent.log_decision`, `core/base_agent.py:743`). The envelope carries
   the `decision_log_id` so the two can be joined; a proposal with no decision
   row is a defect, not a shortcut.
4. **Execution is delegated, never inlined.** The envelope names *what* should
   happen; existing services do it. FUTURES §8.1: "Confirmation is the gate;
   existing services are the executors."
5. **Idempotency is on the envelope, not the executor.** A repeated sweep must
   find its own open proposal and not stack a second one
   (`recurring_order_agent.py:_find_open_proposal`).

---

## 2. `action_family` — bound to the FUTURES §8.2 allowlist

The allowlist is FUTURES §8.2's, not a new one. `action_family` is exactly that
table's left column, lowercased and slugged:

| `action_family` | FUTURES §8.2 row | Executor today |
|---|---|---|
| `procurement` | Procurement | draft PO / one-tap draft in Orders |
| `inventory` | Inventory | transfer, waste, count-sheet draft |
| `communications` | Communications | provider draft (outbound engine) |
| `calendar` | Calendar / ops | calendar event draft |
| `catalog` | Catalog / menu | scan/import or recipe draft |
| `insight` | Insights → act | one-tap Act (recommendation actions) |
| `navigation` | Navigation assist | deep link; **no mutation** |
| `ux` | *(not in §8.2)* | UX override — internal, see §4.4 |

`action_kind` is `<family>.<subject>.<verb>`, stable once shipped, and each kind
owns a payload schema. Kinds outside the allowlist are refused at the write
site, not filtered at render time. FUTURES §8.2's "out of MVP / gated harder"
set (mass deletes, billing, permissions, unsent-draft email, guest PII export)
has **no family** and therefore cannot be expressed in this schema at all —
which is the intended way to say "not yet".

---

## 3. `autonomy_tier`

Three tiers, taken from the pattern `drift_agent` already implements
(`services/agent-orchestrator/agents/drift_agent.py:8-17`):

| Tier | Meaning | Confirmation | Example |
|---|---|---|---|
| `auto_safe` | Reversible, touches neither money, stock, nor outbound email. Applied directly; still logged. | none | `drift_agent` marking an inactive, already-unmapped catalog row resolved |
| `propose_only` | Touches money, stock, or outbound email. **Never** applied by the proposer. | required | recurring purchase order; price-change drift finding |
| `gated_rollout` | Confirmed once, then released to a fraction of users behind a kill switch. | required, plus rollout % | UX override |

The tier is a property of the *effect*, not of the agent's confidence. A
high-confidence purchase is still `propose_only`. Confidence belongs in
`decision_log.confidence`.

**One tier boundary is non-negotiable and derives directly from FUTURES §8.1:**
anything that mutates **stock, money, or outbound vendor email** is at minimum
`propose_only`. A per-tenant configuration flag may *pre-authorise a channel*
(the vendor-reply auto-send gate, §4.3, is the existing precedent), but a flag
set on a *schedule* or a *provider* is not consent for a *specific action* —
see §4.1 for why that distinction cost this repo an auto-executing purchase
path.

---

## 4. How each existing convention maps

### 4.1 One-tap action center — *the closest fit; the target shape*

`apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts`

| Envelope field | Today |
|---|---|
| `action_id`, `restaurant_id` | `one_tap_actions.id` / `.restaurant_id` |
| `action_family` + `action_kind` | **collapsed** into `action_type`, a Postgres enum (`public.one_tap_action_type`, migration `20260805000000_baseline_from_production.sql:173`) of nine unstructured values (`low_stock`, `price_change`, …, `custom`) |
| `proposer` | **absent** — no column records who proposed |
| `payload` | `metadata` jsonb (free-form) |
| `autonomy_tier` | **absent** — implied by the type |
| `status` | `one_tap_action_status` enum — `pending` / `in_progress` / `completed` / `cancelled` / `expired` |
| `executed_by` / `executed_at` / `execution_result` | present and correct: `one-tap-actions.service.ts:245-247` |
| execution | `triggerWorkflow(action)` at `:262`, dispatching on `action_type` at `:404-425` |

**Verdict: this is the base table.** It already has the confirmation record in
exactly the right shape, written in exactly the right place — by the gateway,
from `userId`, after a human tap. The gaps are `action_family`/`action_kind`
(an enum where a two-part string is needed), `proposer`, and `autonomy_tier`.

Track A3's first increment writes here already, carrying family/kind/proposer/
tier inside `metadata` under `action_type = 'custom'`
(`recurring_order_agent.py:397-444`) because the enum cannot be extended without
a migration. That is a deliberate interim, not the destination — see §5 step 2.

> **The gap that motivated A3.** `recurring_order_agent` did not use this
> convention or any other. It read `recurring_orders.auto_approve` — a boolean
> set once, at schedule-creation time — and on `true` called `create_order(…,
> auto_approved: True)` directly, then notified the manager that the order "has
> been automatically placed". No proposal, no `executed_by`, no `decision_log`.
> A flag on a *schedule* was being treated as consent for every *purchase* that
> schedule ever produces. That path is now deleted (not disabled) and the agent
> is `propose_only`.

### 4.2 `drift_agent` tiered findings — *the tier vocabulary*

`services/agent-orchestrator/agents/drift_agent.py`

| Envelope field | Today |
|---|---|
| `action_family` | implicit — all findings are inventory/catalog |
| `action_kind` | `finding_type`: `new_item`, `removed_item`, `price_change`, `stock_mismatch` |
| `proposer` | `decision_log.agent_name`; also `pos_catalog_match_proposals.match_method = 'drift_agent'` |
| `payload` | `drift_findings.details` jsonb |
| `autonomy_tier` | **`auto_healed` boolean** — the two-valued ancestor of the three-tier field |
| `status` | `open` (money/stock, never auto-applied) / `resolved` / `proposed` |
| confirmation | **none** — a human edits the row; nothing records *who* |
| audit | every finding *and* every run writes `decision_log` (`drift_agent.py:503-542`) |

**Verdict: `drift_agent` contributes the tiering and the audit discipline; it
lacks the confirmation record.** Its split — safe things become proposals in a
queue, money/stock things become `status='open'` findings that are never
auto-applied (`drift_agent.py:409-426`, `:428-501`) — is exactly §3, and
`auto_healed` is `autonomy_tier` with two values instead of three. What it
cannot answer is "who approved this?", because resolving a finding is an
untracked edit. Migration keeps the tiering, adds the stamp.

### 4.3 Vendor-reply approval — *the pre-authorisation precedent*

`services/agent-orchestrator/agents/provider_communication_agent.py` (proposer)
→ `apps/api-gateway/src/procurement/procurement.service.ts` (executor)

| Envelope field | Today |
|---|---|
| `action_family` | `communications` |
| `action_kind` | `procurement_conversations.outbound_email_type` (varchar + CHECK constraint) |
| `proposer` | `ai_generated: true` + `decision_log` |
| `payload` | `message_text` / `content` + `constraint_flags` |
| `autonomy_tier` | **`_check_auto_send_gate()`**, `provider_communication_agent.py:882-925` |
| `status` | `PENDING_APPROVAL` / `AUTO_SENT` / `SENT` / `APPROVED` / `DISCARDED` — *upper case, unlike every other convention* |
| confirmation | `approveDraft()` at `procurement.service.ts:1573`, gated on `status = 'PENDING_APPROVAL'` |
| execution | GmailService, threaded, from `approveDraft()` |

**Verdict: this is the only convention with a per-tenant pre-authorisation
path, and the rule it follows is the one §3 generalises.** The three-gate check
at `:882-925` — paid tier, provider health ≥ threshold, *and* a manager having
pre-approved auto-send for that specific provider — **fails closed**, defaulting
to `PENDING_APPROVAL` on any exception. Note what makes it legitimate where
`auto_approve` was not: it is scoped to a channel the manager explicitly opted
in per-provider, it is re-evaluated per message, and it degrades to manual.
Contrast with §4.1's boolean, which was evaluated once and never revisited.

The second thing this convention contributes is the staging discipline in
`apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:144-146`
and `:522`: the responder *drafts and stages*, it never sends.

Its one liability is the status vocabulary — `PENDING_APPROVAL` vs `pending` vs
`proposed` vs `open` for the identical state, across four tables.

### 4.4 UX-optimizer human gate — *the strongest gate; the rollout tier*

`apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts`

| Envelope field | Today |
|---|---|
| `action_family` | `ux` (internal; not in FUTURES §8.2) |
| `action_kind` | `ux_proposals.kind` + `target_key` |
| `proposer` | `source` (heuristic / llm) |
| `payload` | `change` jsonb + `evidence` |
| `autonomy_tier` | `gated_rollout` — approval creates a `ux_overrides` row at a rollout % behind `UX_OPTIMIZER_ENABLED` (`:483-525`) |
| `status` | `proposed` (`:246`) → `rejected` (`:464`) / `live` (`:510`) / `rolled_back` (`:545`) |
| confirmation | `reviewProposal()` at `:442`; `reviewed_by` is the JWT user id, never caller-supplied (`:436-441`) |
| audit | every outcome appended to `ux_learnings` |

**Verdict: adopt this convention's guardrail wording and its rollout tier.** Two
things it does that nothing else does:

- Its docstring (`:32-45`) records that a previous `AUTO_APPLY = false` constant
  *was referenced in no conditional and therefore guarded nothing* — "a
  guardrail that is not on the path it claims to guard is worse than none: it
  gets believed." That is why invariant #1 in §1 demands an assertion at the
  write site rather than a flag.
- It closes the loop: only *regressions* auto-revert (`:679`, `:725`);
  promotion always needs a human.

---

## 5. Migration order

Sequenced so nothing is a big-bang and each step is independently revertable.
Steps 1–2 are additive schema; nothing before step 5 removes a code path.

1. **Constants and contract, no schema.** Land `action_family`, `action_kind`,
   `autonomy_tier`, `proposer` as a shared vocabulary carried in the existing
   `metadata`/`details` jsonb of all four tables. New proposers write it; old
   rows do not have it. *(Done for `procurement.recurring_order.place`:
   `recurring_order_agent.py:73-84`.)*
2. **Promote `one_tap_actions` to the base table.** Add nullable
   `action_family`, `action_kind`, `proposer_type`, `proposer_name`,
   `autonomy_tier`, `decision_log_id`, `correlation_id`; backfill from
   `action_type` + `metadata`. Keep the `action_type` enum in place and
   dual-written — it is what the mobile and web renderers dispatch on.
3. **Unify the status vocabulary behind a read view.** One `agent_actions` view
   over `one_tap_actions` ∪ `drift_findings` ∪ `procurement_conversations`
   (outbound, AI-generated) ∪ `ux_proposals`, normalising
   `open`/`proposed`/`PENDING_APPROVAL` → `pending`. Read-only. This is the
   first step that produces something the founder can see: one answer to "what
   is the AI waiting on me for?"
4. **Give `drift_agent` findings a confirmation record.** Add
   `resolved_by`/`resolved_at` to `drift_findings`; route resolution through an
   authenticated endpoint. Highest-value remaining gap after A3's first
   increment — money/stock findings currently change state with no record of who
   changed them.
5. **Move writes onto the base table, one family at a time**, in ascending order
   of blast radius: `insight` → `calendar` → `catalog` → `inventory` →
   `communications` → `procurement`. Each family's old table becomes a view over
   the base table for one release, then is dropped.
6. **Extend the `one_tap_action_type` enum** with first-class values (or replace
   the dispatch with `action_kind`) and stop writing `custom` from
   `recurring_order_agent`. Deliberately last: it forces a renderer change on
   both web and mobile, and step 2 makes it non-urgent.
7. **Ask AI composes envelopes.** FUTURES §8's action composer emits this shape
   directly, with no per-family branching. This is the payoff and it is
   unreachable before step 3.

---

## 6. What A3's first increment actually landed

| Item | Where |
|---|---|
| `recurring_order_agent` subclasses `BaseAgent` (lifecycle, retry, idempotency, DLQ, circuit breaker, health) | `services/agent-orchestrator/agents/recurring_order_agent.py` |
| Order-placement path **deleted** (`_create_order` gone; `auto_approve` demoted to a priority hint) | same file, module docstring |
| Enforcement point — refuses any caller-supplied row carrying a confirmation stamp | `recurring_order_agent.py:397-429` |
| Registered, tier `OPTIONAL`, gated off (`AGENT_RECURRING_ORDER_AGENT_ENABLED`) | `core/orchestrator.py:223`, `core/agent_registry.py:209` |
| `recurring.events` exchange declared — `NotificationAgent` had bound three keys on it since Phase 21 against an exchange that was never created, so both ends were inert | `core/message_bus.py:496` |
| Tests: no-auto-execute guarantee, enforcement point, lifecycle, registry gating | `tests/test_recurring_order_agent.py` |

**Not** landed, and explicitly deferred to the steps above: the base-table
columns (step 2), the unified read view (step 3), and any change to the other
three conventions.

---

## 7. Open questions for the founder

These are genuine forks, not implementation detail. They are listed here rather
than defaulted.

1. **Does `recurring_order_agent` ever run against live tenants, and under what
   gate?** It is OPTIONAL and off. Turning it on means managers start receiving
   purchase proposals on a daily sweep. That is a product decision this spec
   does not make. *(Also resolves the second half of OD-31, which asks whether
   this agent "becomes a real agent or is deleted" — the first half is now
   answered: it is a real agent.)*
2. **Should a per-tenant pre-authorisation tier exist for `procurement`, as it
   does for `communications` (§4.3)?** The vendor-reply gate is defensible
   because it is per-provider, re-evaluated, and fails closed. An equivalent for
   purchasing is *possible* under the same three conditions — but it is money,
   and FUTURES §8.4 lists "auto-execute for low-risk" as deferred. Recommend:
   no, not before step 4.
3. **Is `ux` a real `action_family`, or does the UX optimizer stay a separate
   system?** It is the only family with no operator-facing meaning; folding it
   in makes the unified view noisier for a manager. Recommend: keep the shape,
   exclude it from the manager-facing view by default.
