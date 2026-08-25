---
type: reference
name: Ahrefs
category: seo-analytics
url: https://ahrefs.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[dataforseo]]", "[[google-search-console]]"]
---

# Ahrefs

## What it is

Verified 2026-08-24 against `docs.ahrefs.com` and `ahrefs.com/webmaster-tools`.

**Developer surface (verified):** a REST API, plus MCP, Data Studio, Bot Analytics, and
"Ahrefs Connect". Free test queries are offered "without an Enterprise plan".
**UNVERIFIED:** which subscription tiers include API access, and the units/pricing model.
The docs page does not state either — do not quote a price for this without checking.

**Ahrefs Webmaster Tools (AWT) — verified free**, for sites you verify:

| | Free (AWT) | Paid |
|---|---|---|
| Verified websites | Unlimited | Included |
| Web Analytics events | up to 1M / project | higher |
| Site Audit crawl credits | 5,000 / month / project | 10,000 / month / project |
| Site Explorer visibility | 1,000 backlinks & keywords at a time | unlimited |
| Competitor analysis | **not available** | available |

Ahrefs Web Analytics is described as a privacy-focused GA alternative: **no cookies by
default, no personal data collected**.

## Why it might matter here specifically

Two distinct offers, and only one is cheap:

1. **AWT free tier** covers site audit + own-site keywords + a cookieless analytics option.
   For a product with no analytics instrumented at all (see [[ga4]]) that is a genuinely
   low-friction start — cookieless means no consent gate, which sidesteps the privacy work
   GA4 requires.
2. **The paid product / API** is the competitor-research half, and it is the expensive half.
   The Growth department's search-demand work names Search Console and AnswerThePublic as
   its inputs (`growth-charter.md:62`, `:168`) — Ahrefs is not currently in that plan, so
   adopting the paid tier would be adding a cost, not filling a named hole.

## What adopting it would cost

- AWT: site verification only. No spend.
- Paid/API: a subscription whose price and API-tier gating are **unverified**; treat any
  figure in the corpus as unchecked until someone reads the pricing page.
- Competitor analysis being absent from the free tier is the specific thing that forces the
  upgrade — so the honest question is whether competitor data is needed at all yet.

## What decision it bears on

None open. Any paid subscription is a spend decision and belongs to Finance & Pricing /
Growth, and per OD-23 the revenue and budget assumptions around it are themselves unverified.

## Status

`candidate` — AWT free tier verified in detail; **API pricing and plan gating UNVERIFIED**.
