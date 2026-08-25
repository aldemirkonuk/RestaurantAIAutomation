---
type: charter
division: commercial
department: growth
team: conversion-funnel
status: partial
metrics: [funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.fabricated_social_proof_count, funnel.step_dropoff, conversion.checklist_items_green]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[conversion-funnel-premortem]]", "[[conversion-funnel-agenda-full]]", "[[conversion-funnel-agenda-board]]", "[[conversion-funnel-directive]]", "[[conversion-funnel-loops]]", "[[conversion-funnel-schedule]]", "[[technical-seo-ai-answer-surface-charter]]", "[[editorial-gate-charter]]", "[[content-production-charter]]", "[[design-partner-operations-charter]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[client-surfaces-charter]]", "[[design-charter]]", "[[activation-in-product-guidance-charter]]", "[[analytics-bi-charter]]", "[[ux-path-burn-down-charter]]", "[[commercial]]", "[[PAGE_MAP]]"]
---

# Conversion & Funnel — Charter

Team **G5** of [[growth-charter]]. Division: Commercial.

## Mandate

**Content earns the visit; G5 earns the account.** The team owns the conversion/UX checklist
and the instrumentation that says whether any of it works, from a stranger's first visit to
an **activated restaurant** — where activated means the first POS-connected day, not a
signup. A signup that never connects Toast is worth nothing to this product, and defining the
metric that way is the single most consequential decision in this charter.

The checklist, as specified by the founder:

| Item | State today |
|---|---|
| Custom 404 with a CTA | **Absent as a route.** The component exists (`apps/web/src/components/ui/error-state.tsx:142`) and is routed nowhere |
| CTA above the fold | No public marketing page exists to place one on |
| Breadcrumbs | Component exists (`apps/web/src/components/layout/Breadcrumbs.tsx:14`), used on **one** page (`apps/web/src/pages/InsightCatalog.tsx:228`) |
| Sticky mobile CTA | Absent |
| Case studies | None. One design partner, not yet connected |
| **Real reviews only — never fabricated** | **A hard zero, not a checklist item.** See below |
| Image alt text | Partial: 17 `<img>` tags in `apps/web/src`, at least 10 with no `alt` |
| Local business schema | **Deliberately not shipped.** No premises, and the markup would assert one |

**"Real reviews only" is not a task on this list. It is a constraint with an absolute
zero.** `funnel.fabricated_social_proof_count` = 0, no exception path, no severity scale. It
is written into the charter rather than the backlog because a checklist item can be
deprioritised and a constraint cannot.

## Boundaries

Owns outright:

- **The conversion/UX checklist**, each item bound to an outcome metric so none is gradable
  in isolation.
- **Funnel definition and instrumentation** — what the steps are, which are measurable, and
  what a measurable step costs in privacy terms.
- **The 404 page's content and CTA** — G4 owns the status code, G5 owns what the visitor
  reads. Named as a seam in [[growth-directive]] because a seam with two owners has none.
- **Social proof**, its provenance, and the honest empty state when there is none.
- **The pre-signup surface's conversion behaviour**, once one exists.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| The 404 status code | [[technical-seo-ai-answer-surface-charter]] · G4 | G4 owns the protocol, G5 owns the page. **Neither ships the item alone** |
| The words in an article | [[content-production-charter]] · G2 | G5 owns the CTA and the page around the words |
| Whether a claim may be published | [[editorial-gate-charter]] · G3 | Every testimonial, logo, rating, and case study passes the gate |
| Producing the case-study evidence | [[design-partner-operations-charter]] · S1 | S1 produces verified recovery; G5 presents what S1 verified and nothing more |
| Privacy notice wording and legal basis | [[compliance-privacy-charter]], [[privacy-engineering-charter]] | **Growth never drafts privacy copy.** G5 states what it needs to measure |
| In-product onboarding after signup | [[activation-in-product-guidance-charter]] *(Design)* | G5's funnel ends at first POS-connected day; the in-app path to get there is Design's |
| The analytics engine and the metrics narrative | [[analytics-bi-charter]] | G5 consumes; it does not build the engine |
| The app's components, routes, and bundle | [[client-surfaces-charter]], [[design-charter]] | G5 states the requirement; Engineering and Design ship it |
| In-app UX path burn-down | [[ux-path-burn-down-charter]] *(Design)* | Adjacent and easily confused: that catalogue is post-login paths, this is pre-account conversion |
| Anything implying a price | [[unit-economics-pricing-charter]] · F2 | **Founder-deferred.** No CTA reads "see pricing" and no page is laid out around a price |

## Metrics it moves

**Primary — `funnel.visit_to_activated_rate`.** Visit to first POS-connected day.

**`funnel.measurable_steps` is reported next to it, always, and it is currently 0 for every
pre-login step.** A conversion rate computed over a funnel with one visible step is not a
conversion rate. Publishing the pair is what stops G5 reporting a confident number derived
from nothing.

**`funnel.fabricated_social_proof_count` = 0. Absolute.** Breached once, it is unrecoverable:
a fabricated review is not a mistake a company explains, and it would be Growth that did it,
not Sales.

**`funnel.step_dropoff`** per step, once steps exist.

**`conversion.checklist_items_green`** is listed last and never alone, for the same reason
G4's is: it is an activity counter and the department's named failure mode
([[growth-premortem]] M3).

## Evidence today

**PARTIAL**, with three verified findings — one of which corrects the record in
[[commercial]] §1.3.

**The 404, verified as a two-layer defect.** `apps/web/src/App.tsx:302` renders
`<Navigate to="/" replace />` for `path="*"`, so an unmatched path silently redirects to the
dashboard. Above it, `vercel.json:12-15` rewrites `/((?!api/|assets/).*)` to `/index.html`,
which serves **HTTP 200**. A visitor gets a confusing redirect; a crawler gets a soft 404. The
presentation half is nearly free: `apps/web/src/components/ui/error-state.tsx:142` already
exports a `NotFoundError` component, referenced today only by its own Storybook file.

**Product analytics — a correction, not a gap.** [[commercial]] §1.3 recorded "no product
analytics of any kind". That is right about acquisition and wrong about the mechanism.
`apps/web/src/lib/uxSignals.ts` is a real interaction-telemetry client — rage clicks, dead
clicks, time-to-interactive — posting to `apps/api-gateway/src/ux-optimizer/`. It ships
**dark** behind `VITE_UX_OPTIMIZER === "true"` (`:15`), and it buckets on the **authenticated
user id** (`:20-23`). So an instrument exists, it is off, and it is on the wrong side of the
login wall: **it cannot observe a first visit by construction.** That distinction is the whole
of G5's instrumentation problem, and it is better news than "nothing exists" because the
privacy contract has already been thought about (`:8-11`).

**A published privacy position that constrains the obvious solution.**
`apps/web/src/pages/Privacy.tsx:30-31` tells every reader: *no tracking or advertising
cookies, no consent banner, because there is nothing to consent to.* `:48-49` says
interaction telemetry is off unless a deployment enables it and the operator turns on Usage
analytics in Settings (`apps/web/src/components/settings/ServicesPermissions.tsx:29`). The
file's own header comment (`:8-11`) states the contract: *if any of those change, this page
has to change with them.* **Adding a conventional analytics tag would make a live page
false**, and the founder placed "cookie consent" on Growth's checklist, which means Growth
owns the instrument that would invalidate its own privacy page. This is
[[growth-premortem]] M4 and it is the most interesting constraint in the department.

**What else exists:**

- **The activation path is real**: `apps/api-gateway/src/auth/auth.service.ts:650-651` →
  `apps/api-gateway/src/communications/gmail.service.ts:702` sends an onboarding email at
  first registration. The step after signup is instrumented in the sense that it happens; it
  is not measured.
- **Breadcrumbs exist and are used once.** `apps/web/src/components/layout/Breadcrumbs.tsx:14`,
  used at `apps/web/src/pages/InsightCatalog.tsx:228`. The checklist item is a rollout
  question, not a build.
- **Alt text is partial.** 17 `<img>` tags in `apps/web/src`; at least ten carry no `alt`,
  including `apps/web/src/pages/VendorPortal.tsx:222` on the one public content route.

**What does not exist:** any public page a stranger can convert on, any case study, any
review, any pre-login measurement, and any sticky mobile CTA.

## Why this is a team

Its failure is invisible to every other Growth team. G1, G2, G3 and G4 can all report success
in the same quarter that conversion sits at zero, because none of their metrics can see it.
That is the definition used to justify a team in this division: metric, craft, and failure
mode all differ from the siblings ([[commercial]] §0).
