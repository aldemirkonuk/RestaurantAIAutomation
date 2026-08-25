---
type: reference
name: Screaming Frog SEO Spider
category: seo-analytics
url: https://www.screamingfrog.co.uk/seo-spider/
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[ahrefs]]"]
---

# Screaming Frog SEO Spider

## What it is

Verified 2026-08-24 against `screamingfrog.co.uk/seo-spider/`.

- A **desktop** website crawler (Windows, macOS, Linux) auditing a site for 300+ SEO/UX
  issues.
- **Free tier: 500 URLs per crawl**, no signup or email required.
- **Paid licence: £199/year**, which removes the URL cap (bounded only by RAM/storage) and
  unlocks JavaScript rendering, custom extraction, and API integrations.

## Why it might matter here specifically

The JavaScript-rendering line is the decisive detail. `apps/web` is a **Vite SPA using
react-router-dom** (per `CLAUDE.md §1` — explicitly *not* Next.js), so it is client-rendered.
A crawler without JS rendering sees an empty shell, and JS rendering is a **paid-tier**
feature here. So on the product app itself the free tier is close to useless.

Where the free tier does work is a server-rendered or static marketing site, if one is ever
built. Until such a surface exists, this tool has nothing to crawl that would return a
meaningful result.

Second-order point worth recording: this makes crawlability an **architecture** question,
not a tooling one. If SEO-driven acquisition matters (the §12B pipeline assumes it does),
a client-rendered SPA is the constraint — buying a crawler licence does not change what a
search engine sees.

## What adopting it would cost

- Free: nothing but a download, and it is capped at 500 URLs and blind to client-rendered
  content.
- Paid: £199/year, plus a desktop app in the loop — it is not a scheduled job, so it does
  not fit an automated pipeline the way [[dataforseo]] does.

## What decision it bears on

None open. Points at a larger unrecorded question about whether the public surface should be
server-rendered — that would be an ADR if it is ever asked.

## Status

`candidate` — pricing and tier limits verified. Blocked in practice by there being no
crawlable public surface, and by SPA rendering.
