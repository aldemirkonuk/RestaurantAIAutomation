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

/**
 * Does one `has`/`missing` entry hold for a request to `host`? Only host equality is modelled, and
 * only for the hosts in HOSTS: a rule gated on any other host would be skipped for every host this
 * test evaluates, so it throws instead (add the host to HOSTS to have the rule evaluated).
 */
function conditionHolds(cond: { type: string; value: unknown }, host: string): boolean {
  const eq = (cond.value as { eq?: unknown } | null)?.eq;
  if (cond.type !== 'host' || typeof eq !== 'string') {
    throw new Error(`crawl-surface: cannot evaluate header condition ${JSON.stringify(cond)}; extend conditionHolds()`);
  }
  if (!HOSTS.includes(eq)) {
    throw new Error(`crawl-surface: header condition names host ${eq}, which is not in HOSTS; add it so the rule is evaluated`);
  }
  return eq === host;
}

/**
 * `{` and `}` outside a `(...)` group are path-to-regexp's own group delimiters: Vercel compiles
 * `/{(.*)}` to `^/(.*)$`, while a plain RegExp reads the braces as literal characters.
 */
function hasPathToRegexpBraces(source: string): boolean {
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') i += 1;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if ((ch === '{' || ch === '}') && depth === 0) return true;
  }
  return false;
}

/**
 * Why path-to-regexp 6.1.0 (the version `@vercel/routing-utils` pins) would refuse `source`, or
 * null. A refused source fails `vercel build`, so nothing deploys, while every test here would
 * otherwise stay green (found by the merge-train session with `/legal*`). These are its lexer's
 * own rules: a modifier (`*`, `+`, `?`) must directly follow a group's closing `)` at the top
 * level; a group cannot start with `?`, cannot be empty, and cannot hold a capturing group (only
 * `(?...)`); an opening `(` must be closed. A stray `)` at the top level is a literal character to
 * it, so it is not refused (and this test then cannot read it as a regular expression). Checked
 * once (a scratch script, not committed) against path-to-regexp 6.1.0, which decides, compiled
 * with Vercel's options, over 76 sources: nothing this accepts is refused by it and nothing this
 * refuses is accepted, apart from `:name` and `{...}` sources, which are thrown on before this.
 * `vercel build` stays the authority.
 */
function pathToRegexpRefuses(source: string): string | null {
  let depth = 0;
  let afterGroup = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      afterGroup = false;
    } else if (ch === '(') {
      if (depth === 0 && source[i + 1] === '?') return 'a group cannot start with ?';
      if (depth === 0 && source[i + 1] === ')') return 'an empty group';
      if (depth > 0 && source[i + 1] !== '?') return 'a capturing group inside a group';
      depth += 1;
      afterGroup = false;
    } else if (ch === ')') {
      // Only a `)` that closes a group can be followed by a modifier; a stray one is a literal.
      afterGroup = depth === 1;
      if (depth > 0) depth -= 1;
    } else if (depth === 0 && (ch === '*' || ch === '+' || ch === '?')) {
      if (!afterGroup) return `a modifier ${ch} that does not follow a group`;
      afterGroup = false;
    } else {
      afterGroup = false;
    }
  }
  return depth === 0 ? null : 'an unbalanced (';
}

/**
 * Every value that a `headers` rule of `config` sets for `key` on a request to `pathname` on
 * `host`, in file order. A condition or source this does not model throws rather than pass
 * unexamined: a cookie or query condition, a host outside HOSTS, a `:name` parameter, a `{...}`
 * group, a source path-to-regexp refuses. Sources are read as JavaScript regular expressions,
 * anchored and case-sensitive, which is what Vercel compiles them to for the syntax the repo uses
 * (`strict` and `sensitive` path-to-regexp options, ADR 0158 Known limits); a literal `.` is a
 * literal dot to Vercel and any character here.
 */
function headerValuesFor(config: VercelConfig, key: string, pathname: string, host: string): string[] {
  const values: string[] = [];
  for (const rule of config.headers) {
    // `:name` is path-to-regexp's named parameter; `(?:` is a plain regex group and is fine.
    if (/(^|[^?]):[A-Za-z_]/.test(rule.source) || hasPathToRegexpBraces(rule.source)) {
      throw new Error(`crawl-surface: cannot evaluate header source ${rule.source}; extend headerValuesFor()`);
    }
    const refused = pathToRegexpRefuses(rule.source);
    if (refused) {
      throw new Error(`crawl-surface: cannot evaluate header source ${rule.source}: path-to-regexp refuses it (${refused}), so vercel build would fail`);
    }
    let pattern: RegExp;
    try {
      pattern = new RegExp(`^${rule.source}$`);
    } catch {
      throw new Error(`crawl-surface: cannot evaluate header source ${rule.source}: not a JavaScript regular expression`);
    }
    if (!pattern.test(pathname)) continue;
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
    // Limits (ADR 0158, Known limits): three hosts (a rule gated on another host throws), sources
    // read as JS regular expressions, and only the paths built below: slashless, with a trailing
    // slash (Vercel matches strictly, so /reset-password/ is a different path) and, for the two
    // exact routes, nested.
    const tokenPaths = TOKEN_PREFIXES.flatMap((p) =>
      p.endsWith('/') ? [`${p}abc123`, `${p}abc123/`] : [p, `${p}/`, `${p}/abc123`],
    );
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

  it('the header evaluator refuses a source path-to-regexp refuses, so a rule that cannot deploy is not passed', () => {
    const rule = (source: string): VercelConfig => ({
      rewrites: [],
      headers: [{ source, headers: [{ key: 'Referrer-Policy', value: 'origin' }] }],
    });
    const values = (source: string, path = '/a') => headerValuesFor(rule(source), 'Referrer-Policy', path, CANONICAL_HOST);
    for (const source of ['/legal*', '/(.*)/?', '/a(b', '/(?a)', '/()', '/((a)b)', '/a+', '/a?', '/a)*', '/(a)??']) {
      expect(() => values(source), source).toThrow(/path-to-regexp refuses it/);
    }
    // A stray `)` is a literal to path-to-regexp, so it is not refused, but it is not a regular
    // expression either: it is reported as unreadable rather than crashing on a SyntaxError.
    expect(() => values('/a)')).toThrow(/not a JavaScript regular expression/);
    // The shapes the repo uses, and their neighbours, are accepted.
    for (const [source, path] of [
      ['/(.*)', '/a'],
      ['/(a)?', '/a'],
      ['/(a)*', '/aa'],
      ['/((?!x/).*)', '/a'],
      ['/((?:a|b)(?:/.*)?|c/.*)', '/a/'],
      ['/a\\?b', '/a?b'],
    ]) {
      expect(values(source, path), source).toEqual(['origin']);
    }
  });

  it('the header evaluator refuses a cookie condition, a host outside HOSTS, a :name source or a {...} group', () => {
    const rule = (extra: Partial<Rule>): VercelConfig => ({
      rewrites: [],
      headers: [{ source: '/(.*)', headers: [{ key: 'Referrer-Policy', value: 'origin' }], ...extra }],
    });
    const values = (extra: Partial<Rule>, path = '/a') => headerValuesFor(rule(extra), 'Referrer-Policy', path, CANONICAL_HOST);
    expect(() => values({ has: [{ type: 'cookie', value: 'x' }] })).toThrow(/cannot evaluate header condition/);
    expect(() => values({ has: [{ type: 'host', value: { eq: 'www.mudavym.com' } }] })).toThrow(/not in HOSTS/);
    expect(() => values({ missing: [{ type: 'host', value: { eq: 'www.mudavym.com' } }] })).toThrow(/not in HOSTS/);
    expect(() => values({ source: '/:path*' })).toThrow(/cannot evaluate header source/);
    expect(() => values({ source: '/{(.*)}' })).toThrow(/cannot evaluate header source/);
    // A non-capturing group is ordinary regex, not a named parameter; a brace or a quantifier
    // inside a (...) group is ordinary regex too; a host in HOSTS is evaluated, not refused.
    expect(values({ source: '/((?:a|b)x)' }, '/ax')).toEqual(['origin']);
    expect(values({ source: '/(a{2})' }, '/aa')).toEqual(['origin']);
    expect(values({ has: [{ type: 'host', value: { eq: CANONICAL_HOST } }] })).toEqual(['origin']);
  });

  it('the live census probes the same token paths as this guard, with and without a trailing slash', () => {
    const census = readFileSync(join(REPO, 'scripts', 'crawl_surface_census.py'), 'utf8');
    const list = /^TOKEN_SAMPLES\s*=\s*\[([^\]]*)\]/m.exec(census)?.[1];
    if (!list) throw new Error('crawl-surface: no TOKEN_SAMPLES list in scripts/crawl_surface_census.py');
    // The made-up token differs (abc123 here, zz-census there); the shape of each path must not.
    const shape = (p: string) => p.replace(/abc123|zz-census/, 'TOKEN');
    const censusShapes = [...list.matchAll(/"([^"]+)"/g)].map((m) => shape(m[1])).sort();
    const guardShapes = TOKEN_PREFIXES.flatMap((p) =>
      p.endsWith('/') ? [`${p}TOKEN`, `${p}TOKEN/`] : [p, `${p}/`, `${p}/TOKEN`],
    ).sort();
    expect(censusShapes).toEqual(guardShapes);
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
