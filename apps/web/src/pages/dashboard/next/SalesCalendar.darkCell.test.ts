/**
 * c3 need 19: on the charcoal ground an empty calendar square must read as a
 * square. The ground is a token both the squares and the legend's first step
 * wear, so the legend cannot disagree with the grid.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'dashboard-next.css'), 'utf8');

/** The declaration block of the first rule whose selector text includes `sel`. */
function block(sel: string): string {
  const at = css.indexOf(sel);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('calendar empty square on charcoal (c3 need 19)', () => {
  it('sets the empty ground to oklch(0.22 0.01 70) under the charcoal ground', () => {
    const b = block('[data-ground="charcoal"] :is(.dn-cal-grid, .dn-cal-legend)');
    expect(b).toContain('--dn-cell-empty: oklch(0.22 0.01 70)');
  });
  it('the square and the legend step both read that token', () => {
    expect(block('.dn-cell {')).toContain('background: var(--dn-cell-empty, var(--paper-1))');
    expect(block('.dn-cal-legend__step {')).toContain('background: var(--dn-cell-empty, var(--paper-1))');
  });
  it('the weekday heads are at the 11 px floor', () => {
    const tsx = readFileSync(resolve(__dirname, 'SalesCalendar.tsx'), 'utf8');
    expect(tsx).not.toMatch(/pb-1 text-center text-\[10px\]/);
  });
});
