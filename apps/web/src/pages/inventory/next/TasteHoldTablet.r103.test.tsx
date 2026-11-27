/**
 * r103: the held foot slot matches the answered foot line at every width it is shown. The answered
 * line's button is 44 px under `(max-width: 767px), (pointer: coarse)` (taste-card.css), so a 23 px
 * hold under-sized every tablet and the 641-767 px one-column drawer. jsdom has no layout: the rules
 * are read from the stylesheet, including their order (the collapsing rule must still come last).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const t = readFileSync(resolve(__dirname, 'taste-card.css'), 'utf8');

describe('the foot hold is 44 px where the answered foot line is (r103)', () => {
  it('a coarse pointer or a narrow sheet holds 44 px, in the same query as the button', () => {
    const q = '@media (max-width: 767px), (pointer: coarse) {';
    expect(t.split(q).length - 1).toBeGreaterThanOrEqual(2); // the button's block and the hold's block
    expect(t).toMatch(/\(pointer: coarse\) \{\s*\.tc-line--foot\.tc-line--hold \{\s*min-height: 44px;\s*max-height: 44px;/);
  });
  it('the 44 px rule sits before the collapsing rule, so the give-back still wins', () => {
    expect(t.indexOf('min-height: 44px;\n    max-height: 44px;\n  }\n}\n.tc-line--hold {')).toBeGreaterThan(-1);
    expect(t.indexOf("[data-collapsing='true']")).toBeGreaterThan(t.indexOf('.tc-line--foot.tc-line--hold {\n    min-height: 44px'));
  });
});
