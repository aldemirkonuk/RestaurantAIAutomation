/** r36 menu audit N6: a line's house price history, newest first, read only. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriceHistory, versionWords } from './PriceHistory';
import { getHousePriceHistory, type HousePriceHistory, type HousePriceVersion } from '../../../services/api/priceHistory';

vi.mock('../../../services/api/priceHistory', () => ({ getHousePriceHistory: vi.fn() }));
const mockHistory = vi.mocked(getHousePriceHistory);
const money = (n: number) => `₺${n}`;

const ver = (over: Partial<HousePriceVersion> = {}): HousePriceVersion => ({
  bottle: 52,
  glass: null,
  from: '2026-11-02T10:00:00Z',
  to: null,
  source: 'manual',
  by: { userId: null, name: null },
  reason: null,
  ...over,
});
const hist = (over: Partial<HousePriceHistory> = {}): HousePriceHistory => ({
  inventoryId: 'g1',
  goodName: 'Chianti',
  versions: [],
  more: false,
  namesReadable: true,
  namesReason: null,
  ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PriceHistory inventoryId="g1" name="Chianti" money={money} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockHistory.mockReset();
});

describe('one change in words', () => {
  it('says the prices, when, how, who and why', () => {
    expect(versionWords(ver({ glass: 12.5, by: { userId: 'u1', name: 'Aylin' }, reason: 'supplier rise' }), money)).toBe(
      'bottle ₺52, glass ₺12.5, since 2026-11-02, set by hand, by Aylin (supplier rise).',
    );
    expect(versionWords(ver({ bottle: 48, from: '2026-10-01T09:00:00Z', to: '2026-11-02T10:00:00Z', source: 'import' }), money)).toBe(
      'bottle ₺48, 2026-10-01 to 2026-11-02, set from a menu.',
    );
    expect(versionWords(ver({ bottle: null, source: 'agent_accepted' }), money)).toBe('no price, since 2026-11-02, set accepting price advice.');
    expect(versionWords(ver({ source: 'backfill' }), money)).toBe('bottle ₺52, since 2026-11-02, set as it stood when price records began.');
    expect(versionWords(ver({ source: 'pos_sync' }), money)).toBe('bottle ₺52, since 2026-11-02, set pos sync.');
  });

  it('never leaves who blank when someone set it', () => {
    expect(versionWords(ver({ by: { userId: 'u9', name: null } }), money)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand, by someone whose name is not on record.',
    );
    expect(versionWords(ver({ by: { userId: 'u9', name: null } }), money, false)).toBe(
      'bottle ₺52, since 2026-11-02, set by hand, by someone not named here.',
    );
  });
});

describe('the history panel', () => {
  it('lists the changes newest first, and says when older ones are kept', async () => {
    mockHistory.mockResolvedValue(
      hist({ more: true, versions: [ver({ by: { userId: 'u1', name: 'Aylin' } }), ver({ bottle: 48, from: '2026-10-01T09:00:00Z', to: '2026-11-02T10:00:00Z', source: 'import' })] }),
    );
    mount();
    const items = await screen.findAllByTestId('menu-price-history-line');
    expect(items.map((i) => i.textContent)).toEqual([
      'bottle ₺52, since 2026-11-02, set by hand, by Aylin.',
      'bottle ₺48, 2026-10-01 to 2026-11-02, set from a menu.',
    ]);
    expect(screen.getByText('How the house price of Chianti changed, newest first (the last 2; older changes are kept):')).toBeTruthy();
    expect(mockHistory).toHaveBeenCalledWith('g1');
  });

  it('says no change was recorded, rather than an empty list', async () => {
    mockHistory.mockResolvedValue(hist());
    mount();
    expect(await screen.findByText('Chianti has no recorded price change yet.')).toBeTruthy();
    expect(screen.queryByTestId('menu-price-history-line')).toBeNull();
  });

  it('says who could not be named', async () => {
    mockHistory.mockResolvedValue(hist({ versions: [ver({ by: { userId: 'u1', name: null } })], namesReadable: false, namesReason: 'who changed these prices could not be named: denied' }));
    mount();
    expect(await screen.findByText('Not everyone could be named: who changed these prices could not be named: denied.')).toBeTruthy();
    expect(screen.getByTestId('menu-price-history-line').textContent).toBe('bottle ₺52, since 2026-11-02, set by hand, by someone not named here.');
  });

  it('a failed read is said in words, never as no history', async () => {
    mockHistory.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { message: 'The price history could not be read: timeout.' } } }));
    mount();
    expect((await screen.findByTestId('menu-price-history-error')).textContent).toBe(
      'The price history of Chianti could not be read (The price history could not be read: timeout).',
    );
    expect(screen.queryByText(/no recorded price change/)).toBeNull();
  });

  it('a refusal says who may read it', async () => {
    mockHistory.mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { message: 'Forbidden' } } }));
    mount();
    expect((await screen.findByTestId('menu-price-history-error')).textContent).toBe(
      'The price history of Chianti could not be read (only an owner or a manager reads it).',
    );
  });
});
