/**
 * The guard that keeps the host's routing, the app's routes and the registry
 * saying the same thing (ADR 0158).
 *
 * The host answers 404 for any path its SPA rewrite does not list, so a route
 * added to App.tsx without a line here would 404 in production, and a route
 * deleted from App.tsx but left here would keep answering 200 for a page that
 * no longer exists. Both fail this test by name.
 *
 * Reads real files. A parse that finds nothing FAILS: a guard that matched no
 * routes would pass on a broken file, which is the one result it must never
 * report (absence is not health).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEAD_END, HEAD_START } from './head';
import { PUBLIC_ROUTES, TOKEN_PREFIXES } from './routes';

const WEB = join(__dirname, '..', '..', '..');
const REPO = join(WEB, '..', '..');

interface Rule {
  source: string;
  destination?: string;
  has?: { type: string; value: unknown }[];
  missing?: { type: string; value: unknown }[];
  permanent?: boolean;
  headers?: { key: string; value: string }[];
}
interface VercelConfig {
  redirects?: Rule[];
  rewrites: Rule[];
  headers: Rule[];
}

const web: VercelConfig = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
const root: VercelConfig = JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8'));
const app = readFileSync(join(WEB, 'src', 'App.tsx'), 'utf8');
const indexHtml = readFileSync(join(WEB, 'index.html'), 'utf8');

const APP_SHELL = '/crawl/app.html';
const SPA_SOURCE = /^\/\(([a-z0-9|-]+)\)\(\/\.\*\)\?$/;

function appRoutePaths(): string[] {
  const paths = [...app.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/gs)].map((m) => m[1]);
  if (paths.length === 0) throw new Error('crawl-surface: no <Route path="..."> found in App.tsx');
  return paths;
}

function appFirstSegments(): Set<string> {
  return new Set(
    appRoutePaths()
      .filter((p) => p !== '*' && p !== '/')
      .map((p) => p.replace(/^\//, '').split('/')[0]),
  );
}

function spaRewrite(config: VercelConfig): { index: number; segments: Set<string> } {
  const index = config.rewrites.findIndex((r) => r.destination === APP_SHELL && SPA_SOURCE.test(r.source));
  if (index < 0) throw new Error(`crawl-surface: no "/(a|b|...)(/.*)?" -> ${APP_SHELL} rewrite in apps/web/vercel.json`);
  const [, list] = SPA_SOURCE.exec(config.rewrites[index].source)!;
  return { index, segments: new Set(list.split('|')) };
}

const CANONICAL_HOST = 'mudavym.com';
// The canonical host, the retired alias, and any other host a deployment answers on.
const HOSTS = [CANONICAL_HOST, 'restaurant-ai-automation-web.vercel.app', 'preview-abc.vercel.app'];

/** Does one `has`/`missing` entry hold for a request to `host`? Only host equality is modelled. */
function conditionHolds(cond: { type: string; value: unknown }, host: string): boolean {
  const eq = (cond.value as { eq?: unknown } | null)?.eq;
  if (cond.type !== 'host' || typeof eq !== 'string') {
    throw new Error(`crawl-surface: cannot evaluate header condition ${JSON.stringify(cond)}; extend conditionHolds()`);
  }
  return eq === host;
}

/**
 * Every value that a `headers` rule of `config` sets for `key` on a request to `pathname` on
 * `host`, in file order. A rule this cannot evaluate throws: a guard that skipped a rule it did
 * not understand would pass on exactly the rule that breaks it.
 */
function headerValuesFor(config: VercelConfig, key: string, pathname: string, host: string): string[] {
  const values: string[] = [];
  for (const rule of config.headers) {
    // `:name` is path-to-regexp's named parameter; `(?:` is a plain regex group and is fine.
    if (/(^|[^?]):[A-Za-z_]/.test(rule.source)) {
      throw new Error(`crawl-surface: cannot evaluate header source ${rule.source}; extend headerValuesFor()`);
    }
    if (!new RegExp(`^${rule.source}$`).test(pathname)) continue;
    if (!(rule.has ?? []).every((c) => conditionHolds(c, host))) continue;
    if ((rule.missing ?? []).some((c) => conditionHolds(c, host))) continue;
    for (const h of rule.headers ?? []) if (h.key.toLowerCase() === key.toLowerCase()) values.push(h.value);
  }
  return values;
}

describe('apps/web/vercel.json serves every App.tsx route and nothing else', () => {
  it('the SPA rewrite lists exactly the first path segments App.tsx routes', () => {
    const inApp = appFirstSegments();
    const { segments } = spaRewrite(web);
    const missing = [...inApp].filter((s) => !segments.has(s)).sort();
    const stale = [...segments].filter((s) => !inApp.has(s)).sort();
    // Fix by editing the "/(...)(/.*)?" rewrite in apps/web/vercel.json.
    expect({ addToRewrite: missing, removeFromRewrite: stale }).toEqual({ addToRewrite: [], removeFromRewrite: [] });
  });

  it('there is no catch-all left to turn a missing page into a 200', () => {
    for (const r of web.rewrites) {
      expect(r.source).not.toMatch(/^\/\(\(\?!|^\/:path\*$|^\/\(\.\*\)$/);
    }
  });

  it('every public page rewrites to its own head, before the SPA rewrite', () => {
    const { index: spa } = spaRewrite(web);
    for (const route of PUBLIC_ROUTES) {
      if (route.path === '/') {
        // Served from the filesystem (dist/index.html) before any rewrite.
        expect(route.file).toBe('index.html');
        continue;
      }
      const at = web.rewrites.findIndex((r) => r.source === route.path);
      expect(at, `no rewrite for ${route.path}`).toBeGreaterThanOrEqual(0);
      expect(web.rewrites[at].destination).toBe(`/${route.file}`);
      expect(at).toBeLessThan(spa);
    }
  });

  it('robots.txt is the company file only on mudavym.com, and the host rule comes first', () => {
    const robots = web.rewrites.filter((r) => r.source === '/robots.txt');
    expect(robots.map((r) => r.destination)).toEqual(['/crawl/robots-mudavym.txt', '/crawl/robots-other.txt']);
    expect(robots[0].has).toEqual([{ type: 'host', value: { eq: 'mudavym.com' } }]);
    expect(robots[1].has).toBeUndefined();
  });

  it('the old production alias redirects every page permanently, and never /api', () => {
    const [redirect] = (web.redirects ?? []).filter((r) =>
      JSON.stringify(r.has ?? []).includes('restaurant-ai-automation-web.vercel.app'),
    );
    expect(redirect).toBeDefined();
    expect(redirect.permanent).toBe(true);
    expect(redirect.destination).toBe('https://mudavym.com/:path');
    const re = new RegExp(`^/${redirect.source.replace(/^\/:path\((.*)\)$/, '$1')}$`);
    for (const p of ['/', '/login', '/v/acme', '/apis', '/inventory']) expect(re.test(p), p).toBe(true);
    for (const p of ['/api', '/api/v1/calendar/feed/x.ics']) expect(re.test(p), p).toBe(false);
  });

  it('every other host is noindex, and token routes are noindex with no referrer', () => {
    const other = web.headers.find((h) => h.source === '/(.*)' && h.missing);
    expect(other?.missing).toEqual([{ type: 'host', value: { eq: 'mudavym.com' } }]);
    expect(other?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex' }]);

    // Found by what makes it the token rule, not by carrying a Referrer-Policy: a site-wide
    // rule that also sets one must not be mistaken for it.
    const token = web.headers.find((h) => h.headers?.some((x) => x.key === 'X-Robots-Tag' && x.value === 'noindex, nofollow'));
    expect(token).toBeDefined();
    const re = new RegExp(`^${token!.source}$`);
    for (const prefix of TOKEN_PREFIXES) {
      const sample = prefix.endsWith('/') ? `${prefix}abc123` : prefix;
      expect(re.test(sample), sample).toBe(true);
    }
    expect(token!.headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
    expect(token!.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
  });

  it('no rule, in any position, weakens what a token route sends', () => {
    // A link that carries a secret must not be indexed and must not leak in a Referer.
    // Vercel merges every matching header rule and its docs do not say which one wins when two
    // set the same key, so this does not lean on order: a rule that matches a token route and
    // sets one of these keys differently fails, before or after the token rule. Give a site-wide
    // Referrer-Policy a source that leaves the token routes out.
    const tokenPaths = TOKEN_PREFIXES.map((p) => (p.endsWith('/') ? `${p}abc123` : p));
    for (const host of HOSTS) {
      for (const path of tokenPaths) {
        const at = `${host}${path}`;
        expect(new Set(headerValuesFor(web, 'Referrer-Policy', path, host)), `${at} Referrer-Policy`).toEqual(
          new Set(['no-referrer']),
        );
        const robots = headerValuesFor(web, 'X-Robots-Tag', path, host);
        expect(robots.length, `${at} X-Robots-Tag is not set`).toBeGreaterThan(0);
        for (const value of robots) expect(value, `${at} X-Robots-Tag`).toMatch(/\bnoindex\b/);
        expect(
          robots.some((v) => /\bnofollow\b/.test(v)),
          `${at} X-Robots-Tag never says nofollow`,
        ).toBe(true);
        if (host === CANONICAL_HOST) expect(new Set(robots), `${at} X-Robots-Tag`).toEqual(new Set(['noindex, nofollow']));
      }
    }
  });

  it('the header evaluator refuses a rule it cannot evaluate, rather than pass it unexamined', () => {
    const rule = (extra: Partial<Rule>): VercelConfig => ({
      rewrites: [],
      headers: [{ source: '/(.*)', headers: [{ key: 'Referrer-Policy', value: 'origin' }], ...extra }],
    });
    expect(() => headerValuesFor(rule({ has: [{ type: 'cookie', value: 'x' }] }), 'Referrer-Policy', '/a', CANONICAL_HOST)).toThrow(/cannot evaluate/);
    expect(() => headerValuesFor(rule({ source: '/:path*' }), 'Referrer-Policy', '/a', CANONICAL_HOST)).toThrow(/cannot evaluate/);
    // A non-capturing group is ordinary regex, not a named parameter.
    expect(headerValuesFor(rule({ source: '/((?:a|b)x)' }), 'Referrer-Policy', '/ax', CANONICAL_HOST)).toEqual(['origin']);
  });

  it('the live census probes every token prefix', () => {
    const census = readFileSync(join(REPO, 'scripts', 'crawl_surface_census.py'), 'utf8');
    const list = /^TOKEN_SAMPLES\s*=\s*\[([^\]]*)\]/m.exec(census)?.[1];
    if (!list) throw new Error('crawl-surface: no TOKEN_SAMPLES list in scripts/crawl_surface_census.py');
    const samples = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    for (const prefix of TOKEN_PREFIXES) {
      expect(samples.some((s) => s === prefix || s.startsWith(prefix)), `the census does not probe ${prefix}`).toBe(true);
    }
  });

  it('the token list still names real routes', () => {
    const paths = appRoutePaths();
    for (const prefix of TOKEN_PREFIXES) {
      expect(paths.some((p) => p === prefix || p.startsWith(prefix)), prefix).toBe(true);
    }
  });

  it('robots allows public pages by unanchored prefix, so no other route may share one', () => {
    for (const route of PUBLIC_ROUTES.filter((r) => r.path !== '/')) {
      const sharing = appRoutePaths().filter((p) => p !== route.path && p.startsWith(route.path));
      expect(sharing, route.path).toEqual([]);
    }
  });
});

describe('the shell and the second Vercel project', () => {
  it('index.html carries one closed head block', () => {
    const start = indexHtml.indexOf(HEAD_START);
    const end = indexHtml.indexOf(HEAD_END);
    expect(start).toBeGreaterThan(0);
    expect(indexHtml.indexOf(HEAD_START, start + 1)).toBe(-1);
    const block = indexHtml.slice(start, end);
    expect(block).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(block).not.toContain('canonical');
  });

  it('the repo-root vercel.json (the api-gateway project duplicate) is noindex everywhere and serves the closed shell', () => {
    expect(root.headers).toContainEqual({ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] });
    expect(root.rewrites.find((r) => r.source === '/robots.txt')?.destination).toBe('/crawl/robots-other.txt');
    for (const r of root.rewrites) expect(r.destination).not.toBe('/index.html');
  });
});
