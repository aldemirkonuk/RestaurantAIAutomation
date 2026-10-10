/**
 * The two-step confirm on every seal (F-723, F-726).
 *
 * Keyboard, and the pointer under reduced motion, arm a seal on the first
 * press and commit on the second. A double-tap of Enter or a double-click is
 * one reflex, not two decisions, so the second press only counts once
 * `sealTiming.confirmGapMs` has passed; a held key's repeats never count.
 * Esc on an armed seal disarms it and must not also close the Sheet around it.
 *
 * The test setup lifts the gap for the other seal tests; here it is put back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HoldToApprove } from './HoldToApprove';
import { DoorSeal } from '@/pages/receiving/next/DoorSeal';
import { BulkApproveBar } from '@/pages/orders/next/BulkApproveBar';
import type { OrderRowVM } from '@/pages/orders/next/useOrdersNextData';
import { sealTiming } from '@/lib/mudavym/motion';

const mutateAsync = vi.fn().mockResolvedValue({});
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => ({ mutateAsync }),
}));
vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: vi.fn().mockResolvedValue('tok'),
}));

let now = 1_000_000;
const later = (ms: number) => {
  now += ms;
};

const enter = (el: HTMLElement, repeat = false) =>
  fireEvent.keyDown(el, { key: 'Enter', repeat });

function reducedMotion(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: on && query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

let clock: { mockRestore: () => void };
beforeEach(() => {
  sealTiming.confirmGapMs = 400;
  now = 1_000_000;
  clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  mutateAsync.mockClear();
  reducedMotion(false);
});

afterEach(() => {
  clock.mockRestore();
  sealTiming.confirmGapMs = 0;
});

describe('HoldToApprove two-step confirm', () => {
  it('a double Enter does not approve; the seal stays armed', async () => {
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);
    const btn = screen.getByRole('button');

    enter(btn);
    later(30);
    enter(btn);

    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText(/press enter again to approve/i)).toBeInTheDocument();
  });

  it('a second Enter after the gap approves', async () => {
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);
    const btn = screen.getByRole('button');

    enter(btn);
    later(30);
    enter(btn); // too soon: ignored
    later(400);
    enter(btn);

    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
  });

  it('a held key repeating never approves, however long it is held', () => {
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);
    const btn = screen.getByRole('button');

    enter(btn);
    later(500);
    enter(btn, true);
    later(500);
    enter(btn, true);

    expect(onApprove).not.toHaveBeenCalled();
  });

  it('under reduced motion a double-click does not approve', async () => {
    reducedMotion(true);
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);
    const btn = screen.getByRole('button');

    fireEvent.pointerDown(btn);
    later(80);
    fireEvent.pointerDown(btn);
    expect(onApprove).not.toHaveBeenCalled();

    later(400);
    fireEvent.pointerDown(btn);
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
  });

  it('Esc on an armed seal disarms it and does not reach the Sheet behind it', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<HoldToApprove onApprove={vi.fn()} label="Approve" />);
      const btn = screen.getByRole('button');

      enter(btn);
      fireEvent.keyDown(btn, { key: 'Escape' });

      expect(onWindowKey).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'Escape' }),
      );
      expect(screen.queryByText(/press enter again to approve/i)).not.toBeInTheDocument();

      // Not armed, Esc is not the seal's to keep: it travels on as before.
      fireEvent.keyDown(btn, { key: 'Escape' });
      expect(onWindowKey).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});

describe('DoorSeal two-step confirm', () => {
  it('a double Enter does not seal; a second press after the gap does', () => {
    const onSeal = vi.fn();
    render(<DoorSeal onSeal={onSeal} />);
    const btn = screen.getByRole('button');

    enter(btn);
    later(30);
    enter(btn);
    expect(onSeal).not.toHaveBeenCalled();

    later(400);
    enter(btn);
    expect(onSeal).toHaveBeenCalledTimes(1);
  });

  it('Esc on an armed seal does not travel on to the Sheet', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<DoorSeal onSeal={vi.fn()} />);
      const btn = screen.getByRole('button');
      enter(btn);
      fireEvent.keyDown(btn, { key: 'Escape' });
      expect(onWindowKey).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'Escape' }),
      );
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});

describe('BulkApproveBar two-step confirm', () => {
  const rows = [
    { id: 'o1', total: 100 },
    { id: 'o2', total: 50 },
  ] as unknown as OrderRowVM[];

  it('a double Enter approves nothing; a second press after the gap runs', async () => {
    const onRunningChange = vi.fn();
    render(
      <BulkApproveBar
        selectedRows={rows}
        onClear={vi.fn()}
        onApproved={vi.fn()}
        onRunningChange={onRunningChange}
      />,
    );
    const btn = screen.getByRole('button', { name: /hold to approve 2 orders/i });

    enter(btn);
    later(30);
    enter(btn);
    // The approvals wait on the seals, which resolve on a later turn.
    await new Promise((r) => setTimeout(r, 30));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onRunningChange).not.toHaveBeenCalled();

    later(400);
    enter(btn);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });
});
