/**
 * The sheet's stylesheet carries the look the critic asked for (round 3,
 * need 6). jsdom does not apply CSS, so the numbers are pinned in the source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'data-terms-sheet.css'), 'utf8');

describe('data-terms-sheet.css', () => {
  it('blurs the page behind the sheet by 12 px, standard and prefixed', () => {
    expect(css).toMatch(/\.mdv-ovl:has\(\.dt-sheet\) \.mdv-ovl__scrim[^}]*backdrop-filter:\s*blur\(12px\)/s);
    expect(css).toMatch(/-webkit-backdrop-filter:\s*blur\(12px\)/);
  });

  it('speaks the summary in 16 px sans, not mono', () => {
    const contract = css.match(/\.dt-sheet \.mdv-ovl__contract\s*\{([^}]*)\}/s)![1];
    expect(contract).toMatch(/font-size:\s*16px/);
    expect(contract).toMatch(/DM Sans/);
    expect(contract).not.toMatch(/mono/);
  });

  it('animates only transform, and never transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/);
    const props = [...css.matchAll(/transition:\s*([a-z-]+)/g)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(p).toBe('transform');
  });

  it('turns the chevron motion off for reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.dt-fold__chev\s*\{\s*transition:\s*none/s);
  });
});
