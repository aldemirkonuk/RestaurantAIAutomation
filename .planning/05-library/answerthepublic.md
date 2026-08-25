---
type: reference
name: AnswerThePublic
category: seo-analytics
url: https://answerthepublic.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[perplexity-search-harvest]]", "[[dataforseo]]"]
---

# AnswerThePublic

## What it is

Verified 2026-08-24 against `answerthepublic.com`, its pricing page, and its help centre.

- A search-listening tool that surfaces the **questions, prepositions, comparisons, and
  related searches** people type into search engines, across languages and regions.
- **Pricing (verified from the pricing page):** Starter $20/mo or $99 lifetime; Growth
  $99/mo or $490 lifetime; Business $199/mo or $990 lifetime.
- **An API exists** (verified via its help centre): pulls the same question / preposition /
  comparison / alphabetical data programmatically across Google Web, YouTube, Bing, Amazon,
  TikTok, Instagram, ChatGPT and Gemini. It is **in Alpha**, enabled per workspace under
  Account → API Access, uses personal access tokens, and is limited to **60 requests per
  minute per token**. **API access is included with paid plans and is not available on the
  free plan.**
- **UNVERIFIED:** the current free-tier limit (the pricing page does not describe one), and
  current ownership/parent company.

## Why it might matter here specifically

This resolves a question the corpus has been carrying open. Three documents record it as
unknown whether ATP has a usable API at this volume:

- `.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-charter.md:103`
- `.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-agenda-full.md:21`
- `.planning/01-org/commercial/growth/teams/search-demand-research/search-demand-research-premortem.md:63`

**Answer: yes, an API exists; it is Alpha; it requires a paid plan; 60 req/min.** For the
documented workload — "the ten most distinct questions per topic, monthly"
(`search-demand-research-charter.md:27`, `search-demand-research-schedule.md:23`) — 60
requests per minute is not remotely a constraint. The constraint is the **subscription**,
and the risk is **Alpha status**, not throughput.

The distinctness call stays human either way (`search-demand-research-charter.md:46`).

## What adopting it would cost

- A paid plan — $20/mo Starter is the entry point; lifetime options exist. Whether Starter
  includes API access was not separately confirmed and should be checked before purchase.
- Alpha API: breaking changes are expected, and the pipeline that depends on it inherits
  that.
- A credential, which `env.example` currently has no slot for.

## What decision it bears on

None open, but it **removes an unknown** from Growth's search-demand loops. Those three
documents should be updated to say the API exists rather than to ask whether it does.

## Status

`candidate` — API existence, limits, and pricing verified. Free-tier limits and ownership
UNVERIFIED.
