/**
 * r110 menu-6: the 44 px floor at 375 for the controls the r109 walk still found short:
 * the add form's fields (30 px), the version's Menu date (19), the review screen's buttons
 * (20-28) and the held file's Change / Clear (18). Static, like the rest of the 44 px rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
/** The @media (max-width: 599px) block that holds `needle`, wherever later blocks land. */
function narrowBlock(css: string, needle: string): string {
  const at = css.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  const start = css.lastIndexOf('@media (max-width: 599px)', at);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}\n', at));
}

describe('the 44 px floor on a phone (r110 menu-6)', () => {
  it('the add form fields and the Menu date carry the touch-field class, and the rule gives them 44 px', () => {
    const next = read('src/pages/menu/next/MenuNext.tsx');
    expect(next.match(/id="menu-add-(name|category|glass|bottle)"/g)).toHaveLength(4);
    for (const id of ['name', 'category', 'glass', 'bottle']) {
      const at = next.indexOf(`id="menu-add-${id}"`);
      expect(next.slice(at, at + 400)).toMatch(/mdv-touch-field/);
    }
    expect(read('src/pages/menu/next/MenuVersions.tsx')).toMatch(/className="mdv-touch-field" aria-label="Menu date"/);
    const rule = narrowBlock(read('src/pages/menu/next/menu-rows.css'), '.mdv-touch-field');
    expect(rule).toContain('min-height: 44px');
    expect(rule).not.toMatch(/transition|animation/);
  });

  it("the held file's Change, Clear and Add pages are 44 px under 600 px", () => {
    const rule = narrowBlock(read('src/components/mudavym/drop-zone.css'), '.mdv-drop__acts .mdv-link');
    expect(rule).toContain('min-height: 44px');
    expect(rule).not.toMatch(/transition|animation/);
  });

  it('the review screen buttons and field chips carry the phone floor', () => {
    const src = read('src/components/onboarding/MenuReviewScreen.tsx');
    for (const needle of ['more look good', 'Add a wine', 'Skip review']) {
      const at = src.indexOf(needle);
      expect(at).toBeGreaterThan(-1);
      // The button that holds the words: from its own <button to the words, no further back.
      expect(src.slice(src.lastIndexOf('<button', at), at)).toMatch(/max-sm:min-h-\[44px\]/);
    }
    expect(src).toMatch(/disabled:opacity-50 max-sm:min-h-\[44px\]/);
  });
});
