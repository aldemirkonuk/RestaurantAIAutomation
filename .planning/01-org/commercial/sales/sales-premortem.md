---
type: premortem
division: commercial
department: sales
status: new
metrics: [sales.unprompted_sessions_7d, sales.verified_dollars_recovered, sales.design_partner_touch_streak, sales.sending_identity_isolated, sales.time_to_first_connection]
updated: 2026-08-24
links: ["[[sales-charter]]", "[[sales-directive]]", "[[sales-loops]]", "[[sales-agenda-full]]", "[[design-partner-operations-premortem]]", "[[outbound-engine-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[analytics-bi-charter]]", "[[commercial]]", "[[YC_WEDGE_PLAN]]", "[[PROJECT]]"]
---

# Sales — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.
> The first one is the highest-probability failure in the entire Commercial division,
> and it will feel like success the whole time it is happening.

## It is 2027-08-24 and this department has failed. What happened?

---

### M1 — The friendship carried the account, and politeness was read as product-market fit

The design partner is a friend (`.planning/PROJECT.md:127`). Friends are agreeable. The
restaurant says the product looks great, agrees the invoice problem is real, promises to
try it this week, and never opens it unprompted. The founder, receiving warm signal every
single time he asks, concludes the product works. Twelve months later the first real
prospect — someone with no reason to be kind — meets a product that has been validated by
nobody, and the gap between "my friend likes it" and "a stranger will pay" is discovered
at the worst possible moment, in front of the only prospect that mattered.

The mechanism is not that the friend lies. It is that **the founder is the only source of
activation, and nobody measures that.** Every session is preceded by a text message, so
every session looks like usage.

**Earliest observable signal.** `sales.unprompted_sessions_7d == 0` for three consecutive
weeks while qualitative sentiment stays positive. The tell is the *divergence*: warm words
with a flat usage line. It is visible from the first week the product is connected — and
today it is not visible at all, because no product analytics exist anywhere in
`env.example` (187 lines) and Sentry is the only telemetry SDK
(`.planning/foundation/EXTERNAL_CONNECTIONS.md`).

**What would have prevented it.**

1. **Instrument unprompted sessions before the first demo, not after.** One event —
   session start with a `last_founder_contact_at` delta — is enough. If the delta is under
   24 hours, the session was prompted. This is a day of work and it is the difference
   between evidence and vibes. It must exist *before* the relationship generates opinions,
   because after that the data will be interpreted through them.
2. **A standing question the friend can answer honestly.** Not *"is this useful?"* — which
   has one polite answer — but *"what did you do last Tuesday instead of opening this?"*
   Ask for the substitute behaviour, not the verdict. A friend will tell you what they
   actually did; they will not tell you your product is bad.
3. **A second, non-friend design partner as a control.** Deliberately hard given the
   deferred list, so the weaker form: **one stranger conversation per month**, even with
   no target list, purely as a calibration instrument against politeness. Recorded in
   [[sales-loops]] as `L4`.
4. **Written down at founding that this is the expected failure.** [[red-team-charter]]
   holds the department to `sales.unprompted_sessions_7d`, and the founder pre-agrees
   today that three flat weeks triggers a review — so the review is a schedule item rather
   than an admission.

---

### M2 — DEP-06 was never checked, and a year of work sat behind five environment variables

`DEP-06: Toast API credentials configured for friend's restaurant` is unchecked
(`.planning/PROJECT.md:101`). Everything downstream waits on it: the recovery number, the
case study, the demo, and — because there is exactly one candidate restaurant in existence
— the entire NF-B guest track ([[README]] §4.2). The connector is already built
(`apps/api-gateway/src/toast/`, ~52KB across 5 files) and the config placeholders already
exist (`env.example:49-56`). Nothing is missing except a conversation and five values.

That is precisely why it does not happen. There is no phase that owns it, no ticket
blocking on it, and it is never the most interesting thing available on any given day. It
is a five-minute task with no deadline, which is the exact profile of a task that survives
a year.

**Earliest observable signal.** `sales.time_to_first_connection` passes **30 days** from
2026-08-24 with the box still unchecked. There is no ambiguity to interpret — the checkbox
is either ticked or it is not, and it is a `grep` away.

**What would have prevented it.** Make it the **only** item on the department's board
until it closes, and give it a named consequence: if `DEP-06` is unchecked at 2026-09-24,
Sales stops producing documents and the founder books the restaurant visit. Concretely,
[[sales-loops]] `L1` closes **weekly** with exactly one binary output, and
[[sales-agenda-board]] shows nothing else above it. A department whose first act is
writing charters instead of entering five environment variables has already chosen the
comfortable failure.

---

### M3 — The outbound sequence sold a claim the product had not earned

Pressure arrives — a YC deadline, a quiet month, an urge to see the machine work — and
outbound ships before [[design-partner-operations-charter]] has a **verified** recovery
number. The sequence therefore claims something like *"restaurants recover $X in
overbilling"* where `$X` is modelled, extrapolated, or drawn from a credit that was
*requested* rather than *received*. That distinction is exactly the one the repo's own
analysis insists on: until an 812 credit memo lands on a later invoice, "dollars
recovered" means *"we asked"* (`.planning/YC_WEDGE_PLAN.md:31-33`).

Restaurants are a small, talkative market. A claim that does not survive the first pilot
does not merely fail to close that deal — it burns the reference, and the correction never
travels as far as the claim did.

**Earliest observable signal.** The first outbound artifact (sequence copy, landing page,
demo script, YC application paragraph) containing a **dollar figure whose provenance is
not a landed credit**. Detectable at review time, before anything sends, by one question:
*which invoice did that credit appear on?*

**What would have prevented it.** A hard gate in [[sales-directive]]: **no outbound copy
may contain a recovery figure until `sales.verified_dollars_recovered > 0`.** Until then
the sequence sells the *mechanism* (four-way match, `overbilled_vs_ship` outranking every
verdict but a missing invoice — `.planning/YC_WEDGE_PLAN.md:342`) and offers to run it on
the prospect's own last month of invoices. Selling the mechanism is honest, it is
differentiated, and it does not require a number we do not have. The gate is machine-ish:
a claim needs a citation to a landed credit, or it does not ship.

---

### M4 — Deliverability burned on the shared identity and took procurement down with it

Cold outbound goes out through the platform's existing Gmail plumbing, because it is
already wired and adding a second identity feels like premature infrastructure. The
transactional sender is a single hardcoded identity
(`apps/api-gateway/src/communications/gmail.service.ts:76-78`) and the inbound poller
filters against that same address (`communications.controller.ts:1028-1031`). Cold mail
attracts spam complaints by nature. Reputation degrades, and the first casualties are the
messages that matter most: purchase orders to vendors and low-stock alerts to the
customer. **One reputation, three broken systems** — and the outage presents as a
procurement bug, so the sales experiment that caused it is the last place anyone looks.

**Earliest observable signal.** Any cold-outbound send where the envelope sender resolves
through `GmailService`. That is a code-review-visible fact on day one — long before a
single bounce — and it is checkable with a grep, not a metric.

**What would have prevented it.** Two things, both cheap:

1. **A separate sending domain and backend for cold outbound, before send #1.** The seam
   already exists and is unused: `env.example:165` declares `EMAIL_BACKEND=gmail` and a
   second backend key is already reserved (`SENDGRID_API_KEY`, `env.example:167`, read at
   `services/agent-orchestrator/config/settings.py:202`). This is configuration, not
   architecture.
2. **A CI guard in the shape of the repo's existing `scripts/check_*.sh` family**: no
   module under a sales/outbound path may import `GmailService`. A grep-grade check that
   makes the boundary structural rather than remembered. `sales.sending_identity_isolated`
   is a boolean and it must be `true` before the machine is allowed to run.

---

### M5 — The department out-produced the work: two teams, fourteen documents, one unchecked box

[OD-09](../../../decisions/OPEN-DECISIONS.md) records the founder overruling the
recommendation to merge Sales into [[growth-charter]]
(OD-09, `.planning/decisions/OPEN-DECISIONS.md:104`). That overrule stands. The risk it creates is
specific and worth naming: **one of the two teams is dormant by construction** —
[[outbound-engine-charter]]'s own primary metric is "dormant until the list un-defers"
([[commercial]] §3). A dormant team with seven documents and no forcing function does not
stay honestly dormant. It acquires activity to justify itself: a sequencing tool nobody
sends from, a qualification rubric with no one to qualify, a warmed domain with no list.
Twelve months later the department's output is fourteen documents describing a machine
that never ran, while `DEP-06` is still unchecked.

**Earliest observable signal.** At **2026-11-24** (three months): the unit-document count
under `.planning/01-org/commercial/sales/` is 21 while `sales.verified_dollars_recovered`
is `$0` and `DEP-06` is unchecked. Documents outnumbering outcomes 21:0 is the signal, and
it is **already 21:0 today** — which is exactly why the date matters more than the ratio.

**What would have prevented it.** The department carries **its own entry trigger**, in the
same shape it imposes on its dormant team:

> **[[outbound-engine-charter]] does not staff, spend, or acquire tooling until
> `sales.verified_dollars_recovered > 0` AND the founder has un-deferred the target list.**
> Until both hold, S2's only permitted output is design — the sending-isolation decision,
> the qualification rubric, the reply-routing shape. Zero sends. Zero spend.

And the department's own review date: if at **2026-11-24** `DEP-06` is unchecked and
`sales.verified_dollars_recovered` is `$0`, the correct action is to fold Sales into
[[growth-charter]] as a single function and delete fourteen of these twenty-one documents.
Written here, at founding, so that retiring the department is a **pre-agreed outcome with
a date and a number** rather than a judgement call someone has to be brave enough to make.
[[red-team-charter]] and [[decision-office-charter]] hold the date.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible |
|---|---|---|---|
| M1 | Friendship carries the account | 3 straight weeks of `unprompted_sessions_7d == 0` with warm sentiment | Product analytics — **does not exist yet**, which is the first problem |
| M2 | DEP-06 never checked | 30 days from 2026-08-24, box still unchecked | `.planning/PROJECT.md:101` — one grep |
| M3 | Claim outruns evidence | First dollar figure with no landed credit behind it | Outbound copy review, pre-send |
| M4 | Shared sending identity | Any outbound path importing `GmailService` | Code review / `check_*.sh` guard |
| M5 | Org out-produced the work | 2026-11-24: 21 docs, $0 recovered, DEP-06 open | Directory census + checkbox |

Four of these five are checkable with a `grep` or a checkbox. M1 is the exception and the
most dangerous — it is the only one that requires instrumentation that does not exist yet,
and it is the one most likely to kill the department. **Build M1's signal first.**
