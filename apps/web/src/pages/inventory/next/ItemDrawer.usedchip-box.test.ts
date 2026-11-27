/**
 * The held "Used in" chip and the real one must take the same box (r108-7a).
 * jsdom has no layout, so this pins the rule that gives them one: both are
 * block-level with a fixed height, never inline-flex on the text baseline.
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
  it('has a fixed 44 px height, not a minimum a line of text can exceed', () => {
    expect(rule).toMatch(/\bheight:\s*44px;/);
    expect(rule).not.toMatch(/min-height/);
  });
});
