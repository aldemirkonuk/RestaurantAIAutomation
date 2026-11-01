# 0355 — /notes/* pages are public but unlisted

- **Status:** Locked
- **Date:** 2026-11-01
- **Decider:** Aldemir (founder), 2026-11-01 for the route and unlisted status; the content rule below was added after audit of PR #731, not decided by the founder in the moment
- **Keywords:** notes, public, unlisted, noindex, robots, sitemap, gmail-session
- **Links:** [[0158-seo-geo-surface]] (allow-list crawl rule), [[0344-register-is-the-landing-door-and-story-tells-one-night]]

## Context

The founder wants the Gmail session prompt readable at a public URL on mudavym.com, and accepts that it exposes internal ops detail (ADR numbers and PR numbers). The web app is a Vite SPA; public pages use `PublicShell` (`apps/web/src/components/mudavym/PublicShell.tsx`). Crawl control is an allow-list: a route absent from `PUBLIC_ROUTES` (`apps/web/src/lib/seo/routes.ts`) is served the closed head (`noindex, nofollow`) and is disallowed by robots.txt.

## Options considered

1. **`/notes/<slug>`, unlisted** — new React route on `PublicShell`; no registry entry, so it is noindex by default. Costs one page file per note.
2. **`/story/...`** — rejected: `/story` is the indexed marketing page (ADR 0344); internal detail would be searchable.
3. **`/l/...`** — rejected: landing variants are unmerged and tied to tracking and gating.
4. **Static `public/notes/*.html`** — rejected: no shared shell or tokens without copied CSS, and it needs its own `X-Robots-Tag` rule.
5. **Indexed `/notes/...`** — rejected by the founder: needs a `PUBLIC_ROUTES` entry and a `vercel.json` rewrite, and makes the detail discoverable.

## Decision

Pages under `/notes/` are public to anyone with the URL, `noindex, nofollow`, and absent from the sitemap, robots allow lines and `llms.txt`. A `/notes/` page is never added to `PUBLIC_ROUTES`. The first is `/notes/gmail-session`.

This amends nothing in ADR 0158 but touches its surface: a `/notes/` page needs the first path segment `notes` in the SPA rewrite in `apps/web/vercel.json`, which sends `/notes/*` to `/crawl/app.html` (closed head). The rewrite is not the indexed path that Option 5 rejects: Option 5's `vercel.json` cost is a per-route head rewrite plus a `PUBLIC_ROUTES` entry, which this decision avoids.

Content rule: a `/notes/` page carries no gate or merge-control token (for example the ADR 0090 PASS marker), no capability link or document id, no workstation path, no line-number citation, and no control-plane or identity detail (gate thresholds, merge rules, who owns an OAuth client). No lexical test can enforce a semantic rule, so a human reads the prose of every `/notes/` page before it merges; the page test pins only the known past violations. The first page was revised on 2026-11-01 after audit of PR #731 to remove all of these.

Retire-to-write: no document is retired for this ADR or page. The founder waived the rule for this page on 2026-11-01 ("do not retire another document").

## Consequences

- Easier: a founder-approved working note can be shared by link without a search footprint.
- Harder: "unlisted" is not private. Anyone with the link can read it, and `noindex` is a request crawlers may ignore. Nothing secret may go on a `/notes/` page, and a `/notes/` page is a dated snapshot, not policy.
- Revisit if a note needs access control (move it behind sign-in) or if any `/notes/` URL is found in a search index.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-01 | — | Created |
| 2026-11-01 | audit of PR #731, round 1 (BLOCK at fc240ba27) | Content rule and vercel.json amendment added |
| 2026-11-01 | audit of PR #731, round 2 (BLOCK at 0dd74ad27) | Gate mechanics, OD-77 clause, SHA and scratch paths removed; banner added; Decider wording corrected |
