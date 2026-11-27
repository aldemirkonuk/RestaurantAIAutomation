/** r109 drinks-g3: Plan prep on /cocktails, for any role. No money; only an editor gets the link to fix an unlinked line. */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DrinkCard } from '../../../../services/api/recipes';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ get: vi.fn(), auth: {} as Record<string, unknown> }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get }, getErrorStatus: () => null }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import PlanPrep, { PREP_UNREAD } from './PlanPrep';

const line = (label: string, inventoryId: string | null): DrinkCard['lines'][number] => ({
  label, qty: 30, unit: 'ml', name: inventoryId ? 'Plymouth gin' : null, role: 'stocked', inventoryId, componentId: null, qtyBase: 300, baseUnit: 'ml10', usablePct: null,
});
const cards = { drinks: [{ cocktailId: 'n', name: 'Negroni', section: null, glass: null, method: null, garnish: null, yieldServes: 1, version: 1, versionDate: null, lines: [line('gin', 'g1'), line('Lime juice', null)], allergens: { readable: false } }], components: [] };

// The house's money form and zone are asked through the same client: answer them by url, so the card read stays the only open ask.
const house = vi.hoisted(() => ({ code: 'GBP', zone: null as string | null }));
const settings = (url: string) =>
  url === '/settings/currency'
    ? { data: { restaurantId: 'r', code: house.code, country: null, readable: true, reason: null, statedAt: null } }
    : url === '/settings/time-zone'
      ? { data: { restaurantId: 'r', zone: house.zone, readable: true } }
      : null;
const ask = (url: string) => settings(url) ?? { data: cards };
let qc = new QueryClient();
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
);

const mount = (role: string) => {
  h.auth = { activeRestaurantId: RID, activeRole: role, user: { userId: 'u', role } };
  return render(<PlanPrep />, { wrapper: wrap });
};

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  house.code = 'GBP';
  house.zone = null;
  h.get.mockReset().mockImplementation(async (url: string) => ask(url));
  window.localStorage.clear();
});

describe('Plan prep', () => {
  it('staff plan serves and read the pull list, with no link and no money', async () => {
    mount('staff');
    fireEvent.click(screen.getByTestId('prep-open'));
    fireEvent.change(await screen.findByLabelText('Negroni'), { target: { value: '12' } });
    expect(screen.getByTestId('prep-pull')).toHaveTextContent('360 ml Plymouth gin · Negroni');
    expect(screen.getByTestId('prep-not-linked')).toHaveTextContent('not linked: Lime juice (Negroni)');
    expect(screen.queryByRole('link', { name: 'Link it' })).toBeNull();
    expect(screen.getByTestId('prep-sheet')).not.toHaveTextContent(/cost|price|£|₺/i);
  });

  it('an owner or manager gets a link into the drink to link the line', async () => {
    mount('manager');
    fireEvent.click(screen.getByTestId('prep-open'));
    fireEvent.change(await screen.findByLabelText('Negroni'), { target: { value: '2' } });
    expect(screen.getByRole('link', { name: 'Link it' })).toHaveAttribute('href', '/cocktails?open=n');
  });

  it('the serves are kept for the house and the day, and come back on the next open', async () => {
    const first = mount('staff');
    fireEvent.click(screen.getByTestId('prep-open'));
    fireEvent.change(await screen.findByLabelText('Negroni'), { target: { value: '5' } });
    first.unmount();
    mount('staff');
    fireEvent.click(screen.getByTestId('prep-open'));
    expect(((await screen.findByLabelText('Negroni')) as HTMLInputElement).value).toBe('5');
  });

  it('bad serves are said and not counted', async () => {
    mount('staff');
    fireEvent.click(screen.getByTestId('prep-open'));
    fireEvent.change(await screen.findByLabelText('Negroni'), { target: { value: '1000' } });
    expect(screen.getByText('Planned serves are a whole number from 0 to 999.')).toBeInTheDocument();
    expect(screen.queryByTestId('prep-pull')).toBeNull();
  });

  it.each(['down', 'old'])('a failed read (%s gateway) is unread, never a shorter list', async (k) => {
    const old = { data: { drinks: [{ ...cards.drinks[0], lines: [{ label: 'gin', qty: 30, unit: 'ml', name: null }] }], components: [] } };
    h.get.mockImplementation(async (url: string) => settings(url) ?? (k === 'down' ? Promise.reject(new Error('down')) : old));
    mount('staff');
    fireEvent.click(screen.getByTestId('prep-open'));
    expect(await screen.findByTestId('prep-unread')).toHaveTextContent(PREP_UNREAD);
  });

  // r109 drinks fixer: a late answer for the house left behind is dropped, never shown under the house now open.
  it('a late read for the house switched away from does not overwrite the house now open', async () => {
    const RID_B = '22222222-2222-4222-8222-222222222222';
    const named = (name: string) => ({ drinks: [{ ...cards.drinks[0], cocktailId: name, name }], components: [] });
    let lateA!: (v: unknown) => void;
    h.get.mockReset().mockImplementation((url: string) =>
      settings(url) ? Promise.resolve(settings(url)) : url.includes(RID_B) ? Promise.resolve({ data: named('Gimlet B') }) : new Promise((r) => { lateA = r; }),
    );
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u', role: 'staff' } };
    const view = render(<PlanPrep />, { wrapper: wrap });
    fireEvent.click(screen.getByTestId('prep-open'));
    h.auth = { ...h.auth, activeRestaurantId: RID_B };
    view.rerender(<PlanPrep />);
    fireEvent.click(screen.getByTestId('prep-open'));
    expect(await screen.findByLabelText('Gimlet B')).toBeInTheDocument();
    await act(async () => lateA({ data: named('Negroni A') }));
    expect(screen.queryByLabelText('Negroni A')).toBeNull();
    expect(screen.getByLabelText('Gimlet B')).toBeInTheDocument();
  });

  it('an answer that arrives after the house changed and nothing was asked again is dropped, not shown', async () => {
    const RID_B = '22222222-2222-4222-8222-222222222222';
    let lateA!: (v: unknown) => void;
    h.get.mockReset().mockImplementation((url: string) => (settings(url) ? Promise.resolve(settings(url)) : new Promise((r) => { lateA = r; })));
    h.auth = { activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u', role: 'staff' } };
    const view = render(<PlanPrep />, { wrapper: wrap });
    fireEvent.click(screen.getByTestId('prep-open'));
    h.auth = { ...h.auth, activeRestaurantId: RID_B };
    view.rerender(<PlanPrep />);
    await act(async () => lateA({ data: cards }));
    expect(screen.queryByLabelText('Negroni')).toBeNull();
  });

  // r110 drinks-g5: the day is the house's, in the house's form.
  describe('the house day', () => {
    afterEach(() => vi.useRealTimers());
    const lateOn27 = () => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-27T23:30:00Z') });

    it('keys the serves by the Istanbul day, not the browser day, and prints the heading in the lira house form', async () => {
      house.code = 'TRY';
      house.zone = 'Europe/Istanbul';
      lateOn27();
      mount('staff');
      fireEvent.click(screen.getByTestId('prep-open'));
      fireEvent.change(await screen.findByLabelText('Negroni'), { target: { value: '4' } });
      await waitFor(() => expect(window.localStorage.getItem(`mudavym.prepPlan.v1:${RID}:2026-11-28`)).toContain('4'));
      expect(window.localStorage.getItem(`mudavym.prepPlan.v1:${RID}:2026-11-27`)).toBeNull();
      window.print = vi.fn();
      fireEvent.click(screen.getByTestId('prep-print'));
      expect(await screen.findByTestId('prep-paper')).toHaveTextContent('Prep list, 28 Kas 2026');
    });

    it('reads a plan kept under the old browser day once, and moves it to the house day', async () => {
      house.zone = 'Europe/Istanbul';
      lateOn27();
      const browserDay = new Date();
      const old = `mudavym.prepPlan.v1:${RID}:${browserDay.getFullYear()}-${String(browserDay.getMonth() + 1).padStart(2, '0')}-${String(browserDay.getDate()).padStart(2, '0')}`;
      window.localStorage.setItem(old, JSON.stringify({ n: '6' }));
      mount('staff');
      await waitFor(() => expect(h.get).toHaveBeenCalledWith('/settings/time-zone'));
      await act(async () => {});
      fireEvent.click(screen.getByTestId('prep-open'));
      expect(((await screen.findByLabelText('Negroni')) as HTMLInputElement).value).toBe('6');
      expect(window.localStorage.getItem(`mudavym.prepPlan.v1:${RID}:2026-11-28`)).toContain('6');
      if (!old.endsWith('2026-11-28')) expect(window.localStorage.getItem(old)).toBeNull();
    });
  });
});
