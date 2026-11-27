/**
 * r109 menu-g4: the plan says what each new price does to the margin, against
 * the house's own target, for an owner or manager (the gateway sends margin
 * only to them). Static: no motion, the plan's scroll and focus unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuPlan, belowTargetCount, landsBelowTarget, marginWords, planSentence } from './MenuPlan';
import { getMenuPlan, type MenuPlan as Plan, type PlanKindMargin, type PlanLine } from '../../../services/api/menus';

vi.mock('../../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenuPlan: vi.fn(), makeMenuCurrent: vi.fn() };
});

const margin = (now: number | null, then: number | null, state: PlanKindMargin['atThisMenu']['state'] = 'raise'): PlanKindMargin => ({
  atHouseNow: { marginPct: now, state: 'raise' },
  atThisMenu: { marginPct: then, state },
  targetPct: 65,
});
const glass = { kind: 'glass' as const, menuPrice: null, housePrice: null, result: 'blank_never_priced' as const, lastSet: null, lock: null };
function line(id: string, name: string, m: PlanKindMargin | null | undefined): PlanLine {
  return {
    menuItemId: id,
    name,
    producer: null,
    vintage: null,
    wineLibraryId: `mw-${id}`,
    inventoryId: `inv-${id}`,
    house: { wineName: name, vintage: null, active: true },
    bottle: { kind: 'bottle', menuPrice: 55, housePrice: 50, result: 'change', lastSet: null, lock: null, margin: m },
    glass,
    flag: null,
    returned: false,
    vintageMismatch: false,
  } as PlanLine;
}
const plan = (lines: PlanLine[]): Plan =>
  ({
    menuId: 'menu-new',
    current: false,
    readAt: null,
    generatedAt: '2026-11-27T09:00:00Z',
    fingerprint: 'fp',
    lines,
    counts: { change: lines.length, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: lines.length, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
    kitchenLines: [],
    notOnThisFile: [],
  }) as unknown as Plan;

function mount(p: Plan) {
  vi.mocked(getMenuPlan).mockResolvedValue(p);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MenuPlan menuId="menu-new" canManage onDone={() => undefined} onCancel={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('the margin words', () => {
  it('"62% / 71%"; one decimal when it is not whole', () => {
    expect(marginWords(margin(62, 71, 'on_target'))).toBe('62% / 71%');
    expect(marginWords(margin(60, 66.6667, 'lower'))).toBe('60% / 66.7%');
  });
  it('a state with no percent is said in words, never as a margin', () => {
    const no = (state: PlanKindMargin['atThisMenu']['state']): PlanKindMargin => ({ atHouseNow: { marginPct: null, state }, atThisMenu: { marginPct: null, state }, targetPct: 65 });
    expect(marginWords(no('no_cost'))).toBe('cost not recorded');
    expect(marginWords(no('pour_unconfirmed'))).toBe('pour not confirmed');
    expect(marginWords({ ...no('no_target'), targetPct: null })).toBe('no target set');
    expect(marginWords(null)).toBeNull();
  });
  it('a price lands below target only when the rule says raise at this menu', () => {
    expect(landsBelowTarget(margin(60, 58))).toBe(true);
    expect(landsBelowTarget(margin(60, 66, 'on_target'))).toBe(false);
    expect(landsBelowTarget(margin(60, 70, 'lower'))).toBe(false);
  });
});

describe('the plan with margins', () => {
  it('the sentence counts the prices that land below the target', () => {
    const p = plan([line('1', 'Chianti', margin(60, 58)), line('2', 'Barolo', margin(62, 66, 'on_target')), line('3', 'Soave', margin(55, 60))]);
    expect(belowTargetCount(p.lines)).toBe(2);
    expect(planSentence(p)).toContain('2 prices land below your target margin');
    expect(planSentence(plan([line('2', 'Barolo', margin(62, 66, 'on_target'))]))).not.toContain('below your target');
  });

  it('a manager sees the column, and a line below target says so in warn ink', async () => {
    mount(plan([line('1', 'Chianti', margin(60, 58)), line('2', 'Barolo', margin(62, 71, 'lower'))]));
    expect(await screen.findByText('Margin now / at this menu')).toBeInTheDocument();
    const rows = screen.getAllByTestId('menu-plan-row');
    expect(within(rows[0]).getByTestId('menu-plan-margin')).toHaveTextContent('60% / 58%below your 65% target');
    expect(within(rows[0]).getByTestId('menu-plan-below-target')).toHaveStyle({ color: 'var(--warn)' });
    expect(within(rows[1]).getByTestId('menu-plan-margin')).toHaveTextContent('62% / 71%');
    expect(within(rows[1]).queryByTestId('menu-plan-below-target')).toBeNull();
  });

  it('a staff plan (every margin null) has no margin column and no margin words', async () => {
    mount(plan([line('1', 'Chianti', null)]));
    await screen.findByTestId('menu-plan');
    expect(screen.queryByText('Margin now / at this menu')).toBeNull();
    expect(screen.queryByTestId('menu-plan-margin')).toBeNull();
    expect(screen.getByTestId('menu-plan-sentence')).not.toHaveTextContent('target margin');
  });
});
