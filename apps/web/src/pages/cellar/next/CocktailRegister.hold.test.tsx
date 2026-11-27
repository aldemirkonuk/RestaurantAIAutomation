/**
 * The cocktail list and the register nav hold their widths from first paint (r109 drinks-3, walk N2):
 * the Allergens column was 125 px until its sentences landed and then 170, and the spine nav was 122 px
 * until the readout landed and then 473, so the columns and the header's buttons moved (staff, 1440,
 * CLS 0.054 in 6 of 12 runs). CSS-text pins, as the nav's two-row pin beside them; the width itself is
 * measured by the walk on a production build.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
const tsx = readFileSync(resolve(__dirname, 'CocktailRegister.tsx'), 'utf8');

describe('the Allergens column holds 170 px from the header', () => {
  it('the head cell carries the class that holds the column', () => {
    expect(tsx).toMatch(/<th scope="col" className="cl-col-allergens">Allergens<\/th>/);
  });

  it('the class sets the width and the floor to 170 px, with no motion', () => {
    const rule = css.match(/\.cl-table--drinks th\.cl-col-allergens \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/width: 170px;/);
    expect(rule).toMatch(/min-width: 170px;/);
    expect(rule).not.toMatch(/transition|animation|opacity/);
  });
});

describe('the register nav holds its width above 640 px', () => {
  it('has a floor of 480 px, its buttons kept at the right edge, with no motion', () => {
    const block = css.match(/@media \(min-width: 641px\) \{\s*\.cl-spine-nav \{[^}]*\}\s*\}/)?.[0] ?? '';
    expect(block).toMatch(/min-width: 480px;/);
    expect(block).toMatch(/justify-content: flex-end;/);
    expect(block).not.toMatch(/transition|animation|opacity/);
  });

  it('the phone rule keeps its height and takes its own header row from first paint', () => {
    const block = css.match(/@media \(max-width: 640px\) \{\s*\.cl-spine-nav \{[^}]*\}\s*\}/)?.[0] ?? '';
    expect(block).toMatch(/min-height: 64px;/);
    // Without its own row the nav sits beside the wordmark while one register is listed, then wraps below it
    // when the house's set lands: the header grows 64 to 100 px (walk r100 N1).
    expect(block).toMatch(/flex-basis: 100%;/);
    expect(block).not.toMatch(/transition|animation|opacity/);
  });
});
