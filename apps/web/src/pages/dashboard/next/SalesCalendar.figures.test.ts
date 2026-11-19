/**
 * c3 need 19 (remainder): the calendar's $ figures are 11 px tabular where
 * drawn, and a square under 44 px wide leaves them to its tooltip.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'dashboard-next.css'), 'utf8');
const block = (sel: string): string => {
  const at = css.indexOf(sel);
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

describe('calendar figures at the 11 px floor (c3 need 19)', () => {
  it('the figure is tabular and the phone size is 11 px, not 10', () => {
    expect(block('.dn-cell-fig {')).toContain('font-variant-numeric: tabular-nums');
    expect(block('  .dn-cell-fig {')).toContain('font-size: 11px');
  });
  it('a tooltip-mode grid hides the figure and its words', () => {
    const b = block(".dn-cal-grid[data-fig='tooltip']");
    expect(b).toContain('display: none');
  });
  it('animates no forbidden property on the cell', () => {
    expect(css).not.toMatch(/transition:\s*all/);
  });
});
