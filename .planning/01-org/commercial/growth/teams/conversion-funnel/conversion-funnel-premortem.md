---
type: premortem
division: commercial
department: growth
team: conversion-funnel
status: provisional
metrics: [funnel.fabricated_social_proof_count, funnel.measurable_steps, funnel.visit_to_activated_rate, conversion.checklist_items_green]
updated: 2026-08-24
links: ["[[conversion-funnel-charter]]", "[[conversion-funnel-loops]]", "[[conversion-funnel-directive]]", "[[growth-premortem]]", "[[editorial-gate-charter]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[red-team-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Conversion & Funnel — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. G5 has failed. What happened?

---

### M1 — Social proof was invented, because the honest version looked like nothing

The mechanism named in [[commercial]] §1.3, and it is first because the pressure is
continuous and the fix is always one sentence away. "Real reviews only" collides with having
exactly one customer — a friend's Turkish restaurant in San Francisco whose Toast credentials
are still unconfigured. The conversion checklist asks for case studies and reviews. The page
has a visible gap where trust belongs, conversion sits near zero, and every week someone
reasonable suggests filling it.

**The blunt version — an invented reviewer, a fake logo wall — is not what happens.** What
happens is the soft version: a case study written from the design partner's politeness, a
figure phrased as **dollars recovered** when the repo's own analysis says it means *we asked*
([[YC_WEDGE_PLAN]]:31-33), and the word "restaurants" in the plural. Each step is defensible
in the moment. The page is false. And because it is a conversion page, it is the page a
prospect screenshots.

**Earliest observable signal.** Any social-proof element whose source is not a named,
consenting counterparty with a dated artifact. Practically: a testimonial, logo, rating, or
figure appearing in a draft with no entry in the provenance record. The earlier tell is a
case study drafted **before** [[design-partner-operations-charter]] has produced a verified
credit memo.

**What would have prevented it.** Three things, none of which is restraint.
**(a)** `funnel.fabricated_social_proof_count` = 0 is a department-level absolute with no
exception path ([[growth-agenda-board]]).
**(b)** Every social-proof element goes through [[editorial-gate-charter]], which rejects
anything lacking a named consenting counterparty. It is a published claim, so the gate that
handles claims handles it.
**(c)** The honest option is **designed**, not left as a gap: "one design partner, results
pending verification" is a shippable sentence and a deliberately designed empty state does not
beg to be filled the way an empty slot does.

---

### M2 — The funnel got measured, and a live privacy page became false

G5 cannot compute `funnel.visit_to_activated_rate` without pre-login instrumentation, and
"cookie consent" is on the checklist the founder handed to Growth. So the conventional
solution ships: an analytics tag in `apps/web/index.html`, a consent banner beside it, both in
a routine PR, both as checklist items going green.

Meanwhile `apps/web/src/pages/Privacy.tsx:30-31` has been telling every reader *no tracking or
advertising cookies, no consent banner, because there is nothing to consent to*, and `:48-49`
says telemetry is off unless explicitly enabled. The file's header comment (`:8-11`) states
the contract outright: *if any of those change, this page has to change with them.* It did not
change, because nobody who touched `index.html` was thinking about a page in
`src/pages/`. The company now contradicts its own published privacy claim, authored by the
team whose job is talking to strangers.

**Earliest observable signal.** The first PR touching `apps/web/index.html` or adding an
analytics environment variable **without** a diff to `apps/web/src/pages/Privacy.tsx` in the
same commit. Also: a consent-banner component appearing with no
[[compliance-privacy-charter]] review recorded.

**What would have prevented it.** A **coupling rule enforced in CI**, not by memory: tracking
configuration and the privacy notice change in the same commit or neither changes. And a
sequencing rule — **exhaust the cookieless options first**. Server-side referrer capture,
first-party session counting without a cookie, and log-derived visit counts can produce
`funnel.measurable_steps` > 0 without a single tracking cookie. The cheapest way to keep a
privacy promise is to not need the thing that breaks it. Wording stays with
[[compliance-privacy-charter]] and [[privacy-engineering-charter]] in every case.

---

### M3 — The checklist went green on an app nobody outside could reach

Breadcrumbs get rolled out across the authenticated app. Alt text is completed on all 17
`<img>` tags. The 404 component gets wired. A sticky mobile CTA appears on the dashboard.
Six of eight items turn green, all of them real improvements, none of them visible to a
single person who does not already have an account. `funnel.visit_to_activated_rate` is
unchanged, and unchanged from zero, and it stays that way because the entire checklist was
applied behind the login wall.

**Earliest observable signal.** A checklist item completed on an authenticated route.
Concretely: breadcrumbs shipped to `apps/web/src/pages/` dashboards while there is still no
public page carrying them. Also any close-time where `conversion.checklist_items_green` moves
and `funnel.measurable_steps` is still 0.

**What would have prevented it.** Each item is bound to an outcome metric and scoped to a
**pre-account surface**; an item completed on an authenticated route is recorded as
in-product work belonging to [[activation-in-product-guidance-charter]], not as a G5 checklist
completion. And [[growth-loops]] L-GRO-6 reconciles green items against outcomes monthly, one
level above the team doing the grading.

---

### M4 — Activation was redefined to something achievable

`funnel.visit_to_activated_rate` uses *first POS-connected day*. That number will be zero for
a long time — the design partner's `DEP-06` Toast credentials are still unchecked, so it may
be zero even for the one customer. A zero metric attracts pressure, and the pressure has a
seductive resolution: signups are measurable, immediate, and responsive to conversion work.
The definition quietly becomes "signup", G5 starts reporting a rate that moves, and the
company optimises for accounts that never connect a POS and therefore never see the product
do anything.

**Earliest observable signal.** Any report where the denominator is signups, or where
"activated" appears without "POS-connected" beside it. Also: a conversion experiment whose
success criterion is registration completion.

**What would have prevented it.** The definition lives in the charter, and any change to it is
a **department-level decision** requiring [[growth-directive]]'s metric-definition right, not
a team choice. Signups may be tracked as an intermediate step in `funnel.step_dropoff` —
knowing where people fall out is useful — but the headline rate keeps its denominator. Zero is
an honest reading of a product with one unconnected design partner, and reporting an honest
zero is what keeps the rest of the department's numbers legible.

---

## Cross-cutting counter-pressure

- **M1 and M4 are the same instinct**: making a page or a number look better than the company
  is. One does it with a sentence, the other with a definition. Both are caught by the same
  discipline — the claim and the metric are owned outside the team that benefits from them.
- **M2 is unusual and worth naming as such**: it is a failure where Growth harms a *legal*
  surface rather than a commercial one, and no other team in the department can see it
  coming. That is why the coupling rule is in CI rather than in a checklist.
- **[[red-team-charter]] should attack M1 and M4.** Both are decisions that feel reasonable at
  the moment they are made, which is its stated scope: attacking decisions, not systems.
