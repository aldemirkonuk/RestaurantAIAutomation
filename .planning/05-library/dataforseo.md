---
type: reference
name: DataForSEO
category: seo-analytics
url: https://dataforseo.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[ahrefs]]", "[[answerthepublic]]"]
---

# DataForSEO

## What it is

Verified 2026-08-24 against `dataforseo.com`.

An **API-only** SEO data provider — there is no dashboard product to speak of; the offer is
endpoints. Verified API families:

- **SERP API** — search-results tracking
- **Keyword Data** — Google Ads, Google Trends, Bing Ads, Clickstream
- **Backlinks API**
- **On-Page API**
- Plus Reviews, App Data, Business Data, Merchant (Amazon / Google Shopping), Domain
  Analytics, Content Analysis

**Pricing model: pay-per-use**, with a UI for monitoring usage and spend. A free trial is
offered. **UNVERIFIED:** per-request costs and whether a minimum deposit applies — the
homepage states neither, and `dataforseo.com/pricing` was not fetched in this pass.

## Why it might matter here specifically

It is the only entry in this category that is **built for programmatic consumption first**,
which is what a scheduled pipeline actually needs. The Growth department's search-demand
loops are described as recurring jobs
(`.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-schedule.md:23`),
and a recurring job wants an API with metered cost, not a seat licence with a UI.

Set against [[ahrefs]]: Ahrefs is a tool a person uses, DataForSEO is a tool a job uses.
Against [[answerthepublic]]: ATP's API exists but is Alpha and subscription-gated;
DataForSEO's is the mature commercial equivalent of the same data shape.

## What adopting it would cost

- Real, metered spend that grows with usage — the failure mode is a runaway scheduled job,
  which this project has already been bitten by in a different form (OD-20: unauthenticated
  endpoints driving paid model calls). Any adoption needs a spend cap *before* the first job.
- Credentials in `env.example` — which currently has **no** SEO or search key of any kind.
- It supplies data, not judgement. The distinctness calls the search-demand charter reserves
  for a human (`search-demand-research-charter.md:46`) stay human.

## What decision it bears on

None open. Would become a spend decision under Finance & Pricing.

## Status

`candidate` — API families verified; **per-request pricing and minimum deposit UNVERIFIED**.
