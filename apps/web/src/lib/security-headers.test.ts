/**
 * The response headers mudavym.com must send on every page (ADR 0185).
 *
 * Reads the real apps/web/vercel.json - the file the production project
 * (Root Directory apps/web) serves from - and evaluates its header rules the
 * way the host does: every rule whose source matches a path contributes its
 * headers. For each sample path it asserts the full protective set is present,
 * that a token route keeps `Referrer-Policy: no-referrer` (ADR 0158) and gets
 * no second, weaker value, and that no two matching rules set one header to
 * different values - the host merges them and does not document which wins.
 *
 * A config with no header rules FAILS: a guard that evaluated nothing would
 * pass on a broken file (absence is not health).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOKEN_PREFIXES } from './seo/routes';

interface HeaderRule {
  source: string;
  has?: { type: string; value: unknown }[];
  missing?: { type: string; value: { eq?: string } }[];
  headers: { key: string; value: string }[];
}

const WEB = join(__dirname, '..', '..');
const config: { headers: HeaderRule[] } = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
const CANONICAL_HOST = 'mudavym.com';

function appliesOnCanonicalHost(rule: HeaderRule): boolean {
  if (rule.has?.length) return false;
  return !(rule.missing ?? []).some((m) => m.type === 'host' && m.value?.eq === CANONICAL_HOST);
}

function matching(path: string): HeaderRule[] {
  return config.headers.filter((rule) => appliesOnCanonicalHost(rule) && new RegExp(`^${rule.source}$`).test(path));
}

function valuesFor(path: string, key: string): string[] {
  return matching(path).flatMap((rule) => rule.headers.filter((h) => h.key.toLowerCase() === key.toLowerCase()).map((h) => h.value));
}

const TOKEN_SAMPLES = TOKEN_PREFIXES.map((p) => (p.endsWith('/') ? `${p}abc123` : p));
const PAGE_SAMPLES = ['/', '/login', '/register', '/orders', '/orders/9f1c', '/settings', '/v/acme', '/privacy', '/assets/index-abc.js', '/sw.js'];

describe('mudavym.com security headers (ADR 0185)', () => {
  it('parses real header rules, and none uses a path parameter this evaluator cannot read', () => {
    expect(config.headers.length).toBeGreaterThan(0);
    for (const rule of config.headers) expect(rule.source, rule.source).not.toContain(':');
  });

  it.each([...PAGE_SAMPLES, ...TOKEN_SAMPLES])('%s carries the protective set', (path) => {
    expect(valuesFor(path, 'X-Content-Type-Options')).toEqual(['nosniff']);
    expect(valuesFor(path, 'X-Frame-Options')).toEqual(['SAMEORIGIN']);
    expect(valuesFor(path, 'Strict-Transport-Security')).toEqual(['max-age=63072000; includeSubDomains']);
    expect(valuesFor(path, 'Cross-Origin-Opener-Policy')).toEqual(['same-origin-allow-popups']);
    const permissions = valuesFor(path, 'Permissions-Policy');
    expect(permissions).toHaveLength(1);
    expect(permissions[0]).toContain('camera=(self)');
    expect(permissions[0]).toContain('microphone=(self)');
    expect(permissions[0]).toContain('geolocation=()');
    expect(permissions[0]).not.toContain('preload');
  });

  it.each(TOKEN_SAMPLES)('token route %s keeps exactly no-referrer', (path) => {
    expect(valuesFor(path, 'Referrer-Policy')).toEqual(['no-referrer']);
    expect(valuesFor(path, 'X-Robots-Tag')).toEqual(['noindex, nofollow']);
  });

  it.each(PAGE_SAMPLES)('%s gets the site-wide referrer policy once', (path) => {
    expect(valuesFor(path, 'Referrer-Policy')).toEqual(['strict-origin-when-cross-origin']);
  });

  it.each([...PAGE_SAMPLES, ...TOKEN_SAMPLES])('%s: no two matching rules set one header differently', (path) => {
    const seen = new Map<string, Set<string>>();
    for (const rule of matching(path)) {
      for (const h of rule.headers) {
        const k = h.key.toLowerCase();
        seen.set(k, (seen.get(k) ?? new Set()).add(h.value));
      }
    }
    for (const [key, values] of seen) expect([...values], `${path} ${key}`).toHaveLength(1);
  });

  it('the second Vercel project (repo-root vercel.json) also keeps no-referrer on token routes (ADR 0158)', () => {
    const root: { headers: HeaderRule[] } = JSON.parse(readFileSync(join(WEB, '..', '..', 'vercel.json'), 'utf8'));
    for (const path of TOKEN_SAMPLES) {
      const values = root.headers
        .filter((rule) => !rule.has?.length && new RegExp(`^${rule.source}$`).test(path))
        .flatMap((rule) => rule.headers.filter((h) => h.key.toLowerCase() === 'referrer-policy').map((h) => h.value));
      expect(values, path).toEqual(['no-referrer']);
    }
  });

  it('HSTS is not preloaded: preload is effectively irreversible and binds every future subdomain', () => {
    for (const rule of config.headers) {
      for (const h of rule.headers) {
        if (h.key.toLowerCase() === 'strict-transport-security') expect(h.value).not.toContain('preload');
      }
    }
  });
});
