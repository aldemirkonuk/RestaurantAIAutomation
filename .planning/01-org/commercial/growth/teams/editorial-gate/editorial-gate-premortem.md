---
type: premortem
division: commercial
department: growth
team: editorial-gate
status: provisional
metrics: [editorial.gate_bypass_count, editorial.rejection_rate, editorial.claims_traceable_pct, editorial.overstated_claim_catches]
updated: 2026-08-24
links: ["[[editorial-gate-charter]]", "[[editorial-gate-loops]]", "[[editorial-gate-directive]]", "[[growth-premortem]]", "[[content-production-charter]]", "[[brand-identity-charter]]", "[[design-partner-operations-charter]]", "[[narrative-collateral-charter]]", "[[red-team-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Editorial Gate — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. G3 has failed. What happened?

---

### M1 — The founder was the only editor, became the bottleneck, and the gate was suspended for one week

The mechanism named in [[commercial]] §1.3, and it is first because every other failure here
runs through it. One person writes and judges. A launch week arrives with four units queued
and a real external deadline. The gate is suspended "for these four only; we will backfill
the edit." The backfill never happens, because a published page reads as finished work and
nothing in the system asks about it again.

The fourth article contains the recovery number, stated as **dollars recovered**, when the
repo's own analysis is explicit that this currently means *we asked*
([[YC_WEDGE_PLAN]]:31-33). A number is the one thing a reader will check, and the first
person to check it is likely to be an investor or a prospect, both of whom will conclude
something broader than "one article had an error."

**Earliest observable signal.** `editorial.rejection_rate` at 0% for two consecutive
close-times. That is not clean input; it is a gate that has stopped reading. The definitive
signal is structural rather than statistical: **a published unit with no verdict artifact in
version control.** Absence, not a report.

**What would have prevented it.** Three things, and none of them is discipline.
**(a)** Published throughput is capped at gate throughput ([[growth-directive]]), so the
queue that creates the pressure never forms. **(b)** The verdict is a **committed file**, so
a bypass is a missing object in git rather than an unremembered decision.
**(c)** `editorial.gate_bypass_count` lives on the **department** board, one level above the
person who would suspend it. A metric held inside the team that suspends itself is not a
control.

---

### M2 — The gate became a proofreader and stopped checking claims

Voice and banned constructions are fast, satisfying, and unambiguous. Em dashes are
findable in seconds; "streamlined" is a string match. Claim verification is slow, requires
opening sources, and frequently ends in an uncomfortable conversation with the person who
wrote the sentence. Under any time pressure the fast checks expand to fill the slot. Six
months in, every published unit is clean prose and `editorial.claims_traceable_pct` has
never actually been computed, because computing it means re-opening every source.

**Earliest observable signal.** Verdicts whose recorded reasons are overwhelmingly stylistic.
Concretely: a close-time where `editorial.overstated_claim_catches` is zero and the return
reasons are all voice or construction. Also: a unit passing with a provenance record that has
fewer source entries than the draft has factual sentences.

**What would have prevented it.** **Order the checks and record them separately.** Claims
first, always, before a single stylistic note is written — a returned draft stops at the
first failed check, so a claim failure never gets buried under fourteen comma notes. The
banned-construction linter runs **before** the human sees the draft
([[content-production-schedule]]), specifically so the human's attention is not spent on the
part a machine can do. And the verdict artifact has one field per check, so a gate that
stopped doing check 1 is visible in its own records.

---

### M3 — The rules were never written down, so they were negotiated every time

The voice guide belongs to [[brand-identity-charter]] and does not exist yet. The
banned-construction list exists as a founder instruction with one worked example. So the
first time a writer defends an em dash — reasonably, in a specific sentence where it reads
well — the gate has nothing external to point at, and the argument is settled by whoever
cares more that day. Repeat twenty times and there is no list, only a mood. Publishing
becomes a negotiation, which is exactly the condition under which the mandatory pass quietly
becomes an advisory one.

**Earliest observable signal.** The first verdict whose reason is "reads like a press
release" with no clause of a written guide cited. That is a real judgement, and it is
unenforceable at scale precisely because it is a real judgement.

**What would have prevented it.** The banned-construction list is a **document with reasons
per entry**, authored before unit one and versioned. G3 owns that list and enforces
[[brand-identity-charter]]'s voice guide, and the split is what makes both defensible: the
gate is never defending its own taste. Where the guide is silent, the gate records the case
and M1 amends the guide — the case becomes the rule, rather than the arguer becoming the rule.

---

### M4 — The gate passed everything true and published something misleading

Every claim was sourced. Every source was real. The article was still misleading, because
selection is not sourcing: a case study that reports what was identified and omits that
nothing has yet been received; a customer count of one, technically accurate, phrased as
"restaurants"; a capability list drawn from `.planning` documents describing what is planned
rather than shipped. `editorial.claims_traceable_pct` reads 100% the entire time. The gate
did its job as written and the page misled the reader anyway.

**Earliest observable signal.** Any published sentence whose accuracy depends on a
qualification that appears only in the provenance record and not on the page. The concrete
canary: the word "restaurants", plural, when there is one design partner whose Toast
credentials are still unconfigured.

**What would have prevented it.** A fourth check, added explicitly rather than assumed:
**would a reader who believed this page be surprised by the truth?** Applied to the page as a
whole rather than to sentences, and applied hardest to omissions. This is the check that
catches [[conversion-funnel-charter]]'s social-proof pressure and
[[narrative-collateral-charter]]'s enthusiasm, neither of which is a false statement problem.
It is subjective, it cannot be automated, and it is the strongest argument that this stage is
a human being rather than a tool.

---

## Cross-cutting counter-pressure

- **Every mechanism here is a variant of one thing: the gate is expensive and everything
  around it is cheap.** Drafting is cheap and getting cheaper; deadlines are free to impose;
  style checks are fast. The counter-pressures are all structural — a cap, a committed
  artifact, an ordered checklist, a metric held one level up — because a gate defended by
  willpower is defended by whoever is least tired.
- **[[red-team-charter]] should attack M1 and M4 specifically.** Both are decisions that feel
  correct at the moment they are made, which is [[red-team-charter]]'s stated scope:
  attacking decisions, not systems.
- **Fork CM-F1 is the live version of M1.** If Content Production and Editorial Gate merge,
  every counter-pressure above still applies and only their owner changes. The verdict
  artifact is the piece that must survive the merge intact.
