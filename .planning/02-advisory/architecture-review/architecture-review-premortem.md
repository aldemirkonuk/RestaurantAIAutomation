---
type: premortem
division: advisory
department: architecture-review
status: new
metrics: [arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.findings_closed_by_silence, arch.diverged_invariant_count, arch.layer_violations_open, arch.sweeps_since_last_new_finding_class]
updated: 2026-08-24
links: ["[[architecture-review-charter]]", "[[architecture-review-directive]]", "[[architecture-review-loops]]", "[[architecture-review-schedule]]", "[[architecture-review-agenda-full]]", "[[architecture-review-agenda-board]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[client-surfaces-charter]]", "[[research-math-charter]]", "[[ORG_STRUCTURE]]", "[[README]]"]
---

# Architecture Review — Premortem

> Written at founding, before success is assumed.

It is **2027-08-24**. Architecture Review has failed. It did not fail by being wrong.
Every finding it wrote was correct, well-cited, and calmly received. It failed in the
five ways below, most likely first — and the first one is the failure mode that
[ADR 0007](../../decisions/0007-org-structure.md) named in advance, in writing, when it
locked findings-only authority:

> *"Findings-only carries a known risk: under deadline, findings can be acknowledged and
> deferred indefinitely."*

This document exists mostly to make that sentence operational.

---

## 1. Review became theatre — findings were acknowledged, and that was the end of it

**What happened.** The first sweep produced seven findings. Every one was read. Every one
got a reply within a day, and every reply was some version of *"yes, that's real —
we'll get to it."* Nobody disagreed. Nobody argued. Nobody fixed anything either, because
in any given week there was always something with a customer attached to it, and a
finding has no customer.

By sweep four the replies stopped, not out of hostility but because both sides now knew
the exchange was ceremonial. By month six the sweep was still running — the schedule
fired, the document was written, the file was committed — and it had become a **liturgy**:
performed on time, believed by no one, costing a real half-day every fortnight. AR-2's
diverged guardrail was still diverged. The web app was still talking to Postgres.
`api_spend` and `decision_log` still could not be joined. And the org now had documentary
evidence that it had known about all of it for a year, which is materially worse than not
having known.

**Earliest observable signal — and it is very early.**

Not *"findings are old."* By the time findings are old the habit is set. The signal is
the **first finding that receives an acknowledgement with no accompanying decision**. In
mechanical terms: the first time `arch.findings_closed_by_decision_ratio` has a
denominator and a zero numerator — a finding raised, a reply received, and neither a fix
nor a written acceptance in `OPEN-DECISIONS.md`.

That is available at **sweep two, roughly day 14.** The three cheap proxies that make it
impossible to miss:

- `arch.finding_age_days_max` rises across two consecutive sweeps while
  `arch.findings_closed` stays at zero.
- Any reply containing *"we know"* / *"already aware"* that is not followed by an
  `OPEN-DECISIONS.md` line within the same sweep. **Awareness is not a close.** It is,
  precisely, the failure mode wearing the costume of a success.
- The sweep document's diff shrinks two sweeps running — the sweep is being produced
  rather than performed.

**Counter-pressure — three mechanisms, and the third is the one that actually bites.**

**(a) Age escalates, severity does not.** Severity decides how loudly a finding is
written; **age alone** decides what happens to it. Every finding is re-reported at every
sweep with its age in days. At **three sweeps (42 days)** it stops being a finding and is
rewritten as an `OPEN-DECISIONS.md` item phrased as a binary the founder must answer:

> *Fix it, or accept it in writing — with a named owner and a revisit date.*

The mechanism is stolen wholesale from the org's own answer to this risk:
[ADR 0007](../../decisions/0007-org-structure.md) says *"the Decision Office's close-time
tracking is the counter-pressure."* This is that sentence with a number in it. The
escalation path is in [[architecture-review-directive]] §Escalation and the loop that
drives it is `loop-finding-age` in [[architecture-review-loops]], close-time fortnightly.

**(b) "Accepted" is a first-class, honourable close.** This is the part that makes (a)
survivable rather than adversarial. A written *"yes, `apps/web` will keep reading Postgres
directly until the guest app ships; owner [[client-surfaces-charter]]; revisit
2027-02-01"* **closes the finding**, counts in the numerator, and is a good outcome. The
function is not trying to win arguments; it is trying to convert **silent deferral into
recorded deferral**. A deferral with an owner and a date is a decision. A deferral without
one is the failure in this section. [[architecture-review-charter]] §Metrics states the
anti-target that follows: a ratio of 1.0 means this function is only finding things nobody
would contest.

**(c) The merge trigger — this function's own anti-sprawl rule.** Symmetric with the
Skills self-retirement trigger (OD-24) and with OD-26's question about whether structures
may only ratchet upward:

> **If at 2026-11-24 (90 days) fewer than half of the findings raised have closed by
> decision — fixed *or* accepted in writing — Architecture Review is merged into
> [[decision-office-charter]] rather than continued.**

The reasoning is not modesty. If findings do not convert, the constraint is not detection,
it is **closure** — and closure is the Decision Office's actual mandate
([[ORG_STRUCTURE]] §3). Running a separate detection function in front of a closure
bottleneck adds documents and removes nothing. The trigger is proposed as binding and
belongs in `OPEN-DECISIONS.md` alongside OD-24 and OD-26.

---

## 2. It reviewed what greps, and the real violations were behavioural

**What happened.** Building an import-boundary linter was tractable and satisfying, so it
got built first. It found real things: a UI component importing a service, a domain module
reaching sideways. Every sweep after that was a linter report with commentary. Twelve
months of clean import graphs.

Meanwhile the commitment-detection guardrail (AR-2) drifted from 8 patterns to 19 on one
side and stayed at 8 on the other, and no import scan has ever had anything to say about
it, because **there is no import.** There are two files that agree about a rule and one
comment claiming they are identical. A vendor reply in French containing *"nous
acceptons"* auto-sent down the Python path. Legal found out from the vendor.

**Earliest observable signal.** The **composition of the finding log**, checkable at sweep
three. If every finding is of a class a static tool could have produced, the census is not
being run — a human reviewer whose output is reproducible by a linter is not adding the
thing the function was created for. Concretely: `arch.sweeps_since_last_new_finding_class`
reaching 3. Two out of the seven founding findings (AR-2, AR-5) are of the invisible class,
and neither is discoverable by import analysis.

**Counter-pressure.** **Every sweep must contain exactly one invariant census, and the
census is the part that may not be skipped when the sweep is short.** The census picks
*one* rule that must hold everywhere — *never auto-send a commitment*, *every request is
tenant-scoped*, *every model call is metered* — and enumerates every place it is enforced,
then compares the enforcements to each other. AR-2 was found this way in a single session,
by counting two lists. AR-5 is the same shape: one invariant (`tenant isolation`), one
enforcement point that concedes it does not enforce
(`tenant.guard.ts:38-46`), 94 endpoints relying on a second one being remembered.

The linter is still worth building — it makes the cheap class of violation stop needing a
human ([[architecture-review-agenda-full]] Step 3). The rule is about **order**: the census
is done first in every sweep, and the linter is what runs when nobody is looking.

---

## 3. Three advisors wrote the same finding, and the line stopped reading any of them

**What happened.** `analytics.controller.ts` is unguarded, reachable, and spends money on
`claude-opus-4-8`. [[security-charter]] wrote it up as an exploitable endpoint.
[[red-team-charter]] wrote it up as a decision that was never made. This function wrote it
up as an invariant enforced by convention. Three documents, one `path:line`, three slightly
different framings, all correct.

Engineering, receiving three findings about one file from three functions that do not build
anything, did the rational thing and started filtering advisory output as a category. The
next finding — a genuinely novel one that only this function could have produced — arrived
into a channel that had already been muted.

**Earliest observable signal.** The **same `path:line` cited by two advisory functions in
one sweep window.** This is checkable mechanically and it will happen early: AR-5 already
overlaps OD-19/OD-20, which are [[security-charter]]'s. So the signal is present at
founding, before the first sweep, which is why the rule is written into
[[architecture-review-charter]] §Non-goals rather than left to good manners.

**Counter-pressure.** The de-duplication rule, and it needs to be mechanical rather than
collegial: **the finding goes to whichever function's metric it moves; if it moves two,
one finding is written and the other cross-links it.** Two findings against one
`path:line` in one sweep is itself a Sev-2 finding — filed against the advisory layer,
visible on [[architecture-review-agenda-board]]. Reviewers who duplicate are committing the
defect class they were hired to catch, and it should cost them the same way.

A second, blunter counter-pressure: **this function has a budget of findings per sweep,
and it is small.** Seven at founding is a backlog, not a cadence. A sweep that produces
twelve findings has stopped ranking and started listing, and a list is what people mute.

---

## 4. The L0–L6 stack was wrong, and it was enforced faithfully anyway

**What happened.** [[README]] §1 is a good model — but it is a **claim**, written in one
sitting, before L2 modules and L6 surfaces had been built out. In practice the seam
between L2 (module softwares) and L6 (surfaces) turned out not to be a layer boundary at
all: several modules are *only* reachable through their own surface, and forcing every call
through a notional L2 façade added indirection with no independence gained.

This function did not notice, because noticing would have required doubting its own only
rule. It kept writing Sev-2 bypass findings against the same seam. Engineering kept
arguing them down, correctly, one at a time. The findings aged, escalated per mechanism
#1(a), and consumed founder attention on a rule that should have been amended in month
two. Worse: because the function was demonstrably wrong about that seam, its correct
findings about AR-2 and AR-4 were discounted by association.

**Earliest observable signal.** **Three findings against the same seam, all argued down on
the same grounds.** Not three findings, and not one argued down — the conjunction. That
pattern is not three losses; it is evidence about the **rule**, and it is available by
roughly sweep four. A cheaper leading indicator: any sweep where the reviewed unit's
rebuttal is a *design* argument (*"the indirection buys nothing here"*) rather than a
*priority* argument (*"true, not now"*). Priority rebuttals mean the rule holds and the
work is queued. Design rebuttals are about the rule.

**Counter-pressure.** Two, and the second is the load-bearing one.

- **The stack is versioned and reviewable.** [[architecture-review-schedule]] carries a
  **quarterly layer-stack review** whose only question is *"is [[README]] §1 still the
  right decomposition?"* It is on the calendar whether or not anything has gone wrong,
  because a review that only happens under pressure happens under pressure.
- **The escalation for a repeatedly-defeated seam is an amendment, not a fourth finding.**
  Written into [[architecture-review-directive]] §Escalation trigger #4. This function is
  chartered to propose changes to the rule it owns
  ([[architecture-review-charter]] §Boundaries), and a function that cannot revise its own
  premise is enforcing a wall poster.

---

## 5. It reviewed Platform and Applied AI, and never really reviewed Product

**What happened.** The mandate is *"all of Platform, Applied AI, and Product"*
([[ORG_STRUCTURE]] §3). Platform and Applied AI are legible to layer analysis — files,
imports, tables, callsites. Product is not: its structural defects are things like *a
route with no inbound link*, *a capability that exists in three surfaces and behaves
differently in each*, *a guest flow whose state lives in four places*. Those are layer
questions, but they do not look like layer questions, so they never got reviewed.

Twelve months in, `apps/web` had grown from 51 routes to eighty-odd, the L6/L2 seam had
been crossed in a dozen new places on the AR-1 pattern, and the finding log contained one
entry about it — the founding one.

**Earliest observable signal.** The finding log's distribution **by reviewed division**.
If after four sweeps Product has fewer than a quarter of the findings while owning the
largest and fastest-changing surface, Product is not being reviewed; it is being skipped.
The counting signal already exists in [[PAGE_MAP]]: **24 routes have no inbound in-app
link and 13 route components could not be traced** — a structural fact about L6 that no
Product-side artifact currently owns.

**Counter-pressure.** **Sweeps rotate by division on a published rotation**
([[architecture-review-schedule]]), and a skipped rotation is reported on the board as a
skipped rotation rather than absorbed silently. Plus one Product-specific census in the
first quarter — *"which surfaces write directly to L0?"* — which is AR-1 generalised, and
is the review that catches the next twelve instances of it rather than the first two.

---

## The shape all five share

Four of the five are the same failure in different clothes: **the function kept producing
output while quietly ceasing to produce effect.** Acknowledged ≠ decided. Scanned ≠
reviewed. Written ≠ read. Chartered ≠ covered. Only #4 is different in kind — it is the
function being faithfully right about the wrong rule.

There is a specific irony worth naming, because it is the sharpest risk here: this
function's entire premise is that **a green signal produced by a system that is not
measuring the right thing is worse than no signal**, because it converts an unknown risk
into a false assurance. A fortnightly sweep that runs on time and changes nothing is
exactly that object. Architecture Review would then be the clearest example in the org of
the defect it was created to detect — and, being outside the line, there is nobody above
it whose job is to notice.

Which is why mechanism #1(c) exists, and why it is a **date** rather than a sentiment:
**2026-11-24, half of findings closed by decision, or merge into
[[decision-office-charter]].**

**For [[red-team-charter]]:** the highest-value attack on this function is not to find a
layer violation we missed. It is to take the finding log at day 60 and ask, of each entry,
*what changed in the repo because this was written?* If the honest answer for the majority
is "nothing," mechanism #1 has already happened and the merge trigger should fire early.
