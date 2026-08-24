---
type: premortem
division: advisory
department: red-team
status: provisional
metrics: [rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.self_selected_target_share, rt.locked_decision_challenge_rate, rt.undeclared_decision_count]
updated: 2026-08-24
links: ["[[red-team-charter]]", "[[red-team-directive]]", "[[red-team-loops]]", "[[red-team-schedule]]", "[[red-team-agenda-full]]", "[[red-team-agenda-board]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]", "[[ORG_STRUCTURE]]", "[[0007-org-structure]]", "[[0001-mudavym-single-entity]]", "[[compliance-privacy-charter]]"]
---

# Red Team — Premortem

> Written at founding, before success is assumed.

This function has a sharper premortem obligation than any unit it will review, for one
reason: **its two failure modes point in opposite directions, and each one is the cure for
the other.** A red team that produces only objections becomes noise and gets ignored. A
red team that is too polite produces nothing worth ignoring. Every counter-pressure
against one moves the function toward the other, so the counter-pressures below are
deliberately built as **paired** measurements — a single number cannot tell the difference
between a healthy red team and either failure, and any dashboard reporting one without
the other is already lying.

The two are M1 and M2. They are first not because they are most likely in isolation, but
because the *oscillation between them* is the characteristic way this kind of function
dies.

---

## It is 2027-08. Red Team has failed. What happened?

### M1 — It became an objection machine, and everyone stopped reading

Findings are cheap to write and expensive to act on, and nothing in a findings-only
mandate limits supply. Within two quarters Red Team was producing an objection to
everything: forty-one open findings, each individually defensible, collectively
unreadable. Decision owners learned the correct response — acknowledge, thank, defer —
because acting on all of them was impossible and choosing between them was Red Team's job,
not theirs, and Red Team had not done it. By quarter three, "there's a Red Team finding on
that" carried no information at all. The function still ran; it had simply been
reclassified as weather.

The mechanism is not laziness. It is that **objecting is the cheap half of the work**.
Reconstructing what would have to be true, checking whether the evidence exists, and then
naming the one thing to do next — that is the expensive half, and it is the half that
makes a finding actionable. Skipping it does not feel like skipping anything; it feels
like being productive.

**Earliest observable signal.** Not the finding count — the count rises in a healthy first
quarter too. The tell is **`rt.finding_actionability` falling while finding volume rises**.
Two findings in the same week that name no owner, or name "the org" as owner, are the
first instance. The second signal is textual and appears earlier still: a finding whose
next-step field reads *"reconsider"*, *"revisit"*, or *"clarify"* — verbs with no object
and no owner. A third: the WIP cap being argued with rather than respected.

**What would have prevented it.**

- **The 7-finding WIP cap** ([[red-team-charter]] §The attack budget), enforced by
  [[red-team-directive]] R3. To open finding #8, one of the seven must close. This is the
  only mechanism here that scales with the actual failure — it makes the *scoring* rule
  do work, because under a cap the function must decide which objection is worth a slot.
  Uncapped, it never has to decide, and a red team that never chooses targets is
  reproducing the sprawl it is meant to catch.
- **Format rejection at the gate, by Red Team itself.** A finding without a named owner
  and exactly one named next action does not leave this function. `rt.finding_actionability`
  target is 100% and there is no acceptable second number — not because 96% would be bad
  analysis, but because the 4% is what teaches everyone to skim.
- **The finding is written as a question the owner can answer, not a verdict they must
  absorb.** [[red-team-directive]] R5. "What breaks this" plus "here is the one thing that
  would tell us" is actionable; "this is risky" is weather.

---

### M2 — It was too polite, and produced nothing that cost anything

The mirror failure, and the more likely one in a solo-founder org where the attacker and
the decider are the same working relationship. Every attack landed on a NEW, unowned,
zero-evidence team charter — safe targets, no defender, no friction. Not one landed on a
decision the founder personally locked. Attacks on `OPEN-DECISIONS.md` items were phrased
as clarifying questions. `rt.reaffirmation_rate` sat at 100% for four quarters and was
reported as a *strength* — "every decision we tested held up" — when it was the exact
signature of a function testing nothing that could fail.

The structural reason politeness is the default here: [[0007-org-structure]] put advisory
outside the line so it could be independent, but independence of **reporting** is not
independence of **incentive**. The unit knows who reads it. And the corpus makes the pull
concrete — 82 referral lines invite Red Team to attack *other units'* mechanisms, and
**zero** of them invite it to attack the founder's own calls.

**Earliest observable signal.** **`rt.reaffirmation_rate` at or near 100% across a full
cycle** — every attack ending "stands unchanged." The second signal is distributional and
visible sooner: a cycle's target list containing **no** item from `decisions/*.md` and no
founder-locked item, only NEW team charters. The third is linguistic and visible in the
first week: a finding that recommends *documenting* the decision better rather than
questioning whether it is right. Documentation recommendations are what an attack degrades
into when it cannot afford to be wrong about something that matters.

**What would have prevented it.**

- **O3 — one founder-locked decision attacked per cycle, mandatory**
  ([[red-team-charter]] §The selection rule). Not optional, not score-dependent. A cycle
  producing zero attacks on a founder-locked decision is itself a filed finding, against
  Red Team, in Red Team's own board.
- **Reaffirmation is a success only if the argument is written into the target's review
  trail.** [[red-team-directive]] R6. This is what makes "the decision stands" expensive
  enough to be honest: a polite attack produces a review-trail row that visibly says
  nothing, and an empty row is legible. The standard already exists —
  `0001-mudavym-single-entity.md:50` records the two-company challenge in full, including
  the reasoning that defeated it, and `0007-org-structure.md:84-88` records a
  recommendation that **lost**. Both are more useful than the decisions they annotate.
- **Report `rt.reaffirmation_rate` and `rt.finding_actionability` as a pair, always.**
  High reaffirmation + high actionability = a well-made decision corpus, which is a real
  and good outcome. High reaffirmation + *low* actionability = politeness. Low
  reaffirmation + low actionability = M1. The pair separates three states that any single
  number collapses into one.
- **The three named starting targets are all consequential and two are the founder's**
  ([[red-team-agenda-full]] T1–T3: ADR 0006's erasure collision, OD-23's revenue target,
  ADR 0007's 693 documents). Choosing them *now*, at founding, is the only moment they can
  be chosen without knowing how uncomfortable they will be.

---

### M3 — Findings-only decayed into findings-ignored

The risk [[0007-org-structure]] names about itself: *"under deadline, findings can be
acknowledged and deferred indefinitely"* (`0007-org-structure.md:74-76`). It happened. No
finding was ever rejected — rejection would have required an argument. They were
acknowledged, marked "noted, post-v0", and aged. After a year the median open finding was
seven months old, several referred to decisions that had already shipped and could no
longer be unwound, and the function's entire output was an archive.

**This is not hypothetical, and the evidence predates the function.** OD-20 is marked
🔴 **"Founder call — urgent"** in `OPEN-DECISIONS.md` — live unauthorized spend on the
founder's API key. The fix exists as PR **#31**, and as of 2026-08-24 that PR is **open and
unmerged**; `main` still carries the unguarded controller. The finding was made, the fix was
authored, and the loop did not close. That is M3, already running, on the very incident
that this function's charter uses as its worked example.

**Earliest observable signal.** `rt.open_finding_age_days` median crossing **14 days** —
well before the 30-day escalation, because the median moves before the tail does. Second
signal: any finding whose target decision has *shipped* while the finding was open; that is
a terminal reading, not a warning. Third, and cheapest to watch: an owner's `questions.md`
gaining entries without ever losing any.

**What would have prevented it.**

- **A hard close-time on the return leg, not on the resolution.** [[red-team-loops]] L-RT-2
  measures **72 hours from attack complete to the finding sitting in the owner's
  `questions.md`** — the leg Red Team actually controls. Measuring "time to resolution"
  would be measuring someone else's calendar and would produce a metric this function can
  always blame away.
- **Automatic escalation at 30 days.** L-RT-6: an open finding at 30 days stops being a
  finding and becomes an `OPEN-DECISIONS.md` row addressed to the founder. Ageing is
  converted into a decision the founder must make — including the decision *"we accept
  this risk"*, which is a legitimate answer and, written down, is a better outcome than
  silence.
- **[[decision-office-charter]] holds the close-time books** and is a different unit, so
  Red Team is not grading its own responsiveness. `0007-org-structure.md:75-76` names this
  exact division of labour as the counter-pressure; L-RT-6 is what makes it mechanical.

---

### M4 — The referral queue ate the function

82 referral lines from 67 units were waiting on day one, and every new unit added more.
Red Team answered them, because they were specific, well-argued, and flattering. Within
two quarters it was a service desk: responsive, busy, and attacking only what it was
handed. It never ran an undeclared-decision sweep, because nobody submits an undeclared
decision — by definition. It never attacked an ADR, because no ADR filed a referral.
Channel C4 — the one job nothing else in the org can do — produced zero findings in a
year, while `OD-C1`–`OD-C8` sat in Corporate's documents, referenced 57 times between
them, never once in the register.

**Earliest observable signal.** **`rt.self_selected_target_share` below 60%** in any cycle.
Sooner and cheaper to see: a cycle whose target list contains **zero** items from channels
C1 (new locks) or C4 (undeclared). Cheapest of all: the *sequence* of the first five
targets. If they are five referrals in the order they arrived, the scoring rule was never
applied and the queue is running the function.

**What would have prevented it.**

- **Referrals enter the same scoring funnel with no privileged lane**
  ([[red-team-directive]] R2). A referral is evidence that a unit is worried, which is a
  useful signal and *not* the same as priority. The unit most worried about itself is
  frequently not the unit most wrong.
- **Reserved slots, not best-effort intent.** Each cycle: 1 slot for O1 (newest lock),
  1 for O2 (oldest unattacked fork), 1 for O3 (founder-locked). Three of seven are
  spoken for before any referral is read. Intent does not survive a full inbox; reserved
  capacity does.
- **The undeclared-decision sweep is a *scheduled job*, not an aspiration**
  ([[red-team-schedule]], monthly; [[red-team-loops]] L-RT-3), and it is subject to the
  org's 3-run rule — if it surfaces nothing in three consecutive runs it is deleted rather
  than kept as decoration.

---

### M5 — It drifted into security testing, and duplicated a department

The most attractive drift, because the security surface is *concrete* — 94 routes
unguarded by omission, a guard that fails open, a live paid-LLM endpoint — while decision
attacks are abstract and argumentative. Red Team started citing controllers, then writing
threat models, then grading controls. Two functions now produced overlapping security
opinions; [[security-charter]] received advice from an advisory function about work it
owns, and the founder received two streams of security commentary and one stream of merged
fixes.

The symmetry is worth noting: [[security-charter]]'s own premortem names the mirror-image
failure — *"the department became a second Red Team and stopped shipping controls"*
(`intelligence/security/security-premortem.md:165-176`). Both units have independently
identified the same boundary as the one that erodes. That agreement is the strongest
available evidence that it will.

**Earliest observable signal.** **A Red Team document whose *subject* is a `path:line` in
`apps/`** rather than a decision. Evidence citations pointing at code are correct and
expected; a *target* that is code is the defect. Second signal: any Red Team artifact
containing the words "threat model", "scan", "CVE", or "allowlist" in a non-boundary
context — the sweep in [[red-team-agenda-board]] queries exactly this. Third: Security
asking Red Team to review a control, and Red Team accepting.

**What would have prevented it.**

- **The one-sentence test, applied per target before it enters the queue**
  ([[red-team-directive]] R1): *does this attack a **reason** or a **system**?* Systems go
  to [[security-charter]]. There is no borderline case — the correct Red Team target on a
  security topic is always the *decision* underneath it (why the guard fails open, why the
  route class was secured by memory), never the route.
- **The founder's scoping sentence quoted verbatim in the charter's non-goals**, with its
  `path:line` (`ORG_STRUCTURE.md:61`, `0007-org-structure.md:45`). A boundary that lives in
  someone's memory erodes; a boundary quoted with a citation gets challenged explicitly if
  someone wants to move it — which is the correct way for it to move.
- **A standing self-query in [[red-team-agenda-board]]** that lists any file in this
  directory matching security vocabulary. Expected result: empty. It is the cheapest
  possible detector for the drift, and it runs against our own directory rather than
  waiting for Security to complain.

---

## The failure this premortem cannot prevent

**Red Team wrote a good premortem and then attacked nobody.** Everything above is a
document; none of it is a filed finding. This function's entire evidence base is
`ORG_STRUCTURE.md:61` and one sentence in an ADR. The 60-day staleness rule
([[ORG_STRUCTURE]] §4, foundation §3.3) is the only external check, and a date bump defeats
it.

The honest counter-pressure is the merge condition already written into
[[red-team-charter]] §Entry and exit triggers — fewer than 6 findings, or actionability
below 80%, or a 100% reaffirmation rate at the second quarterly review folds this function
into [[decision-office-charter]]. It was decided at founding, which is the only point at
which it could be decided cheaply, and it is written as a **merge** trigger on purpose: the
corpus carries split triggers in 15 documents and merge triggers in 3, and a function whose
job is attacking structural reasoning should not add to that asymmetry while OD-26 is open.

**First assignment, therefore: attack [[red-team-charter]].** Specifically the claim that a
scored queue with a 7-item cap produces signal rather than noise — which is asserted here
with no evidence whatsoever, by a function whose entire purpose is objecting to exactly
that kind of claim.
