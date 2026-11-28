/**
 * The phone list's cards and the drawer's held reads, as stylesheet facts (r106 g3; ADR 0112, MOTIONS.md).
 * jsdom runs no animations, so the CSS and the stagger constant are what is read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(`src/pages/inventory/next/${f}`, 'utf8');
const list = read('inventory-next.css');
const drawer = read('item-drawer.css');
const rule = (css: string, sel: string): string => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`no rule ${sel}`);
  return css.slice(i, css.indexOf('}', i));
};

describe('phone cards land inside 400 ms', () => {
  const card = rule(list, '.ivc-card');
  const dur = Number(/animation: ivc-in (\d+)ms cubic-bezier\(0\.2, 0\.7, 0\.2, 1\) both/.exec(card)?.[1]);
  const step = Number(/animation-delay: calc\(var\(--i, 0\) \* (\d+)ms\)/.exec(card)?.[1]);
  const cap = Number(/const STAGGER_CARDS = (\d+);/.exec(read('PhoneRows.tsx'))?.[1]);

  it('is 200 ms with an 18 ms step, capped at 6 cards', () => {
    expect(dur).toBeLessThanOrEqual(200);
    expect(step).toBe(18);
    expect(cap).toBe(6);
  });
  it('the last card ends by 400 ms (duration + cap x step)', () => {
    expect(dur + cap * step).toBeLessThanOrEqual(400);
  });
  it('moves transform and opacity only, and reduced motion is animation none', () => {
    const frames = list.slice(list.indexOf('@keyframes ivc-in'), list.indexOf('}', list.indexOf('@keyframes ivc-in') + 60));
    expect(frames).toMatch(/opacity: 0;\s*transform: translateY\(6px\)/);
    expect(frames).not.toMatch(/height|margin|top|left/);
    const reduced = list.slice(list.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.iv-page \*,[\s\S]*animation: none !important/);
  });
});

describe('a read that has not answered holds its height and moves nothing', () => {
  it('each held read has a min-height equal to what it becomes', () => {
    expect(rule(drawer, ".ivd-hold[data-hold='used'],\n.ivd-hold[data-hold='dishes']")).toMatch(/min-height: 52px/);
    expect(rule(drawer, ".ivd-hold[data-hold='nutrition']")).toMatch(/min-height: 156px/);
  });
  it('pulses on iv-skel-pulse and stops under reduced motion (no fade either)', () => {
    expect(rule(drawer, '.ivd-hold .iv-skel-bar')).toContain('animation: iv-skel-pulse 1.4s ease-in-out infinite');
    const reduced = drawer.slice(drawer.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ivd-hold \.iv-skel-bar \{\s*animation: none;/);
    expect(drawer.slice(drawer.indexOf('.ivd-hold {'))).not.toMatch(/transition/);
  });
  it('the three plain-text reading lines are gone from the drawer', () => {
    expect(read('ItemUsedIn.tsx')).not.toMatch(/<p className="iv-note">Reading/);
    expect(read('NutritionCard.tsx')).not.toMatch(/<p className="iv-note" data-testid="ivn">/);
    expect(read('ItemUsedIn.tsx').match(/<HeldReading/g)).toHaveLength(2);
    expect(read('NutritionCard.tsx')).toContain('<HeldReading');
  });
});
