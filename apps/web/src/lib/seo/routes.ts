/**
 * The route-meta registry: which URLs a stranger's machine may read, and what
 * each one says about itself.
 *
 * ONE list feeds every crawl artefact, so they cannot disagree:
 *
 *   served heads   dist/index.html, dist/crawl/heads/*.html  (vite-plugin.ts)
 *   robots.txt     robots.ts   (allow lines come from here)
 *   sitemap        sitemap.ts  (routes with `sitemap: true`)
 *   llms.txt       llms.ts
 *   vercel.json    rewrites, checked against this list by crawl-surface.test.ts
 *
 * A route that is not listed here is served the shell's closed default
 * (`noindex, nofollow`, see head.ts) and is disallowed by robots.txt. That is
 * the rule the Technical SEO team wrote down: list what to crawl, because a
 * deny-list has to name every private path and becomes a map of the app
 * (technical-seo-ai-answer-surface-directive.md, "robots.txt is an allow-list").
 *
 * Adding a public page: add an entry, add its rewrite in apps/web/vercel.json
 * (crawl-surface.test.ts names the missing line), and keep the copy free of
 * prices, customer counts and ratings (ADR 0039; the team's never-list).
 */

import type { HeadMeta } from './head';
import { siteGraph } from './graph';
import { SITE, absoluteUrl, titleWithSite } from './site';

export interface PublicRoute {
  /** Exact path, no trailing slash. */
  path: string;
  /** File under dist that serves this path, without the leading slash. */
  file: string;
  head: HeadMeta;
  /** Listed in sitemap-pages.xml. `/` is not: it redirects strangers to /login. */
  sitemap: boolean;
}

function indexable(path: string, title: string, description: string, jsonLd?: unknown): HeadMeta {
  return { title, description, robots: 'index, follow', canonical: absoluteUrl(path), jsonLd };
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    // The house has no landing page; a stranger's home is the sign-in door
    // (ADR 0143). The root still carries the site graph, and only the root:
    // Google reads the WebSite name from the domain's home page and nowhere
    // else. It is written into dist/index.html itself, because the host serves
    // that file for "/" before any rewrite runs (vite-plugin.ts).
    path: '/',
    file: 'index.html',
    head: indexable('/', SITE.name, SITE.sentence, siteGraph()),
    sitemap: false,
  },
  {
    path: '/login',
    file: 'crawl/heads/login.html',
    head: indexable('/login', titleWithSite('Sign in'), SITE.sentence),
    sitemap: true,
  },
  {
    path: '/register',
    file: 'crawl/heads/register.html',
    head: indexable('/register', titleWithSite('Create an account'), SITE.sentence),
    sitemap: true,
  },
  {
    // Title and sentence are the page's own words in the ratified public
    // treatment (ADR 0149, Codex public-pages lane: PublicShell title
    // "Privacy & data", voice line below). Change them with the page.
    path: '/privacy',
    file: 'crawl/heads/privacy.html',
    head: indexable(
      '/privacy',
      titleWithSite('Privacy & data'),
      'What Mudavym stores, what connections permit, and where to review your choices.',
    ),
    sitemap: true,
  },
  {
    // G9 (census, 2026-09-25): required by ADR 0145's round-6r notice and the
    // owner data-terms acceptance work. Title and sentence are the page's own
    // words (Terms.tsx's PublicShell title and voice line); change them with
    // the page. Placeholder text per OD-132/OD-124 — still indexable, since
    // "placeholder" describes what the words settle, not whether the route
    // is real.
    path: '/terms',
    file: 'crawl/heads/terms.html',
    head: indexable(
      '/terms',
      titleWithSite('Terms of Service'),
      'What using Mudavym means today, stated plainly, ahead of legal review.',
    ),
    sitemap: true,
  },
];

/**
 * Prefixes a reader may fetch that are not pages with a registry head.
 * `readers` says which robots groups get the line (robots.ts):
 *
 * - `everyone`: every group, training crawlers included.
 * - `answer`: search engines, answer engines and link-preview fetchers only.
 *   Vendor catalogues are the vendors' price lists; Mudavym can let a search
 *   or answer engine send a buyer there, but it cannot license them for model
 *   training (founder, 2026-09-17: "split by purpose").
 * - `render`: fetchers that need the page's scripts, images and icons to
 *   render or preview it. Training crawlers do not render, so they do not get
 *   the bundle.
 */
export type Readers = 'everyone' | 'answer' | 'render';

export interface CrawlPrefix {
  /**
   * robots.txt path pattern. Plain prefixes on purpose: Python's robotparser
   * never matches a `$` rule and some parsers ignore `*`, so an anchored Allow
   * silently closes a page for them (measured, ADR 0158 "Sources").
   */
  pattern: string;
  readers: Readers;
  why: string;
}

export const VENDOR_PREFIX = '/v/';

export const CRAWL_PREFIXES: readonly CrawlPrefix[] = [
  // Trailing slash kept: /vendor-prices is a signed-in route.
  { pattern: VENDOR_PREFIX, readers: 'answer', why: 'published vendor catalogues' },
  { pattern: '/llms.txt', readers: 'everyone', why: 'the answer-surface summary' },
  { pattern: '/assets/', readers: 'render', why: 'scripts and styles a renderer needs' },
  // The catalogue page reads this API when a renderer runs it. The bundle
  // calls the gateway host today, whose robots.txt is a 404 (crawl allowed);
  // this line keeps rendering working if the call moves to the same origin.
  { pattern: '/api/v1/vendor-portal/', readers: 'render', why: 'the catalogue data a renderer fetches' },
  { pattern: '/favicon.svg', readers: 'render', why: 'search result icon' },
  { pattern: SITE.logo.path, readers: 'render', why: 'share image' },
  // Found by adversarial review (ADR 0158): without these three lines the
  // Sitemap: directive below named a file every group's own Disallow: /
  // closed, so the file this build's whole point is to make discoverable
  // was, by its own robots.txt, never fetchable by any compliant crawler.
  // The pages file lists nothing a reader could not already read directly
  // (the four PUBLIC_ROUTES entries are unconditional above), so it is open
  // to everyone. The vendor file lists /v/:slug URLs, so it follows /v/'s
  // own rule — the same "split by purpose" the founder gave for the pages
  // themselves, now applied to the file that indexes them. The index is
  // open to everyone too, but for a narrower reason: `Sitemap:` is a single
  // directive with no per-group form, so it cannot itself be gated, and it
  // is what the built index lists — including the vendor file's URL — that
  // a training crawler is told about without being able to fetch. That
  // costs nothing today (the index carries no vendor slugs, only sitemap
  // filenames), and matches ADR 0158's own "Known limits" on this point.
  { pattern: '/sitemap.xml', readers: 'everyone', why: 'the sitemap index' },
  { pattern: '/sitemap-pages.xml', readers: 'everyone', why: 'lists only pages already open to everyone' },
  { pattern: '/sitemap-vendors-', readers: 'answer', why: 'lists vendor catalogue URLs' },
];

/**
 * Paths that carry a secret or a stranger's house data in the URL. Never
 * allowed for any reader, never in a sitemap, served with `noindex` and
 * `Referrer-Policy: no-referrer` (vercel.json). An invite preview names the
 * restaurant, the inviter and the role (pages/InviteLanding.tsx).
 */
export const TOKEN_PREFIXES: readonly string[] = [
  '/invite/',
  '/reset-password',
  '/verify-email',
  '/studio/invite/',
];

/** Registry entry for an exact pathname, if it is a public page. */
export function publicRouteFor(pathname: string): PublicRoute | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PUBLIC_ROUTES.find((r) => r.path === path);
}
