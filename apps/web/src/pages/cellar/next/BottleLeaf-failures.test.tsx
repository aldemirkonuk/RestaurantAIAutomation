/**
 * BottleLeaf's two writes, failed (inventory r40, INV-W31 carried to /cellar):
 * the vendor order and "Bring into the cellar". Each failure is said once, in
 * the house's words: never "Request failed with status code 500", never "the
 * gateway refused it", and a 5xx or no answer is "not known", never "Nothing
 * was sent" or "Nothing was booked", with what to look at before trying again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import type { BottleVM, CellarRow } from './useCellarNextData';

const api = vi.hoisted(() => ({
  post: vi.fn(),
  bringIn: vi.fn(),
}));

vi.mock('../../../services/api/client', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, apiClient: { ...(real.apiClient as object), post: api.post } };
});
vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({
    mutate: (body: unknown, opts: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      api.bringIn(body).then(
        () => opts.onSuccess?.(),
        (e: unknown) => opts.onError?.(e),
      );
    },
    isPending: false,
  }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));
vi.mock('../../../services/api/pricing', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listPriceLocks: async () => ({
    restaurantId: 'r1',
    generatedAt: '2026-09-21T12:00:00Z',
    readable: true,
    reason: null,
    scope: 'this house' as const,
    currentMenus: [],
    locks: [],
    counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 },
    namesReadable: true,
    namesReason: null,
    markersReadable: true,
    markersReason: null,
  }),
}));
vi.mock('./useHouseMoney', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useHouseMoney: () => (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`),
}));
vi.mock('./useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarSettings: () => ({
    data: {
      restaurantId: 'r1',
      holdCeremony: 'auto',
      holdCeremonyConfigured: true,
      gazetteerMeasures: ['bottles'],
      gazetteerMeasuresConfigured: false,
      setBy: null,
      setAt: null,
      readable: true,
      readError: null,
    },
    loading: false,
    save: { mutateAsync: vi.fn(), isPending: false, isError: false, error: null },
  }),
}));

import BottleLeaf from './BottleLeaf';

function cellarRow(over: Partial<CellarRow> = {}): CellarRow {
  return {
    inventoryId: 'inv-1',
    stockLive: 9,
    thresholdMin: 12,
    providerId: 'v1',
    providerName: 'Rossi',
    lastCountedAt: null,
    glassesPerBottle: null,
    menuPriceGlass: null,
    menuPriceBottle: null,
    velocityPerDay: null,
    daysSinceSale: null,
    analyticsReadable: true,
    ...over,
  };
}

function bottle(cellar: CellarRow | null): BottleVM {
  return {
    id: 'w1',
    name: 'Boğazkere 2021',
    producer: 'Kavaklıdere',
    houseOwn: false,
    grape: 'Boğazkere',
    country: 'Türkiye',
    region: 'Diyarbakır',
    appellation: null,
    style: 'Red',
    vintage: 2021,
    listPrice: 62,
    marketPrice: null,
    bottleSizeMl: 750,
    description: null,
    tastingNotes: null,
    pairingNotes: null,
    imageUrl: null,
    knowledge: 'inferred',
    observedAt: null,
    cellar,
    beverageKind: 'wine',
    structure: null,
  };
}

function mount(cellar: CellarRow | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BottleLeaf
        bottle={bottle(cellar)}
        providers={[{ id: 'v1', name: 'Rossi' } as never]}
        vendorsError={null}
        restaurantId="r1"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

function answered(status: number, message?: unknown): AxiosError {
  const response = {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: message === undefined ? {} : { message },
  } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, {}, response);
}

function unanswered(): AxiosError {
  const e = new AxiosError('Network Error', 'ERR_NETWORK', undefined, {});
  e.request = {};
  return e;
}

function order() {
  const hold = screen.getByRole('button', { name: /^Hold to order \d+ from Rossi/ });
  fireEvent.keyDown(hold, { key: 'Enter' });
  fireEvent.keyDown(hold, { key: 'Enter' });
}

const body = () => document.body.textContent ?? '';

beforeEach(() => {
  api.post.mockReset();
  api.bringIn.mockReset();
});

describe('BottleLeaf — a vendor order that failed', () => {
  it('a refused order says why once, in plain words, and that nothing was sent', async () => {
    api.post.mockRejectedValue(answered(403));
    mount(cellarRow());
    order();
    await waitFor(() => expect(screen.getByTestId('order-ceremony-error')).toBeTruthy());
    expect(screen.getByTestId('order-ceremony-error').textContent).toBe(
      'Nothing was sent — this account is not allowed to do that in this house. Try again when ready.',
    );
    expect(body()).not.toMatch(/status code|gateway/i);
    // Said once: no second line under the leaf.
    expect(body().split('Nothing was sent').length - 1).toBe(1);
  });

  it('keeps the server\'s own sentence when it is written for a person', async () => {
    api.post.mockRejectedValue(answered(400, 'This vendor takes orders by the case only'));
    mount(cellarRow());
    order();
    await waitFor(() => expect(screen.getByTestId('order-ceremony-error')).toBeTruthy());
    expect(screen.getByTestId('order-ceremony-error').textContent).toBe(
      'Nothing was sent — this vendor takes orders by the case only. Try again when ready.',
    );
  });

  it('a 5xx is not known, never "Nothing was sent", and says to look on Orders first', async () => {
    api.post.mockRejectedValue(answered(502));
    mount(cellarRow());
    order();
    await waitFor(() => expect(screen.getByTestId('order-ceremony-error')).toBeTruthy());
    expect(screen.getByTestId('order-ceremony-error').textContent).toBe(
      'It is not known whether the order was sent — the server failed before it could answer. Look on Orders before ordering it again.',
    );
    expect(body()).not.toContain('Nothing was sent');
    expect(body()).not.toContain('Try again when ready');
  });

  it('no answer at all is not known too', async () => {
    api.post.mockRejectedValue(unanswered());
    mount(cellarRow());
    order();
    await waitFor(() => expect(screen.getByTestId('order-ceremony-error')).toBeTruthy());
    expect(screen.getByTestId('order-ceremony-error').textContent).toBe(
      'It is not known whether the order was sent — no answer came back. Look on Orders before ordering it again.',
    );
  });
});

describe('BottleLeaf — bringing a bottle in, failed', () => {
  function bringIn() {
    fireEvent.click(screen.getByRole('button', { name: 'Bring into the cellar' }));
  }

  it('a refused bring-in says nothing was booked, and why, in plain words', async () => {
    api.bringIn.mockRejectedValue(answered(422));
    mount(null);
    bringIn();
    await waitFor(() => expect(body()).toContain('Nothing was booked'));
    expect(body()).toContain('Nothing was booked — the server did not accept it as sent.');
    expect(body()).not.toMatch(/status code|no reason given/i);
  });

  it('an unanswered bring-in is not known, and says to look at the cellar so it is not booked twice', async () => {
    api.bringIn.mockRejectedValue(answered(500));
    mount(null);
    bringIn();
    await waitFor(() => expect(body()).toContain('it is not known whether the bottles were booked'));
    expect(body()).toContain(
      'The server failed before it could answer, so it is not known whether the bottles were booked. Look at the cellar before trying again, so they are not booked twice.',
    );
    expect(body()).not.toContain('Nothing was booked');
  });

  it('a bring-in that failed on this device says so, never "no reason given"', async () => {
    api.bringIn.mockRejectedValue(new Error('No restaurant selected'));
    mount(null);
    bringIn();
    await waitFor(() => expect(body()).toContain('Nothing was booked'));
    expect(body()).toContain('Nothing was booked — no restaurant selected.');
  });
});
