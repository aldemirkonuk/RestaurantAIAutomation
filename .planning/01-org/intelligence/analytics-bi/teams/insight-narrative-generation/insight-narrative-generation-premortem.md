---
type: premortem
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: provisional
metrics: [analytics.insight_acceptance_rate, analytics.top_rank_ignore_rate, analytics.insight_feedback_coverage, analytics.consultant_enabled_restaurants]
updated: 2026-08-24
links: ["[[insight-narrative-generation-charter]]", "[[insight-narrative-generation-loops]]", "[[insight-narrative-generation-directive]]", "[[analytics-bi-premortem]]", "[[analytics-engine-charter]]", "[[metric-contract-truth-assurance-charter]]", "[[security-charter]]", "[[red-team-charter]]", "[[guest-experience-charter]]"]
---

# Insight & Narrative Generation — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — The consultant layer was switched on for a demo and never switched back

This is the premortem `intelligence.md:432-435` already wrote for this team, and it is
first here because the guardrail it names is real *and* has no enforcement mechanism.

`consultants.service.ts` is well designed: default OFF, toggle-gated per restaurant,
*"absent row ⇒ disabled"* (`:18`), and *"the prompt forbids inventing numbers"* (`:15`).
Someone flips it for a pitch. Toggles have no expiry. Months later the evidence-pack
constraint gets loosened "for richer answers", the model produces a confident margin figure
that no computation supports, a customer repeats it back, and the credibility cost exceeds
everything the deterministic engine earned. As `intelligence.md:434-435` puts it: *"the
existing default-OFF design is the guardrail; the premortem is that someone flips it for a
demo and forgets."*

The compounding factor is external and live: `PUT /analytics/consultants/:id/toggle`
(`analytics.controller.ts:516`) and `POST /analytics/consult/:id` (`:531`) are two of **39
unguarded routes** on that controller. **Anyone on the internet can flip the toggle and
drive the Opus call** (foundation README:41-49, OD-20). So the failure does not even require
an internal mistake.

**Earliest observable signal.** An `analytics_insight_prefs` row with
`category = 'consultants'`, `enabled = true`, older than one close-time, with no named
owner. Second signal, and the more dangerous one: any diff to the system prompt at
`consultants.service.ts:130+` that weakens *"Evidence pack (authoritative; do not
contradict)"*.

**What would have prevented it.** Enablement carries a **named human and an expiry**. The
weekly job ([[insight-narrative-generation-schedule]]) lists every enabled row with its
age; unowned rows revert to the default, which is OFF — so reverting requires no
permission. And this team does not demo the consultant layer while OD-20 stands, which
makes the security escalation *this team's* problem rather than an abstract one owned
elsewhere.

---

### M2 — The support floor was lowered before a demo, and nobody had to change a test

The failure sequence is short and entirely plausible. A prospect's restaurant has three
weeks of data. The insight feed is empty, because the floors are doing their job:
`nonZeroDays < 7` (`insight-generator.service.ts:1017`), `qtys.length < 5` (`:550`),
`transactions.length >= 10` (`:867`), support saturating at `n = 14` (`:200`),
`|z| >= 3` (`:1107`). An empty screen in a demo is uncomfortable. One of those literals
changes. The feed fills with sentences computed from four data points. The manager acts on
one. It was noise.

**There is no spec file for `insight-generator.service.ts`**, so that change requires
nothing except confidence.

**Earliest observable signal.** A commit touching any of those five literals with no spec
file in the diff — which today describes every possible such commit. Also: the first week
`analytics.insight_acceptance_rate` rises while `analytics.top_rank_ignore_rate` rises too.
Both going up means more is being shown, not that more is being valued.

**What would have prevented it.** Every floor is a **named exported constant with a spec
case** ([[analytics-engine-directive]] rule 5; AB-1 owns the constant, this team owns the
consequence). And the empty state is *designed*: a feed that says *"we cannot yet say
anything about your Tuesdays — 3 of 7 weeks of data"* is a shippable, honest screen, and it
removes the demo pressure entirely. `AGENT_NATIVE_UI_DECISION.md:191-192` already argues
that a system that says "we cannot tell" is **more valuable** than one that guesses.

---

### M3 — The team measured 8 rules and called it insight acceptance

`analytics.insight_acceptance_rate` is measurable over the **8 rules** in
`recommendations.service.ts` (`:120`, `:137`, `:184`, `:198`, `:211`, `:223`, `:272`,
`:286`), because those are the only things with dispositions. The **573 insight types**
have no feedback capture at all: `analytics_insights` (baseline `:2194-2209`) carries
`candidate_key`, `sentence`, `score`, `effect_pct`, `z_score`, `evidence` — and **no
disposition column**.

Twelve months on, the team reports a healthy acceptance rate. It is the acceptance rate of
eight hand-written rules. The 573-type engine — the artifact the founder wants to lead with
— has never been evaluated by a human at all, and nobody noticed because the metric had a
number in it.

**Earliest observable signal.** The first published acceptance rate whose denominator is
not stated. A rate without its denominator named is the failure, not a symptom of it.

**What would have prevented it.** `analytics.insight_feedback_coverage` — the share of
*surfaced* narrative objects that can receive a disposition — is published beside the
acceptance rate from day one. Today it reads: **8 rules covered, 573 insight types
uncovered.** Adding a disposition path for insights is then a visible gap with a number
rather than an unnoticed absence.

**Second-order trap to avoid.** `recommendation_actions` is keyed by `rule_key`, so a
dismissal is *sticky per rule*, while `recommendation_impressions` is per-render. Dividing
one by the other naively produces a number that falls forever as impressions accumulate
against a one-time dismissal. Getting this join wrong would be this department publishing a
confidently wrong metric about its own honesty.

---

### M4 — Ranking optimised for engagement and the feed became a slot machine

`recommendation_impressions` exists precisely because someone foresaw this: *"a recommender
trained only on conversions learns its own priors: recommend, it gets acted on, train on
the action, recommend it harder, and the long tail becomes invisible — invisibly, because
offline metrics improve as it degrades"* (migration `20260817000000`, citing
`BEVERAGE_CATALOGUE_ARCHITECTURE.md §10.6 M1`).

The failure is that the guard exists and is never used. Impressions are written
fire-and-forget (`recommendations.service.ts:380`) into a table nothing reads. The team
tunes scoring toward acceptance, acceptance rises, and what actually happened is that the
feed narrowed to the three rules managers reflexively click. The insight that would have
changed a purchase order is at position 14, or never generated.

**Earliest observable signal.** Rising `insight_acceptance_rate` with **falling distinct
`rule_key` count in the acted set**. Concentration in what gets acted on, not the rate, is
the tell.

**What would have prevented it.** Report acceptance **and** coverage of the served
distribution together — distinct rules served, distinct rules acted on, and
`top_rank_ignore_rate`. `position` is stored for this reason: *"a low-ranked, ignored
recommendation is expected; a top-ranked, ignored one is informative."* Any scoring change
is evaluated against the reconstructed served list (`request_id` groups one
`getRecommendations()` call exactly), not against a headline rate.

---

### M5 — At 11 restaurants, the team learned to read noise as signal

The acceptance rate is a small-sample statistic. `AGENT_NATIVE_UI_DECISION.md:332-337`:
detecting a 10% relative lift on a 50% baseline needs **~800 conversions per arm**; one
restaurant produces 20–50 task completions/day. *"You cannot prove any of these changes
helps — not one, not ever, at this scale."*

The failure is procedural, not statistical: the team reports acceptance weekly, the number
moves 40% week to week because restaurant traffic swings 30–60% (`:190-191`), and every
swing gets a story. Scoring is retuned against noise. Twelve months of work produce a
ranking function fitted to variance — and the *department that is supposed to model
statistical honesty for the whole company* is the one doing it.

**Earliest observable signal.** Any retrospective or agenda entry attributing a
week-over-week acceptance change to a specific scoring edit. The first one.

**What would have prevented it.** Biweekly, not weekly ([[insight-narrative-generation-loops]]
N1), with an explicit `insufficient_data` flag on the reported number until volume supports
it — the same posture the product shows the customer, applied to ourselves. Scoring changes
are justified by mechanism ("this rule fired on 3 data points and should not have"), never
by a rate movement.

---

## Cross-cutting counter-pressure

- **Every mechanism here is a version of one thing: this team is rewarded for filling the
  screen.** M1, M2 and M4 are all pressure toward *more output*; M3 and M5 are how that
  pressure gets misread as success. The structural counter-pressure is that this team's
  primary metric is a *ratio*, and its siblings own the numerator's correctness
  ([[analytics-engine-charter]]) and the claim's truth
  ([[metric-contract-truth-assurance-charter]]).
- **[[red-team-charter]] should attack M1** — it is the mechanism with a demo incentive
  behind it, which is exactly the class of decision advisory exists to attack
  ([[ORG_STRUCTURE]] §3).
- **[[security-charter]] carries OD-20 with a close-time.** Until then, M1 is not fully
  mitigable from inside this team, and the board says so rather than implying otherwise.
- **INTEL-F3 remains open.** Until `subject_type` has a home for the operator, this team's
  primary signal lives outside the neural footprint and cannot feed the loop graph
  (foundation §7).
- **Anti-sprawl.** 60 days without revisiting makes this fiction (foundation §3.3). Start
  by checking whether `analytics.insight_feedback_coverage` still reads *8 of 581*.
