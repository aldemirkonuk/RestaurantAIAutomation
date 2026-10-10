/**
 * F-775 — a 409 in a bulk run is not "refused, still pending".
 *
 * The gateway answers 409 `order_already_approved` when a second manager or a
 * stale tab seals an order someone already sealed. The bar used to count that
 * as refused, drop the sentence (only a 403's was kept) and say "still pending,
 * still selected" about an approved order. These cases pin the three outcomes
 * apart: already approved is settled and leaves the selection; any other 409
 * prints its own sentence and stays selected; a plain refusal keeps the old
 * "still pending" words.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const approveMock = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => approveMock,
}));

vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: vi.fn(async (id: string) => `seal-${id}`),
}));

vi.mock('@/lib/mudavym/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mudavym/motion')>()),
  animate: vi.fn(),
  useReducedMotion: () => false,
}));

import { BulkApproveBar } from './BulkApproveBar';
import type { OrderRowVM } from './useOrdersNextData';

const rowsOf = (...ids: string[]) =>
  ids.map((id) => ({ id, total: 100 }) as unknown as OrderRowVM);

const conflict = (reason: string, message: string) =>
  Object.assign(new Error(message), { response: { status: 409, data: { reason, message } } });

const ALREADY =
  'This order is already approved, so there is nothing to approve again. Nothing was changed.';
const CHANGED =
  'Someone else changed this order while it was being approved, so this approval was not written. Open the order again to see where it stands.';

async function runBar(ids: string[]) {
  const onApproved = vi.fn();
  render(
    <BulkApproveBar
      selectedRows={rowsOf(...ids)}
      onClear={() => {}}
      onApproved={onApproved}
      onRunningChange={() => {}}
    />,
  );
  const die = screen.getByRole('button', { name: /hold to approve/i });
  // Keyboard path: Enter arms, Enter again approves.
  fireEvent.keyDown(die, { key: 'Enter' });
  await act(async () => {
    fireEvent.keyDown(die, { key: 'Enter' });
  });
  await screen.findByText(/approved — one impression/i);
  return onApproved;
}

beforeEach(() => {
  approveMock.mutateAsync.mockReset();
});

describe('BulkApproveBar and a 409', () => {
  it('treats an order that is already approved as settled: deselected, not refused', async () => {
    approveMock.mutateAsync.mockImplementation(async ({ orderId }: { orderId: string }) => {
      if (orderId === 'o-2') throw conflict('order_already_approved', ALREADY);
      return {};
    });

    const onApproved = await runBar(['o-1', 'o-2']);

    expect(onApproved).toHaveBeenCalledWith(['o-1', 'o-2']);
    expect(screen.getByText(/1 already approved — nothing to do\./i)).toBeInTheDocument();
    expect(screen.queryByText(/still pending/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refused/i)).not.toBeInTheDocument();
  });

  it('prints any other 409 sentence verbatim and keeps that order selected', async () => {
    approveMock.mutateAsync.mockImplementation(async ({ orderId }: { orderId: string }) => {
      if (orderId === 'o-2') throw conflict('order_changed_while_approving', CHANGED);
      return {};
    });

    const onApproved = await runBar(['o-1', 'o-2']);

    expect(onApproved).toHaveBeenCalledWith(['o-1']);
    expect(screen.getByRole('status')).toHaveTextContent(CHANGED);
    expect(screen.queryByText(/still pending/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1 not approved — still selected/i)).toBeInTheDocument();
  });

  it('still names a plain refusal as pending', async () => {
    approveMock.mutateAsync.mockImplementation(async ({ orderId }: { orderId: string }) => {
      if (orderId === 'o-2') {
        throw Object.assign(new Error('Network Error'), { response: { status: 500 } });
      }
      return {};
    });

    const onApproved = await runBar(['o-1', 'o-2']);

    expect(onApproved).toHaveBeenCalledWith(['o-1']);
    expect(
      screen.getByText(/1 refused by the gateway — still pending, still selected\./i),
    ).toBeInTheDocument();
  });
});
