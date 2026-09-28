/**
 * Charcoal-ground headings must carry their OWN ink token.
 *
 * globals.css sets `h1`/`h2`/`p` directly on the element (globals.css:129-136
 * for the headings, :157 for `p`) — a declaration on the element itself beats
 * anything a `.mudavym` ancestor only resolves as a custom property, so any
 * heading or paragraph in this stylesheet with no `color` of its own renders
 * dark-on-dark against the decided Warm Charcoal ground (ADR 0042): `.rc-title`
 * and the two bare `h2` rules measured 1.07:1 and 1.02:1 in a real browser
 * render (see the lane scratchpad's before/after capture); CatalogView's
 * expanded detail (`.rc-said` wrapping bare `<p>` tags, CatalogView.tsx:255-273)
 * measured 2.47:1 for the same reason one level down — `.rc-said` sets color
 * on itself, but that does not reach a child `<p>` once globals.css's `p`
 * rule matches it directly.
 *
 * This test reads the SHIPPED stylesheet off disk (never a copy pasted here,
 * mirroring styles/mudavym-ground.test.ts) and asserts each selector's
 * DECLARED `color`, not a resolved computed value — jsdom paints nothing, so
 * this proves the rule text carries the token, never the pixels. The real
 * pixels are the harness capture (must_fix #3), not this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const CSS_PATH = join(__dirname, 'rec-next.css');

let sheet: CSSStyleSheet;

function install(): void {
  const style = document.createElement('style');
  style.id = 'rec-next-under-test';
  style.textContent = readFileSync(CSS_PATH, 'utf8');
  document.head.appendChild(style);
  const installed = style.sheet;
  // Absence is not health (see mudavym-ground.test.ts): if jsdom silently
  // dropped the sheet, every assertion below would find no rule and this
  // test would fail loud rather than pass vacuously.
  if (!installed || installed.cssRules.length === 0) {
    throw new Error(
      'rec-next.css did not parse in jsdom — the assertions below would ' +
        'have been vacuous. Fix the harness, do not delete the test.',
    );
  }
  sheet = installed;
}

/** The LAST rule with this exact selector text (later wins the cascade on a tie). */
function ruleFor(selectorText: string): CSSStyleRule {
  const rules = Array.from(sheet.cssRules) as CSSStyleRule[];
  const matches = rules.filter((r) => 'selectorText' in r && r.selectorText === selectorText);
  if (matches.length === 0) {
    throw new Error(`no rule found for selector ${JSON.stringify(selectorText)} in rec-next.css`);
  }
  return matches[matches.length - 1];
}

beforeAll(install);

describe('headings on the charcoal ground declare their own --ink-* token', () => {
  for (const selector of ['.rc-title', '.rc-section-head h2', '.rc-dayhead h2']) {
    it(`${selector} sets color to a var(--ink-*) token, not the inherited default`, () => {
      const rule = ruleFor(selector);
      expect(rule.style.color).toMatch(/^var\(--ink-\d/);
    });
  }
});

describe('CatalogView\'s expanded detail survives globals.css\'s bare `p` rule', () => {
  it('.rc-said p inherits the wrapper\'s ink instead of taking its own color', () => {
    const rule = ruleFor('.rc-said p');
    expect(rule.style.color.trim()).toBe('inherit');
  });

  it('.rc-said itself still declares an --ink-* token — inherit has to inherit something', () => {
    const rule = ruleFor('.rc-said');
    expect(rule.style.color).toMatch(/^var\(--ink-\d/);
  });
});

/**
 * Regression, found in verification 2026-09-19: giving `.rc-section-head h2`
 * (above) its own color fixed that selector's own contrast, but also gave it
 * specificity (0,1,1) — which beats a bare `.rc-dark-head` at (0,1,0). The one
 * heading the product deliberately renders dim (`.rc-dark-head`, "Change a
 * rule" — RecommendationsNext.tsx:817, comment at :806-810) sits inside a
 * `.rc-section-head`, so it silently re-brightened to the same ink-1 as every
 * other section head. Every check above passes in isolation — each reads one
 * selector's own declared color and never asks which rule wins when two of
 * them match the same element.
 *
 * This test builds the real nesting and lets the browser's own cascade decide
 * — `getComputedStyle`, not a hand-rolled specificity count. jsdom does not
 * resolve `var()` to a pixel color (confirmed against jsdom 29.1.1: it returns
 * the winning declaration's literal text), so the assertion checks which
 * *token* won, exactly as the tests above do.
 */
describe('the fifth heading (.rc-dark-head) wins its cascade against .rc-section-head h2', () => {
  it('renders the dim ink-4 token, not the section head\'s ink-1', () => {
    const wrap = document.createElement('div');
    wrap.className = 'rc-section-head';
    const h2 = document.createElement('h2');
    h2.className = 'rc-serif rc-dark-head';
    wrap.appendChild(h2);
    document.body.appendChild(wrap);
    try {
      expect(getComputedStyle(h2).color).toMatch(/^var\(--ink-4/);
    } finally {
      wrap.remove();
    }
  });
});
