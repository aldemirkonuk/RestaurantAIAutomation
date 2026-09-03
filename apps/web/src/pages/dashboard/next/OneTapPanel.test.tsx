/**
 * OneTapPanel — the rail contract, on the page the founder moved it to.
 *
 * What this asserts is exactly what the move promised:
 *
 *  - the panel is on the dashboard rail and reads the guarded gateway module,
 *    tenant-keyed, with nothing borrowed from `/notifications`;
 *  - the honesty line that must never be dropped is on screen: marking an
 *    action done RECORDS a decision — `triggerWorkflow` is TODO stubs, so the
 *    seal never means "the house did it";
 *  - a house-raised action (no author) is told apart from a person-raised one
 *    STRUCTURALLY, and the house one carries the dashed calm edge;
 *  - an unreadable register says so in words and is never drawn as an empty
 *    desk — the "absence reported as health" rule;
 *  - the die reaches the real execute endpoint, and only after the hold;
 *  - a response that arrives AFTER the restaurant was switched is discarded —
 *    the rail must never show the previous house's actions.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    post: (...args: unknown[]) => api.post(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import OneTapPanel from './OneTapPanel';

const houseRaised = {
  id: 'a1',
  restaurantId: 'rest-A',
  userId: null,
  actionType: 'low_stock',
  title: 'Reorder the Rioja',
  description: 'Six bottles left against a par of twenty-four.',
  actionUrl: '/inventory?filter=low-stock',
  priority: 'high',
  status: 'pending',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
};

const personRaised = {
  ...houseRaised,
  id: 'a2',
  userId: 'user-1',
  actionType: 'custom',
  title: 'Call the cellar about Thursday',
  description: undefined,
  actionUrl: undefined,
  priority: 'low',
};

function serve(rows: unknown[]) {
  api.get.mockResolvedValue({ data: { actions: rows } });
}

function draw(restaurantId: string | null = 'rest-A') {
  return render(
    <MemoryRouter>
      <OneTapPanel restaurantId={restaurantId} />
    </MemoryRouter>,
  );
}

/** A promise whose settlement this test controls, so a read can be left mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset().mockResolvedValue({ data: {} });
});

describe('OneTapPanel — the desk on the dashboard rail', () => {
  it('reads the guarded one-tap register, keyed by the active restaurant', async () => {
    serve([]);
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/one-tap-actions', {
      params: { restaurantId: 'rest-A' },
    });
  });

  it('does not read anything before the restaurant is known', () => {
    serve([]);
    draw(null);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByLabelText('One-tap actions')).toBeInTheDocument();
  });

  it('says plainly that “done” is a decision, not an order placed', async () => {
    serve([houseRaised]);
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() => expect(within(panel).getByText('Reorder the Rioja')).toBeInTheDocument());
    expect(
      within(panel).getByText(/the seal here means “decided”, never “done by the house”/),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/one-tap-actions\.service\.ts:404/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/It does not place the order itself/),
    ).toBeInTheDocument();
  });

  it('tells a house-raised action apart from a person-raised one, by author not by tone', async () => {
    serve([houseRaised, personRaised]);
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() => expect(within(panel).getByText('Reorder the Rioja')).toBeInTheDocument());

    expect(within(panel).getByText('Raised by the house · not done')).toBeInTheDocument();
    expect(within(panel).getByText('Raised by a person here')).toBeInTheDocument();

    // the calm contract is drawn, not described: the house card carries the
    // dashed edge, the person card does not.
    const houseCard = within(panel).getByText('Reorder the Rioja').closest('li');
    const personCard = within(panel)
      .getByText('Call the cellar about Thursday')
      .closest('li');
    expect(houseCard?.getAttribute('style')).toMatch(/dashed/);
    expect(personCard?.getAttribute('style')).not.toMatch(/dashed/);
  });

  it('commits through the real execute endpoint, and only after the hold', async () => {
    serve([houseRaised]);
    draw();
    await waitFor(() => expect(screen.getByText('Reorder the Rioja')).toBeInTheDocument());

    const die = screen.getByRole('button', { name: 'Hold to mark it done' });
    fireEvent.keyDown(die, { key: 'Enter' }); // arms
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.keyDown(die, { key: 'Enter' }); // approves
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/one-tap-actions/a1/execute', {}),
    );
  });

  it('creates a standing action against the gateway', async () => {
    serve([]);
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Write a new one'));
    fireEvent.change(screen.getByPlaceholderText(/Bodega Álvaro/), {
      target: { value: 'Chase the Chablis invoice' },
    });
    fireEvent.click(screen.getByText('Write it into the book'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/one-tap-actions',
        expect.objectContaining({
          title: 'Chase the Chablis invoice',
          actionType: 'custom',
          priority: 'medium',
        }),
      ),
    );
  });

  it('admits a broken register in words instead of drawing an empty desk', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('no route'), { response: { status: 500 } }));
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() =>
      expect(within(panel).getByText(/this is not an empty desk/)).toBeInTheDocument(),
    );
    expect(within(panel).queryByText(/Nothing standing/)).not.toBeInTheDocument();
  });

  it('tells a refusal apart from a breakage', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() =>
      expect(within(panel).getByText(/refused this account \(403\)/)).toBeInTheDocument(),
    );
    expect(within(panel).queryByText(/this is not an empty desk/)).not.toBeInTheDocument();
  });

  it('renders an em dash, not a zero, for the count while the register is unread', () => {
    api.get.mockReturnValue(new Promise(() => undefined)); // never settles
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    expect(within(panel).getByText('—')).toBeInTheDocument();
  });

  it('discards a response that lands after the restaurant was switched', async () => {
    // rest-A's read is left in flight; rest-B's read answers first and then
    // rest-A's arrives late. `tenant.current !== forTenant` at OneTapPanel.tsx:148
    // is the only thing standing between that and the previous house's actions
    // on screen.
    const a = deferred<{ data: unknown }>();
    const b = deferred<{ data: unknown }>();
    api.get.mockImplementation((_url: string, cfg: { params: { restaurantId: string } }) =>
      cfg.params.restaurantId === 'rest-A' ? a.promise : b.promise,
    );

    const { rerender } = draw('rest-A');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/one-tap-actions', {
        params: { restaurantId: 'rest-A' },
      }),
    );

    // Switch houses while rest-A is still in flight.
    rerender(
      <MemoryRouter>
        <OneTapPanel restaurantId="rest-B" />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/one-tap-actions', {
        params: { restaurantId: 'rest-B' },
      }),
    );

    // rest-B answers with its own single action…
    await act(async () => {
      b.resolve({ data: { actions: [{ ...personRaised, restaurantId: 'rest-B' }] } });
    });
    expect(
      await screen.findByText('Call the cellar about Thursday'),
    ).toBeInTheDocument();

    // …and then the stale rest-A response finally lands. It must change nothing.
    await act(async () => {
      a.resolve({ data: { actions: [{ ...houseRaised, restaurantId: 'rest-A' }] } });
    });

    expect(screen.queryByText('Reorder the Rioja')).not.toBeInTheDocument();
    expect(screen.getByText('Call the cellar about Thursday')).toBeInTheDocument();
    const panel = screen.getByLabelText('One-tap actions');
    expect(within(panel).queryByText('Raised by the house · not done')).not.toBeInTheDocument();
  });

  it('shows nothing from the previous house while the new one is still loading', async () => {
    // The other half of the same guard: the reset effect (OneTapPanel.tsx:135-139)
    // must blank the register on a switch rather than leaving rest-A's rows up
    // until rest-B answers.
    serve([houseRaised]);
    const { rerender } = draw('rest-A');
    expect(await screen.findByText('Reorder the Rioja')).toBeInTheDocument();

    const held = deferred<{ data: unknown }>();
    api.get.mockReturnValue(held.promise);
    rerender(
      <MemoryRouter>
        <OneTapPanel restaurantId="rest-B" />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Reorder the Rioja')).not.toBeInTheDocument();
    // and the count is an em dash, not a stale 1
    const panel = screen.getByLabelText('One-tap actions');
    expect(within(panel).getByText('—')).toBeInTheDocument();
    await act(async () => {
      held.resolve({ data: { actions: [] } });
    });
  });

  it('says a real empty desk in words', async () => {
    serve([]);
    draw();
    await waitFor(() =>
      expect(screen.getByText(/Nothing standing/)).toBeInTheDocument(),
    );
  });
});
