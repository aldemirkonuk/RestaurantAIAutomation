---
type: loops
division: commercial
department: sales
team: design-partner-operations
status: partial
metrics: [sales.time_to_first_connection, sales.design_partner_touch_streak, sales.unprompted_sessions_7d, sales.verified_dollars_recovered, sales.blocker_age_max, nf_b.source_count]
updated: 2026-08-24
links: ["[[design-partner-operations-charter]]", "[[design-partner-operations-premortem]]", "[[design-partner-operations-directive]]", "[[design-partner-operations-schedule]]", "[[sales-loops]]", "[[analytics-bi-charter]]", "[[pos-bridge-charter]]", "[[product-vision-charter]]", "[[media-brand-charter]]", "[[guest-experience-charter]]", "[[research-math-charter]]", "[[LOOP-MAP]]"]
loop_count: 6
loop_ids: ["dpo-connection-countdown", "dpo-touch-and-blockers", "dpo-politeness-detector", "dpo-credit-landing", "dpo-receiving-discipline", "dpo-patience-budget"]
loop_close_times: ["weekly", "weekly", "weekly", "monthly", "weekly", "weekly"]
loop_statuses: ["proposed", "proposed", "blocked", "blocked", "proposed", "proposed"]
---

# Design Partner Operations — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

**Reading note.** Six loops; **two run today.** The two that matter most (L3 politeness,
L4 recovery) are blocked on artifacts that do not exist. Stated per loop rather than
implied, because a loop marked running while its input is `null` manufactures the feeling
of a controlled system.

---

## L1 — Connection countdown

```yaml
type: loop
id: dpo-connection-countdown
owner: design-partner-operations
measures: [sales.time_to_first_connection]
changes: [design_partner.credential_state, dpo.board_priority]
inputs_from: [design-partner-operations]
outputs_to: [sales, pos-bridge, guest-experience, research-math, analytics-bi]
close_time: weekly
status: proposed
```

**Measures.** Days since 2026-08-24 with `DEP-06` unchecked
(`.planning/PROJECT.md:101`).
**Changes.** Board composition — while it runs, it is the only item. Day 30 escalates as a
scheduling failure; day 60 means [[design-partner-operations-premortem]] M2 landed.
**Fan-out.** `nf_b.source_count` is `0` and cannot move until this closes; there is exactly
one candidate restaurant in existence (`.planning/PROJECT.md:127`).
**Runs today?** **Yes.** A checkbox and a calendar.

---

## L2 — Weekly touch and blocker queue

```yaml
type: loop
id: dpo-touch-and-blockers
owner: design-partner-operations
measures: [sales.design_partner_touch_streak, sales.blocker_age_max, sales.blockers_open]
changes: [dpo.week_priority, product-vision.need_queue, pos-bridge.fault_queue]
inputs_from: [design-partner-operations]
outputs_to: [product-vision, pos-bridge, sales]
close_time: weekly
status: proposed
```

**Measures.** Consecutive qualifying weeks, plus the age of the oldest open blocker. A
touch qualifies only if it produced an observed usage moment or a named blocker.
**Changes.** Next week's single ask. A blocker older than 14 days escalates — the
restaurant will not chase us, and silence is not patience.
**The trap.** A streak is gamed by sending a text. The qualification rule is the entire
defence; without it this loop measures the founder's politeness rather than the customer's.
**Runs today?** **Yes**, by hand — and it needs a contact log, which does not exist. That
log is also the only signal for [[design-partner-operations-premortem]] M4.

---

## L3 — Politeness detector *(the one that decides the outcome)*

```yaml
type: loop
id: dpo-politeness-detector
owner: design-partner-operations
measures: [sales.unprompted_sessions_7d, sales.session_to_contact_delta, sales.sentiment_note]
changes: [dpo.relationship_verdict, product-vision.need_queue, sales.escalation_state]
inputs_from: [analytics-bi]
outputs_to: [sales, product-vision, red-team]
close_time: weekly
status: blocked
```

**Measures.** Sessions in 7 days **not** preceded within 24 hours by a founder message —
and, deliberately alongside it, the week's sentiment note. **The signal is the
divergence.** Warm words with a flat line is M1 in progress; either half alone says
nothing.
**Changes.** Three consecutive zero weeks escalates **automatically**
([[design-partner-operations-directive]]), because this is the failure nobody escalates
voluntarily.
**Blocked on.** One event from [[analytics-bi-charter]]: session start carrying
`seconds_since_last_founder_contact`. `env.example` (187 lines) has no analytics key;
Sentry is the only telemetry SDK (`.planning/foundation/EXTERNAL_CONNECTIONS.md`).
**Runs today?** **No** — and it is the highest-value unblock available to this team.

---

## L4 — Credit landing reconciliation

```yaml
type: loop
id: dpo-credit-landing
owner: design-partner-operations
measures: [sales.credits_requested, sales.credits_landed, sales.verified_dollars_recovered, sales.credit_landing_rate]
changes: [media-brand.case_study_inputs, sales.claim_allowlist, outbound-engine.evidence_gate]
inputs_from: [design-partner-operations, procurement]
outputs_to: [media-brand, outbound-engine, finance-pricing, strategy-fundraising]
close_time: monthly
status: blocked
```

**Measures.** Two counters that must never merge: credits **requested**, credits
**landed**. The gap between them is the honesty of every claim the company makes
(`.planning/YC_WEDGE_PLAN.md:31-33`).
**Changes.** The first landed credit flips the division's evidence gate — the literal
switch that lets anyone publish a dollar figure.
**Why monthly.** Credit memos arrive on the *next* billing cycle. A weekly close would
report "requested" and call it recovery, which is the exact error the metric exists to
prevent. The counterparty sets the close-time.
**Blocked on.** `overbilled_vs_ship` (`.planning/YC_WEDGE_PLAN.md:342`) needs a
machine-read invoice; the invoice half is hand-typed per line item
(`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400,438`).
**Manual path — open now.** The founder types one week of real invoices. One landed credit
is all that is needed.
**Runs today?** **Not automatically. Manually, yes — and it should, this quarter.**

---

## L5 — Receiving discipline watch

```yaml
type: loop
id: dpo-receiving-discipline
owner: design-partner-operations
measures: [dpo.receiving_sessions_per_delivery, dpo.invoice_fields_blank_rate]
changes: [dpo.manual_entry_commitment, product-vision.ingestion_priority]
inputs_from: [design-partner-operations, procurement]
outputs_to: [product-vision, engineering, sales]
close_time: weekly
status: proposed
```

**Measures.** Receiving sessions per delivery, and the share of deliveries where the
invoice fields are left blank. The UI treats blank as a legitimate state — *"Empty means
'no invoice yet', which is a real and common state"*
(`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:397-398`) — so the product
will never complain, and neither will the restaurant.
**Changes.** A blank rate above 50% in week two triggers the manual-entry commitment (we
type them) and raises ingestion priority with Engineering.
**Why it exists as its own loop.** To keep one specific misreading from happening:
*"the customer stopped entering invoices"* is **not** *"the customer does not care about
overbilling."* Different findings, opposite implications, and only one is about the
product. → [[design-partner-operations-premortem]] M5
**Runs today?** **Yes**, once connected. Countable from receiving records.

---

## L6 — Relationship patience budget

```yaml
type: loop
id: dpo-patience-budget
owner: design-partner-operations
measures: [dpo.asks_per_week, dpo.decline_or_defer_streak]
changes: [dpo.ask_queue, org.access_to_account]
inputs_from: [customer-relationship-research, guest-experience, media-brand, product-vision]
outputs_to: [sales, customer-relationship-research, guest-experience, media-brand]
close_time: weekly
status: proposed
```

**Measures.** Substantive asks landing on the account per week, from **any** unit, and the
streak of declined or deferred asks.
**Changes.** The queue. Above one ask per week, everything else defers. Two consecutive
declines or deferrals pauses **all** asks and reports strain to the department — that is
the earliest honest reading of a relationship going quiet, and reading it late is
irreversible.
**Why a loop rather than a rule.** A rule with no counter is a preference. The counter is
the mechanism. → [[design-partner-operations-premortem]] M4
**Runs today?** **Yes** — as soon as the contact log exists. It does not yet.

---

## Loop health

| Loop | Close-time | Status | Blocked on |
|---|---|---|---|
| L1 Connection countdown | weekly | **runnable** | nothing |
| L2 Touch + blockers | weekly | runnable | contact log (trivial) |
| L3 Politeness detector | weekly | **blocked** | one analytics event |
| L4 Credit landing | monthly | blocked / manual path open | invoice ingestion |
| L5 Receiving discipline | weekly | runnable after connection | `DEP-06` |
| L6 Patience budget | weekly | runnable | contact log (trivial) |

**Two artifacts unblock four loops:** a contact log (L2, L6 — an afternoon) and one
analytics event (L3 — one ask into [[analytics-bi-charter]]). Neither is hard. Both guard
failures that are invisible from inside the friendship, which is precisely why they need
to be counters rather than intentions.
