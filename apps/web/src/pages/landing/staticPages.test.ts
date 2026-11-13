/**
 * The static landing pages under `public/l/<name>/` (ADR 0354) sit outside
 * the React app, so nothing shared keeps them on the landing's rules. This
 * guard reads each SHIPPED page off disk and checks ADR 0354 Decision 2 and 3
 * on its bytes: no outside host, no em or en dash, dollars only, no form, one
 * "Start free" button that carries `?for=` into signup, not indexed, a
 * reduced-motion block, and fonts that exist under `public/fonts/`.
 *
 * What it cannot cover: it reads text, it paints nothing. Whether every
 * block of figures carries a "Sample" label, and whether reduced motion
 * really shows the finished state, are checked in a browser, not here.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

export const PAGES = ['day'] as const;

const PUBLIC = join(__dirname, '../../../public');
const CANONICAL = '<link rel="canonical" href="https://mudavym.com/">';
const START_RE = /<a\b([^>]*\bdata-start\b[^>]*)>([\s\S]*?)<\/a>/g;
const FOR_SCRIPT_RE = /<script id="start-for">([\s\S]*?)<\/script>/;

const pagePath = (name: string) => join(PUBLIC, 'l', name, 'index.html');
const read = (name: string) => readFileSync(pagePath(name), 'utf-8');

/** Every URL the page could ask a browser to fetch or follow. */
function urlsIn(html: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(?:src|href|srcset|poster|action|data)\s*=\s*["']?([^"'\s>]+)/gi,
    /url\(\s*['"]?([^'")]+)/gi,
    /@import\s+(?:url\()?\s*['"]?([^'");\s]+)/gi,
  ];
  for (const re of patterns) for (const m of html.matchAll(re)) out.push(m[1]);
  return out;
}

function startLinks(html: string): { attrs: string; text: string; href: string }[] {
  return [...html.matchAll(START_RE)].map(([, attrs, text]) => ({
    attrs,
    text: text.trim(),
    href: /\bhref="([^"]*)"/.exec(attrs)?.[1] ?? '',
  }));
}

/** Runs the page's own `for` script against `search` and returns every rewritten href. */
function runForScript(html: string, search: string): string[] {
  const code = FOR_SCRIPT_RE.exec(html)?.[1];
  if (!code) throw new Error('no <script id="start-for"> on the page');
  window.history.replaceState({}, '', `/l/test/${search}`);
  document.body.innerHTML = startLinks(html)
    .map(l => `<a ${l.attrs}>${l.text}</a>`)
    .join('');
  new Function(code)();
  return [...document.querySelectorAll('a[data-start]')].map(a => a.getAttribute('href') ?? '');
}

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe.each(PAGES)('static landing page /l/%s (ADR 0354)', name => {
  it('exists and is a whole page', () => {
    expect(existsSync(pagePath(name))).toBe(true);
    const html = read(name);
    expect(html.length).toBeGreaterThan(10_000);
    expect(html).toMatch(/^<!doctype html>/i);
  });

  it('asks no other host for anything; the canonical is the only absolute URL', () => {
    const html = read(name).replace(CANONICAL, '');
    const absolute = urlsIn(html).filter(u => /^(https?:)?\/\//i.test(u));
    expect(absolute).toEqual([]);
  });

  it('has no em or en dash anywhere', () => {
    const html = read(name);
    const hits = html.split('\n').flatMap((line, i) => (/[–—]/.test(line) ? [i + 1] : []));
    expect(hits).toEqual([]);
  });

  it('shows dollars, never euros', () => {
    expect(read(name)).not.toContain('€');
  });

  it('embeds no form and no iframe', () => {
    const html = read(name);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/<iframe\b/i);
  });

  it('has the one button: "Start free" to /register?type=new', () => {
    const links = startLinks(read(name));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.text).toBe('Start free');
      expect(l.href.startsWith('/register?type=new')).toBe(true);
    }
  });

  it('carries a clean `for` into signup and drops a bad one', () => {
    const html = read(name);
    const n = startLinks(html).length;
    const page = `&page=${name}`;
    expect(runForScript(html, '?for=wine-bars')).toEqual(
      Array(n).fill(`/register?type=new&for=wine-bars${page}`),
    );
    for (const bad of [
      '?for=Wine-Bars',
      '?for=a%26page%3Dx',
      '?for=%3Cscript%3E',
      `?for=${'a'.repeat(41)}`,
      '?for=',
      '',
    ]) {
      expect(runForScript(html, bad)).toEqual(Array(n).fill(`/register?type=new${page}`));
    }
  });

  it('is not indexed and names / as its canonical', () => {
    const html = read(name);
    expect(html).toContain(CANONICAL);
    expect(html).toMatch(/<meta name="robots" content="noindex">/);
  });

  it('has a reduced-motion block', () => {
    expect(read(name)).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
  });

  it("uses only the app's own fonts, and each file exists", () => {
    const html = read(name);
    const faces = [...html.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const srcs = [...face.matchAll(/url\(\s*['"]?([^'")]+)/g)].map(m => m[1]);
      expect(srcs.length).toBeGreaterThan(0);
      for (const src of srcs) {
        expect(src.startsWith('/fonts/')).toBe(true);
        expect(existsSync(join(PUBLIC, src))).toBe(true);
      }
    }
  });
});
