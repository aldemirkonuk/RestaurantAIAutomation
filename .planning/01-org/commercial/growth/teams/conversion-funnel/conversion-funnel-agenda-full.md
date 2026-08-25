---
type: agenda-full
division: commercial
department: growth
team: conversion-funnel
status: provisional
metrics: [funnel.measurable_steps, funnel.visit_to_activated_rate, funnel.fabricated_social_proof_count]
updated: 2026-08-24
links: ["[[conversion-funnel-charter]]", "[[conversion-funnel-premortem]]", "[[conversion-funnel-loops]]", "[[conversion-funnel-directive]]", "[[conversion-funnel-schedule]]", "[[conversion-funnel-agenda-board]]", "[[growth-agenda-full]]", "[[technical-seo-ai-answer-surface-charter]]", "[[editorial-gate-charter]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[client-surfaces-charter]]", "[[OPEN-DECISIONS]]"]
---

# Conversion & Funnel — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

G5 has no page to convert on and no way to see a visitor. The work divides into three parts,
and only the first is unblocked.

1. **Decide how to measure without breaking a promise.** `funnel.measurable_steps` is 0
   pre-login. The conventional fix breaks `apps/web/src/pages/Privacy.tsx:30-31`. Finding a
   cookieless answer is design work, not a ticket, and it is the highest-value thing G5 can do
   before a marketing page exists.
2. **The 404**, jointly with [[technical-seo-ai-answer-surface-charter]]. The cheapest real
   improvement in the department, and the only checklist item that helps a visitor **today**.
3. **The honest social-proof design.** Built now, before there is pressure, because the whole
   point is that it must not look like a gap waiting to be filled.

## How

**Measurement without a cookie (item 1).** Options, cheapest and least invasive first:

| Option | What it gives | Privacy cost |
|---|---|---|
| Server/CDN log-derived visit counts | Visits, referrers, paths | None. No client code, no identifier stored |
| First-party session counting without a cookie | Sessions, entry page, exit page | Low, and describable in one sentence |
| A first-party analytics tag with no cross-site identifier | Full pre-login funnel | **Requires changing a published promise** |
| A conventional third-party analytics tag | Everything, plus a consent banner | Contradicts `apps/web/src/pages/Privacy.tsx:30-31` outright |

G5's position: **exhaust the top two before proposing either of the bottom two.** Rows 1 and 2
plausibly get `funnel.measurable_steps` from 0 to 3 with no consent surface at all, and the
cheapest way to keep a privacy promise is to not need the thing that breaks it.

**The rule that goes with it, whichever row is chosen:** tracking configuration and the
privacy notice change **in the same commit or neither changes** — enforced in CI, because
`apps/web/src/pages/Privacy.tsx:8-11` already states the contract in a code comment, where CI
cannot read it. [[compliance-privacy-charter]] and [[privacy-engineering-charter]] hold the
pen on every word of the notice. Growth never drafts privacy copy.

**The 404 (item 2), as a seam.** G4 owns the status code, which lives at the host:
`vercel.json:12-15` rewrites everything to `/index.html` and a rewrite serves 200. G5 owns
what the page says and where its CTA goes. The component already exists at
`apps/web/src/components/ui/error-state.tsx:142` and is routed nowhere; `apps/web/src/App.tsx:302`
currently redirects instead. **Neither team ships the item alone**, and the acceptance
criterion is a status code observed in production plus a page a lost visitor can act on.

**Honest social proof (item 3).** Design the empty state deliberately: what the page says
when there is one design partner and no verified recovery number yet. A designed statement is
shippable; a blank slot is an invitation. Every element that ever fills it needs a named
consenting counterparty and a dated artifact, and it passes [[editorial-gate-charter]] like
any other claim.

**The rest of the checklist**, scoped honestly: breadcrumbs, alt text, sticky mobile CTA, and
CTA-above-fold are all **pre-account surface** work. Completing them on authenticated routes
is in-product work that belongs elsewhere and does not count here
([[conversion-funnel-premortem]] M3). Local business schema is **not shipped**: there are no
premises, and the markup would assert some.

## Why now

- **The 404 is the only conversion improvement available today.** Every unmatched URL
  currently redirects a confused visitor to a dashboard they cannot use. The component exists.
  The fix is a routing change plus a host change.
- **The measurement decision gets harder after content ships.** Choosing cookieless counting
  before there is traffic is a design choice; choosing it after a marketing page is live and a
  number is wanted is a retreat.
- **The social-proof pressure has not started yet.** It starts the day there is a page with a
  gap on it. Designing the honest version while nobody is asking for numbers is the only time
  it can be designed calmly ([[conversion-funnel-premortem]] M1).
- **Alt text is a real accessibility gap right now**, not a future SEO item: at least ten of
  the 17 `<img>` tags in `apps/web/src` carry no `alt`, including
  `apps/web/src/pages/VendorPortal.tsx:222` on the one public content route.

## Next steps

1. Write the measurement options paper — the four rows above, with what each yields and what
   each costs. Take it to [[compliance-privacy-charter]], not to Engineering.
2. Agree the 404 seam with [[technical-seo-ai-answer-surface-charter]]: who files what, and
   the shared acceptance criterion.
3. Draft the honest social-proof block and have [[editorial-gate-charter]] mark it up before
   anyone needs it.
4. File the alt-text gap with [[client-surfaces-charter]] — it is small, real, and unblocked.
5. Propose the CI coupling check for tracking config and the privacy notice.
6. Do **not** define a funnel step that cannot be measured, and do not report a conversion
   rate while `funnel.measurable_steps` is 0.

## Questions for the founder

1. **Do we keep the no-cookie promise?** `apps/web/src/pages/Privacy.tsx:30-31` is a good
   promise and rarer than it looks. G5's strong preference is to keep it and measure
   cookielessly. Changing it is your call and
   [[compliance-privacy-charter]]'s wording.
2. **Activation stays "first POS-connected day"?** It will read zero for a long time,
   including possibly for the design partner, whose Toast credentials are still unconfigured.
   G5 recommends holding the definition and reporting the zero
   ([[conversion-funnel-premortem]] M4).
3. **What may we say about the design partner?** Naming a restaurant requires its consent,
   and an unnamed case study is weaker but honest. This is a question for the relationship,
   through [[design-partner-operations-charter]], before it is a design question.
4. **Where does the 404's CTA point** when there is no marketing site? Today the only honest
   destinations are the login page and the privacy page, and neither is a conversion.
