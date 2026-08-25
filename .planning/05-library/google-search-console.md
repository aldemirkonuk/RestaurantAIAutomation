---
type: reference
name: Google Search Console (Search Console API)
category: seo-analytics
url: https://developers.google.com/webmaster-tools/v1/api_reference_index
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[ga4]]", "[[answerthepublic]]"]
---

# Google Search Console

## What it is

Verified 2026-08-24 against the Search Console API reference.

Four resource families:

| Resource | What it does |
|---|---|
| `searchanalytics` | Query traffic data with filters and dimensions (query, page, country, device, date). Results ordered by clicks descending. |
| `sitemaps` | Submit, list, get, delete sitemaps |
| `sites` | Add, remove, list, get properties |
| `urlInspection` | Index status for a single URL (needs inspection URL, site URL, language code) |

**UNVERIFIED from the reference index:** row limits per request, the 16-month data
retention window, and daily quota. These are widely stated but were **not** confirmed
against primary documentation in this pass — the corpus already carries an open worry about
"Search Console export limits" (`.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-agenda-full.md:21`)
and that worry should be resolved by reading the quota page, not by repeating a number.

## Why it might matter here specifically

It is the **only source of this project's own real search demand** — every other tool in
this category reports on the market; GSC reports on Mudavym.

Verified constraint: **no Search Console credential exists anywhere in the repo.** `env.example`
and `services/agent-orchestrator/.env.example` contain no Search Console, analytics, SEO,
or Perplexity key of any kind. This confirms the claim already recorded at
`.planning/01-org/commercial/growth/growth-charter.md:168`. The §12B content pipeline and
the search-demand loops are therefore blocked on a *credential*, not on tooling — and that
is the cheapest unblock in this whole category.

## What adopting it would cost

- A verified property (the site must exist and be verifiable — check whether it does).
- A Google Cloud project + OAuth or service-account credentials, and somewhere to keep them.
- Search Console reports on traffic that already exists. On a site with no traffic the API
  returns empty rows, so the value is a *later* payoff — the reason to set it up now is
  that the data window starts when the property is verified, not when someone first queries.

## What decision it bears on

None open. Blocks Growth's search-demand loops.

## Status

`candidate` — API verified; **no credential in the repo**; quota/retention figures UNVERIFIED.
