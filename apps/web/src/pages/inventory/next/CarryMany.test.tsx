/**
 * Carry many (inventory r40): a pasted list, one good a line, each carried by
 * the one-good write with nothing on hand; a par read as a count is read; a
 * line on the list or listed twice left out; each result said per line and for
 * the whole, and a name never added twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';

const api = vi.hoisted(() => ({ carry: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  carryHouseItem: api.carry,
}));

import CarryMany from './CarryMany';
import { CARRY_MANY_MAX, CARRIED_ONCE } from './carry-lines';
import CarryThis from './CarryThis';

function mount(listedNames: Array<string | null> = [], restaurantId: string | null = 'r1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CarryMany restaurantId={restaurantId} listedNames={listedNames} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const list = () => screen.getByRole('textbox', { name: 'The list' }) as HTMLTextAreaElement;
const paste = (text: string) => fireEvent.change(list(), { target: { value: text } });
const kept = (value: string) => fireEvent.change(screen.getByLabelText('Kept'), { target: { value } });
const kind = (value: string) => fireEvent.change(screen.getByLabelText('Kind'), { target: { value } });

function answered(status: number): AxiosError {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {} } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, {}, response);
}

const names = () => api.carry.mock.calls.map(([body]) => body.displayName);

beforeEach(() => {
  api.carry.mockReset();
  api.carry.mockImplementation(async (body: { displayName: string }) => ({ id: `id-${body.displayName}`, ...body }));
});

describe('CarryMany: before sending', () => {
  it('cannot be sent empty, and says what each line will be', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Paste or type a list first' })).toBeDisabled();
    paste('Bread flour, 5 kg\nLemons');
    expect(document.body.textContent).toContain('Will be carried, par 5 kg.');
    expect(document.body.textContent).toContain('Will be carried, no par.');
    expect(screen.getByRole('button', { name: 'Carry 2 goods' })).not.toBeDisabled();
  });

  it('holds the whole list back while one line cannot be read', () => {
    mount();
    paste('Bread flour, 5\nLemons');
    expect(document.body.textContent).toContain('Say which: 5 g or 5 kg.');
    expect(screen.getByRole('button', { name: 'Put right 1 line first' })).toBeDisabled();
  });

  it('keeps a supply by count until another way is picked', () => {
    mount();
    kind('supply');
    paste('Napkins, 200');
    expect(screen.getByRole('button', { name: 'Carry 1 good' })).not.toBeDisabled();
    kept('g');
    expect(screen.getByRole('button', { name: 'Put right 1 line first' })).toBeDisabled();
  });

  it('will not carry more than the cap at once', () => {
    mount();
    paste(Array.from({ length: CARRY_MANY_MAX + 1 }, (_, i) => `Good ${i}`).join('\n'));
    expect(screen.getByTestId('carry-many-blocked').textContent).toBe(
      `That is ${CARRY_MANY_MAX + 1} lines. Carry ${CARRY_MANY_MAX} or fewer at a time.`,
    );
    expect(screen.getByRole('button', { name: `Carry ${CARRY_MANY_MAX + 1} goods` })).toBeDisabled();
  });

  it('says why nothing can be added with no house open', () => {
    mount([], null);
    paste('Lemons');
    expect(screen.getByTestId('carry-many-blocked').textContent).toBe('No house is open, so nothing can be added.');
    expect(screen.getByRole('button', { name: 'Carry 1 good' })).toBeDisabled();
  });
});

describe('CarryMany: sending', () => {
  it('carries each line with the kind, the book unit and its par, and leaves out the listed and the twice-listed', async () => {
    mount(['Salt']);
    paste('Bread flour, 5 kg\nLemons\nSalt\nlemons');
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 goods' }));
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    expect(api.carry.mock.calls.map(([body, rid]) => [body, rid])).toEqual([
      [{ kind: 'food', uom: 'g', displayName: 'Bread flour', thresholdMin: 5000 }, 'r1'],
      [{ kind: 'food', uom: 'g', displayName: 'Lemons' }, 'r1'],
    ]);
    expect(screen.getByTestId('carry-many-summary').textContent).toBe(
      'Carried 2 goods, with nothing on hand until a delivery or a count. Left out: 1 already on the list and 1 listed twice.',
    );
    expect(screen.getByTestId('carry-many-summary').getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Nothing left to carry' })).toBeDisabled();
  });

  it('says a name the house already carries as already carried, and one off the list as maybe removed', async () => {
    api.carry.mockRejectedValue(answered(409));
    mount();
    paste('Lemons');
    fireEvent.click(screen.getByRole('button', { name: 'Carry 1 good' }));
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    expect(document.body.textContent).toContain('Already carried, though not on this list: it may have been removed. Nothing was added.');
    expect(screen.getByTestId('carry-many-summary').textContent).toBe('1 was already carried, so nothing was added for it.');
  });

  it('a refused line says why and is sent again alone; a carried one is never sent twice', async () => {
    api.carry.mockImplementation(async (body: { displayName: string }) => {
      if (body.displayName === 'Lemons') throw answered(403);
      return { id: 'x', ...body };
    });
    mount();
    paste('Bread flour\nLemons');
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 goods' }));
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    expect(document.body.textContent).toContain('Not added — this account is not allowed to do that in this house.');
    expect(screen.getByTestId('carry-many-summary').getAttribute('role')).toBe('alert');
    expect(list()).toBeDisabled();
    expect(screen.getByLabelText('Kind')).toBeDisabled();
    api.carry.mockClear();
    api.carry.mockImplementation(async (body: { displayName: string }) => ({ id: 'y', ...body }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the 1 again' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(names()).toEqual(['Lemons']);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nothing left to carry' })).toBeTruthy());
  });

  it('a line whose answer never came is not known, never "not added", and says trying again is safe', async () => {
    api.carry.mockRejectedValue(answered(502));
    mount();
    paste('Lemons');
    fireEvent.click(screen.getByRole('button', { name: 'Carry 1 good' }));
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    expect(document.body.textContent).toContain(`it is not known whether Lemons was added. ${CARRIED_ONCE}`);
    expect(document.body.textContent).not.toContain('Not added');
    expect(screen.getByTestId('carry-many-summary').textContent).toContain('For Lemons it is not known whether it was added.');
    expect(screen.getByRole('button', { name: 'Try the 1 again' })).not.toBeDisabled();
  });

  it('a name already carried is never sent again; only the refused line is', async () => {
    api.carry.mockImplementation(async (body: { displayName: string }) => {
      if (body.displayName === 'Lemons') throw answered(409);
      throw answered(403);
    });
    mount();
    paste('Lemons\nBread flour');
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 goods' }));
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    api.carry.mockClear();
    api.carry.mockImplementation(async (body: { displayName: string }) => ({ id: 'y', ...body }));
    fireEvent.click(screen.getByRole('button', { name: 'Try the 1 again' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(names()).toEqual(['Bread flour']);
  });

  it('keeps each answer when the page re-reads and the goods join the list', async () => {
    api.carry.mockImplementation(async (body: { displayName: string }) => {
      if (body.displayName === 'Lemons') throw answered(409);
      return { id: 'x', ...body };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const at = (listedNames: string[]) => (
      <QueryClientProvider client={qc}>
        <CarryMany restaurantId="r1" listedNames={listedNames} onClose={() => {}} />
      </QueryClientProvider>
    );
    const { rerender } = render(at([]));
    paste('Bread flour\nLemons');
    fireEvent.click(screen.getByRole('button', { name: 'Carry 2 goods' }));
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    rerender(at(['Bread flour', 'Lemons']));
    const rows = screen.getAllByTestId('carry-many-row').map((r) => r.textContent);
    expect(rows[0]).toContain('Carried.');
    expect(rows[1]).toContain('Already carried; nothing was added.');
    expect(rows.join(' ')).not.toContain('left out');
    expect(screen.getByRole('button', { name: 'Nothing left to carry' })).toBeDisabled();
  });

  it('keeps at most four in flight', async () => {
    let inFlight = 0;
    let most = 0;
    const gates: Array<() => void> = [];
    api.carry.mockImplementation(
      (body: { displayName: string }) =>
        new Promise((resolve) => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          gates.push(() => {
            inFlight -= 1;
            resolve({ id: body.displayName, ...body });
          });
        }),
    );
    mount();
    paste(['A', 'B', 'C', 'D', 'E', 'F'].join('\n'));
    fireEvent.click(screen.getByRole('button', { name: 'Carry 6 goods' }));
    await waitFor(() => expect(gates.length).toBe(4));
    while (gates.length > 0) {
      gates.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await waitFor(() => expect(screen.getByTestId('carry-many-summary')).toBeTruthy());
    expect(most).toBe(4);
    expect(api.carry).toHaveBeenCalledTimes(6);
  });
});


describe('Carry this leads to Carry many', () => {
  it('offers the list sheet when the page asks for it, and not otherwise', () => {
    const onMany = vi.fn();
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CarryThis restaurantId="r1" onClose={() => {}} onCarried={() => {}} onMany={onMany} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Carry many at once' }));
    expect(onMany).toHaveBeenCalledTimes(1);
    unmount();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <CarryThis restaurantId="r1" onClose={() => {}} onCarried={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('ivc-many')).toBeNull();
  });
});
