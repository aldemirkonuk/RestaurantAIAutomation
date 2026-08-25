---
type: loops
division: commercial
department: sales
status: new
metrics: [sales.time_to_first_connection, sales.unprompted_sessions_7d, sales.verified_dollars_recovered, sales.design_partner_touch_streak, sales.qualified_conversation_rate, sales.sending_identity_isolated]
updated: 2026-08-24
links: ["[[sales-charter]]", "[[sales-premortem]]", "[[sales-directive]]", "[[sales-schedule]]", "[[design-partner-operations-loops]]", "[[outbound-engine-loops]]", "[[analytics-bi-charter]]", "[[pos-bridge-charter]]", "[[media-brand-charter]]", "[[product-vision-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_ids: ["sales-connection-countdown", "sales-design-partner-cadence", "sales-politeness-detector", "sales-recovery-verification", "sales-outbound-calibration"]
loop_close_times: ["weekly", "weekly", "weekly", "monthly", "fortnightly"]
loop_statuses: ["proposed", "proposed", "blocked", "blocked", "dormant"]
---

# Sales — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

**Reading note.** Five loops. **Four of the five cannot currently close**, because the
measurement they depend on does not exist. That is stated per loop rather than hidden —
a loop documented as running when its input is `null` is worse than no loop, because it
manufactures the feeling of a controlled system.

---

## L1 — Connection countdown

The department's only unblocked loop, and the only one that closes today.

```yaml
type: loop
id: sales-connection-countdown
owner: sales
measures: [sales.time_to_first_connection]
changes: [design_partner.credential_state, sales.board_priority]
inputs_from: [design-partner-operations]
outputs_to: [pos-bridge, guest-experience, research-math, analytics-bi]
close_time: weekly
status: proposed
```

**What it measures.** Days since 2026-08-24 with `DEP-06` unchecked
(`.planning/PROJECT.md:101`). Binary input, integer output.

**What it changes.** Below 30 days: the board carries it as the single top item. At 30
days: it escalates to the founder as a scheduling failure, not a technical one. At 60
days: [[sales-premortem]] M2 is realised and the department's honest status is *blocked on
one conversation*.

**Why it fans out so widely.** NF-B has no source without it. There is exactly one
candidate restaurant (`.planning/PROJECT.md:127`), so this loop's output is a hard input to
[[guest-experience-charter]] and [[research-math-charter]] whether or not they know it.

**Can it close today?** **Yes.** A checkbox and a date.

---

## L2 — Design partner contact cadence

```yaml
type: loop
id: sales-design-partner-cadence
owner: design-partner-operations
measures: [sales.design_partner_touch_streak, sales.blockers_open]
changes: [sales.weekly_priority, product-vision.need_queue]
inputs_from: [design-partner-operations]
outputs_to: [product-vision, media-brand, sales]
close_time: weekly
status: proposed
```

**What it measures.** Consecutive weeks with a real contact, and the count of blockers the
restaurant is currently sitting behind.

**What it changes.** A broken streak reorders next week's priority. An open blocker older
than two weeks escalates — the restaurant is not going to chase us.

**The trap this loop must not become.** A streak is trivially gamed by sending a text.
Contact is only counted when it produced either an observed usage moment or a named
blocker. A "checking in!" message is not a touch.

**Can it close today?** **Yes**, weakly — the streak is countable by hand from day one.
It becomes meaningful only once L3 exists to tell contact from activation.

---

## L3 — Politeness detector *(the department's most important loop, and it cannot run)*

```yaml
type: loop
id: sales-politeness-detector
owner: design-partner-operations
measures: [sales.unprompted_sessions_7d, sales.session_to_contact_delta]
changes: [sales.relationship_verdict, product-vision.need_queue]
inputs_from: [analytics-bi]
outputs_to: [sales, product-vision, red-team]
close_time: weekly
status: blocked
```

**What it measures.** Sessions in the last 7 days **not** preceded within 24 hours by a
founder message. The delta is the whole signal: warm words with a flat unprompted line is
[[sales-premortem]] M1 in progress.

**What it changes.** Three consecutive zero weeks escalates automatically per
[[sales-directive]] — automatically, because this is the one failure nobody escalates
voluntarily.

**Why `status: blocked`.** No product analytics are configured. `env.example` (187 lines)
contains no analytics key, and Sentry is the only telemetry SDK
(`.planning/foundation/EXTERNAL_CONNECTIONS.md`). The input does not exist.

**Unblocking it.** One event from [[analytics-bi-charter]]: session start carrying
`seconds_since_last_founder_contact`. That is the entire dependency, and it is the
department's highest-value ask of another unit.

**Can it close today?** **No.** And this is the loop most likely to decide whether the
department succeeds.

---

## L4 — Recovery verification

```yaml
type: loop
id: sales-recovery-verification
owner: design-partner-operations
measures: [sales.verified_dollars_recovered, sales.credits_requested, sales.credit_landing_rate]
changes: [media-brand.case_study_inputs, outbound-engine.claim_allowlist, strategy-fundraising.traction_inputs]
inputs_from: [design-partner-operations, analytics-bi]
outputs_to: [media-brand, outbound-engine, finance-pricing, strategy-fundraising]
close_time: monthly
status: blocked
```

**What it measures.** Two numbers that must never be conflated: credits **requested**, and
credits that **landed on a later invoice**. The gap between them is the honesty of every
claim the company makes (`.planning/YC_WEDGE_PLAN.md:31-33`).

**What it changes.** A landed credit unlocks the evidence gate in [[sales-directive]] — it
is the literal switch that lets [[outbound-engine-charter]] and [[media-brand-charter]]
use a dollar figure at all.

**Why monthly.** Credit memos arrive on the *next* invoice cycle. A weekly close would
report "requested" and call it recovery, which is the exact error the metric exists to
prevent. The close-time is set by the counterparty's billing cycle, not by our preference.

**Why `status: blocked`.** The headline verdict `overbilled_vs_ship`
(`.planning/YC_WEDGE_PLAN.md:342`) needs a machine-read invoice; today the invoice half is
hand-typed per line item (`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400,438`).
**Manual workaround that unblocks v0:** run one week of real invoices by hand. One landed
credit closes this loop once, which is all that is needed to open the gate.

**Can it close today?** **Not automatically. Manually, yes** — and it should be, this
quarter.

---

## L5 — Outbound calibration *(dormant by construction)*

```yaml
type: loop
id: sales-outbound-calibration
owner: outbound-engine
measures: [sales.qualified_conversation_rate, sales.reply_rate, sales.complaint_rate, sales.sending_identity_isolated]
changes: [outbound.sequence_copy, outbound.qualification_rubric, outbound.send_volume]
inputs_from: [outbound-engine, compliance-privacy]
outputs_to: [sales, growth, finance-pricing]
close_time: fortnightly
status: dormant
```

**What it measures.** Qualified conversations per 100 first-touches; reply rate; and
`complaint_rate`, which is the safety metric rather than the performance one.

**What it changes.** Copy, rubric, and volume. Volume is the dangerous dial — a complaint
rate crossing threshold cuts volume to zero automatically rather than being discussed.

**Entry trigger — this loop does not start until both hold:**
`sales.verified_dollars_recovered > 0` **and** the founder has un-deferred the target list.
Written as a trigger rather than a plan so the loop cannot quietly begin
([[sales-premortem]] M5).

**Can it close today?** **No, and it must not.** `sales.sending_identity_isolated == false`
(`apps/api-gateway/src/communications/gmail.service.ts:76-78`); a send today would put
procurement mail behind a sales reputation.

---

## Loop health

| Loop | Close-time | Status | Blocked on |
|---|---|---|---|
| L1 Connection countdown | weekly | **proposed, runnable** | nothing |
| L2 Contact cadence | weekly | proposed, weak | L3 for meaning |
| L3 Politeness detector | weekly | **blocked** | one analytics event |
| L4 Recovery verification | monthly | blocked (manual path open) | invoice ingestion |
| L5 Outbound calibration | fortnightly | **dormant** | the number + the list |

**One runnable loop out of five.** That is the true state of the department and the reason
[[sales-agenda-board]] carries a single top item. Unblocking L3 costs one event from
another team and converts the department's most dangerous blind spot into a weekly number
— the highest-leverage request Sales can make of anyone.
