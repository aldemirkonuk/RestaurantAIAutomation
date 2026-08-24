---
type: premortem
division: commercial
department: sales
team: outbound-engine
status: new
metrics: [sales.sending_identity_isolated, sales.claim_provenance_rate, sales.complaint_rate, sales.qualified_conversation_rate, sales.suppression_integrity]
updated: 2026-08-24
links: ["[[outbound-engine-charter]]", "[[outbound-engine-directive]]", "[[outbound-engine-loops]]", "[[sales-premortem]]", "[[design-partner-operations-premortem]]", "[[compliance-privacy-charter]]", "[[media-brand-charter]]", "[[reliability-sre-charter]]", "[[red-team-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Outbound Engine — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.
> This team has sent zero emails, so every mechanism below is still fully preventable —
> which is the only reason writing it now is worth anything.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — Deliverability burned on the shared identity, and procurement went down with it

The first sequence went out through the existing Gmail plumbing. It was already wired,
already authenticated, already sending; standing up a second identity felt like premature
infrastructure for an experiment that might not work.

The transactional sender is one hardcoded identity
(`apps/api-gateway/src/communications/gmail.service.ts:76-78`), and the inbound poller
filters against that same address
(`apps/api-gateway/src/communications/communications.controller.ts:1028-1031`). Cold mail
attracts complaints by nature — not because the copy is bad, but because that is what cold
mail does. Reputation degraded. The first casualties were the messages that mattered most:
purchase orders to vendors and low-stock alerts to the one customer we had.

**And the diagnosis went wrong**, which is the part that turns a setback into a failure.
The symptom presented as *"vendors aren't receiving POs"* — a procurement bug. Days were
spent in the procurement module. The sales experiment three weeks earlier was the last
place anyone looked, because nothing connected them in anyone's mental model.

**Earliest observable signal.** Not a bounce rate — far earlier: **any code path under an
outbound module that can reach `GmailService`.** That is visible at review time, before a
single send, and it is a grep.

**What would have prevented it.**

1. **A separate domain and backend before send #1.** The seam already exists unused:
   `env.example:165` declares `EMAIL_BACKEND=gmail`, and `SENDGRID_API_KEY`
   (`env.example:167`) is already read at
   `services/agent-orchestrator/config/settings.py:202`. This is configuration and a
   domain purchase, not architecture.
2. **A CI guard in the shape of the existing `scripts/check_*.sh` family:** no module under
   an outbound path may import `GmailService`. Grep-grade, cheap, and it makes the boundary
   structural instead of remembered.
3. **`sales.sending_identity_isolated` is a hard gate, not a metric.** While it is `false`,
   the answer to every send request is no. Metrics get discussed; gates get obeyed.
4. **A written note in the procurement runbook** naming outbound reputation as a candidate
   cause of transactional delivery failure — so the wrong-diagnosis half of this mechanism
   costs hours rather than days. [[reliability-sre-charter]] holds it.

---

### M2 — The sequence sold a claim the product had not earned

Pressure arrived — a quiet month, a YC deadline, the urge to see the machine work — and
outbound shipped before [[design-partner-operations-charter]] had a **verified** number.
So the copy said something like *"restaurants recover $X"* where `$X` was modelled,
extrapolated from a single discrepancy, or drawn from a credit that had been *requested*
rather than *received*. The repo's own analysis draws exactly that line: until an 812
credit memo lands on a later invoice, "dollars recovered" means *"we asked"*
(`.planning/YC_WEDGE_PLAN.md:31-33`).

Restaurants are a small, talkative market. The first pilot that failed to reproduce `$X`
did not merely fail to close — it burned the reference, and the correction never travelled
as far as the claim.

**Earliest observable signal.** The first outbound artifact — sequence copy, landing page,
demo script, investor paragraph — containing a dollar figure whose provenance is **not a
landed credit**. Caught at review by one question: *which invoice did that credit appear
on?*

**What would have prevented it.** A **claim allowlist**: an enumerated set of statements
outbound may make, each with a citation. Empty today, by design. Anything not on the list
does not ship. And a rule about what to sell while the list is empty: **the mechanism, not
the outcome.** The four-way document model is genuinely differentiating without any dollar
figure — when the distributor's own ship notice says 22 and its own invoice says 24, there
is nothing left to argue about (`.planning/YC_WEDGE_PLAN.md` §REVISION 3;
`overbilled_vs_ship` outranks every verdict but a missing invoice, `:342`). Offering to run
the match on the prospect's own last month of invoices is a stronger opening than a number
we cannot defend.

---

### M3 — The machine invented a list

The target list was deferred. The machine was built, tested, and ready. Waiting felt like
waste, and a sequence with nobody in it is an unbearable object. So someone scraped a
plausible list — restaurants within a radius, or a POS-marketplace directory, or a review
site — and called it a pilot rather than a launch. It sent to a few hundred addresses, got
a 0.4% reply rate and two complaints, and the org concluded *outbound does not work for
this market* on evidence that was really *this list does not work*.

Worse, the deferral was quietly voided. The founder's decision to defer the list was a real
strategic choice, and it was reversed by a team's discomfort with idleness rather than by a
decision.

**Earliest observable signal.** Any artifact naming, describing, filtering, or counting
target restaurants: a spreadsheet, a scraping script, a `WHERE cuisine =` clause, a segment
definition. **The first row is the signal** — not the first send.

**What would have prevented it.** The entry trigger in [[outbound-engine-charter]], written
at founding and stated in the negative: **no staffing, no spend, no tooling, no domain, no
sends** until `verified_dollars_recovered > 0` **and** the founder has un-deferred the
list. Plus a specific piece of honesty in this document: *a team whose machine is finished
and whose list is deferred should look idle.* Idleness is the correct state, and naming it
here removes the excuse that looking busy was the goal.

---

### M4 — Nobody could reliably be un-emailed

The suppression list was a nice-to-have that stayed on the list of nice-to-haves. Someone
replied *"please stop"* and received the third step of the sequence four days later,
because reply-routing and sequence-stopping were separate systems and only one of them had
been built. A second contact at the same restaurant kept receiving mail after the first had
opted out, because suppression was per-address rather than per-domain — and the
already-built `prospects` module in this very repo dedupes **by domain**
(`prospects.service.ts:36-42`), so the correct pattern was visible the whole time and was
not copied.

One of those recipients was a restaurant the design partner knew. In a small market, the
reputational cost of the fourth email is not proportional to the first three.

**Earliest observable signal.** The first stop request that takes more than 24 hours to
take effect — measurable from send #1, and never measurable retroactively.

**What would have prevented it.** **Suppression built before sending, not after**, and
**per-domain, not per-address**, copying the dedupe shape the repo already demonstrates.
`sales.suppression_integrity` is a launch gate: a system that cannot reliably stop should
not be permitted to start. It is also the cheapest possible thing to build before there is
any data in it.

---

### M5 — The rubric was written after the pipeline, so it justified whatever was in it

Qualification got deferred as premature — you cannot define a qualified restaurant before
talking to any. So the first conversations happened, and the rubric was written afterwards
to describe them. It therefore contained no disqualifying criterion that any existing
conversation failed. Every prospect qualified. `qualified_conversation_rate` sat near 100%
and measured nothing, and the number that was supposed to tell the org whether outbound
worked instead told it that outbound was working.

**Earliest observable signal.** `qualified_conversation_rate > 60%` in the first cohort.
An honest rubric disqualifies most of a cold list; a rate that high is evidence of a broken
definition, not a good one. Even sharper: a rubric with **no** criterion that a current
prospect fails.

**What would have prevented it.** **Write the rubric now, while the pipeline is empty and
nobody is attached to anyone in it** — this is the one moment it can be written honestly,
and it is a permitted output under the entry trigger. Require at least one *hard
disqualifier* (no POS API access; single-location with no wine programme; a distributor
mix that cannot produce the documents the match needs). Freeze it before the first send;
changes after that require a written rationale and a re-scored cohort, so that loosening
the definition is visible rather than gradual.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible |
|---|---|---|---|
| M1 | Shared identity burned | outbound path can reach `GmailService` | Code review / CI guard |
| M2 | Claim outran evidence | a dollar figure with no landed credit | Copy review, pre-send |
| M3 | Machine invented a list | the **first row** of any target artifact | Repo / drive census |
| M4 | Cannot un-email | first stop request >24h to take effect | Suppression log |
| M5 | Rubric justified the pipeline | `qualified_conversation_rate > 60%` in cohort 1 | Rubric vs cohort |

**Four of five are preventable today, at zero cost, precisely because nothing has been
sent.** The CI guard (M1), the empty claim allowlist (M2), the suppression design (M4),
and the frozen rubric (M5) are all permitted outputs under the entry trigger. M3 is the
exception: it is prevented only by accepting that a team whose list is deferred is supposed
to look idle.
