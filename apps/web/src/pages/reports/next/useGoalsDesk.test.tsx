/**
 * F-525: the book's proposal belongs to the house it was asked in. A switch
 * drops it, an ask that answers after a switch never lands on the next
 * house's desk, and placing refuses a proposal of another house.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const auth = vi.hoisted(() => ({ rid: 'house-a' as string | null }));
const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), put: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: 'owner' }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/hooks/useGoalScenarios', () => ({ useGoalScenarios: () => ({}) }));

import { useGoalsDesk } from './useGoalsDesk';

const SPEC = { data: { available: true, spec: { analysisId: 'till', graph: 'area', days: 90, why: 'Covers trend.' } } };

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const place = vi.fn();
  const hook = renderHook(() => useGoalsDesk({ place, queryRoot: 'reports' }), { wrapper });
  return { ...hook, place };
}

beforeEach(() => {
  auth.rid = 'house-a';
  api.post.mockReset();
});

describe('useGoalsDesk across a house switch (F-525)', () => {
  it('drops the last house’s proposal on a switch, and does not bring it back', async () => {
    api.post.mockResolvedValue(SPEC);
    const { result, rerender } = setup();
    act(() => result.current.ask('g1', 'Lift the till'));
    await waitFor(() => expect(result.current.proposal?.cutting?.id).toBe('till'));

    auth.rid = 'house-b';
    rerender();
    expect(result.current.proposal).toBeNull();
    auth.rid = 'house-a';
    rerender();
    expect(result.current.proposal).toBeNull();
  });

  it('an ask that answers after the switch never lands on the next house’s desk', async () => {
    let release: (v: unknown) => void = () => {};
    api.post.mockImplementation(() => new Promise((res) => (release = res)));
    const { result, rerender } = setup();
    act(() => result.current.ask('g1', 'Lift the till'));
    expect(api.post).toHaveBeenCalledWith('/analytics/goals/house-a/g1/cutting-spec', {});

    auth.rid = 'house-b';
    rerender();
    await act(async () => {
      release(SPEC);
    });
    expect(result.current.proposal).toBeNull();
    auth.rid = 'house-a';
    rerender();
    expect(result.current.proposal).toBeNull();
  });

  it('places a proposal only on the sheet of the house it was asked in', async () => {
    api.post.mockResolvedValue(SPEC);
    const { result, rerender, place } = setup();
    act(() => result.current.ask('g1', 'Lift the till'));
    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    // A card drawn before the switch, pressed after it.
    const staleDesk = result.current;
    const cutting = staleDesk.proposal!.cutting!;

    auth.rid = 'house-b';
    rerender();
    act(() => staleDesk.place(cutting));
    expect(place).not.toHaveBeenCalled();

    auth.rid = 'house-a';
    rerender();
    act(() => result.current.ask('g1', 'Lift the till'));
    await waitFor(() => expect(result.current.proposal).not.toBeNull());
    act(() => result.current.place(result.current.proposal!.cutting!));
    expect(place).toHaveBeenCalledWith({ id: 'till', graph: 'area', days: 90 });
  });
});

describe('useGoalsDesk writes answer whether they were kept (F-1285)', () => {
  const GOAL = {
    name: 'More tables with wine',
    metricKey: 'wine_attach_rate',
    targetValue: 0.35,
    deadline: null,
    direction: 'at_least' as const,
    period: 'week',
  };

  it('answers true once the gateway kept the goal', async () => {
    api.post.mockResolvedValue({ data: { id: 'g9' } });
    const { result } = setup();
    let kept: boolean | undefined;
    await act(async () => {
      kept = await result.current.create(GOAL);
    });
    expect(kept).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('answers false on a refusal and keeps the gateway’s reason', async () => {
    api.post.mockRejectedValue({ response: { data: { message: 'Set the time zone first.' } } });
    api.patch.mockRejectedValue({ response: { data: { message: 'Only owners and managers.' } } });
    const { result } = setup();
    let kept: boolean | undefined;
    await act(async () => {
      kept = await result.current.create(GOAL);
    });
    expect(kept).toBe(false);
    expect(result.current.error).toBe('Setting the goal did not go through: Set the time zone first.');
    await act(async () => {
      kept = await result.current.update('g1', { targetValue: 0.4 });
    });
    expect(kept).toBe(false);
  });
});
