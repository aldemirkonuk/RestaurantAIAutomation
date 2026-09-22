/**
 * ADR 0134, round 6 answers, locked by the founder 2026-09-21 ("Lock all four (Recommended)").
 * The CSS halves of §4, §5, §8 and §9 — read from the stylesheets themselves,
 * because jsdom neither lays out nor cascades, so a render cannot see them.
 *
 *   §4  the palette does not animate its filtering (`.mdv-list-still`)
 *   §5  the house hint arrives on `ink` 160, and not at all under reduced motion
 *   §5a / §8  the reduced-motion guard's stylesheet, and that both surfaces load it
 *   §9  the chip's 24px target is its own, not Tailwind preflight's
 *
 * Each assertion below was mutated in the source it reads and seen to fail
 * (ADR 0134, "Round 6 answers — locked 2026-09-21").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ink } from '../../lib/mudavym/motion';

const DIR = __dirname;
const read = (rel: string) => readFileSync(join(DIR, rel), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Block {
  prelude: string;
  body: string;
}

/** Top-level blocks of a stylesheet (or of an at-rule's body), braces balanced. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const k = part.indexOf(':');
    if (k === -1) continue;
    out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return out;
}

/** The one top-level rule whose prelude is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const hits = blocks(stripComments(css)).filter((b) => b.prelude === selector);
  expect(hits, `exactly one top-level "${selector}" rule`).toHaveLength(1);
  return decls(hits[0].body);
}

const px = (v: string) => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  if (!m) throw new Error(`not a px length: "${v}"`);
  return Number(m[1]);
};

describe('§9 — the chip is a 24px target by itself', () => {
  it('declares its own line-height, and its box is at least 24px tall', () => {
    const chip = rule(read('sheet.css'), '.mdv-chip');
    expect(chip['line-height'], '.mdv-chip must not inherit its line-height').toBeDefined();
    const lineHeight = Number(chip['line-height']);
    expect(Number.isFinite(lineHeight), 'a unitless line-height, so it scales with the chip').toBe(true);

    const fontSize = px(chip['font-size']);
    const padY = px(chip.padding.split(/\s+/)[0]);
    const border = px(chip.border.split(/\s+/)[0]);
    const height = fontSize * lineHeight + 2 * padY + 2 * border;
    // 11 x 1.5 + 6 + 2 = 24.5 — SC 2.5.8's 24 CSS px, with the chip's own numbers.
    expect(height).toBeGreaterThanOrEqual(24);
  });
});

describe('§4 — the palette does not animate its filtering', () => {
  it('a row inside .mdv-list-still has no transition', () => {
    const still = rule(read('sheet.css'), '.mdv-list-still .mdv-item');
    expect(still.transition).toBe('none');
  });
});

describe('§5(b) — the house hint arrives on `ink`, in CSS', () => {
  const css = stripComments(read('sheet.css'));

  it('names its animation only when the reader has not asked for less', () => {
    // Nothing on the bare rule: under reduced motion there is no animation at all.
    expect(rule(css, '.mdv-hint').animation).toBeUndefined();

    const media = blocks(css).filter(
      (b) => b.prelude === '@media (prefers-reduced-motion: no-preference)',
    );
    const inner = media.flatMap((m) => blocks(m.body)).filter((b) => b.prelude === '.mdv-hint');
    expect(inner).toHaveLength(1);
    const [name, duration, ...curve] = decls(inner[0].body).animation.split(/\s+/);
    expect(name).toBe('mdv-hint-in');
    // The token, not a lookalike: its duration and its curve, from motion.ts.
    expect(duration).toBe(`${ink.ms}ms`);
    expect(curve.join(' ')).toBe(ink.easing);
  });

  it('moves 4px along the rail and fades in, and ends with no transform', () => {
    const kf = blocks(css).filter((b) => b.prelude === '@keyframes mdv-hint-in');
    expect(kf).toHaveLength(1);
    const steps = Object.fromEntries(blocks(kf[0].body).map((b) => [b.prelude, decls(b.body)]));
    expect(steps.from).toEqual({ opacity: '0', transform: 'translateX(-4px)' });
    expect(steps.to).toEqual({ opacity: '1', transform: 'none' });
  });
});

describe('§5(a) and §8 — the reduced-motion guard stylesheet', () => {
  it('removes every transition and animation under the attribute, and only under reduced motion', () => {
    const css = stripComments(read('reduced-motion.css'));
    const top = blocks(css);
    expect(top).toHaveLength(1);
    expect(top[0].prelude).toBe('@media (prefers-reduced-motion: reduce)');
    const inner = blocks(top[0].body);
    expect(inner).toHaveLength(1);
    const selectors = inner[0].prelude.split(',').map((s) => s.trim());
    expect(selectors).toEqual(
      expect.arrayContaining([`[data-reduced-motion='true']`, `[data-reduced-motion='true'] *`]),
    );
    expect(decls(inner[0].body)).toEqual({
      transition: 'none !important',
      animation: 'none !important',
    });
  });

  it('is loaded by both surfaces that set the attribute, each on its own', () => {
    const sidebar = read('../layout/Sidebar.tsx');
    const inventory = read('../../pages/inventory/command/InventoryCommandPage.tsx');
    expect(sidebar).toContain(`import '../mudavym/reduced-motion.css'`);
    expect(inventory).toContain(`import "../../../components/mudavym/reduced-motion.css"`);
    expect(sidebar).toContain(`data-reduced-motion={reduced ? 'true' : undefined}`);
    expect(inventory).toContain(`data-reduced-motion={reducedMotion ? "true" : undefined}`);
  });
});
