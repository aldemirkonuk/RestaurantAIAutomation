/**
 * The cocktail register's controls are 44 px at a phone or on a touch screen (r109 drinks-4, walk N3):
 * the action row was 30 px tall (Export 36 px) and the two filter labels 16 px. CSS-text pins, as the
 * recipe sheet's tick beside them; the heights and the CLS are measured by the walk on a production build.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
const tsx = readFileSync(resolve(__dirname, 'CocktailRegister.tsx'), 'utf8');
const touch = css.match(/@media \(max-width: 719px\), \(pointer: coarse\) \{\s*\.cl-cocktails \.cl-btn,[\s\S]*?\n\}\n/)?.[0] ?? '';

describe('the register is scoped, and its buttons and labels are 44 px on touch', () => {
  it('the register root carries the scope class', () => {
    expect(tsx).toMatch(/<div className="cl-cocktails" data-testid="cocktail-register"/);
  });

  it('every .cl-btn and the Export button are 44 px at <=719px or a coarse pointer', () => {
    expect(touch).toMatch(/\.cl-cocktails \.cl-btn,\s*\.cl-cocktails \.cl-strip button \{ min-height: 44px; \}/);
  });

  it('the two filter labels are 44 px tall and give back the height their line already had', () => {
    const rule = touch.match(/\.cl-cocktails \.cl-norecipe-room label \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/min-height: 44px;/);
    expect(rule).toMatch(/margin-block: calc\(\(1lh - 44px\) \/ 2\);/);
  });

  it('the rooms held from first paint rise with the controls, a phone first', () => {
    expect(touch).toMatch(/\.cl-strip \{ min-height: 44px; \}/);
    expect(touch).toMatch(/\.cl-loose-room \{ min-height: 44px; \}/);
    const phone = css.match(/@media \(max-width: 640px\) \{\s*\.cl-strip \{ min-height: 92px; \}[^}]*\}\s*\}/)?.[0] ?? '';
    expect(phone).toMatch(/\.cl-loose-room \{ min-height: calc\(1lh \+ 44px\); \}/);
  });

  it('moves nothing and animates nothing', () => {
    const phone = css.match(/@media \(max-width: 640px\) \{\s*\.cl-strip \{ min-height: 92px; \}[^}]*\}\s*\}/)?.[0] ?? '';
    expect(touch + phone).not.toMatch(/transition|animation|opacity/);
  });
});
