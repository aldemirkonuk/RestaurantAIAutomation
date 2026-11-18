/**
 * The house's token layer (design critic N-10): one seal ramp, three papers,
 * no alias palettes, tinted shadows, and no `transition-all` that was not
 * already there. Reads the shipped CSS and the Tailwind config off disk.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error the config is plain JS with no declaration file
import tailwind from '../../tailwind.config.js';

const HERE = __dirname;
const SRC = join(HERE, '..');
const TOKENS = readFileSync(join(HERE, 'house-tokens.css'), 'utf8');
const MUDAVYM = readFileSync(join(HERE, 'mudavym.css'), 'utf8');
const colors = (tailwind as any).theme.extend.colors as Record<string, Record<string, string>>;

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const LIGHTNESS = [0.96, 0.92, 0.86, 0.78, 0.7, 0.58, 0.47, 0.4, 0.33, 0.26, 0.2];

function cssRamp(): { l: number; c: number; h: number }[] {
  return STOPS.map((k) => {
    const m = TOKENS.match(new RegExp(`--seal-${k}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
    if (!m) throw new Error(`--seal-${k} missing from house-tokens.css`);
    return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
  });
}

describe('one seal ramp', () => {
  it('has eleven OKLCH stops at the doctrine lightnesses, chroma at most .09, hue 210', () => {
    const r = cssRamp();
    expect(r.map((s) => s.l)).toEqual(LIGHTNESS);
    for (const s of r) {
      expect(s.c).toBeLessThanOrEqual(0.09);
      expect(s.h).toBe(210);
    }
  });

  it('is the same ramp in Tailwind: wine-* and seal-* numeric stops equal the CSS tokens', () => {
    const r = cssRamp();
    STOPS.forEach((k, i) => {
      const want = `oklch(${r[i].l} ${r[i].c} ${r[i].h} / <alpha-value>)`;
      expect(colors.wine[String(k)]).toBe(want);
      expect(colors.seal[String(k)]).toBe(want);
    });
  });
});

describe('three papers, no alias palettes', () => {
  it('Tailwind paper fallbacks equal the light-ground tokens in mudavym.css', () => {
    for (const k of ['0', '1', '2']) {
      const css = MUDAVYM.match(new RegExp(`--paper-${k}:\\s*(#[0-9a-f]{6});`, 'i'))![1].toLowerCase();
      const fallback = colors.paper[k].match(/#[0-9a-f]{6}/i)![0].toLowerCase();
      expect(fallback).toBe(css);
    }
  });

  it('the warm surface and neutral steps reuse the three papers instead of minting more whites', () => {
    const papers = new Set(
      ['0', '1', '2'].map((k) => colors.paper[k].match(/#[0-9a-f]{6}/i)![0].toLowerCase()),
    );
    const warm = [
      colors.surface.secondary,
      colors.surface.tertiary,
      colors.slate['25'],
      colors.slate['50'],
      colors.slate['100'],
      colors.gray['50'],
      colors.gray['100'],
    ].map((v) => v.toLowerCase());
    for (const v of warm) expect(papers.has(v)).toBe(true);
  });

  it('brand, yellow and danger are gone from the theme and from every class list', () => {
    for (const name of ['brand', 'yellow', 'danger']) expect(colors[name]).toBeUndefined();
    const offenders: string[] = [];
    const re = /\b(bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|shadow)-(brand|yellow|danger)-\d/;
    for (const f of walk(SRC)) {
      if (!/\.(tsx?|css)$/.test(f) || f.endsWith('house-tokens.test.ts')) continue;
      if (re.test(readFileSync(f, 'utf8'))) offenders.push(relative(SRC, f));
    }
    expect(offenders).toEqual([]);
  });
});

describe('tinted shadows', () => {
  const shadows = (tailwind as any).theme.extend.boxShadow as Record<string, string>;
  it('no Tailwind shadow is pure black, and the ring is the seal, not blue', () => {
    for (const [k, v] of Object.entries(shadows)) expect(v, k).not.toMatch(/rgb\(0 0 0/);
    expect(shadows.ring).not.toMatch(/59 130 246/);
  });
  it('the four levels are tinted, and charcoal swaps each for a 1 px hairline', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(TOKENS).toMatch(new RegExp(`--shadow-${n}:[^;]*oklch\\(0\\.2[^;]*80`));
    }
    expect(TOKENS).toMatch(/data-mudavym-ground="charcoal"\][\s\S]*--shadow-4: 0 0 0 1px oklch\(1 0 0 \/ 0\.06\)/);
  });
});

describe('corner doctrine', () => {
  it('names card 20, control 12, chip full, sheet 28 once, in CSS and Tailwind', () => {
    expect(TOKENS).toContain('--r-card: 20px');
    expect(TOKENS).toContain('--r-control: 12px');
    expect(TOKENS).toContain('--r-chip: 9999px');
    expect(TOKENS).toContain('--r-sheet: 28px');
    const r = (tailwind as any).theme.extend.borderRadius;
    expect([r.card, r.control, r.sheet]).toEqual(['1.25rem', '0.75rem', '1.75rem']);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * `transition-all` animates every property, including layout, and repaints on
 * hover for things that should not move. The count may only go down: a file
 * not in the baseline may not use it, and a file in it may not use it more.
 * When you fix a file, lower or delete its line in transition-all.baseline.json.
 */
describe('transition-all ratchet', () => {
  const baseline: Record<string, number> = JSON.parse(
    readFileSync(join(HERE, 'transition-all.baseline.json'), 'utf8'),
  );
  const found: Record<string, number> = {};
  for (const f of walk(SRC)) {
    if (!/\.(tsx?|css)$/.test(f) || /\.test\.|house-tokens/.test(f)) continue;
    const n = (readFileSync(f, 'utf8').match(/transition-all|transition:\s*all\b/g) ?? []).length;
    if (n) found[relative(SRC, f)] = n;
  }

  it('no file uses transition-all more than the baseline allows', () => {
    const over = Object.entries(found).filter(([f, n]) => n > (baseline[f] ?? 0));
    expect(over).toEqual([]);
  });
});
