/**
 * F-416 (sim wave 9, 2026-10-09): one order over the manager's ceiling made
 * bulk approve approve NOTHING, with "The seals could not be issued".
 *
 * The gateway refuses the SEAL for everything that would refuse the approval,
 * so an over-ceiling order fails at the mint with the rule's own sentence. The
 * bar minted with `Promise.all`, so that one refusal threw the whole run away
 * and the sentence with it. Each order is decided on its own now: the ones
 * that minted are approved, the refused one stays selected with its reason.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

type ApproveInput = { orderId: string; challenge: string | null };
const approveMock = vi.hoisted(() => ({
  mutateAsync: vi.fn<(input: ApproveInput) => Promise<unknown>>(async () => ({})),
}));
const mintMock = vi.hoisted(() => vi.fn<(orderId: string) => Promise<string | null>>());

vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: (id: string) => mintMock(id),
}));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => approveMock,
}));
// Reduced motion: the keyboard path (Enter arms, Enter commits) and no WAAPI.
vi.mock('@/lib/mudavym/motion', () => ({
  animate: vi.fn(),
  pour: { ms: 1 },
  stamp: {},
  tuck: {},
  useReducedMotion: () => true,
}));
vi.mock('@/components/mudavym', () => ({ Seal: () => null }));

import { BulkApproveBar } from './BulkApproveBar';
import type { OrderRowVM } from './useOrdersNextData';

const CEILING =
  'This order is over the house ceiling of 2,500 — an owner has to sign it.';

function refusal(message: string, status = 403) {
  return Object.assign(new Error(message), { response: { status } });
}

const rows = (ids: string[]) =>
  ids.map((id) => ({ id, total: 100 }) as unknown as OrderRowVM);

function mount(ids: string[]) {
  const onApproved = vi.fn();
  render(
    <BulkApproveBar
      selectedRows={rows(ids)}
      onClear={vi.fn()}
      onApproved={onApproved}
      onRunningChange={vi.fn()}
    />,
  );
  const die = () => screen.getByRole('button', { name: /hold to approve/i });
  fireEvent.keyDown(die(), { key: 'Enter' });
  fireEvent.keyDown(die(), { key: 'Enter' });
  return { onApproved };
}

beforeEach(() => {
  approveMock.mutateAsync.mockReset();
  approveMock.mutateAsync.mockResolvedValue({});
  mintMock.mockReset();
});

describe('bulk approve — one refused seal refuses one order, not the run', () => {
  it('approves the orders that minted and keeps the refused one with its sentence', async () => {
    mintMock.mockImplementation(async (id) => {
      if (id === 'over') throw refusal(CEILING);
      return `seal-${id}`;
    });
    const { onApproved } = mount(['a', 'over', 'b']);

    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(onApproved).toHaveBeenCalledWith(['a', 'b']);
    expect(approveMock.mutateAsync).toHaveBeenCalledTimes(2);
    expect(approveMock.mutateAsync).toHaveBeenCalledWith({ orderId: 'a', challenge: 'seal-a' });
    expect(approveMock.mutateAsync).toHaveBeenCalledWith({ orderId: 'b', challenge: 'seal-b' });
    expect(approveMock.mutateAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'over' }),
    );
    expect(screen.getByText('2 approved — one impression.')).toBeTruthy();
    expect(screen.getByText(/1 refused by the gateway — still pending, still selected/)).toBeTruthy();
    expect(screen.getByText(CEILING)).toBeTruthy();
    expect(screen.queryByText(/could not be issued/)).toBeNull();
  });

  it('a mint that reached nobody still approves nothing and says so', async () => {
    mintMock.mockRejectedValue(refusal('Network Error', 0));
    const { onApproved } = mount(['a', 'b']);

    await waitFor(() =>
      expect(screen.getByText('The seals could not be issued — nothing approved.')).toBeTruthy(),
    );
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
  });
});
