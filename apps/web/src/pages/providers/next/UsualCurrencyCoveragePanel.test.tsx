/**
 * The providers page's prompt panel — "Usual currencies stated".
 *
 * THE FOUNDER, 2026-09-06, batch 66, verbatim: *"Add the prompt panel"* — "One
 * panel on the providers page (and the orders sheet's empty field) saying how
 * many vendors have stated a usual currency and linking to the ones that have
 * not. No provenance lie."
 *
 * The three states the brief names are each pinned here:
 *   some stated — the fraction, and a link per unanswered vendor;
 *   none stated — a SENTENCE, never an empty panel, and every vendor listed;
 *   a failed read — the failure in words, and no number claimed.
 *
 * `apiClient` is mocked, so these assert what the panel does with the gateway's
 * answers, never that the gateway gives them. The sentence itself is the
 * gateway's, printed verbatim: its wording is pinned in the gateway's own
 * `usual-currency-coverage.spec.ts`, and a second copy here would drift.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));

import { UsualCurrencyCoveragePanel } from './UsualCurrencyCoveragePanel';

const opened: string[] = [];

function renderIt(known: string[] = ['b', 'c']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UsualCurrencyCoveragePanel
        knownIds={new Set(known)}
        onOpenVendor={(id) => opened.push(id)}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  opened.length = 0;
});

describe('the usual-currency coverage panel', () => {
  it('prints the fraction and links every vendor that has stated none', async () => {
    api.get.mockResolvedValue({
      data: {
        stated: 3,
        total: 14,
        unstated: [
          { id: 'b', name: 'Bodega Álvaro', recorded: null },
          { id: 'c', name: 'Cellar Nine', recorded: null },
        ],
        sentence: '3 of your 14 vendors have stated a usual currency.',
      },
    });
    renderIt();

    expect(
      await screen.findByText('3 of your 14 vendors have stated a usual currency.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bodega Álvaro' }));
    expect(opened).toEqual(['b']);
  });

  it('says NONE of them in words rather than rendering an empty panel', async () => {
    // A panel that draws nothing when the answer is "none of them" cannot be
    // told apart from one that failed to load.
    api.get.mockResolvedValue({
      data: {
        stated: 0,
        total: 14,
        unstated: [{ id: 'b', name: 'Bodega Álvaro', recorded: null }],
        sentence: 'None of your 14 vendors has stated a usual currency.',
      },
    });
    renderIt();

    expect(
      await screen.findByText('None of your 14 vendors has stated a usual currency.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('usual-currency-unstated')).toBeInTheDocument();
  });

  it('prints a failed read as a failure, and claims no count', async () => {
    api.get.mockRejectedValue({
      response: { data: { message: 'How many vendors have stated one could not be read (timeout).' } },
    });
    renderIt();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be read');
    expect(alert).toHaveTextContent('not a house whose vendors have stated none');
    expect(screen.queryByTestId('usual-currency-unstated')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usual-currency-coverage-sentence')).not.toBeInTheDocument();
  });

  it('names a vendor holding a value that is not a currency', async () => {
    api.get.mockResolvedValue({
      data: {
        stated: 0,
        total: 1,
        unstated: [{ id: 'b', name: 'Zed Cellars', recorded: 'ZZZ' }],
        sentence: 'None of your 1 vendor has stated a usual currency.',
      },
    });
    renderIt(['b']);
    expect(
      await screen.findByRole('button', {
        name: 'Zed Cellars — recorded as ZZZ, which is not a currency',
      }),
    ).toBeInTheDocument();
  });

  it('does not offer a click it cannot honour', async () => {
    // The grid does not hold this vendor, so nothing here can open its profile;
    // a button that silently does nothing would be worse than saying so.
    api.get.mockResolvedValue({
      data: {
        stated: 0,
        total: 1,
        unstated: [{ id: 'gone', name: 'Retired Imports', recorded: null }],
        sentence: 'None of your 1 vendor has stated a usual currency.',
      },
    });
    renderIt(['b']);
    expect(await screen.findByText(/Retired Imports \(not in the list below\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retired Imports/ })).not.toBeInTheDocument();
  });

  it('keeps the heading up while it is still counting', async () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    renderIt();
    await waitFor(() =>
      expect(screen.getByText(/Counting how many vendors/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Usual currencies stated')).toBeInTheDocument();
  });
});
