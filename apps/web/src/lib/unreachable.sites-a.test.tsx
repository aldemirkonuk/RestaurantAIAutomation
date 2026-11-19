/**
 * r83 errors-rest, PR A (settings, team, providers): every site below used to
 * print axios's "Network Error" straight into a sentence. Each one now says
 * the unreachable words when the call got no answer (ERR_NETWORK, no response)
 * and still prints its own message when an answer arrived.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UNREACHABLE_WORDS } from './unreachable';

const noAnswer = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const answered = Object.assign(new Error('Network Error'), {
  code: 'ERR_NETWORK',
  response: { status: 502 },
});

const mocks = vi.hoisted(() => ({
  getTargetMargin: vi.fn(),
  getFormerStaff: vi.fn(),
  getMyWeek: vi.fn(),
  getTeamNotes: vi.fn(),
  getWeek: vi.fn(),
  providers: { current: {} as Record<string, unknown> },
}));

vi.mock('@/services/api/pricing', () => ({
  getTargetMargin: mocks.getTargetMargin,
  setTargetMargin: vi.fn(),
  confirmPourSize: vi.fn(),
}));
vi.mock('@/components/mudavym', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Wordmark: () => null,
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', user: { restaurantId: 'r1' } }),
}));
vi.mock('../pages/team/next/AwayCard', () => ({ AwayCard: () => null, HouseAwayCard: () => null }));
vi.mock('../pages/team/next/useHouseAreas', () => ({ useHouseAreas: () => ({ areas: null }) }));
vi.mock('../services/api/team', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getFormerStaff: mocks.getFormerStaff,
  getMyWeek: mocks.getMyWeek,
  getTeamNotes: mocks.getTeamNotes,
  getWeek: mocks.getWeek,
}));
vi.mock('../hooks/queries/useProviderQueries', () => ({
  useProviders: () => mocks.providers.current,
}));
vi.mock('../hooks/queries/useOrderQueries', () => ({
  useOrders: () => ({ data: undefined, refetch: vi.fn() }),
}));

import { TargetMarginSection } from '../pages/settings/next/TargetMarginSection';
import { FormerStaffSheet } from '../pages/team/next/FormerStaff';
import { MyShiftsNext } from '../pages/team/next/MyShiftsNext';
import { useTeamNextData } from '../pages/team/next/useTeamNextData';
import { useProvidersNextData } from '../pages/providers/next/useProvidersNextData';
import { serverMessage } from '../pages/providers/next/scorecard/useVendorScorecard';

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings: target margin read', () => {
  it('says the unreachable words, not "Network Error"', async () => {
    mocks.getTargetMargin.mockRejectedValue(noAnswer);
    render(<TargetMarginSection canManage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(UNREACHABLE_WORDS);
    expect(alert).not.toHaveTextContent('Network Error');
  });
});

describe('team', () => {
  it('former staff: the read sentence says the unreachable words', async () => {
    mocks.getFormerStaff.mockRejectedValue(noAnswer);
    render(<FormerStaffSheet onClose={() => {}} />, { wrapper: wrap });
    const el = await screen.findByText(/former-staff history could not be read/);
    expect(el).toHaveTextContent(UNREACHABLE_WORDS);
    expect(el).not.toHaveTextContent('Network Error');
  });

  it('my shifts: both banner sentences say the unreachable words', async () => {
    mocks.getMyWeek.mockRejectedValue(noAnswer);
    mocks.getTeamNotes.mockResolvedValue({ notes: [], readable: true, reason: null });
    render(<MyShiftsNext />, { wrapper: wrap });
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(UNREACHABLE_WORDS);
    expect(banner).not.toHaveTextContent('Network Error');
  });

  it('week hook: errorMessage is the unreachable words', async () => {
    mocks.getWeek.mockRejectedValue(noAnswer);
    const { result } = renderHook(() => useTeamNextData('2026-08-31'), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.errorMessage).toBe(UNREACHABLE_WORDS);
  });
});

describe('providers', () => {
  it('providers hook: errorMessage is the unreachable words, an answered failure keeps its own', () => {
    mocks.providers.current = { data: undefined, isError: true, error: noAnswer, refetch: vi.fn() };
    expect(renderHook(() => useProvidersNextData()).result.current.errorMessage).toBe(UNREACHABLE_WORDS);
    mocks.providers.current = { data: undefined, isError: true, error: answered, refetch: vi.fn() };
    expect(renderHook(() => useProvidersNextData()).result.current.errorMessage).toBe('Network Error');
  });

  it('scorecard serverMessage puts the unreachable words in the fallback sentence', () => {
    expect(serverMessage(noAnswer, 'The card could not be read')).toBe(
      `The card could not be read (${UNREACHABLE_WORDS})`,
    );
    expect(serverMessage(new Error('boom'), 'x')).toBe('x (boom)');
  });
});
