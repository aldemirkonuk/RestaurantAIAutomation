/**
 * The charcoal ground reaches the page, the fields and the focus ring
 * (design critic N-01). Loads the SHIPPED stylesheet off disk, mounts elements
 * under `<html data-mudavym-ground="charcoal">` and asserts what resolves.
 * jsdom proves values, never pixels; the browser checks are in the PR body.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'ground-dark.css'), 'utf8');

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  if (!style.sheet || style.sheet.cssRules.length === 0) {
    throw new Error('ground-dark.css did not parse in jsdom; the assertions would be vacuous');
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-mudavym-ground');
});

function charcoal(on: boolean): void {
  if (on) document.documentElement.setAttribute('data-mudavym-ground', 'charcoal');
}
function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}
const prop = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

describe('charcoal ground, outside the shell', () => {
  it('html resolves the ground, the field tokens and the teal focus ring', () => {
    charcoal(true);
    const html = document.documentElement;
    expect(prop(html, '--ground')).toBe('oklch(0.17 0.01 70)');
    expect(prop(html, '--field-fill')).toBe('oklch(0.22 0.01 70)');
    expect(prop(html, '--field-ink')).toBe('#efe7d9');
    expect(prop(html, '--focus-ring')).toBe('oklch(0.72 0.09 205)');
    expect(prop(html, 'color-scheme')).toBe('dark');
  });

  it('a page outside .mudavym inherits the dark paper and ink tokens', () => {
    charcoal(true);
    const page = mount('<div class="page"></div>');
    expect(prop(page, '--paper-0')).toBe('#15130F');
    expect(prop(page, '--ink-1')).toBe('#EFE7D9');
  });

  it('paper declares none of it', () => {
    const html = document.documentElement;
    expect(prop(html, '--ground')).toBe('');
    expect(prop(html, '--focus-ring')).toBe('');
    mount('<div></div>');
    expect(prop(document.body, 'background-color')).not.toBe('var(--ground)');
  });

  it('body paints the ground', () => {
    charcoal(true);
    expect(getComputedStyle(document.body).backgroundColor).toBe('var(--ground)');
  });
});

describe('charcoal fields', () => {
  it('a text input, textarea and select take the dark fill and cream ink', () => {
    charcoal(true);
    for (const tag of ['<input type="text">', '<input type="email">', '<textarea></textarea>', '<select></select>']) {
      const el = mount(tag);
      expect(getComputedStyle(el).backgroundColor, tag).toBe('var(--field-fill)');
      expect(getComputedStyle(el).color, tag).toBe('var(--field-ink)');
    }
  });

  it('a checkbox is not given the field fill', () => {
    charcoal(true);
    const el = mount('<input type="checkbox">');
    expect(getComputedStyle(el).backgroundColor).not.toBe('var(--field-fill)');
  });

  it('paper leaves fields alone', () => {
    const el = mount('<input type="text">');
    expect(getComputedStyle(el).backgroundColor).not.toBe('var(--field-fill)');
  });
});

describe('charcoal chrome', () => {
  it('the tip strip and the palette card flip with the shell', () => {
    charcoal(true);
    const strip = mount('<div class="mdv-guidance-strip"></div>');
    const card = mount('<div class="mdv-palette-card"></div>');
    expect(getComputedStyle(strip).backgroundColor).toBe('var(--paper-1)');
    expect(getComputedStyle(card).backgroundColor).toBe('var(--paper-1)');
  });
});

describe('the focus ring rule', () => {
  it('is 2 px, offset 3 px, teal, and covers every interactive tag', () => {
    expect(CSS).toMatch(/outline:\s*2px solid var\(--focus-ring\)/);
    expect(CSS).toMatch(/outline-offset:\s*3px/);
    for (const t of ['a', 'button', 'input', 'select', 'textarea']) {
      expect(CSS).toMatch(new RegExp(`:is\\([^)]*\\b${t}\\b[^)]*\\):focus-visible`));
    }
  });
});

describe('the first-run pages carry no light-only colours', () => {
  // r60 walk: on charcoal, /get-started showed a white header, white role chips
  // holding cream text, and a near-black headline on the dark ground.
  for (const f of ['GetStarted', 'HouseMenu', 'HouseContents']) {
    it(`${f}.tsx uses the ground tokens, not white or fixed greys, and its headings name an ink`, () => {
      const src = readFileSync(join(__dirname, '..', 'pages', `${f}.tsx`), 'utf8');
      expect(src).not.toMatch(/\bbg-white\b/);
      expect(src).not.toMatch(/text-\[#6d685f\]|text-\[#b7b2a8\]/);
      for (const m of src.matchAll(/<h[12] className="([^"]*)"/g)) {
        expect(m[1]).toContain('text-inkm-1');
      }
    });
  }
});
