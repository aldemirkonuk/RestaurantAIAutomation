/**
 * The motion tokens resolve, in either ground, and every motion has its
 * reduced-motion tier (design critic N-12). Loads the shipped stylesheet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const RAW = readFileSync(join(__dirname, 'motion.css'), 'utf8');
/** The sheet without its comments, so prose cannot satisfy or trip a rule. */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (v: string) => v.replace(/\s+/g, '');

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = RAW;
  document.head.appendChild(style);
  if (!style.sheet || style.sheet.cssRules.length === 0) throw new Error('motion.css did not parse');
});
afterEach(() => document.documentElement.removeAttribute('data-mudavym-ground'));

const root = () => getComputedStyle(document.documentElement);

describe('motion tokens', () => {
  it('resolve on :root with the specified curves and durations', () => {
    expect(squash(root().getPropertyValue('--ease-house'))).toBe('cubic-bezier(0.16,1,0.3,1)');
    expect(squash(root().getPropertyValue('--ease-sheet'))).toBe('cubic-bezier(0.32,0.72,0,1)');
    expect(squash(root().getPropertyValue('--ease-exit'))).toBe('cubic-bezier(0.4,0,1,1)');
    expect(root().getPropertyValue('--dur-hover').trim()).toBe('160ms');
    expect(root().getPropertyValue('--dur-press').trim()).toBe('90ms');
    expect(root().getPropertyValue('--dur-pill').trim()).toBe('220ms');
    expect(root().getPropertyValue('--dur-collapse').trim()).toBe('280ms');
    expect(root().getPropertyValue('--dur-glide').trim()).toBe('520ms');
    expect(root().getPropertyValue('--ease-glide').trim()).toMatch(/^linear\((?:[\d.]+,\s*){11}1\)$/);
  });

  it('are the same in the charcoal ground', () => {
    document.documentElement.setAttribute('data-mudavym-ground', 'charcoal');
    expect(squash(root().getPropertyValue('--ease-house'))).toBe('cubic-bezier(0.16,1,0.3,1)');
    expect(root().getPropertyValue('--dur-pill').trim()).toBe('220ms');
  });
});

describe('what animates', () => {
  it('never transitions "all", and only touches compositor or grid-row properties', () => {
    expect(CSS).not.toMatch(/transition:\s*all/);
    expect(CSS).not.toMatch(/transition-property:\s*all/);
    const props = [...CSS.matchAll(/transition:\s*([^;]+);/gs)].flatMap((m) =>
      m[1].split(',').map((t) => t.trim().split(/\s+/)[0]),
    );
    const allowed = new Set([
      'none', 'transform', 'scale', 'opacity', 'grid-template-rows', 'width', 'color', 'background-color', 'border-color', 'box-shadow',
    ]);
    for (const p of props) expect(allowed.has(p), p).toBe(true);
  });

  it('has a reduced-motion tier that removes translate, scale and the blur', () => {
    const reduce = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('.mdv-pill__thumb { transition: none; }');
    expect(reduce).toContain('.mdv-collapse { transition: none; }');
    expect(reduce).toMatch(/\.mdv-press:active[^{]*\{[^}]*transform: none/);
    expect(reduce).toMatch(/backdrop-filter: none/);
    expect(reduce).toMatch(/var\(--dur-fade\) linear/);
  });

  it('keeps the press at .98 in 90 ms ease-in and the lift at 1 px', () => {
    expect(CSS).toMatch(/\.mdv-press:active[^{]*\{[^}]*scale\(0\.98\)/);
    expect(CSS).toMatch(/transition-duration:\s*var\(--dur-press\)/);
    expect(CSS).toMatch(/translateY\(-1px\)/);
    expect(CSS).toMatch(/translateX\(4px\)/);
  });
});

describe('the pill on a phone and on the charcoal ground', () => {
  it('never wider than its column, and tighter below 480 px', () => {
    expect(CSS).toMatch(/\.mdv-pill \{[^}]*max-width:\s*100%/s);
    expect(CSS).toMatch(/@media \(max-width: 480px\)\s*\{\s*\.mdv-pill \.mdv-pill__opt \{ padding-left: 8px; padding-right: 8px; \}/);
  });

  it('lets the team headline shrink to the phone column so the lens pill cannot widen the page', () => {
    const team = readFileSync(join(__dirname, '../pages/team/next/team-next.css'), 'utf8');
    expect(team).toMatch(/\.tm-headline \{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  });

  it('writes the chosen label in the ground ink on charcoal (white on the light seal is 2.5:1)', () => {
    expect(CSS).toMatch(/\.mudavym\[data-ground='charcoal'\] \.mdv-pill__opt\[aria-pressed='true'\]/);
    expect(CSS).toMatch(/html\[data-mudavym-ground='charcoal'\] \.mudavym:not\(\[data-ground\]\) \.mdv-pill__opt\[aria-selected='true'\] \{ color: var\(--paper-0/);
  });
});

describe('the press on every other control', () => {
  it('scales to .98 in 90 ms on :active, except disabled controls and .mdv-press', () => {
    const rule = CSS.match(/\.mudavym :is\(button[^{]*\):active:not\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain(':disabled');
    expect(rule![1]).toContain('.mdv-press');
    expect(squash(rule![2])).toContain('scale:0.98');
    expect(squash(rule![2])).toContain('transition:scalevar(--dur-press)var(--ease-press)');
  });

  it('uses the scale property (never transform) and a zero-specificity base', () => {
    const base = CSS.match(/:where\(\.mudavym\) :where\(button[^{]*\)\s*\{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(squash(base![1])).toContain('transition-property:scale');
    expect(CSS).not.toMatch(/\.mudavym :is\(button[^{]*\):active[^{]*\{[^}]*transform/);
  });

  it('drops the scale under reduced motion', () => {
    const reduce = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(squash(reduce)).toMatch(/:active:not\([^)]*\)\{scale:none;\}/);
  });
});
