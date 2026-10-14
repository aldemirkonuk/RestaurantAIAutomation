/**
 * The /reports page belongs to ONE house at a time: its clock (F-909) and,
 * across a switch, its own shelf and desk (F-910).
 *
 * F-909 — the till's calendar months and its "so far" follow the HOUSE's
 * clock, not the reader's device. The gateway refuses a month that has not
 * begun on the house's clock, so offering one is offering a 400.
 *
 * Two zones a day apart at one instant keep the test true whatever zone the
 * machine running it is in: at 00:30 UTC on 1 November it is already the
 * afternoon of 1 Nov on Kiritimati and still the afternoon of 31 Oct in Pago
 * Pago.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const auth = vi.hoisted(() => ({ rid: 'house-a' as string | null }));
const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), put: vi.fn() }));
const shelf = vi.hoisted(() => ({ list: vi.fn(), request: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: 'owner' }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/hooks/useGoalScenarios', () => ({ useGoalScenarios: () => ({}) }));
vi.mock('@/services/api/reports', () => ({
  REPORT_EXPORTS_PAGE_LIMIT: 20,
  listReportExports: (q: unknown) => shelf.list(q),
  requestReportExport: (b: unknown) => shelf.request(b),
  retryReportExport: vi.fn(),
  downloadReportExport: vi.fn(),
}));

import { TillWindowPicker } from './Cutting';
import { useReportExports } from './useReportExports';
import { useGoalsDesk } from './useGoalsDesk';
import { till } from './rp-registers-trade';
import { failureOf } from './rp-format';

const AHEAD = 'Pacific/Kiritimati';
const BEHIND = 'Pacific/Pago_Pago';

describe('the till month follows the house clock (F-909)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T00:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const firstMonth = (zone: string) => {
    const { unmount } = render(
      <TillWindowPicker days={30} onChange={() => {}} onMonth={() => {}} zone={zone} />,
    );
    const values = within(screen.getByRole('combobox', { name: 'Calendar month' }))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    unmount();
    return values;
  };

  it('offers the months up to the house’s month, not the device’s', () => {
    const behind = firstMonth(BEHIND);
    expect(behind[0]).toBe('2026-10');
    expect(behind).toHaveLength(24);
    expect(firstMonth(AHEAD)[0]).toBe('2026-11');
  });

  it('reaches the whole closing year in January, and its quarters (F-1604)', () => {
    vi.setSystemTime(new Date('2027-01-10T12:00:00Z'));
    const { unmount } = render(
      <TillWindowPicker days={30} onChange={() => {}} onMonth={() => {}} zone="Europe/Istanbul" />,
    );
    const values = (name: string) =>
      within(screen.getByRole('combobox', { name }))
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value)
        .filter(Boolean);
    expect(values('Calendar month')).toEqual(expect.arrayContaining(['2026-01', '2025-02']));
    expect(values('Calendar quarter')).toEqual(expect.arrayContaining(['2026-Q1', '2025-Q2']));
    unmount();
  });

  it('says "so far" of the house’s current month only', () => {
    const line = (zone: string) => till.window({ days: 30, month: '2026-10', zone });
    expect(line(BEHIND)).toContain(', so far');
    expect(line(AHEAD)).not.toContain('so far');
  });
});

describe('a refused read is said in the gateway’s words (F-909)', () => {
  it('keeps the gateway’s sentence for a 4xx, not the transport’s', () => {
    const err = {
      message: 'Request failed with status code 400',
      response: { status: 400, data: { message: 'November 2026 has not begun at the house yet.' } },
    };
    expect(failureOf(err)?.message).toBe('November 2026 has not begun at the house yet.');
  });

  it('keeps the transport’s message when the server failed with no sentence of its own', () => {
    const err = { message: 'Network Error', response: { status: 502, data: '<html>' } };
    expect(failureOf(err)?.message).toBe('Network Error');
  });
});

describe('a house switch leaves nothing of the last house’s shelf or desk (F-910)', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );

  beforeEach(() => {
    auth.rid = 'house-a';
    shelf.list.mockReset();
    shelf.request.mockReset();
    api.post.mockReset();
    shelf.list.mockResolvedValue({ exports: new Array(20).fill(null).map((_, i) => ({ id: `e${i}`, status: 'ready' })), total: 100 });
  });

  it('the shelf opens on page 1 of the new house, with no failure from the last', async () => {
    shelf.request.mockRejectedValue({ message: 'x', response: { data: { message: 'The window is closed.' } } });
    const { result, rerender } = renderHook(() => useReportExports({ queryRoot: 'reports' }), { wrapper });
    await waitFor(() => expect(result.current.exports).toHaveLength(20));
    act(() => result.current.request('till', 30));
    await waitFor(() => expect(result.current.error).toContain('The window is closed.'));
    await waitFor(() => expect(result.current.page).toBe(1));
    act(() => result.current.nextPage());
    act(() => result.current.nextPage());
    expect(result.current.page).toBe(3);

    auth.rid = 'house-b';
    rerender();
    expect(result.current.page).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('a shelf write that fails after the switch does not land on the next house', async () => {
    let fail: (e: unknown) => void = () => {};
    shelf.request.mockImplementation(() => new Promise((_, rej) => (fail = rej)));
    const { result, rerender } = renderHook(() => useReportExports({ queryRoot: 'reports' }), { wrapper });
    act(() => result.current.request('till', 30));
    auth.rid = 'house-b';
    rerender();
    await act(async () => fail({ message: 'Request failed with status code 500' }));
    expect(result.current.error).toBeNull();
  });

  it('a goal write that fails after the switch does not land on the next house’s desk', async () => {
    let fail: (e: unknown) => void = () => {};
    api.post.mockImplementation(() => new Promise((_, rej) => (fail = rej)));
    const { result, rerender } = renderHook(
      () => useGoalsDesk({ place: vi.fn(), queryRoot: 'reports' }),
      { wrapper },
    );
    act(() => result.current.create({ title: 'Lift the till' } as never));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    auth.rid = 'house-b';
    rerender();
    await act(async () => fail({ message: 'Request failed with status code 500' }));
    expect(result.current.error).toBeNull();
  });
});
