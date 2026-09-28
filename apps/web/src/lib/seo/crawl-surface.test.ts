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

// The token paths both header guards evaluate: slashless, with a trailing slash (Vercel matches
// strictly, so /reset-password/ is a different path) and, for the two exact routes, nested.
const TOKEN_PATHS = TOKEN_PREFIXES.flatMap((p) =>
  p.endsWith('/') ? [`${p}abc123`, `${p}abc123/`] : [p, `${p}/`, `${p}/abc123`],
);

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
 * Why this test cannot read `source` the way Vercel does, or null. Both kinds are thrown on, so a
 * rule is never passed unexamined.
 *
 * Syntax path-to-regexp gives a meaning a plain RegExp does not, which is not modelled here: a `:`
 * (a named parameter) or a `{` / `}` (its own group: `/{(.*)}` compiles to `^/(.*)$`) outside a
 * `(...)` group; a modifier right after a group (it applies to the preceding `/` and the group, so
 * `/(a)?` matches the empty path and not `/`); a character class (path-to-regexp counts the
 * parentheses inside one).
 *
 * Shapes path-to-regexp 6.1.0, the version `@vercel/routing-utils` pins, REFUSES: a modifier that
 * does not follow a group, a group that starts with `?`, an empty group, a capturing group inside a
 * group (only `(?...)` may nest), an unclosed `(`. A refused source fails `vercel build`, so nothing
 * deploys, while every other test here would stay green (found by the merge-train session with
 * `/legal*`). A stray `)` is a literal to the library, so it is left to `new RegExp`, which rejects it.
 *
 * What is read: literal text, and `(...)` groups of plain regular expression with `(?:` and
 * lookaheads inside. Text outside a group is literal to path-to-regexp, which `sourceToRegExp`
 * reproduces.
 *
 * Compared with path-to-regexp 6.1.0, compiled with Vercel's options (a scratch script, not
 * committed), in two exhaustive runs over sources that start with `/`: every string of up to 6
 * characters from `a / . ( ) ? : * | \` (111,111), and up to 5 from those plus `1 + [ ] { } ^ $ - #`
 * (168,421). In both, no source the library refuses was read silently, no source was called refused
 * that the library accepts, and on every source read, this test's RegExp and the library's regex
 * gave the same answer on 19 probe paths. `vercel build` stays the authority (ADR 0158, Known
 * limits).
 */
function unreadableSource(source: string): string | null {
  let depth = 0;
  let afterGroup = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      if (next === undefined) return 'a trailing backslash is not modelled';
      if (depth === 0 && /[A-Za-z0-9]/.test(next)) return 'an escaped letter or digit outside a group is not modelled: it is a plain letter to path-to-regexp';
      i += 1;
      afterGroup = false;
    } else if (ch === '(') {
      if (depth === 0 && source[i + 1] === '?') return 'path-to-regexp refuses a group that starts with ?, so vercel build would fail';
      if (depth === 0 && source[i + 1] === ')') return 'path-to-regexp refuses an empty group, so vercel build would fail';
      if (depth > 0 && source[i + 1] !== '?') return 'path-to-regexp refuses a capturing group inside a group, so vercel build would fail';
      depth += 1;
      afterGroup = false;
    } else if (ch === ')') {
      // Only a `)` that closes a group can be followed by a modifier; a stray one is a literal.
      afterGroup = depth === 1;
      if (depth > 0) depth -= 1;
    } else if (ch === '[') {
      return 'a character class is not modelled: path-to-regexp counts parentheses inside it';
    } else if (depth === 0 && (ch === '*' || ch === '+' || ch === '?')) {
      return afterGroup
        ? `a modifier ${ch} after a group is not modelled: path-to-regexp applies it to the preceding / and the group`
        : `path-to-regexp refuses a modifier ${ch} that does not follow a group, so vercel build would fail`;
    } else if (depth === 0 && ch === ':') {
      return 'a : outside a group is path-to-regexp parameter syntax, which is not modelled';
    } else if (depth === 0 && (ch === '{' || ch === '}')) {
      return 'a {...} group is path-to-regexp syntax, which is not modelled';
    } else {
      afterGroup = false;
    }
  }
  return depth === 0 ? null : 'path-to-regexp refuses an unclosed group, so vercel build would fail';
}

/**
 * The RegExp for a source `unreadableSource` accepted. Text outside a `(...)` group is literal to
 * path-to-regexp (a `.`, `|`, `^`, `$` or stray `)` there matches itself), and inside a group it is
 * regular expression, so only the outside is escaped.
 */
function sourceToRegExp(source: string): RegExp {
  let depth = 0;
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      out += ch + source[i + 1];
      i += 1;
    } else if (ch === '(') {
      depth += 1;
      out += ch;
    } else if (ch === ')' && depth > 0) {
      depth -= 1;
      out += ch;
    } else {
      out += depth === 0 && '.|^$)'.includes(ch) ? `\\${ch}` : ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Every value that a `headers` rule of `config` sets for `key` on a request to `pathname` on
 * `host`, in file order. A condition or source this cannot read the way Vercel does throws rather
 * than pass unexamined: a cookie or query condition, a host outside HOSTS, or any source
 * `unreadableSource` names. The rest are read as Vercel compiles them: anchored and case-sensitive
 * (`strict` and `sensitive` path-to-regexp options, ADR 0158 Known limits), text outside a group
 * literal, groups as regular expression.
 */
function headerValuesFor(config: VercelConfig, key: string, pathname: string, host: string): string[] {
  const values: string[] = [];
  for (const rule of config.headers) {
    const unreadable = unreadableSource(rule.source);
    if (unreadable) {
      throw new Error(`crawl-surface: cannot evaluate header source ${rule.source}: ${unreadable}`);
    }
    let pattern: RegExp;
    try {
      pattern = sourceToRegExp(rule.source);
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
    // Limits (ADR 0158, Known limits): three hosts (a rule gated on another host throws), and only
    // the paths in TOKEN_PATHS.
    for (const host of HOSTS) {
      for (const path of TOKEN_PATHS) {
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
    // path-to-regexp 6.1.0 refuses each of these, so vercel build fails and nothing deploys. The
    // last is a nested capturing group, the shape that looks like a fix for a `(?:` false alarm.
    for (const source of [
      '/legal*',
      '/(.*)/?',
      '/a(b',
      '/(?a)',
      '/(?:a|b)',
      '/(?!x).*',
      '/()',
      '/((a)b)',
      '/a+',
      '/a?',
      '/a)*',
      '/((reset-password|verify-email)(/.*)?|invite/.*)',
    ]) {
      expect(() => values(source), source).toThrow(/path-to-regexp refuses/);
    }
    // A group whose contents are not a regular expression is reported, not left to a SyntaxError.
    expect(() => values('/(*)')).toThrow(/not a JavaScript regular expression/);
    // The shapes the repo uses, and their neighbours, are read.
    for (const [source, path] of [
      ['/(.*)', '/a'],
      ['/assets/(.*)', '/assets/x'],
      ['/((?!x/).*)', '/a'],
      ['/(a|a/.*|b)', '/a/x'],
      ['/((?:a|b)(?:/.*)?|c/.*)', '/a/'],
      ['/(reset-password|reset-password/.*|verify-email|verify-email/.*|invite/.*)', '/verify-email/'],
      ['/a\\?b', '/a?b'],
      ['/(a:b)', '/a:b'],
      ['/(a{2})', '/aa'],
    ]) {
      expect(values(source, path), source).toEqual(['origin']);
    }
  });

  it('text outside a group is literal, as path-to-regexp reads it, so a rule is not matched by a look-alike path', () => {
    const values = (source: string, path: string) =>
      headerValuesFor(
        { rewrites: [], headers: [{ source, headers: [{ key: 'Referrer-Policy', value: 'origin' }] }] },
        'Referrer-Policy',
        path,
        CANONICAL_HOST,
      );
    // A `.` outside a group is a dot, not any character; `|`, `^`, `$` and a stray `)` match themselves.
    expect(values('/index.html', '/index.html')).toEqual(['origin']);
    expect(values('/index.html', '/indexXhtml')).toEqual([]);
    expect(values('/a|b', '/a|b')).toEqual(['origin']);
    expect(values('/a|b', '/a')).toEqual([]);
    expect(values('/a)', '/a)')).toEqual(['origin']);
    expect(values('/a$', '/a$')).toEqual(['origin']);
    // Inside a group it is regular expression: a dot is any character and | is alternation.
    expect(values('/(a.b|c)', '/aXb')).toEqual(['origin']);
    expect(values('/(a.b|c)', '/c')).toEqual(['origin']);
    // An escape of a letter or digit outside a group is a plain letter to path-to-regexp, so it is refused.
    expect(() => values('/a\\d', '/a1')).toThrow(/not modelled/);
    expect(() => values('/a\\', '/a')).toThrow(/not modelled/);
  });

  it('the header evaluator refuses what it cannot read as path-to-regexp does, and a condition it does not model', () => {
    const rule = (extra: Partial<Rule>): VercelConfig => ({
      rewrites: [],
      headers: [{ source: '/(.*)', headers: [{ key: 'Referrer-Policy', value: 'origin' }], ...extra }],
    });
    const values = (extra: Partial<Rule>, path = '/a') => headerValuesFor(rule(extra), 'Referrer-Policy', path, CANONICAL_HOST);
    // Read differently by path-to-regexp (a named parameter, its own {...} group, a modifier that
    // applies to the preceding / and the group, a character class), so not modelled.
    for (const source of ['/:path*', '/:0', '/a:', '/{(.*)}', '/a{b}', '/(a)?', '/(a)*', '/a[b]', '/([)])']) {
      expect(() => values({ source }), source).toThrow(/not modelled/);
    }
    expect(() => values({ has: [{ type: 'cookie', value: 'x' }] })).toThrow(/cannot evaluate header condition/);
    expect(() => values({ has: [{ type: 'host', value: { eq: 'www.mudavym.com' } }] })).toThrow(/not in HOSTS/);
    expect(() => values({ missing: [{ type: 'host', value: { eq: 'www.mudavym.com' } }] })).toThrow(/not in HOSTS/);
    // A host in HOSTS is evaluated, not refused.
    expect(values({ has: [{ type: 'host', value: { eq: CANONICAL_HOST } }] })).toEqual(['origin']);
  });

  it('the live census probes the same token paths as this guard, with and without a trailing slash', () => {
    const census = readFileSync(join(REPO, 'scripts', 'crawl_surface_census.py'), 'utf8');
    const list = /^TOKEN_SAMPLES\s*=\s*\[([^\]]*)\]/m.exec(census)?.[1];
    if (!list) throw new Error('crawl-surface: no TOKEN_SAMPLES list in scripts/crawl_surface_census.py');
    // The made-up token differs (abc123 here, zz-census there); the shape of each path must not.
    const shape = (p: string) => p.replace(/abc123|zz-census/, 'TOKEN');
    const censusShapes = [...list.matchAll(/"([^"]+)"/g)].map((m) => shape(m[1])).sort();
    const guardShapes = TOKEN_PATHS.map(shape).sort();
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

  it('the repo-root vercel.json gives every token path no-referrer and noindex, nofollow, wherever the rule sits', () => {
    // The duplicate project has no host conditions. Its site-wide rule adds a plain `noindex` to the
    // token paths beside the token rule's `noindex, nofollow`, so two X-Robots-Tag values reach
    // them (which one Vercel sends is not measured): each must say noindex and one must say nofollow.
    for (const path of TOKEN_PATHS) {
      expect(new Set(headerValuesFor(root, 'Referrer-Policy', path, CANONICAL_HOST)), `root ${path} Referrer-Policy`).toEqual(
        new Set(['no-referrer']),
      );
      const robots = headerValuesFor(root, 'X-Robots-Tag', path, CANONICAL_HOST);
      expect(robots.length, `root ${path} X-Robots-Tag is not set`).toBeGreaterThan(0);
      for (const value of robots) expect(value, `root ${path} X-Robots-Tag`).toMatch(/\bnoindex\b/);
      expect(
        robots.some((v) => /\bnofollow\b/.test(v)),
        `root ${path} X-Robots-Tag never says nofollow`,
      ).toBe(true);
    }
  });

  it('the repo-root vercel.json (the api-gateway project duplicate) is noindex everywhere and serves the closed shell', () => {
    expect(root.headers).toContainEqual({ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] });
    expect(root.rewrites.find((r) => r.source === '/robots.txt')?.destination).toBe('/crawl/robots-other.txt');
    for (const r of root.rewrites) expect(r.destination).not.toBe('/index.html');
  });
});
