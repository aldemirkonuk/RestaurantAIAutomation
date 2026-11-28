/**
 * r110 drinks-g4: Learn the specs, a staff drill on the house's own cards. Three Leitner boxes (box 1 first), keys Space / 1 / 2,
 * progress only in this browser, no money, and no animation under reduced motion.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DrinkCard } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get, post: h.post, put: h.put, patch: h.patch }, getErrorStatus: () => null }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u1', role: 'staff' } }) }));

import LearnSpecs, { LEARN_UNREAD } from './LearnSpecs';

const KEY = `mudavym.learnSpecs.v1:${RID}:u1`;
const card = (id: string, name: string, extra: Partial<DrinkCard> & Record<string, unknown> = {}): DrinkCard => ({
  cocktailId: id, name, section: null, glass: 'Coupe', method: 'Shake hard, then strain', garnish: 'Lime wheel', yieldServes: 1, version: 1, versionDate: null,
  lines: [{ label: 'gin', qty: 60, unit: 'ml', name: 'Plymouth gin' }], allergens: { readable: false }, ...extra,
});
const four = [card('a', 'Alpha'), card('b', 'Bravo'), card('c', 'Charlie'), card('d', 'Delta')];

let reduced = false;
beforeEach(() => {
  reduced = false;
  // The setup file's ResizeObserver is a vi.fn that restoreAllMocks empties; a plain one stands in for every test.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.localStorage.clear();
  Object.values(h).forEach((f) => f.mockReset());
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  h.get.mockImplementation(async () => ({ data: { drinks: four } }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const open = async () => {
  render(<LearnSpecs />);
  fireEvent.click(screen.getByTestId('learn-open'));
  await screen.findByTestId('learn-face');
};
const face = () => screen.getByTestId('learn-face').querySelector('h3')!.textContent;
const key = (k: string) => fireEvent.keyDown(window, { key: k });
const answer = (k: '1' | '2') => {
  key(' ');
  key(k);
};
const kept = () => JSON.parse(window.localStorage.getItem(KEY) ?? '{}');

describe('Learn the specs', () => {
  it('deals box 1 first (a drink never seen is in it), then 2, then 3, by name inside a box', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 3, b: 2, c: 1 }));
    await open();
    const seen: Array<string | null> = [];
    for (let i = 0; i < 4; i += 1) {
      seen.push(face());
      answer('1');
    }
    expect(seen).toEqual(['Charlie', 'Delta', 'Bravo', 'Alpha']);
  });

  it('the face says the name, the glass and the method word; Space shows the lines, garnish and method', async () => {
    await open();
    expect(screen.getByTestId('learn-face')).toHaveTextContent('AlphaCoupe · Shake');
    expect(screen.queryByTestId('learn-spec')).toBeNull();
    key(' ');
    const spec = screen.getByTestId('learn-spec');
    expect(spec).toHaveTextContent('Plymouth gin');
    expect(spec).toHaveTextContent('Garnish: Lime wheel');
    expect(spec).toHaveTextContent('Shake hard, then strain');
  });

  it('1 is Knew it (up a box, to 3 at most) and 2 is Not yet (back to box 1); nothing is graded before the spec is shown', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 3, b: 2 }));
    await open(); // Charlie, Delta, Bravo, Alpha
    key('1');
    expect(face()).toBe('Charlie');
    answer('1'); // Charlie 1 -> 2
    answer('2'); // Delta stays 1
    answer('1'); // Bravo 2 -> 3
    answer('2'); // Alpha 3 -> 1
    expect(kept()).toEqual({ a: 1, b: 3, c: 2, d: 1 });
  });

  it('a drink marked Not yet comes round first the next time', async () => {
    await open();
    answer('1'); // Alpha knew
    answer('2'); // Bravo not yet
    answer('1');
    answer('1');
    expect(screen.getByTestId('learn-end')).toHaveTextContent('3 of 4 known; 1 comes round first next time.');
    fireEvent.click(screen.getByRole('button', { name: 'Go round again' }));
    expect(face()).toBe('Bravo');
  });

  it('says the end plainly when every drink is known', async () => {
    h.get.mockImplementation(async () => ({ data: { drinks: [card('a', 'Alpha'), card('b', 'Bravo')] } }));
    await open();
    answer('1');
    answer('1');
    expect(screen.getByTestId('learn-end').textContent).toBe('2 of 2 known.');
  });

  it('starts fresh from corrupt storage, and from boxes that are not 1, 2 or 3', async () => {
    window.localStorage.setItem(KEY, '{not json');
    await open();
    expect(face()).toBe('Alpha');
    cleanup();
    window.localStorage.setItem(KEY, JSON.stringify({ a: 9 }));
    await open();
    expect(face()).toBe('Alpha');
  });

  it('shows no money, reads only the cards, and sends nothing: progress lives in this browser', async () => {
    h.get.mockImplementation(async () => ({ data: { drinks: [card('a', 'Alpha', { price: 12.5, cost: 3.1, margin: 0.7, perServe: 3.1 })] } }));
    await open();
    key(' ');
    expect(screen.getByTestId('learn-sheet').textContent).not.toMatch(/12\.5|3\.1|0\.7|cost|price|margin|[£$₺€]/i);
    key('1');
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get.mock.calls[0][0]).toBe(`/recipes/${RID}/drinks/cards`);
    expect(h.post).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('a failed read says so; it is never an empty drill', async () => {
    h.get.mockRejectedValue(new Error('down'));
    render(<LearnSpecs />);
    fireEvent.click(screen.getByTestId('learn-open'));
    expect(await screen.findByTestId('learn-unread')).toHaveTextContent(LEARN_UNREAD);
  });

  /** A hidden spec is as tall as its lines plus its method's steps (a newline starts a row), 20 px a row. */
  const rowsHeight = (el: HTMLElement) => el.querySelectorAll('li').length * 20 + (el.querySelector('.cl-learn-method')?.textContent ?? '').split('\n').length * 20;
  const mockHeights = (extra: () => number = () => 0) =>
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cl-learn-probe-spec') ? rowsHeight(this) + extra() : 0;
    });

  it('holds the room under the face at the tallest card, measured on read, so showing a spec moves nothing', async () => {
    h.get.mockImplementation(async () => ({ data: { drinks: [card('a', 'Alpha'), card('b', 'Bravo', { lines: [1, 2, 3, 4, 5].map((n) => ({ label: `g${n}`, qty: 10, unit: 'ml', name: null })), method: 'Stir for thirty seconds then pour over a single large cube' })] } }));
    mockHeights();
    await open();
    await waitFor(() => expect(screen.getByTestId('learn-room')).toHaveStyle({ minHeight: '120px' }));
  });

  it('a card whose method has many newline steps holds the room, though another card has more lines', async () => {
    const fiveLines = card('a', 'Alpha', { lines: [1, 2, 3, 4, 5].map((n) => ({ label: `g${n}`, qty: 10, unit: 'ml', name: null })), method: 'Shake and strain' });
    const sixSteps = card('b', 'Bravo', { lines: [1, 2, 3, 4].map((n) => ({ label: `s${n}`, qty: 10, unit: 'ml', name: null })), method: ['Chill the glass', 'Add the base', 'Stir thirty turns', 'Top with soda', 'Lift the bar spoon', 'Garnish at the pass'].join('\n') });
    h.get.mockImplementation(async () => ({ data: { drinks: [fiveLines, sixSteps] } }));
    mockHeights();
    await open();
    // Alpha: 5 lines + 1 row = 120; Bravo: 4 lines + 6 rows = 200. The deal puts Alpha first, so Bravo's room must already be held.
    await waitFor(() => expect(screen.getByTestId('learn-room')).toHaveStyle({ minHeight: '200px' }));
    expect(face()).toBe('Alpha');
  });

  it('re-measures the room when the sheet is resized or the phone turned', async () => {
    let tick: () => void = () => undefined;
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { tick = cb; } observe() {} disconnect() {} unobserve() {} });
    let wrap = 0;
    mockHeights(() => wrap);
    await open();
    await waitFor(() => expect(screen.getByTestId('learn-room')).toHaveStyle({ minHeight: '40px' }));
    wrap = 60;
    act(() => tick());
    await waitFor(() => expect(screen.getByTestId('learn-room')).toHaveStyle({ minHeight: '100px' }));
  });

  it('the reveal and the next face fade in; under reduced motion nothing animates and no animation class is there', async () => {
    await open();
    expect(screen.getByTestId('learn-face')).toHaveClass('cl-learn-face--in');
    key(' ');
    expect(screen.getByTestId('learn-spec')).toHaveClass('cl-learn-reveal');
    cleanup();
    reduced = true;
    await open();
    expect(screen.getByTestId('learn-face').className).not.toMatch(/--in/);
    key(' ');
    expect(screen.getByTestId('learn-spec').className).toBe('');
  });

  it('the drill buttons are 44 px tall on a phone or a coarse pointer', () => {
    const css = readFileSync(join(__dirname, '../cellar-next.css'), 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain('@media (max-width: 719px), (pointer: coarse) { .cl-learn-actions button { min-height: 44px; } }');
  });
});
