/**
 * The cellar's two kinds of money (useHouseMoney.ts): the house's, in its own
 * currency; and a reference price, which names none. KEEP THIS FILE
 * BYTE-IDENTICAL on every branch that adds it, as its subject is.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REFERENCE_CURRENCY_NOTE, sayReference, useHouseMoney } from './useHouseMoney';

const house = vi.hoisted(() => ({
  read: (async () => ({ readable: true, code: 'TRY' })) as () => Promise<unknown>,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));
vi.mock('../../../services/api/settings', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    settingsApi: { ...(actual.settingsApi as object), houseCurrency: () => house.read() },
  };
});

function say() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useHouseMoney(), { wrapper });
}

beforeEach(() => {
  house.read = async () => ({ readable: true, code: 'TRY' });
});

describe("useHouseMoney: the house's own money", () => {
  it('a lira house reads lira, never $', async () => {
    const { result } = say();
    await waitFor(() => expect(result.current(14)).toBe('₺14.00'));
    expect(result.current(1234.5)).toBe('₺1,234.50');
  });

  it('a dollar house still reads dollars', async () => {
    house.read = async () => ({ readable: true, code: 'USD' });
    const { result } = say();
    await waitFor(() => expect(result.current(14)).toBe('$14.00'));
  });

  it('says … while the currency is read, never a bare figure', () => {
    house.read = () => new Promise(() => {});
    const { result } = say();
    expect(result.current(14)).toBe('…');
  });

  it('an unknown amount is the dash; a numeric string is its number', async () => {
    const { result } = say();
    await waitFor(() => expect(result.current(14)).toBe('₺14.00'));
    expect(result.current(null)).toBe('—');
    expect(result.current(Number.NaN)).toBe('—');
    expect(result.current('14' as unknown as number)).toBe('₺14.00');
  });

  it('an unreadable currency says so beside the figure', async () => {
    house.read = async () => ({ readable: false, code: null });
    const { result } = say();
    await waitFor(() => expect(result.current(14)).toBe("14.00 (the house's money could not be read)"));
  });

  it('no stated currency prints the figure with its caveat, never $', async () => {
    house.read = async () => ({ readable: true, code: null });
    const { result } = say();
    await waitFor(() => expect(result.current(14)).toMatch(/currency not recorded/));
    expect(result.current(14)).not.toMatch(/\$/);
  });
});

describe('sayReference: a price whose row names no currency', () => {
  it('is the bare figure and says its currency is not stated', () => {
    expect(sayReference(62)).toBe(`62.00 (${REFERENCE_CURRENCY_NOTE})`);
    expect(sayReference(1234.5, false)).toBe('1,234.50');
  });

  it('is the dash when unknown', () => {
    expect(sayReference(null)).toBe('—');
    expect(sayReference(undefined, false)).toBe('—');
  });
});
