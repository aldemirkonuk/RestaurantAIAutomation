---
type: premortem
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: partial
metrics: [pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[supplier-distributor-network-charter]]"
  - "[[supplier-distributor-network-directive]]"
  - "[[partnerships-integrations-premortem]]"
  - "[[supply-discovery-charter]]"
  - "[[design-partner-operations-charter]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[YC_WEDGE_PLAN]]"
---

# Supplier & Distributor Network — Premortem

> Written at founding, before success is assumed.

It is August 2027. `pi.live_counterparties` is still 0 and `procurement_orders` is still in
single digits. Here is how, most likely first.

---

## M1 — The team runs a metric it does not control, because two boundaries cross it

**The mechanism.** This is the most likely failure and it is structural, not behavioural. Two
open forks pass through this team at once:

- **PROD-F2** — does supply discovery sit in Product & Vision or here?
- **CM-F3** — is distributor connectivity Sales' or ours? (`commercial.md:631`, citing
  `YC_WEDGE_PLAN.md:41`: *"the connectivity is a commercial problem, not a technical one"*)

Neither resolves, because an unowned thing generates no pressure to resolve itself. So the
team is measured on `pi.live_counterparties` — distributors with a refreshing feed or an
active portal login — while the **ask** that produces a willing distributor sits in Sales and
the **discovery** that produces the candidate list sits in Product & Vision. Every status
report becomes a list of other units' actions. Twelve months on, the honest summary is "we
were blocked," which is true and useless, and the team has produced portal features nobody
requested because building was the only thing fully inside its control.

**Earliest observable signal.** The first status report whose blockers are **entirely other
units' actions**. Cheaper still: **90 days with PROD-F2 and CM-F3 both open and
`pi.live_counterparties` still 0.**

**Counter-pressure.** Two, and the second is the real one:
1. The charter **states the proposed seam** — signed intent to send data; Sales before it, us
   after it — so the fork is arguable rather than ambient. A boundary that is written down
   gets contested; one that is assumed gets ignored.
2. **A 90-day dissolution clause.** If both forks are still open at day 90 with the metric at
   zero, this team proposes its own merge into [[pos-bridge-charter]] (same connector failure
   mode, same substrate) and hands the relationship half to
   [[design-partner-operations-charter]]. **A team that cannot state what it controls should
   be merged, not staffed.** This is the single most likely place this department is one team
   too many, and saying so in the founding document is cheaper than discovering it in a year.

---

## M2 — The portal is built for distributors who never log in

**The mechanism.** The vendor portal exists — two public routes, a slug-addressed page,
JSON-LD for crawlers (`vendor-portal.controller.ts:20-21, 39-40`). It is a good surface. But a
distributor's actual workflow is a PDF price list emailed to a rep on Tuesday, and it has been
for thirty years. Nothing in the product is worth changing that for — not from *their* side,
because the value accrues to the restaurant, not to them. So the portal accumulates features
aimed at a login that never happens: a dashboard, an order view, a message inbox. Each is
justified by "distributors will need this once they're on," and the premise is never tested
because testing it requires a distributor.

**Earliest observable signal.** Portal feature work proceeding with **zero portal logins to
date**. Visible from the first feature, and it is visible today: the surface exists and
`pi.live_counterparties` = 0.

**Counter-pressure.** Invert the default: **meet the workflow that exists rather than
replacing it.** `YC_WEDGE_PLAN.md:39-41` already prescribes this shape for EDI — *parse X12,
accept it however it arrives, build no transport*. The same logic applies to the whole
counterparty surface: accept the emailed PDF, the spreadsheet, the SFTP drop. And a hard rule
in [[supplier-distributor-network-directive]]: **no portal feature ships while
`pi.live_counterparties` == 0**, except features that reduce the effort required to become the
first one. A portal is a reward for a relationship, not a way to get one.

---

## M3 — We build EDI transport because it feels like the professional answer

**The mechanism.** A distributor eventually says "we can do EDI." That sounds like a solved
problem with a standard, and standards are seductive to engineers. So the work drifts from
*parse an X12 document* to *speak X12 properly* — a VAN relationship, AS2 certificates,
acknowledgement flows, trading-partner setup per distributor. Six months of infrastructure for
a channel that, per the plan's own research, is *"requested per distributor and is a big-house
privilege"* — and the Southern Glazer's EDI programmes are vendor-side anyway, *"the opposite
direction from what a restaurant needs"* (`YC_WEDGE_PLAN.md:36-39`).

**Earliest observable signal.** The first design document that mentions AS2, a VAN, or
trading-partner onboarding. One grep, and it is unambiguous.

**Counter-pressure.** This is already decided upstream and the team's job is to not relitigate
it: **build no VAN or AS2 transport** (`YC_WEDGE_PLAN.md:40-41`). Parse 810/856/812, read
850/855, accept the document however it arrives — email, photo, upload, SFTP drop. Four intake
channels, one document model, and **downstream code never learns which channel a document
arrived on** (`YC_WEDGE_PLAN.md:47-53`). If a distributor insists on true EDI transport, that
is a commercial decision with a cost attached, escalated — not absorbed as engineering.

---

## M4 — Vendor pages leak, because publish-state was treated as a route problem

**The mechanism.** `GET /vendor-portal/:slug` and `/:slug/jsonld` are deliberately public and
correctly marked `@Public()`. Security's SEC-2 already flagged that the real risks here are
**slug enumeration and unpublished-page leakage**, not signature verification — and that
`ENDPOINTS.md` had originally prescribed the wrong control entirely. But because the route is
now correctly classified as "intentionally public, not a gap" (`ENDPOINTS.md:656`), the
residual risk reads as *closed*. Then a vendor page is created in draft during a negotiation,
its slug is guessable, and a competitor reads the terms of an agreement that has not been
signed. Or JSON-LD, which exists to be crawled, indexes a page that was never meant to be
public.

**Earliest observable signal.** A vendor record that exists before its relationship does — a
draft page with a live slug. Detectable the first time a page is created ahead of a signature,
which is exactly when it is most useful to create one.

**Counter-pressure.** **Publish-state is a relationship property, not a route property**, and
therefore belongs to this team rather than to Security. Two rules: a vendor page renders only
when the underlying relationship is in a published state, and slugs are not enumerable —
non-sequential, non-guessable. The route stays public; the *content* becomes conditional. And
the check runs at page creation, not at request time, because the risk is created by the
workflow rather than by the endpoint.

---

## M5 — `provider_promotions` stays dormant, and the intelligence built on it silently reads empty

**The mechanism.** `provider-intelligence.service.ts` performs **six** reads against
`provider_promotions` (`:135, :159, :179, :197, :222, :414`). The table is dormant. Every one
of those reads returns nothing, and each caller handles it gracefully — which is correct
engineering and a terrible signal, because "no promotions found" is indistinguishable from "no
promotions exist" is indistinguishable from "the feed stopped three weeks ago." When a
distributor relationship does go live and the feed later breaks, the system will report the
same tranquil emptiness it reports today, and nobody will notice for a month.

**Earliest observable signal.** Available now, at zero cost: **there is no distinction in the
code between "dormant," "empty," and "stale."** No freshness check, no last-refresh timestamp
surfaced, no alert.

**Counter-pressure.** Freshness before features. Every counterparty feed carries a
`last_refreshed_at` and an expected cadence, and a feed past its cadence is **loud** — that is
what makes `pi.live_counterparties` measurable at all, since the definition is *refreshing*,
not *present*. Build this before the first live feed, not after the first silent break: it is
the same argument as instrumenting the catalogue-match gate before real data arrives
([[pos-bridge-premortem]] M4), and it fails the same way if deferred.

---

## The one that would hurt most

**M1**, and uniquely among the premortems in this department, the honest counter-pressure is
*this team might not survive it*. M2–M5 are correctable inside the team. M1 is a question
about whether the team should exist in this shape at all, and the 90-day clause exists so that
the question gets answered rather than absorbed.
