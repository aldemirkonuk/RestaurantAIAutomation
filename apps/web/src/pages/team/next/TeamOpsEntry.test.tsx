/**
 * The two legacy-only team acts, built into the Mudavym page (founder,
 * 2026-09-26, round 8, item 51):
 *
 *   - removing a coverage rule — two steps, like every other remove on /team;
 *   - logging sales by hand — one service, or several at once (typed for the
 *     floor, or read from a CSV and shown before anything is sent).
 *
 * THE REGRESSION. On the rebuilt page these calls had no caller: the only
 * place `deleteCoverageTemplate`, `ingestSales` and `ingestSalesBatch` were
 * called from was the legacy desk that the cutover deletes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const team = vi.hoisted(() => ({
  del: vi.fn(),
  create: vi.fn(),
  one: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('../../../services/api/team', () => ({
  deleteCoverageTemplate: (...a: unknown[]) => team.del(...a),
  createCoverageTemplate: (...a: unknown[]) => team.create(...a),
  ingestSales: (...a: unknown[]) => team.one(...a),
  ingestSalesBatch: (...a: unknown[]) => team.batch(...a),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: vi.fn() },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { id: 'u1', restaurantId: 'rest-A' } }),
}));

import { CoverageRulesSheet } from './CoverageRulesSheet';
import { SalesSheet } from './SalesSheet';
import type { TeamMember } from '../../../services/api/team';
import { todayIso } from './tm-format';

const person = (id: string, name: string, status = 'active') =>
  ({ id, display_name: name, status, position: null }) as unknown as TeamMember;
const ANA = person('m-ana', 'Ana');
const BO = person('m-bo', 'Bo');
const CY = person('m-cy', 'Cy', 'inactive');

const RULES = [
  { id: 'r-sat', role: 'Floor', day_of_week: 6, shift_period: 'pm', min_staff: 3 },
  { id: 'r-all', role: 'Bar', day_of_week: null, shift_period: 'am', min_staff: 1 },
];

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  team.del.mockReset();
  team.create.mockReset();
  team.one.mockReset();
  team.batch.mockReset();
});

// ── coverage rules ───────────────────────────────────────────────────────

describe('CoverageRulesSheet — removing a rule', () => {
  const draw = (over: Partial<React.ComponentProps<typeof CoverageRulesSheet>> = {}) =>
    wrap(
      <CoverageRulesSheet rules={RULES} failed={false} weekStart="2026-09-21" onClose={() => {}} {...over} />,
    );

  it('lists every rule in words, each with its own named remove control', () => {
    draw();
    const rows = screen.getAllByTestId('rule-row');
    expect(rows.map((r) => within(r).getByText(/·/).textContent)).toEqual([
      'Bar · every day day · 1 person',
      'Floor · Saturday evening · 3 people',
    ]);
    expect(
      screen.getByRole('button', { name: 'Remove the rule Floor · Saturday evening · 3 people' }),
    ).toBeTruthy();
  });

  it('asks first, says what the engine stops asking for, and "Keep it" writes nothing', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Remove the rule Floor/ }));
    expect(screen.getByText(/stops the staffing engine asking for 3 Floor on Saturday evening/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(team.del).not.toHaveBeenCalled();
    expect(screen.queryByText(/stops the staffing engine/)).toBeNull();
  });

  it('removes through the house-scoped route and names what went', async () => {
    team.del.mockResolvedValue({ ...RULES[0], restaurant_id: 'rest-A' });
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Remove the rule Floor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the rule' }));
    await waitFor(() => expect(team.del).toHaveBeenCalledWith('r-sat', 'rest-A'));
    expect((await screen.findByTestId('rule-removed')).textContent).toBe(
      'Removed: Floor · Saturday evening · 3 people.',
    );
  });

  it('says the rule was not removed when the gateway refuses', async () => {
    team.del.mockRejectedValue(new Error('No such coverage rule in this restaurant.'));
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Remove the rule Floor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the rule' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /The rule was not removed \(No such coverage rule in this restaurant\.\)/,
    );
  });

  it('a failed read is not an empty file, and offers no form to file a duplicate', () => {
    draw({ rules: null, failed: true });
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/);
    expect(screen.queryByRole('button', { name: 'Add coverage rule' })).toBeNull();
  });

  it('says loading while unanswered, and idle when empty', () => {
    const { unmount } = draw({ rules: null });
    expect(screen.getByText('Reading the coverage rules…')).toBeTruthy();
    unmount();
    draw({ rules: [] });
    expect(screen.getByTestId('rules-empty').textContent).toMatch(/engine is idle/);
  });
});

// ── sales by hand ────────────────────────────────────────────────────────

describe('SalesSheet — one service', () => {
  const draw = (over: Partial<React.ComponentProps<typeof SalesSheet>> = {}) =>
    wrap(<SalesSheet members={[ANA, BO]} restaurantId="rest-A" onClose={() => {}} {...over} />);

  it('writes the legacy row — manual, blanks as 0 — into this house', async () => {
    team.one.mockResolvedValue({});
    draw();
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'm-ana' } });
    fireEvent.change(screen.getByLabelText('Covers'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Net sales'), { target: { value: '1810.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the service' }));
    await waitFor(() =>
      expect(team.one).toHaveBeenCalledWith(
        {
          memberId: 'm-ana',
          serviceDate: todayIso(),
          covers: 42,
          checks: 0,
          netSales: 1810.5,
          wineSales: 0,
          source: 'manual',
        },
        'rest-A',
      ),
    );
    expect((await screen.findByTestId('sales-result')).textContent).toMatch(/Saved Ana’s/);
  });

  it('refuses a figure that is not a plain number, and sends nothing', () => {
    draw();
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'm-ana' } });
    fireEvent.change(screen.getByLabelText('Net sales'), { target: { value: '1,200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the service' }));
    expect(screen.getByTestId('sales-refusal').textContent).toMatch(/net sales: “1,200” is not a plain number/);
    expect(team.one).not.toHaveBeenCalled();
  });

  it('keeps the figures and says why when the save fails', async () => {
    team.one.mockRejectedValue(new Error('Only owners and managers can perform this action'));
    draw();
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'm-bo' } });
    fireEvent.change(screen.getByLabelText('Covers'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the service' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not saved \(Only owners and managers/);
    expect((screen.getByLabelText('Covers') as HTMLInputElement).value).toBe('9');
  });

  it('says loading while the roster is unanswered, and refuses to save when it failed', () => {
    const { unmount } = draw({ members: null });
    expect(screen.getByText('Reading the roster…')).toBeTruthy();
    unmount();
    draw({ members: null, rosterFailed: true });
    expect(screen.getByRole('alert').textContent).toMatch(/roster could not be read/);
    expect((screen.getByRole('button', { name: 'Save the service' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SalesSheet — several at once', () => {
  const draw = () =>
    wrap(<SalesSheet members={[ANA, BO, CY]} restaurantId="rest-A" onClose={() => {}} />);

  it('types a night for the active floor, sends only the filled lines, names what was declined', async () => {
    team.batch.mockResolvedValue({
      inserted: 1,
      skipped: 1,
      skippedRows: [{ memberId: 'm-bo', serviceDate: '2026-09-20' }],
    });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Several at once' }));
    // One labelled line per ACTIVE person; Cy is inactive.
    expect(screen.getByLabelText('Covers for Ana')).toBeTruthy();
    expect(screen.queryByLabelText('Covers for Cy')).toBeNull();
    fireEvent.change(screen.getByLabelText('Service day'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('Covers for Ana'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Wine sales for Bo'), { target: { value: '120' } });
    expect(screen.getByTestId('sales-count').textContent).toMatch(/2 ready to save/);
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 services' }));
    await waitFor(() =>
      expect(team.batch).toHaveBeenCalledWith(
        [
          { memberId: 'm-ana', serviceDate: '2026-09-20', covers: 30, checks: 0, netSales: 0, wineSales: 0, source: 'manual' },
          { memberId: 'm-bo', serviceDate: '2026-09-20', covers: 0, checks: 0, netSales: 0, wineSales: 120, source: 'manual' },
        ],
        'rest-A',
      ),
    );
    expect((await screen.findByTestId('sales-result')).textContent).toMatch(
      /Saved 1 service\. 1 row was not saved because the person is not on this house’s roster: Bo on/,
    );
  });

  it('reads a CSV, shows every row before sending, and sends the good ones as csv', async () => {
    team.batch.mockResolvedValue({ inserted: 1, skipped: 0, skippedRows: [] });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Several at once' }));
    const file = new File(
      ['service_date,name,covers,net_sales\n2026-09-24,Ana,30,900\n2026-09-24,Zed,5,10\n2026-09-24,Bo,x,1\n'],
      'night.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByTestId('sales-file-input'), { target: { files: [file] } });
    expect((await screen.findByTestId('sales-file')).textContent).toMatch(/From night\.csv: 2 rows read/);
    expect(screen.getByTestId('sales-file-refused').textContent).toMatch(/Line 3 not read: nobody on the roster is called “Zed”/);
    const preview = screen.getByTestId('sales-preview');
    expect(preview.textContent).toMatch(/Will not be saved: covers: “x” is not a plain number/);
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 service' }));
    await waitFor(() =>
      expect(team.batch).toHaveBeenCalledWith(
        [{ memberId: 'm-ana', serviceDate: '2026-09-24', covers: 30, checks: 0, netSales: 900, wineSales: 0, source: 'csv' }],
        'rest-A',
      ),
    );
  });

  it('has nothing to save until a line is filled', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Several at once' }));
    const save = screen.getByRole('button', { name: 'Nothing to save yet' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
