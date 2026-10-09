/**
 * BulkApproveBar — the paths that are not a pointer (F-319).
 *
 * "Approve all" is a hold. A screen reader or voice control presses it with a
 * bare click (`detail === 0`), which used to do nothing at all. It now takes
 * the same two steps as the keyboard; a mouse click still never approves.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrderRowVM } from './useOrdersNextData';

const mutateAsync = vi.fn(async () => ({}));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutateAsync }),
}));
vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: vi.fn(async (id: string) => `seal-${id}`),
}));

import { BulkApproveBar } from './BulkApproveBar';

const rows = [{ id: 'o-1', total: 10 }, { id: 'o-2', total: 20 }] as unknown as OrderRowVM[];

const mount = () =>
  render(
    <BulkApproveBar selectedRows={rows} onClear={vi.fn()} onApproved={vi.fn()} onRunningChange={vi.fn()} />,
  );
const bar = () => screen.getByRole('button', { name: /Hold to approve 2 orders/ });

beforeEach(() => mutateAsync.mockClear());

describe('BulkApproveBar without a pointer', () => {
  it('a screen-reader click arms, and a second one approves every row', async () => {
    mount();
    fireEvent.click(bar());
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(bar()).toHaveTextContent('Enter again to approve all');

    fireEvent.click(bar());
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });

  it('a mouse click never approves', async () => {
    mount();
    fireEvent.click(bar(), { detail: 1 });
    fireEvent.click(bar(), { detail: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('Enter then Enter approves, and is described by its status line', async () => {
    const user = userEvent.setup();
    mount();
    bar().focus();
    await user.keyboard('{Enter}');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(bar()).toHaveAccessibleDescription('Press Enter again to approve — Esc cancels.');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });
});
