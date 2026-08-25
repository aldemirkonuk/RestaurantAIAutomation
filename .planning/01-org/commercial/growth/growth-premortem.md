---
type: premortem
division: commercial
department: growth
status: provisional
metrics: [seo.indexed_pages, seo.soft_404_rate, editorial.gate_bypass_count, funnel.measurable_steps, funnel.fabricated_social_proof_count, demand.wedge_share_of_corpus]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[growth-loops]]", "[[growth-directive]]", "[[search-demand-research-premortem]]", "[[content-production-premortem]]", "[[editorial-gate-premortem]]", "[[technical-seo-ai-answer-surface-premortem]]", "[[conversion-funnel-premortem]]", "[[compliance-privacy-charter]]", "[[design-partner-operations-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Growth — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Growth has failed. What happened?

Five mechanisms, most likely first. Each is a department-level failure: the individual
teams' own failure modes live in their own premortems, and the ones below are the failures
that no single team can see from inside its own metric.

---

### M1 — The pipeline ran at full speed with nowhere to publish

The pipeline is the most legible thing Growth owns. It has six named stages and a diagram,
and every stage can be started immediately. So it was. G1 harvested a corpus, G2 drafted,
G3 edited, and by month three there were fourteen finished articles and **still no URL that
serves a page to a stranger** — because publishing is not a stage in that diagram, it is an
engineering dependency on `apps/web`, which is the authenticated product
(`apps/web/src/App.tsx:161` is the only public content route). Work looked like progress
for a full quarter. `seo.indexed_pages` never left zero, and nobody noticed because nobody
was reporting a number that could only be zero.

**Earliest observable signal.** The first draft entering [[editorial-gate-premortem]]'s
queue before any URL exists that could serve it. Not the tenth draft, the first. A second
tell arrives sooner: a Growth status update that reports *articles written* as its headline
figure.

**What would have prevented it.** Sequencing stated as a hard dependency in
[[growth-directive]]: **the publishing target precedes the first draft.** Concretely, one
route that returns server-rendered HTML with a real `<title>`, plus `robots.txt` and a
sitemap, before G2 is asked for article one. And the department's first standing number is
`seo.indexed_pages`, not draft count — a number that can only be zero is the correct number
to publish while it is zero, because it is the one that forces the dependency.

---

### M2 — The gate was suspended for one launch week and never fully came back

The founder is the writer and the editor. That is not a staffing detail, it is the
structural argument inside fork **CM-F1**. A week arrives with a real deadline, four
articles are queued, and the gate is skipped "for these four only, we will backfill the
edit". The backfill does not happen, because a published page reads as done. The fourth
article contains the recovery number, stated as *dollars recovered*, when the repo's own
analysis is explicit that this currently means **we asked, not we received**
([[YC_WEDGE_PLAN]]:31-33). A reader checks numbers. Numbers are the one thing they check.

**Earliest observable signal.** `editorial.rejection_rate` reaching 0% for two consecutive
close-times. A gate that rejects nothing is not passing everything, it is not reading. The
harder signal is any published unit whose provenance record is missing — which is why
provenance is a file per claim, not a memory.

**What would have prevented it.** `editorial.gate_bypass_count` is a **hard zero on the
department board**, not a team metric, so suspending the gate is visible one level above
the person who suspended it. The gate's verdict is a committed artifact, so a bypass is an
absence in version control rather than an unremembered decision. And publishing capacity is
capped at gate throughput by design: if one person can edit two articles a week, the
pipeline's published target is two, and G2's queue depth is the pressure relief, never the
gate. See [[editorial-gate-premortem]] M1.

---

### M3 — Every checklist went green on a site nobody could reach

Both checklists are gradable today against `apps/web`, and that is the trap. Core Web
Vitals can be measured on the authenticated shell. Image compression can be completed.
Canonical tags can be added to routes that only render after login. Twelve of sixteen boxes
turn green, the technical-SEO checklist is reported as substantially complete, and the only
crawlable content route in the entire product is still a vendor wine catalogue at
`/v/:slug` that no prospective restaurant will ever search for. The department reports a
green checklist and zero indexed pages in the same document, and the green is what gets
remembered.

**Earliest observable signal.** Any checklist item marked complete in a close-time where
`seo.indexed_pages` is zero. That combination — green checklist, zero index — is the alarm
state, and only the department sees both numbers.

**What would have prevented it.** Checklist items are **not gradable in isolation**: each
one is bound to an outcome metric in [[technical-seo-ai-answer-surface-charter]], and an
item whose outcome metric is unreadable is recorded as *unreadable*, never as done. This is
the same counter-pressure Engineering applies to grep-shaped guards — a syntax check always
gets an outcome-side twin. [[growth-loops]] L-GRO-6 runs the reconciliation monthly.

---

### M4 — Growth's own instrumentation made a shipped privacy page false

G5 cannot measure `funnel.visit_to_activated_rate` without pre-login instrumentation, and
"cookie consent" sits on the technical-SEO checklist the founder handed to Growth. So an
analytics tag is added to `apps/web/index.html` and a consent banner ships alongside it, as
a checklist item, in a routine PR. Meanwhile `apps/web/src/pages/Privacy.tsx:30-31` has been
telling every reader: *no tracking or advertising cookies, no consent banner, because there
is nothing to consent to*, and `:48-49` says telemetry is off unless explicitly enabled. The
page's own header comment (`:8-11`) states the contract plainly: *if any of those change,
this page has to change with them*. It did not change. The company now has a written privacy
claim that its own homepage contradicts, authored by the department that talks to strangers
for a living. That is a compliance incident wearing a growth hat.

**Earliest observable signal.** The first PR that touches `apps/web/index.html` or adds an
analytics environment variable **without** a diff to `apps/web/src/pages/Privacy.tsx` in the
same commit. Also: the first appearance of a consent-banner component with no
[[compliance-privacy-charter]] review recorded.

**What would have prevented it.** A coupling rule, enforced as a CI check rather than a
convention: **any change to tracking, cookies, or telemetry configuration and the privacy
notice ship in the same commit or neither ships.** The wording is drafted by
[[compliance-privacy-charter]] and never by Growth. And G5 exhausts the
no-new-tracking options first — server-side referrer capture, first-party session counting
without a cookie — because the cheapest way to keep a privacy claim true is to not need the
cookie. See [[conversion-funnel-premortem]] M2.

---

### M5 — Social proof was manufactured, because there was exactly one customer

"Real reviews only" is founder-specified and unambiguous. It collides with reality: one
known user, a friend's Turkish restaurant in San Francisco on Toast, whose Toast credentials
are still not configured. The conversion checklist asks for case studies and reviews. The
page has an empty section where trust is supposed to live, conversion sits near zero, and
the fix is one sentence away at all times. The soft version arrives first and is the one
that actually happens: not an invented reviewer, but a case study written from the design
partner's politeness and a recovery figure that means *we asked*. It is defensible in the
moment and it is false on the page.

**Earliest observable signal.** Any social-proof element whose source is not a named,
consenting counterparty with a dated artifact behind it. Practically: a testimonial, logo,
star rating, or figure appearing in a draft with no entry in the provenance record. The
softer tell comes earlier — a case study drafted before
[[design-partner-operations-charter]] has produced a verified credit memo.

**What would have prevented it.** `funnel.fabricated_social_proof_count` is an absolute
zero on the department board, and the counter-pressure is to make the honest option
available: an **empty state that is deliberately designed** rather than an empty slot that
begs to be filled. "One design partner, results pending verification" is a shippable
sentence. G3 refuses any social proof lacking provenance, using the same rule it applies to
the recovery number, and provenance is a file, not a recollection.

---

## Cross-cutting counter-pressure

- **Two mechanisms above (M1, M3) are the same disease**: Growth measuring its own activity
  instead of its own outcome. The department board carries no activity counters at all —
  no drafts written, no checklist percentage, no keywords harvested — only the five team
  outcomes and the three zeros ([[growth-agenda-board]]).
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  M2 and M5 specifically: they are the two mechanisms where the wrong decision is
  comfortable at the time it is made. [[decision-office-charter]] owns the close-times these
  counter-pressures name, because a counter-pressure with no close-time is the same failure
  one level up.
- **This document is subject to the anti-sprawl rule it cites.** Untouched for 60 days, it
  is fiction ([[README]] §3.3, §6).
