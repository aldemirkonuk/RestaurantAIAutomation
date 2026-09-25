/**
 * "Open first, then remember" — the founder's width rule (2026-09-21).
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

const NONE: ShellPrefs = { counter: {}, railTucked: false };

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

describe("after that, the person's choice per page wins", () => {
  it('a page the person opened stays open, even a wide one', () => {
    const p = rememberCounterWidth(NONE, '/reports', 'open');
    expect(counterWidthFor('/reports', 1440, p)).toBe('open');
  });

  it('a page the person tucked stays tucked at a normal width', () => {
    const p = rememberCounterWidth(NONE, '/orders', 'tucked');
    expect(counterWidthFor('/orders', 1440, p)).toBe('tucked');
  });

  it('is per page: tucking /orders leaves /calendar on the default', () => {
    const p = rememberCounterWidth(NONE, '/orders', 'tucked');
    expect(counterWidthFor('/calendar', 1440, p)).toBe('open');
  });

  it('one record page is one page', () => {
    expect(pageKeyOf('/documents/abc')).toBe(pageKeyOf('/documents/def?x=1'));
    expect(pageKeyOf('/documents/abc')).not.toBe(pageKeyOf('/documents-reports'));
    expect(pageKeyOf('/')).toBe('/');
  });
});

describe('the choice is the PERSON\'s, kept per device', () => {
  it('is keyed by the user id, so two people on one till do not share it', () => {
    writeShellPrefs('u-1', rememberCounterWidth(NONE, '/orders', 'tucked'));
    expect(readShellPrefs('u-1').counter['/orders']).toBe('tucked');
    expect(readShellPrefs('u-2').counter['/orders']).toBeUndefined();
    expect(window.localStorage.getItem(prefsKeyFor('u-1'))).not.toBeNull();
  });

  it('without a person, nothing is written and the default rule stands', () => {
    const set = vi.spyOn(window.localStorage, 'setItem');
    writeShellPrefs(null, rememberCounterWidth(NONE, '/orders', 'tucked'));
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
    window.localStorage.setItem(prefsKeyFor('u-1'), JSON.stringify({ counter: { '/orders': 'wide' } }));
    expect(readShellPrefs('u-1').counter['/orders']).toBeUndefined();
  });
});
