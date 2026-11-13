/**
 * The plan and the result count the same wines in the same words.
 *
 * Onboarding walk 2026-11-12 (r12 finding 9): the plan said "will add 2 prices
 * for wines new to the house" and the result then said "1 price set from this
 * menu". One wine carried a bottle and a glass price: the plan counted kinds,
 * the gateway tallies one outcome per line (`set_house_menu_price` decides
 * locked / unchanged / changed for the whole line, menus.service.ts
 * carryMenuPrice). The model below restates that rule on its own -- it does not
 * call `lineOutcome` -- so a plan that drifts from the gateway fails here.
 *
 * Also: "Make current" opened its plan under the list, below the fold, and
 * nothing moved (r12 finding 7). The plan now comes into view and its heading
 * takes focus.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuPlan, lineOutcome, planNeedsScroll, planSentence } from './MenuPlan';
import { makeCurrentSentence } from './MenuVersions';
import { getMenuPlan, type MakeCurrentResult, type MenuPlan as Plan, type PlanKind, type PlanLine, type PlanResult } from '../../../services/api/menus';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenuPlan: vi.fn(), makeMenuCurrent: vi.fn() };
});
const mockPlan = vi.mocked(getMenuPlan);

const KIND_RESULTS: PlanResult[] = ['change', 'unchanged', 'held_by_lock', 'blank_kept', 'blank_never_priced', 'new_wine'];

function kind(k: 'bottle' | 'glass', result: PlanResult): PlanKind {
  const priced = result === 'change' || result === 'unchanged' || result === 'held_by_lock' || result === 'new_wine';
  return {
    kind: k,
    menuPrice: priced ? 50 : null,
    housePrice: result === 'new_wine' || result === 'blank_never_priced' ? null : result === 'unchanged' ? 50 : 40,
    result,
    lastSet: null,
    lock:
      result === 'held_by_lock'
        ? { lockId: `l-${k}`, lockedPrice: 40, lockedBy: { userId: 'u1', name: 'Aylin' }, lockedAt: '2026-09-01T09:00:00Z' }
        : null,
  };
}

function line(i: number, bottle: PlanResult, glass: PlanResult): PlanLine {
  return {
    menuItemId: `m${i}`,
    name: `Wine ${i}`,
    producer: null,
    vintage: null,
    wineLibraryId: bottle === 'not_linked' ? null : `w${i}`,
    inventoryId: bottle === 'not_linked' || bottle === 'new_wine' || glass === 'new_wine' ? null : `inv${i}`,
    house: null,
    bottle: kind('bottle', bottle),
    glass: kind('glass', glass),
    flag: null,
    returned: false,
    vintageMismatch: false,
  } as PlanLine;
}

/** The gateway's per-line outcome, restated from carryMenuPrice + set_house_menu_price. */
function gatewayOutcome(l: PlanLine): string {
  if (l.bottle.result === 'not_linked') return 'not_linked';
  const named = [l.bottle, l.glass].filter((k) => k.menuPrice !== null);
  if (named.length === 0) return 'no_price';
  if (named.every((k) => k.lock !== null)) return 'locked';
  if (named.some((k) => k.lock === null && k.menuPrice !== k.housePrice)) return 'changed';
  return 'unchanged';
}

function planOf(lines: PlanLine[]): Plan {
  return {
    menuId: 'menu-x',
    current: false,
    generatedAt: '2026-11-12T12:00:00Z',
    fingerprint: 'fp',
    lines,
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
  };
}

const num = (s: string, re: RegExp) => Number(re.exec(s)?.[1] ?? 0);

function agree(lines: PlanLine[]) {
  const priceSync: Record<string, number> = {};
  for (const l of lines) {
    const o = gatewayOutcome(l);
    priceSync[o] = (priceSync[o] ?? 0) + 1;
  }
  const said = planSentence(planOf(lines));
  const done = makeCurrentSentence({
    outcome: 'made_current',
    menuId: 'menu-x',
    previousMenuIds: [],
    lines: lines.length,
    priceSync,
    flagged: 0,
    failed: [],
  }, undefined, lines);
  const planPriced = num(said, /change the price of (\d+) wines?/) + num(said, /add (\d+) wines? new/);
  expect({ case: lines.map((l) => `${l.bottle.result}/${l.glass.result}`), n: planPriced }).toEqual({
    case: lines.map((l) => `${l.bottle.result}/${l.glass.result}`),
    n: num(done, /(\d+) wines? priced from this menu/),
  });
  expect(num(said, /leave (\d+) wines? at/)).toBe(num(done, /(\d+) wines? at (?:its|their) locked price/));
  expect(num(said, /keep (\d+) wines? already at the menu's price/)).toBe(num(done, /(\d+) wines? already at the menu's price/));
}

describe('the plan counts what the result will count', () => {
  const singles: Array<[PlanResult, PlanResult]> = [];
  for (const b of KIND_RESULTS)
    for (const g of KIND_RESULTS) {
      // A wine new to the house is new for both kinds or blank for one.
      if ((b === 'new_wine') !== (g === 'new_wine') && !(b === 'blank_never_priced' || g === 'blank_never_priced')) continue;
      singles.push([b, g]);
    }

  it('for every kind of one line', () => {
    expect(singles.length).toBeGreaterThan(20);
    for (const [b, g] of singles) agree([line(0, b, g)]);
    agree([line(0, 'not_linked', 'not_linked')]);
  });

  it('for every pair of lines on one menu', () => {
    for (const [b1, g1] of singles) for (const [b2, g2] of singles) agree([line(1, b1, g1), line(2, b2, g2)]);
  });

  it('the walk: one new wine with a bottle and a glass price is one wine on both sides', () => {
    const said = planSentence(planOf([line(0, 'new_wine', 'new_wine')]));
    expect(said).toBe('Choosing this menu will add 1 wine new to the house at its menu price.');
    expect(makeCurrentSentence({ outcome: 'made_current', menuId: 'm', previousMenuIds: [], lines: 1, priceSync: { changed: 1 }, flagged: 0, failed: [] }, undefined, [line(0, 'new_wine', 'new_wine')])).toBe(
      'This is now the current menu: 1 line, 1 wine priced from this menu.',
    );
  });
});

// r13 walk 2026-11-12: a typed Soave and a typed Negroni (Cocktail) were
// planned as "add 2 wines new to the house", and the result said "2 wines".
describe('a line is named by its kind', () => {
  const as = (l: PlanLine, category: string | null): PlanLine => ({ ...l, category });
  const made = (priceSync: Record<string, number>, n: number): MakeCurrentResult => ({
    outcome: 'made_current',
    menuId: 'm',
    previousMenuIds: [],
    lines: n,
    priceSync,
    flagged: 0,
    failed: [],
  });

  it('the walk: a wine and a cocktail are planned as a wine and a cocktail, and the result calls them drinks', () => {
    const lines = [as(line(0, 'new_wine', 'new_wine'), 'white'), as(line(1, 'blank_never_priced', 'new_wine'), 'cocktail')];
    expect(planSentence(planOf(lines))).toBe(
      'Choosing this menu will add 1 wine and 1 cocktail new to the house at their menu prices.',
    );
    expect(makeCurrentSentence(made({ changed: 2 }, 2), undefined, lines)).toBe(
      'This is now the current menu: 2 lines, 2 drinks priced from this menu.',
    );
  });

  it('a menu of one kind keeps that kind on both sides', () => {
    const lines = [as(line(0, 'change', 'change'), 'beer'), as(line(1, 'unchanged', 'unchanged'), 'beer')];
    expect(planSentence(planOf(lines))).toBe(
      "Choosing this menu will change the price of 1 beer the house already has and keep 1 beer already at the menu's price.",
    );
    expect(makeCurrentSentence(made({ changed: 1, unchanged: 1 }, 2), undefined, lines)).toBe(
      "This is now the current menu: 2 lines, 1 beer priced from this menu, 1 beer already at the menu's price.",
    );
  });

  it('a line with no section is a drink, never a wine; an unmatched cocktail is not "matched to a wine"', () => {
    expect(planSentence(planOf([as(line(0, 'held_by_lock', 'held_by_lock'), null)]))).toBe(
      'Choosing this menu will leave 1 drink at its locked price.',
    );
    const said = planSentence(planOf([as(line(0, 'not_linked', 'not_linked'), 'cocktail')]));
    expect(said).toContain('1 line is not matched to a cocktail, so no price');
    expect(said).not.toMatch(/wine/);
  });

  it('the plan and the result still count the same lines when the kinds differ', () => {
    for (const [b1, g1] of [['change', 'change'], ['new_wine', 'new_wine'], ['held_by_lock', 'held_by_lock'], ['unchanged', 'unchanged']] as const)
      for (const [b2, g2] of [['change', 'blank_kept'], ['new_wine', 'blank_never_priced'], ['unchanged', 'held_by_lock']] as const) {
        const lines = [as(line(1, b1, g1), 'red'), as(line(2, b2, g2), 'spirit')];
        const said = planSentence(planOf(lines));
        const counted = [...said.matchAll(/(\d+) (?:wines?|spirits?)/g)].reduce((n, m) => n + Number(m[1]), 0);
        const priced = lines.filter((l) => lineOutcome(l) !== 'no_price').length;
        expect({ said, counted }).toEqual({ said, counted: priced });
      }
  });
});

describe('the plan comes into view when it opens', () => {
  const realRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  function mountAt(top: number) {
    const spy = vi.fn();
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = spy;
    Element.prototype.getBoundingClientRect = function () {
      return { top, bottom: top + 400, left: 0, right: 0, width: 0, height: 400, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    mockPlan.mockResolvedValue(planOf([line(0, 'new_wine', 'new_wine')]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MenuPlan menuId="menu-x" canManage onDone={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>,
    );
    return spy;
  }

  it('out of view below the fold, it scrolls its top into view', () => {
    const spy = mountAt(window.innerHeight + 900);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ block: 'start' });
  });

  it('a reader who asked for reduced motion is moved at once, not glided (<html> scrolls smooth by CSS)', () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const spy = mountAt(window.innerHeight + 900);
      expect(spy.mock.calls[0][0]).toMatchObject({ block: 'start', behavior: 'instant' });
    } finally {
      window.matchMedia = real;
    }
  });

  it('already where the reader is looking, it stays still', () => {
    const spy = mountAt(40);
    expect(spy).not.toHaveBeenCalled();
  });

  it('its heading takes focus once the plan is worked out', async () => {
    mountAt(40);
    const h = await screen.findByRole('heading', { name: /before it becomes current/i });
    await waitFor(() => expect(document.activeElement).toBe(h));
  });

  it('the fold is 60% of the window: above it stays, below it or above the top moves', () => {
    expect(planNeedsScroll(0, 800)).toBe(false);
    expect(planNeedsScroll(480, 800)).toBe(false);
    expect(planNeedsScroll(481, 800)).toBe(true);
    expect(planNeedsScroll(-1, 800)).toBe(true);
  });
});

describe('"flagged" is said in words (onboarding walk 2026-11-12, r12 finding 10)', () => {
  it('the plan and the result say what a blank-price line carries, never "flagged"', () => {
    const blank = line(0, 'change', 'blank_kept');
    const said = planSentence({ ...planOf([blank]), counts: { ...planOf([]).counts, blank_kept: 1 } });
    expect(said).toContain('1 price is blank on the menu, so the house keeps the one it has, and the line carries a note saying so');
    const done = makeCurrentSentence({ outcome: 'made_current', menuId: 'm', previousMenuIds: [], lines: 2, priceSync: { changed: 2 }, flagged: 2, failed: [] });
    expect(done).toContain('2 lines with a blank price, noted on the line so a manager can set them on Inventory');
    expect(`${said} ${done}`).not.toMatch(/flagged/i);
  });
});
