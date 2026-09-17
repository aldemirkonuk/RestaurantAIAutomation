/**
 * robots.txt, generated from the registry at build.
 *
 * Two rule sets, chosen by what a reader does with the page (founder,
 * 2026-09-17, "split by purpose"):
 *
 * - OPEN, for search engines, answer engines that cite a link to a person, and
 *   link-preview fetchers: every public page, vendor catalogues under /v/, and
 *   the scripts a renderer needs.
 * - OWN, for crawlers that gather model-training data and for every crawler
 *   not named: Mudavym's own public pages and llms.txt, never a vendor's
 *   catalogue. An unnamed crawler gets OWN because its purpose is unknown, and
 *   the catalogue is not ours to license.
 *
 * RFC 9309: a crawler obeys only the group naming it and ignores `*`; within
 * a group the longest matching pattern wins. So `Disallow: /assets/*.map$`
 * beats `Allow: /assets/`, and the final `Disallow: /` closes every path no
 * line names, which is why this file never has to list a private path.
 *
 * robots.txt is advisory and parsers differ (DuckDuckGo names a parser that
 * ignores Allow lines, so DuckDuckBot reads this file as closed). The controls
 * that do not depend on a crawler's manners are the closed default head on
 * every signed-in route and a shell that carries no house data.
 *
 * Tokens are vendor facts that rot. Each one below was read from its vendor's
 * own crawler page (ADR 0158, "Sources"); the census re-reads them.
 */

import { CRAWL_PREFIXES, PUBLIC_ROUTES, type Readers } from './routes';
import { SITE, absoluteUrl } from './site';

/** Search engines. They render JavaScript, so they need /assets/. */
export const SEARCH_BOTS = ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot'] as const;

/** Answer engines that fetch a page to cite it to a person. */
export const ANSWER_BOTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'DuckAssistBot',
] as const;

/**
 * Link-preview fetchers that read robots.txt, so a shared vendor link unfurls.
 * Slack's fetcher is absent because Slack does not honour robots.txt at all
 * (api.slack.com/robots): what a preview can show is decided by the served
 * head, never by this file.
 */
export const PREVIEW_BOTS = ['facebookexternalhit', 'Twitterbot', 'LinkedInBot'] as const;

/** Model-training crawlers and training-control tokens. */
export const TRAINING_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'meta-externalagent',
] as const;

export const ROBOTS_MARKER = '# robots.txt for mudavym.com';

const HEADER = [
  ROBOTS_MARKER,
  '#',
  '# Mudavym is the back office of a restaurant. Almost all of it sits behind a',
  '# sign-in, and none of that is for crawlers. This file lists the few doors a',
  '# stranger may open. Anything it does not list is closed.',
  '#',
  "# Before Mudavym fetches another site's published data, it reads that site's",
  '# robots.txt, and it does not fetch from a host whose rules it cannot read.',
  '# We ask the same of you.',
  '#',
  '# Vendor catalogues under /v/ belong to the vendors who published them.',
  '# Search engines, answer engines and link previews may read them and send',
  '# buyers there. Crawlers that gather model-training data may not: that',
  '# permission is the vendor\'s to give, not ours.',
  '#',
  `# robots.txt is a request, not a lock. Questions: ${SITE.supportEmail}`,
];

type RuleSet = 'open' | 'own';

function readerAllowed(readers: Readers, set: RuleSet): boolean {
  if (readers === 'everyone') return true;
  return set === 'open';
}

/** The Allow/Disallow lines for one rule set, most general first. */
export function rulesFor(set: RuleSet): string[] {
  const lines: string[] = [];
  for (const route of PUBLIC_ROUTES) {
    // `/` has no unanchored form. A parser that drops `$` reads `Allow: /`,
    // which opens every path to it; what it then fetches is the closed shell
    // (noindex, no house data), so that failure costs crawl, not privacy.
    lines.push(`Allow: ${route.path === '/' ? '/$' : route.path}`);
  }
  for (const prefix of CRAWL_PREFIXES) {
    if (readerAllowed(prefix.readers, set)) lines.push(`Allow: ${prefix.pattern}`);
  }
  if (set === 'open') {
    // Source maps are public on the host today (vite.config.ts `sourcemap`);
    // whether they should be is Security's call. Crawlers need not take them.
    lines.push('Disallow: /assets/*.map$');
  }
  lines.push('Disallow: /');
  return lines;
}

function group(agents: readonly string[], set: RuleSet): string[] {
  return [...agents.map((a) => `User-agent: ${a}`), ...rulesFor(set)];
}

/** The file served at https://mudavym.com/robots.txt. */
export function renderRobots(): string {
  return [
    ...HEADER,
    '',
    '# Search engines, answer engines that cite a link, and link previews',
    ...group([...SEARCH_BOTS, ...ANSWER_BOTS, ...PREVIEW_BOTS], 'open'),
    '',
    '# Crawlers that gather model-training data: our own pages, never a vendor catalogue',
    ...group(TRAINING_BOTS, 'own'),
    '',
    '# Every crawler not named above',
    ...group(['*'], 'own'),
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}

/**
 * The file served on every other host (the api-gateway project's duplicate
 * of the app, and any alias that is not redirected). It does NOT disallow:
 * a disallowed URL is never fetched, so its `X-Robots-Tag: noindex` is never
 * seen and the URL can still be listed bare when something links to it.
 */
export function renderOtherHostRobots(): string {
  return [
    '# This host is not mudavym.com. Every response here carries',
    '# X-Robots-Tag: noindex, so nothing on it belongs in an index.',
    `# The canonical site is ${SITE.origin}/`,
    'User-agent: *',
    'Allow: /',
    '',
  ].join('\n');
}
