---
type: premortem
division: commercial
department: sales
team: design-partner-operations
status: partial
metrics: [sales.unprompted_sessions_7d, sales.verified_dollars_recovered, sales.time_to_first_connection, sales.blocker_age_max, sales.design_partner_touch_streak]
updated: 2026-08-24
links: ["[[design-partner-operations-charter]]", "[[design-partner-operations-loops]]", "[[design-partner-operations-directive]]", "[[sales-premortem]]", "[[outbound-engine-premortem]]", "[[red-team-charter]]", "[[analytics-bi-charter]]", "[[customer-relationship-research-charter]]", "[[guest-experience-charter]]", "[[YC_WEDGE_PLAN]]", "[[PROJECT]]"]
---

# Design Partner Operations — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.
> M1 is the highest-probability failure in the Commercial division. **It will feel like
> success for the entire twelve months it is happening**, which is what makes it the one
> worth building instrumentation for before anything else.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — The friendship carried the account

Every interaction was warm. The owner said the invoice problem was real, that the product
looked useful, that he would try it this week. He meant all of it. He also never opened it
unless the founder texted first — and because the founder always texted first, there was
never a week without a session, so there was never a week that looked like failure.

The mechanism has three parts and only the third is unusual:

1. **A friend has one polite answer** to *"is this useful?"*, and it is yes.
2. **The founder is the sole source of activation**, so activation and usage are the same
   event and cannot be told apart.
3. **The founder is also the person interpreting the data** — and he is being told, weekly
   and sincerely, that things are going well by someone he trusts.

Twelve months on, the first prospect who owes us nothing meets a product validated by
nobody. Worse: the founder's confidence is high, so the disconfirming evidence arrives at
maximum cost, in front of the one prospect that mattered.

**Earliest observable signal.** `sales.unprompted_sessions_7d == 0` for three consecutive
weeks while sentiment stays positive. The signal is the **divergence**, not either half.
It is visible from week one of connection — and **today it is not visible at all**:
`env.example` (187 lines) has no analytics key, and Sentry is the only telemetry SDK
(`.planning/foundation/EXTERNAL_CONNECTIONS.md`).

**What would have prevented it.**

1. **The unprompted-session event exists before the first demo.** One field —
   `seconds_since_last_founder_contact` on session start. Under 24 hours means the session
   was prompted. Requested from [[analytics-bi-charter]]; it is this team's single highest
   -value ask of any other unit, and it must land *before* the relationship starts
   generating opinions, because afterwards the numbers get read through them.
2. **Ask for the substitute behaviour, not the verdict.** Never *"is this useful?"*
   Always *"what did you do last Tuesday instead of opening this?"* A friend will describe
   their actual Tuesday truthfully. They will not tell you your product is bad.
3. **A monthly stranger call as a calibration instrument.** Even with the target list
   deferred: one conversation a month with someone who owes us no kindness. Not pipeline —
   a control group of one against politeness.
4. **The escalation is automatic, not discretionary.** Three zero weeks escalates by
   schedule ([[design-partner-operations-directive]]), because the defining property of
   this failure is that nobody escalates it voluntarily.
5. **[[red-team-charter]] holds the number.** An outside reviewer with a threshold beats
   an inside reviewer with a judgement, especially when the inside reviewer is also the
   friend.

---

### M2 — DEP-06 was never checked

`DEP-06` sits unchecked (`.planning/PROJECT.md:101`) while the connector it needs is
already written: `apps/api-gateway/src/toast/` holds a 33KB service with `getSalesData`
and `processWebhook`, an OAuth service, a controller, DTOs, and a spec; the config
placeholders are already in `env.example:49-56`. The gap is **five values and one
conversation.**

That is exactly why it survives. It is not hard, not blocked, not assigned to a phase, and
never the most interesting thing available on a given day. Meanwhile everything downstream
waits: the recovery number, the case study, the demo — and NF-B, which has no other
possible source because there is exactly one candidate restaurant in existence
(`.planning/PROJECT.md:127`).

**Earliest observable signal.** `sales.time_to_first_connection > 30` days from
2026-08-24 with the box unchecked. Zero interpretation required; it is a grep.

**What would have prevented it.** A **date and a visit**, not a ticket. The credential
exchange happens in person at the restaurant, because a task that requires the other
party's attention does not survive being asked for over text. Concretely: this team's board
carries exactly one item until the box is ticked
([[design-partner-operations-agenda-board]]), and a hard checkpoint at **2026-09-24**
escalates it to the founder as a *scheduling* failure — which is what it is.

---

### M3 — We asked for credits and never watched them land

The team finds a genuine discrepancy, helps the restaurant claim it, and books the win.
The distributor agrees on the phone, then applies the credit partially, or on a later
invoice under a different SKU, or not at all. Nobody checks — checking requires reading
next month's invoice, which is a chore with no dopamine attached. The company's headline
number becomes *dollars requested*, which is a number about our activity rather than the
customer's outcome. Every artifact downstream inherits the error: the case study, the
outbound sequence, the traction slide.

The repo's own analysis names this precisely: until an 812 lands on a later invoice,
"dollars recovered" means *"we asked"* (`.planning/YC_WEDGE_PLAN.md:31-33`).

**Earliest observable signal.** The first time `credits_requested > 0` while
`verified_dollars_recovered` has never been computed. One request with no reconciliation
behind it — visible in week one of the first claim.

**What would have prevented it.** **Two counters, never one.** `credits_requested` and
`credits_landed` are tracked separately from the first claim, and only the second is ever
published. Plus a **monthly reconciliation timed to the distributor's billing cycle** —
the close-time is set by the counterparty, not by our preference for weekly reporting
([[design-partner-operations-loops]] L4). The candidate skill `credit-memo-reconcile`
exists to make this cheap enough to actually happen.

---

### M4 — We burned the relationship's patience on the wrong asks

One restaurant, one owner, a finite tolerance for being a research subject. In the same
month he is asked for: credentials, a testimonial, a research interview by
[[customer-relationship-research-charter]], guest-data permission for
[[guest-experience-charter]], a logo, a reference call, and feedback on three screens. Each
ask is individually reasonable. Collectively they turn a friend doing a favour into a
person being farmed, and the polite version of withdrawal is slow, unannounced, and
irreversible — he simply becomes busier.

**Earliest observable signal.** More than **two distinct asks** land on the account in one
calendar week, from any unit. Countable the moment a contact log exists — and the contact
log does not exist today, which is the actual gap.

**What would have prevented it.** **One front door.** Every unit's request to this account
routes through this team, which sequences them — not for approval, but so the org of one
person does not behave like an org of six. Concretely: a shared contact log, a cap of one
substantive ask per week, and a written priority order (connection → recovery evidence →
reference permission → research → guest data). The cap is the mechanism; the priority
order is what makes the cap decidable instead of arbitrary.

---

### M5 — The restaurant connected, and the product could not be used by a real kitchen

Credentials land, Toast data flows, and then the operational reality lands with it. The
invoice half must be typed by hand, line by line
(`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400,438`) — during a
delivery, in a kitchen, by someone holding a paper invoice and a phone. Receiving
discipline decays within two weeks. Without invoice data the four-way match's headline
verdict `overbilled_vs_ship` (`.planning/YC_WEDGE_PLAN.md:342`) never fires, so the
product's strongest claim is never demonstrated in the one place it could have been. The
account is technically live and produces nothing.

**Earliest observable signal.** Receiving sessions per delivery falls below 1.0 in the
second week after connection. Sharper still and available immediately: the **first
delivery where the invoice fields are left empty** — the UI already treats blank as a real
state ("*Empty means 'no invoice yet', which is a real and common state*",
`ReceivingWorkspace.tsx:397-398`), so the product will not complain, and neither will the
restaurant.

**What would have prevented it.** **Do the typing ourselves for the first month.** The
founder enters the invoices, not the kitchen. It does not scale, it is not a product, and
it is exactly right for one account: it buys a real `overbilled_vs_ship` verdict on real
invoices while the ingestion gap is fixed properly by Engineering. The failure to avoid is
mistaking *"the customer stopped entering invoices"* for *"the customer does not care about
overbilling."* Those are different findings with opposite implications, and only one of
them is about the product.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible |
|---|---|---|---|
| M1 | Friendship carries the account | 3 weeks of `unprompted_sessions_7d == 0` with warm sentiment | Analytics — **does not exist yet** |
| M2 | DEP-06 never checked | day 30 with the box open | `.planning/PROJECT.md:101` |
| M3 | Asked, never verified | first credit request with no reconciliation | Claim log vs invoice |
| M4 | Relationship patience burned | >2 asks in one week from any unit | Contact log — does not exist yet |
| M5 | Kitchen cannot use it | first delivery with empty invoice fields | Receiving records |

Two of the five signals require artifacts that do not exist: the analytics event (M1) and
the contact log (M4). Those are the two cheapest things this team can build, and they
guard the two failures that are hardest to see from the inside.
