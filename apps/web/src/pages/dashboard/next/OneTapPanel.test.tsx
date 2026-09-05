/**
 * OneTapPanel — the rail contract, on the page the founder moved it to.
 *
 * What this asserts is exactly what the move promised:
 *
 *  - the panel is on the dashboard rail and reads the guarded gateway module,
 *    tenant-keyed, with nothing borrowed from `/notifications`;
 *  - the first REAL action (2026-09-05) is sealed: confirming a delivery mints
 *    a one-time seal when the hold begins and carries it back in the header,
 *    and a mint that fails confirms nothing;
 *  - a written action is a RECORD and gets a plain button, not the wax;
 *  - every act that is not built is DISABLED and says so — no control here
 *    claims a write it never makes (ADR 0083);
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

/** The one act that really happens: a delivery, against a real order. */
const deliveryCard = {
  ...houseRaised,
  id: 'a3',
  actionType: 'delivery_confirm',
  title: 'Confirm the Barolo delivery',
  description: 'Six cases, expected today.',
  actionUrl: undefined,
  relatedOrderId: 'ord-9',
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

/**
 * Serve the register AND the note-close experiment.
 *
 * The experiment arm has to be routed by path rather than left to a blanket
 * `mockResolvedValue`. A blanket mock answers `GET /ux/experiments/...` with
 * `{ actions: [...] }`, whose `arm` is undefined, so the panel would fall back
 * to `plain` and every case below would quietly be testing the FALLBACK path —
 * passing for the wrong reason, and never touching a real assignment.
 * `plain` here is the arm 80% of houses are on. The die arm and the unreadable
 * fallback are covered in `note-close-experiment.test.tsx`.
 */
function serve(rows: unknown[], arm: 'plain' | 'die' = 'plain') {
  api.get.mockImplementation(async (path: string) =>
    String(path).startsWith('/ux/experiments')
      ? { data: { experimentKey: 'note_close_control', arm, recorded: true } }
      : { data: { actions: rows } },
  );
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

  it('says which single act on the desk is real, and that nothing here sends or orders', async () => {
    serve([houseRaised]);
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() => expect(within(panel).getByText('Reorder the Rioja')).toBeInTheDocument());
    expect(
      within(panel).getByText(/One act on this desk is real: confirming a delivery/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(/no control here sends a mail or places an order/),
    ).toBeInTheDocument();
  });

  it('disables the reorder and says why, instead of offering a button that refuses', async () => {
    // ADR 0083. The gateway refuses it too — that is the gate; this is the
    // manners, and a live button is a lie told before the refusal arrives.
    serve([houseRaised]);
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() => expect(within(panel).getByText('Reorder the Rioja')).toBeInTheDocument());

    expect(
      within(panel).getByText(/Reordering from here is not built/),
    ).toBeInTheDocument();
    const notBuilt = within(panel).getByRole('button', { name: /Not built yet/ });
    expect(notBuilt).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: /Hold to confirm/ })).toBeNull();
  });

  it('lets no unbuilt act fire, whatever its type', async () => {
    const types = [
      'low_stock',
      'price_change',
      'stock_receipt',
      'inequality',
      'vintage_sub',
      'gmail_send',
      'gmail_contextual',
      'teleport',
    ];
    serve(types.map((t, i) => ({ ...houseRaised, id: `u${i}`, actionType: t, title: `act ${t}` })));
    draw();
    const panel = screen.getByLabelText('One-tap actions');
    await waitFor(() => expect(within(panel).getByText('act low_stock')).toBeInTheDocument());

    const disabled = within(panel).getAllByRole('button', { name: /Not built yet/ });
    expect(disabled).toHaveLength(types.length);
    disabled.forEach((b) => expect(b).toBeDisabled());
    // Nothing was pressable, so nothing was posted.
    disabled.forEach((b) => fireEvent.click(b));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('mints the seal when the hold BEGINS and carries it back in the header', async () => {
    serve([deliveryCard]);
    api.post.mockImplementation(async (path: string) => {
      if (String(path).endsWith('/seal-challenge')) {
        return { data: { challenge: 'seal-token', expiresAt: 'later', act: 'deliver' } };
      }
      return {
        data: {
          ...deliveryCard,
          status: 'completed',
          executionResult: {
            act: 'deliver',
            orderNumber: 'PO-2026-0007',
            bottlesBooked: 72,
          },
        },
      };
    });
    draw();
    await waitFor(() => expect(screen.getByText('Confirm the Barolo delivery')).toBeInTheDocument());

    const die = screen.getByRole('button', { name: 'Hold to confirm the delivery' });
    fireEvent.keyDown(die, { key: 'Enter' }); // arms — and mints
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/one-tap-actions/a3/seal-challenge', {}),
    );
    // The mint happened, the write has not.
    expect(api.post).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(die, { key: 'Enter' }); // confirms
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/one-tap-actions/a3/execute',
        {},
        { headers: { 'X-Seal-Challenge': 'seal-token' } },
      ),
    );
  });

  it('confirms nothing when the seal is not issued', async () => {
    serve([deliveryCard]);
    api.post.mockImplementation(async (path: string) => {
      if (String(path).endsWith('/seal-challenge')) {
        const err = Object.assign(new Error('Request failed'), {
          response: { status: 400 },
          message: 'That order is already booked in as delivered, so nothing was changed.',
        });
        throw err;
      }
      return { data: {} };
    });
    draw();
    await waitFor(() => expect(screen.getByText('Confirm the Barolo delivery')).toBeInTheDocument());

    const die = screen.getByRole('button', { name: 'Hold to confirm the delivery' });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByText(/already booked in as delivered/)).toBeInTheDocument(),
    );
    expect(
      api.post.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith('/execute')),
    ).toHaveLength(0);
  });

  it('says how much was booked, from what the gateway recorded', async () => {
    serve([deliveryCard]);
    api.post.mockImplementation(async (path: string) => {
      if (String(path).endsWith('/seal-challenge')) {
        return { data: { challenge: 'seal-token' } };
      }
      return {
        data: {
          ...deliveryCard,
          status: 'completed',
          executionResult: { act: 'deliver', orderNumber: 'PO-2026-0007', bottlesBooked: 72 },
        },
      };
    });
    draw();
    await waitFor(() => expect(screen.getByText('Confirm the Barolo delivery')).toBeInTheDocument());

    const die = screen.getByRole('button', { name: 'Hold to confirm the delivery' });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });

    await waitFor(() =>
      expect(
        screen.getByText('Delivery confirmed on PO-2026-0007 — 72 bottles booked into stock.'),
      ).toBeInTheDocument(),
    );
  });

  it('renders an em dash, not a zero, when the booked count did not come back', async () => {
    serve([deliveryCard]);
    api.post.mockImplementation(async (path: string) => {
      if (String(path).endsWith('/seal-challenge')) return { data: { challenge: 't' } };
      return { data: { ...deliveryCard, status: 'completed', executionResult: { act: 'deliver' } } };
    });
    draw();
    await waitFor(() => expect(screen.getByText('Confirm the Barolo delivery')).toBeInTheDocument());

    const die = screen.getByRole('button', { name: 'Hold to confirm the delivery' });
    fireEvent.keyDown(die, { key: 'Enter' });
    fireEvent.keyDown(die, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByText(/the quantity booked came back as —\./)).toBeInTheDocument(),
    );
  });

  it('refuses a delivery card that names no order, without offering the die', async () => {
    serve([{ ...deliveryCard, relatedOrderId: null }]);
    draw();
    await waitFor(() => expect(screen.getByText('Confirm the Barolo delivery')).toBeInTheDocument());

    expect(screen.getByText(/names no order/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hold to confirm/ })).toBeNull();
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

  it('records a written action through the real endpoint, with no seal and no wax', async () => {
    // The rationing rule (dashboard.md §1b, §13.10): the wax goes where the
    // write is. A note commits none of the house's stock or money, so it gets
    // a plain button — and a die that means "recorded" beside a die that means
    // "done" is how the seal stops meaning anything.
    serve([personRaised]);
    draw();
    await waitFor(() => expect(screen.getByText('Call the cellar about Thursday')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /Hold to/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Mark it done/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/one-tap-actions/a2/execute', {}, undefined),
    );
    expect(
      api.post.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith('/seal-challenge')),
    ).toHaveLength(0);
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
    api.get.mockImplementation(
      (url: string, cfg?: { params?: { restaurantId?: string } }) => {
        // The experiment read carries no params and is not what this case is
        // about; answering it explicitly keeps the deferred pair to the register.
        if (String(url).startsWith('/ux/experiments'))
          return Promise.resolve({ data: { arm: 'plain', recorded: true } });
        return cfg?.params?.restaurantId === 'rest-A' ? a.promise : b.promise;
      },
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
