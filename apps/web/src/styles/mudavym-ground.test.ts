/**
 * The decided ground must actually RESOLVE — in both app themes.
 *
 * Founder, 2026-09-12: "The `.mudavym` scope paints the decided ground
 * regardless of the light/dark toggle." A CSS change that reads correctly in
 * the file and never wins the cascade is the absence-as-health fault, so this
 * test loads the SHIPPED stylesheets off disk (never a copy pasted here),
 * mounts scoped elements under `<html class="light">` and `<html class="dark">`
 * in turn, and asserts the computed custom-property values.
 *
 * It asserts the whole token SET, not just the ground: charcoal behind
 * light-mode ink is unreadable, so the ink tokens must move with it.
 *
 * What it cannot cover — stated so nobody reads a green here as more than it
 * is: jsdom resolves the cascade but paints nothing, so this proves the
 * VALUES, never the pixels. Author-order ties between separately-injected
 * Vite chunks are also out of reach; the rules are written to win on
 * specificity instead, and the paper-escape case below is the assertion of
 * that (0,2,0 over 0,1,0).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const MUDAVYM_CSS = join(ROOT, 'styles/mudavym.css');
const PAPER_ESCAPE_CSS = join(ROOT, 'pages/documents/next/canonical-document.css');

/** The ADR 0042 Warm Charcoal column — the decided ground and its companions. */
const CHARCOAL = {
  '--paper-0': '#15130F',
  '--paper-1': '#1D1813',
  '--paper-2': '#262019',
  '--ink-1': '#EFE7D9',
  '--ink-2': '#C0B6A5',
  '--ink-3': '#8E8576',
  '--ink-4': '#ABA294',
  '--seal': '#5FB0BC',
} as const;

/** The one escape: ADR 0104 D9, the sheet of paper. */
const PAPER = {
  '--paper-0': '#fffdf8',
  '--ink-1': '#211c16',
  '--seal': '#1a5e6b',
} as const;

function install(): void {
  const style = document.createElement('style');
  style.id = 'mudavym-under-test';
  style.textContent = [
    readFileSync(MUDAVYM_CSS, 'utf8'),
    readFileSync(PAPER_ESCAPE_CSS, 'utf8'),
  ].join('\n');
  document.head.appendChild(style);

  // Absence is not health: if jsdom silently dropped the sheet (a parse error,
  // an empty read), every assertion below would compare '' to '' and pass.
  const sheet = style.sheet;
  if (!sheet || sheet.cssRules.length === 0) {
    throw new Error(
      'mudavym stylesheets did not parse in jsdom — the assertions below would ' +
        'have been vacuous. Fix the harness, do not delete the test.'
    );
  }
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

function tokens(el: Element, names: readonly string[]): Record<string, string> {
  const cs = getComputedStyle(el);
  return Object.fromEntries(
    names.map((n) => [n, cs.getPropertyValue(n).trim()])
  );
}

function setAppTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
}

beforeAll(install);

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove('light', 'dark');
});

describe('the .mudavym scope paints the decided ground', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`resolves the full Warm Charcoal token set under the ${theme} app theme`, () => {
      setAppTheme(theme);
      const page = mount('<div class="mudavym"></div>');
      expect(tokens(page, Object.keys(CHARCOAL))).toEqual(CHARCOAL);
    });

    it(`resolves charcoal for an explicit data-ground under the ${theme} app theme`, () => {
      setAppTheme(theme);
      const page = mount('<div class="mudavym" data-ground="charcoal"></div>');
      expect(tokens(page, Object.keys(CHARCOAL))).toEqual(CHARCOAL);
    });
  }

  it('is identical in both themes — the toggle does not reach into the scope', () => {
    const names = Object.keys(CHARCOAL);
    setAppTheme('light');
    const inLight = tokens(mount('<div class="mudavym"></div>'), names);
    document.body.innerHTML = '';
    setAppTheme('dark');
    const inDark = tokens(mount('<div class="mudavym"></div>'), names);
    expect(inLight).toEqual(inDark);
  });

  it('leaves the ink legible: the companions moved with the ground', () => {
    setAppTheme('light');
    const page = mount('<div class="mudavym"></div>');
    const t = tokens(page, ['--paper-0', '--ink-1']);
    // Pin the pair, so this cannot pass by both tokens staying light together.
    expect(t['--paper-0']).toBe(CHARCOAL['--paper-0']);
    // 15.11:1 — the old light ink (#211C16) on this ground would be 1.05:1.
    expect(contrast(t['--ink-1'], t['--paper-0'])).toBeGreaterThan(7);
  });
});

describe('the one escape still escapes', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`data-ground="paper" keeps the light column under the ${theme} app theme`, () => {
      setAppTheme(theme);
      const sheet = mount('<div class="mudavym" data-ground="paper"></div>');
      expect(tokens(sheet, Object.keys(PAPER))).toEqual(PAPER);
    });
  }

  it('is declared in the GLOBALLY-imported stylesheet, not a lazy page chunk', () => {
    // The block used to live in pages/documents/next/canonical-document.css,
    // which only CanonicalDocumentPage imports and App.tsx lazy-loads. The
    // tests above could not see that: `install()` reads both files off disk and
    // concatenates them, so the escape resolved here while being absent from
    // every route but one — providers/next/TwinSheet asked for paper and got
    // charcoal. Pin where it is declared, not just that it resolves.
    expect(readFileSync(MUDAVYM_CSS, 'utf8')).toMatch(
      /\.mudavym\[data-ground=["']paper["']\]/
    );
    expect(readFileSync(PAPER_ESCAPE_CSS, 'utf8')).not.toMatch(/--paper-0\s*:/);
  });

  it('escapes even nested inside a charcoal page — declared, not inherited', () => {
    setAppTheme('light');
    mount(
      '<div class="mudavym" data-ground="charcoal">' +
        '<article class="mudavym cd-sheet" data-ground="paper"></article>' +
        '</div>'
    );
    const sheet = document.querySelector('.cd-sheet') as HTMLElement;
    expect(tokens(sheet, Object.keys(PAPER))).toEqual(PAPER);
  });
});

/** WCAG 2.x relative-luminance contrast ratio. */
function contrast(a: string, b: string): number {
  const l = (hex: string) => {
    const h = hex.replace('#', '');
    const ch = [0, 2, 4]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [l(a), l(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
