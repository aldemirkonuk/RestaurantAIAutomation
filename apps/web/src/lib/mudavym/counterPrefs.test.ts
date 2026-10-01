/**
 * "Open first, then remember" — the founder's width rule (2026-09-21),
 * narrowed to one choice for every page (founder, 2026-10-01).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  counterWidthFor,
  pageKeyOf,
  prefsKeyFor,
  readShellPrefs,
  rememberCounterWidth,
  writeShellPrefs,
  type ShellPrefs,
} from './counterPrefs';

const NONE: ShellPrefs = { counter: null, railTucked: false };

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('the default before a person has chosen', () => {
  it('is open at a normal width on a normal page', () => {
    expect(counterWidthFor('/orders', 1440, NONE)).toBe('open');
    expect(counterWidthFor('/', 1280, NONE)).toBe('open');
  });

  it('is tucked below ~1280 px', () => {
    expect(counterWidthFor('/orders', 1279, NONE)).toBe('tucked');
    expect(counterWidthFor('/orders', 1024, NONE)).toBe('tucked');
  });

  it('is tucked on the wide pages, at any width', () => {
    expect(counterWidthFor('/reports', 1920, NONE)).toBe('tucked');
    expect(counterWidthFor('/inventory', 1440, NONE)).toBe('tucked');
    expect(counterWidthFor('/reports?tab=spend', 1440, NONE)).toBe('tucked');
  });
});

describe("after that, the person's one choice wins on every page", () => {
  it('a counter the person opened stays open, on a wide page too', () => {
    const p = rememberCounterWidth(NONE, 'open');
    expect(counterWidthFor('/reports', 1440, p)).toBe('open');
    expect(counterWidthFor('/orders', 1100, p)).toBe('open');
  });

  it('a counter the person tucked stays tucked on every page', () => {
    const p = rememberCounterWidth(NONE, 'tucked');
    expect(counterWidthFor('/orders', 1440, p)).toBe('tucked');
    expect(counterWidthFor('/calendar', 1440, p)).toBe('tucked');
    expect(counterWidthFor('/', 1920, p)).toBe('tucked');
  });

  it('one record page is one page, for the wide-page default', () => {
    expect(pageKeyOf('/documents/abc')).toBe(pageKeyOf('/documents/def?x=1'));
    expect(pageKeyOf('/documents/abc')).not.toBe(pageKeyOf('/documents-reports'));
    expect(pageKeyOf('/')).toBe('/');
  });
});

describe('the choice is the PERSON\'s, kept per device', () => {
  it('is keyed by the user id, so two people on one till do not share it', () => {
    writeShellPrefs('u-1', rememberCounterWidth(NONE, 'tucked'));
    expect(readShellPrefs('u-1').counter).toBe('tucked');
    expect(readShellPrefs('u-2').counter).toBeNull();
    expect(window.localStorage.getItem(prefsKeyFor('u-1'))).not.toBeNull();
  });

  it('without a person, nothing is written and the default rule stands', () => {
    const set = vi.spyOn(window.localStorage, 'setItem');
    writeShellPrefs(null, rememberCounterWidth(NONE, 'tucked'));
    expect(set).not.toHaveBeenCalled();
    expect(readShellPrefs(null)).toEqual(NONE);
  });

  it('blocked storage falls back to the default rule, never a broken shell', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readShellPrefs('u-1')).toEqual(NONE);
  });

  it('a stored value that is not a width is ignored, not trusted', () => {
    window.localStorage.setItem(prefsKeyFor('u-1'), JSON.stringify({ counter: 'wide' }));
    expect(readShellPrefs('u-1').counter).toBeNull();
  });

  it("the first build's per-page record reads as never chosen, and keeps the rail", () => {
    window.localStorage.setItem(
      prefsKeyFor('u-1'),
      JSON.stringify({ counter: { '/orders': 'tucked' }, railTucked: true }),
    );
    expect(readShellPrefs('u-1')).toEqual({ counter: null, railTucked: true });
  });
});
