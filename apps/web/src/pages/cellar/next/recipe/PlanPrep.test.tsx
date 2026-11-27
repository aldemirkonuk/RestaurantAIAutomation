/** r109 drinks-g3: Plan prep on /cocktails, for any role. No money; only an editor gets the link to fix an unlinked line. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

const mount = (role: string) => {
  h.auth = { activeRestaurantId: RID, activeRole: role, user: { userId: 'u', role } };
  return render(<MemoryRouter><PlanPrep /></MemoryRouter>);
};

beforeEach(() => {
  h.get.mockReset().mockResolvedValue({ data: cards });
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
    if (k === 'down') h.get.mockRejectedValueOnce(new Error('down'));
    else h.get.mockResolvedValueOnce({ data: { drinks: [{ ...cards.drinks[0], lines: [{ label: 'gin', qty: 30, unit: 'ml', name: null }] }], components: [] } });
    mount('staff');
    fireEvent.click(screen.getByTestId('prep-open'));
    expect(await screen.findByTestId('prep-unread')).toHaveTextContent(PREP_UNREAD);
  });
});
