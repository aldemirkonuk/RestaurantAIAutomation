/**
 * Depth, grain and micro-delight (design critic N-20, r71). Reads the shipped
 * stylesheets: the elevation ramp resolves in both grounds, the grain is a 2 %
 * multiply layer the pointer ignores, the ink-in moves only opacity and
 * transform and stops under reduced motion, and the toast wears the elevation
 * and a 3 px edge.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const RAW = readFileSync(join(__dirname, 'depth.css'), 'utf8');
const CSS = strip(RAW);
const TOAST = strip(readFileSync(join(__dirname, '../components/mudavym/house-toast.css'), 'utf8'));
const HEADER = strip(readFileSync(join(__dirname, '../components/mudavym/house-header.css'), 'utf8'));
const GLOBALS = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const block = (css: string, sel: string) =>
  [...css.matchAll(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]'=()]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = RAW;
  document.head.appendChild(style);
  if (!style.sheet || style.sheet.cssRules.length === 0) throw new Error('depth.css did not parse');
});
afterEach(() => document.documentElement.removeAttribute('data-mudavym-ground'));
const root = () => getComputedStyle(document.documentElement);
const tok = (n: string) => root().getPropertyValue(n).replace(/\s+/g, '');

describe('elevation tokens', () => {
  it('are three tinted rungs, the toast one being the 18/36 drop', () => {
    expect(tok('--elev-1')).toContain('rgba(33,28,22');
    expect(tok('--elev-2')).toContain('018px36px-22pxrgba(33,28,22,0.4)');
    expect(tok('--elev-3')).toContain('28px56px');
  });
  it('turn to a black-based drop in the charcoal ground', () => {
    document.documentElement.setAttribute('data-mudavym-ground', 'charcoal');
    expect(tok('--elev-2')).toContain('rgba(0,0,0');
  });
  it('are loaded by globals.css', () => {
    expect(GLOBALS).toContain("@import './depth.css'");
  });
});

describe('paper tooth', () => {
  const grain = block(CSS, '.mdv-grain::before');
  it('is a 128 px tile at 2 % opacity, multiplied, behind content, ignored by the pointer', () => {
    expect(grain).toMatch(/opacity:\s*0\.02\b/);
    expect(grain).toMatch(/mix-blend-mode:\s*multiply/);
    expect(grain).toMatch(/background-size:\s*128px 128px/);
    expect(grain).toMatch(/pointer-events:\s*none/);
    expect(grain).toMatch(/z-index:\s*-1/);
    expect(CSS).toContain('feTurbulence');
  });
  it('lifts rather than multiplies on charcoal, still under 4 %', () => {
    expect(CSS).toMatch(/mix-blend-mode:\s*screen;\s*opacity:\s*0\.03/);
  });
});

describe('the greeting ink-in', () => {
  const rule = block(CSS, '.mdv-ink-in');
  it('is 400 ms on the house curve and moves only opacity and transform', () => {
    expect(rule).toMatch(/animation:\s*mdv-ink-in 400ms/);
    const frames = CSS.slice(CSS.indexOf('@keyframes mdv-ink-in'), CSS.indexOf('@media (prefers-reduced-motion'));
    const props = [...frames.matchAll(/([a-z-]+):\s*[^;]+;/g)].map((m) => m[1]).filter((p) => p !== 'font-variation-settings');
    expect([...new Set(props)].sort()).toEqual(['opacity', 'transform']);
  });
  it('is at its end state under reduced motion', () => {
    const reduce = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toMatch(/\.mdv-ink-in\s*\{\s*animation:\s*none/);
  });
  it('never uses transition: all', () => {
    expect(CSS).not.toMatch(/transition:\s*all/);
  });
});

describe('the toast and the header', () => {
  it('the toast stands on the elevation and a 3 px edge in the status token', () => {
    expect(block(TOAST, '.mdv-toast')).toMatch(/box-shadow:\s*var\(--elev-2\)\s*!important/);
    expect(block(TOAST, '.mdv-toast')).toMatch(/border-left:\s*3px solid var\(--toast-accent\)\s*!important/);
    expect(block(TOAST, ".mdv-toast[data-type='error']")).toMatch(/--toast-accent:\s*var\(--alarm\)/);
  });
  it('the header blurs 14 px and saturates 1.4', () => {
    expect(block(HEADER, '.mdv-hdr')).toMatch(/(?<!-)backdrop-filter:\s*blur\(14px\) saturate\(1\.4\)/);
    expect(block(HEADER, '.mdv-hdr')).toMatch(/-webkit-backdrop-filter:\s*blur\(14px\) saturate\(1\.4\)/);
  });
});
