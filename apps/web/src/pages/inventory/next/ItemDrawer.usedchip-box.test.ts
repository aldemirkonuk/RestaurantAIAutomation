/**
 * The held "Used in" chip and the real one must take the same box (r108-7a).
 * jsdom has no layout, so this pins the rule that gives them one: both are
 * block-level with a 44 px minimum height (so wrapped text at 200% size grows
 * instead of overlapping), never inline-flex on the text baseline.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/pages/inventory/next/item-drawer.css'), 'utf8');

const rule = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.ivd-usedchip\s*\{([^}]*)\}/) ?? [])[1] ?? '';

describe('the Used in chip box', () => {
  it('is block-level, so an empty held chip and a text one stand on the same line box', () => {
    expect(rule).toMatch(/display:\s*flex;/);
    expect(rule).not.toMatch(/inline-flex/);
  });
  it('has a 44 px minimum, not a fixed height a wrapped line can overflow (WCAG 1.4.4)', () => {
    expect(rule).toMatch(/min-height:\s*44px;/);
    expect(rule).not.toMatch(/(^|[;\s])height:/);
  });
  it('the empty held chip carries the same class, so it takes the same minimum', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/pages/inventory/next/ItemDrawer.tsx'), 'utf8');
    expect(tsx).toMatch(/className="ivd-usedchip ivd-usedchip--held"/);
    expect(css).not.toMatch(/\.ivd-usedchip--held\s*\{[^}]*\bheight:/);
  });
});
