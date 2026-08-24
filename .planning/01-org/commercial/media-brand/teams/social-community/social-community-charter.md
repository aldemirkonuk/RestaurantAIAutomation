---
type: charter
division: commercial
department: media-brand
team: social-community
status: new
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[social-community-premortem]]"
  - "[[social-community-directive]]"
  - "[[social-community-loops]]"
  - "[[social-community-schedule]]"
  - "[[editorial-gate-charter]]"
  - "[[conversion-funnel-charter]]"
  - "[[commercial]]"
---

# Social & Community (M3) — Charter

**Parent:** [[media-brand-charter|Media & Brand]] · Commercial.
**Evidence grade: `NEW`.** ⏸ **Chartered dormant with an explicit entry trigger.**

## Entry trigger

> **This team does no work until the first long-form article clears
> [[editorial-gate-charter|G3's]] editorial gate.**

Before that there is nothing to distribute, and a dormant feed reads worse than no feed. The
treatment matches NF-C at [README §4.3](../../../../../foundation/README.md): preserved as
ambition, not carried as weight. Raised as fork **CM-F6** in [[commercial]] §6 — chartered
dormant, or not chartered at all.

Until the trigger fires, this team's entire operation is one weekly line on the department
schedule: *has an article cleared G3?* Yes or no.

## Mandate

Public presence where Growth's output gets distributed and where restaurant operators
actually gather. Feed mechanics rather than search mechanics.

## Why distinct from Growth

G1–G4 optimise for a query that already exists. This team reaches people who are not
searching. Different trigger, different rhythm, different content shape — an article earns a
click from someone who went looking; a post has to earn attention from someone who did not.

**Why distinct from [[narrative-collateral-charter|M2]]:** M2 builds one argument for a
named room and hands it over. M3 operates a continuous surface with no named recipient, and
its failure is cumulative rather than momentary. A weak deck loses one meeting; a weak feed
becomes the first result for the one search we are guaranteed to be ranked for — our own
company name.

## Boundaries

Owns outright, once live: the accounts and handles, the posting rhythm, the content shape
per platform, and the routing rule for replies.

## Explicit non-goals

- **Producing the content** belongs to [[content-production-charter|Growth G2]]. M3
  distributes; it does not write the source material.
- **Clearing content for publication** belongs to [[editorial-gate-charter|G3]]. Nothing
  posts that has not cleared the gate, including posts.
- **The conversion path after the click** belongs to
  [[conversion-funnel-charter|Growth G5]] — and so does the instrumentation this team's own
  metric depends on.
- **Support.** Replies asking for product help route to the in-product support address, not
  into an unstaffed feed. See [[social-community-directive]].
- **Community content production as a discipline** was considered and not chartered
  ([[commercial]] §1.4): distribution, not production, sits here.
- **Paid promotion.** No budget, no pricing, no target list.

## Metrics it moves

**Primary: referred sessions that reach an activated account.** Not followers. Not
impressions. Activated means a first POS-connected day, matching G5's definition — a signup
that never connects Toast is worth nothing to this product.

**This metric is not currently measurable, and that is a dependency rather than an excuse.**
There is no product analytics of any kind: Sentry is the only telemetry SDK in
[EXTERNAL_CONNECTIONS.md](../../../../../foundation/EXTERNAL_CONNECTIONS.md), so no funnel
step can be attributed to a referrer. G5 owns closing that gap. If the trigger fires before
G5 has, M3 starts with a metric it cannot report, and the honest interim is to report
nothing rather than substitute follower counts — substituting the measurable vanity metric
for the unmeasurable real one is how a feed's purpose drifts.

## Evidence today

`NEW`. Zero artifacts. No social account, handle, scheduling tool, or link-tracking service
appears among the 50 runtime hosts in
[EXTERNAL_CONNECTIONS.md](../../../../../foundation/EXTERNAL_CONNECTIONS.md). Nothing in the
repo references a social presence.

**Nothing has been reserved either**, which is itself a finding: dormancy has a cost, and
the handle for a company that has just renamed itself is a defensive registration rather
than a launch. Raised as a question in [[social-community-agenda-full]] rather than claimed
as a decision here — reserving a handle is cheap, and it is still a decision the founder
makes.

**One dependency on a sibling.** The support address a reply would be routed to is currently
`support@wineops.ai` (`apps/web/src/pages/Help.tsx:18`), which is
[[brand-identity-charter|M1]]'s defect to fix. M3 cannot publish a routing rule that points
at the old company.
