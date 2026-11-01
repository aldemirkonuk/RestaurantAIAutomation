# 0355 — /notes/* pages are public but unlisted

- **Status:** Locked
- **Date:** 2026-11-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** notes, public, unlisted, noindex, robots, sitemap, gmail-session
- **Links:** [[0158-seo-geo-surface]] (allow-list crawl rule), [[0344-register-is-the-landing-door-and-story-tells-one-night]]

## Context

The founder wants the Gmail session prompt readable at a public URL on mudavym.com, and accepts that it exposes internal ops detail (ADR numbers, PR numbers, worktree paths). The web app is a Vite SPA; public pages use `PublicShell` (`apps/web/src/components/mudavym/PublicShell.tsx`). Crawl control is an allow-list: a route absent from `PUBLIC_ROUTES` (`apps/web/src/lib/seo/routes.ts`) is served the closed head (`noindex, nofollow`) and is disallowed by robots.txt.

## Options considered

1. **`/notes/<slug>`, unlisted** — new React route on `PublicShell`; no registry entry, so it is noindex by default. Costs one page file per note.
2. **`/story/...`** — rejected: `/story` is the indexed marketing page (ADR 0344); internal detail would be searchable.
3. **`/l/...`** — rejected: landing variants are unmerged and tied to tracking and gating.
4. **Static `public/notes/*.html`** — rejected: no shared shell or tokens without copied CSS, and it needs its own `X-Robots-Tag` rule.
5. **Indexed `/notes/...`** — rejected by the founder: needs a `PUBLIC_ROUTES` entry and a `vercel.json` rewrite, and makes the detail discoverable.

## Decision

Pages under `/notes/` are public to anyone with the URL, `noindex, nofollow`, and absent from the sitemap, robots allow lines and `llms.txt`. A `/notes/` page is never added to `PUBLIC_ROUTES`. The first is `/notes/gmail-session`.

## Consequences

- Easier: a founder-approved working note can be shared by link without a search footprint.
- Harder: "unlisted" is not private. Anyone with the link can read it, and `noindex` is a request crawlers may ignore. Nothing secret may go on a `/notes/` page.
- Revisit if a note needs access control (move it behind sign-in) or if any `/notes/` URL is found in a search index.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-01 | — | Created |
