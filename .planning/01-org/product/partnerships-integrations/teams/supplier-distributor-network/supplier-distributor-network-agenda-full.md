---
type: agenda-full
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: provisional
metrics: [pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[supplier-distributor-network-charter]]"
  - "[[supplier-distributor-network-premortem]]"
  - "[[supplier-distributor-network-agenda-board]]"
  - "[[supplier-distributor-network-directive]]"
  - "[[supply-discovery-charter]]"
  - "[[design-partner-operations-charter]]"
  - "[[connector-platform-trust-agenda-full]]"
  - "[[YC_WEDGE_PLAN]]"
---

# Supplier & Distributor Network — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn distributors from **rows in a database** into **live counterparties** — sending a
refreshing price feed or logging into a portal. One metric: `pi.live_counterparties`. It reads
**0**.

But the first deliverable is not a feed. It is a **boundary memo**, because this team is cut
by two open forks at once and cannot honestly plan around either.

## How

### First: resolve what this team actually owns

| Fork | Question | State |
|---|---|---|
| **CM-F3** | Distributor connectivity — Sales or here? | Open. `commercial.md:631` cites `YC_WEDGE_PLAN.md:41`: *"the connectivity is a commercial problem, not a technical one."* The org gave this department a team anyway. |
| **OD-21** | Vendor Finder boundary — discovery in Product & Vision or here? | Open. Flagged as *"the most likely duplication in the division"* (`product.md:729`). |

The charter proposes a seam for CM-F3 — **signed intent to send data; Sales before it, us
after it** — and explicitly does not claim the whole territory. The memo puts that in front of
the founder with Sales in the room.

**Why this is step one and not a background item.** A team measured on a number produced by
two other units' actions is [[supplier-distributor-network-premortem]] M1, and it degrades
predictably: blockers become other people's names, and the team builds portal features to have
something inside its control. Ninety days of that is unrecoverable politically even if it is
recoverable technically.

### Second: freshness before features

`provider-intelligence.service.ts` reads `provider_promotions` **six times** (`:135, :159,
:179, :197, :222, :414`) against a dormant table. Every read returns nothing, gracefully. That
means the system today cannot distinguish **dormant** from **empty** from **stale** — and when
a real feed eventually breaks, it will report the same calm nothing
([[supplier-distributor-network-premortem]] M5).

Since `pi.live_counterparties` is defined on *refreshing* feeds, not present ones, **the
freshness signal is a precondition for the metric existing at all.** Build it before the first
live feed, not after the first silent break.

### Third: meet the workflow that exists

A distributor's workflow is a PDF emailed to a rep. `YC_WEDGE_PLAN.md:39-53` already
prescribes the answer and this team should not relitigate it:

- **Parse X12** (810/856/812; read 850/855). **Build no VAN or AS2 transport** (`:40-41`).
- **Four intake channels, one document model** — email, photo at the door, web upload,
  SFTP/EDI drop — and *"downstream code never learns which channel a document arrived on"*
  (`:53`).

The portal is a reward for a relationship, not a way to get one. Hence the standing rule:
**no portal feature ships while `pi.live_counterparties` == 0**, except features that reduce
the effort of becoming the first one.

### Fourth: the residual vendor-portal risk, correctly scoped

The assignment inherited from `product.md:733-735` — *"classify these two routes"* — **is
already closed.** `ENDPOINTS.md:656` now reads *"all carry explicit `@Public()` —
intentionally public, not a gap"*, and the code confirms it
(`vendor-portal.controller.ts:21, :40`).

What remains is what Security's SEC-2 actually named: **slug enumeration and unpublished-page
leakage.** That is this team's, not Security's, because **publish-state is a property of the
relationship** — whether a vendor's page should be visible is a fact about the agreement, not
about the route ([[supplier-distributor-network-premortem]] M4).

## Why now

1. **Two open forks is an unstable configuration**, and the instability compounds. Every week
   spent working an unowned territory is a week of work that may need to be handed over.
2. **The freshness gap is free to close now and expensive later.** No live feed exists to
   disrupt.
3. **`procurement_orders` = 1** (`AGENT_NATIVE_UI_DECISION.md:59`). Everything here is
   capability, not throughput — which means the design is still cheap to change.
4. **One correction is already carried:** the "classify these" assignment is closed, and the
   provider-intelligence read count is six, not five (`product.md:739`). Planning against
   stale docs produces work that is already done.

## Next steps

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | **CM-F3 boundary memo**, written with [[design-partner-operations-charter]], proposing the signed-intent seam | Sales | Memo in front of the founder; the fork is decidable |
| 2 | Feed **freshness signal**: `last_refreshed_at` + expected cadence + a loud past-cadence state | — | Dormant, empty and stale are three distinguishable states |
| 3 | **Publish-state gate** on vendor pages + non-enumerable slugs | [[connector-platform-trust-charter]] | A draft vendor page cannot be read by URL guess |
| 4 | Define the **counterparty state model** — prospective / agreed / live / stale / lapsed — as the substrate for `pi.live_counterparties` | — | Every distributor record carries a state |
| 5 | **One live feed**, in whatever format the distributor already sends | Step 1 resolving, or a founder-named distributor | `pi.live_counterparties` = 1 |
| 6 | Carry corrections upstream: vendor-portal already classified; six `provider_promotions` reads, not five | — | `foundation/teams/product.md` updated |
| 7 | **Day-90 review** — if CM-F3 and OD-21 are both still open with the metric at 0, propose this team's own merge | [[supplier-distributor-network-directive]] | The proposal is written, either way |

Steps 2–4 and 6 are inside this team's control regardless of how the forks resolve. That is
deliberate: **the plan is built so that fork-independent work fills the waiting period**, so
the team is not idle and does not drift into portal features
([[supplier-distributor-network-premortem]] M2).

## Questions for the founder

1. **CM-F3.** Ratify the signed-intent seam, overrule it, or give both halves to one unit?
   **If one unit, we would rather this team be merged than run a shared metric.** That is a
   real preference, not a rhetorical one.
2. **OD-21.** Does `distributor-discovery/` — the best-tested surface this team touches, with
   four spec files — belong here or to [[supply-discovery-charter]]? It is currently cited by
   both and owned cleanly by neither.
3. **Day-90 clause.** Endorsed? It commits this team to proposing its own dissolution under a
   stated condition. That only works if the commitment is real.
4. **Portal feature freeze while `pi.live_counterparties` == 0.** Endorse? It is the main
   defence against building for a login that never happens.

**Not asked:** pricing, terms, or which distributors to approach. Founder-deferred, and — under
the proposed seam — the approach question is Sales' anyway.
