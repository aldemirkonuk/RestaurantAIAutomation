/**
 * The header may never print a nameless page.
 *
 * `PAGE_NAMES` is typed `Record<MudavymPage, string>`, so a slug added to
 * `MUDAVYM_PAGES` without a name fails `tsc`. That is a good guard and it is
 * not the whole guard: `tsc` is a separate job from the test run, a `Record`
 * says nothing about the VALUE (an empty string, or a whitespace placeholder,
 * type-checks perfectly), and `pageNameFor` — not the map — is what the header
 * actually calls. So the parity is asserted at runtime too, per slug, and the
 * name is required to be a real word rather than merely present. Absence
 * reported as health (ADR 0020) is exactly what a blank header name would be.
 */

import { describe, it, expect } from 'vitest';
import { MUDAVYM_PAGES } from './useMudavymDesign';
import { PAGE_NAMES, NO_CHROME, pageNameFor } from './pageNames';

describe('every rebuilt page has a name to print', () => {
  it.each(MUDAVYM_PAGES)('%s has a PAGE_NAMES entry that is a real word', (page) => {
    expect(Object.prototype.hasOwnProperty.call(PAGE_NAMES, page)).toBe(true);
    const name = PAGE_NAMES[page];
    expect(typeof name).toBe('string');
    expect(name.trim()).not.toBe('');
    // A name, not a title-cased slug echoed back at the reader.
    expect(name).not.toContain('_');
  });

  it.each(MUDAVYM_PAGES)('%s resolves through pageNameFor, the header’s own call', (page) => {
    expect(pageNameFor(page, null).trim()).not.toBe('');
  });

  it('names nothing that is not a page', () => {
    expect(Object.keys(PAGE_NAMES).sort()).toEqual([...MUDAVYM_PAGES].sort());
  });

  it('names the chrome-free escapes too, so the list stays a decision not a gap', () => {
    for (const page of NO_CHROME) {
      expect(MUDAVYM_PAGES).toContain(page);
      expect(PAGE_NAMES[page].trim()).not.toBe('');
    }
  });

  /**
   * One slug, eight routes (App.tsx:318-324): `/wines` is not "Cellar". The
   * route-aware branch is the reason `pageNameFor` exists at all.
   */
  it('lets the route name the cellar family', () => {
    expect(pageNameFor('cellar', '/cellar')).toBe('Cellar');
    expect(pageNameFor('cellar', '/wines')).toBe('Wines');
    expect(pageNameFor('cellar', '/soft-drinks')).toBe('Soft drinks');
    // An unmapped route falls back to the slug's own name, never to blank.
    expect(pageNameFor('cellar', '/cellar/anything-else')).toBe('Cellar');
  });
});
