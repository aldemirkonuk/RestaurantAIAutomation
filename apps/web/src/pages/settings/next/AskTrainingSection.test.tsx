/**
 * Questions and training -- the owner's switch (ADR 0145, founder 2026-09-21,
 * his pick verbatim: "Same as the wine pool (Recommended)": "A notice in our
 * Terms and on /ask, and an owner opt-out per house. Names are removed before
 * any export.").
 *
 * The component is rendered directly; its mounting is asserted in
 * `SettingsNext.test.tsx`. The owner rule itself is the gateway's
 * (`house-ask-training.spec.ts`); these tests hold what the page says.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AskTrainingSection } from './AskTrainingSection';
import type { SettingsNextData } from './useSettingsNextData';

function remote(data: unknown, status = 'ok') {
  return { status, data, error: status === 'error' ? 'gateway unreachable' : null, reload: vi.fn(), set: vi.fn() };
}

function reg(over: Record<string, unknown> = {}) {
  return { restaurantId: 'r1', optedOut: false, readable: true, reason: null, statedAt: null, statedBy: null, ...over };
}

function mount(over: Record<string, unknown> = {}) {
  const saveAskTraining = vi.fn(() => Promise.resolve(true));
  const data = {
    isOwner: true,
    saveAskTraining,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseAskTraining: remote(reg()),
    ...over,
  } as unknown as SettingsNextData;
  render(<AskTrainingSection data={data} />);
  return { saveAskTraining };
}

describe('the training choice -- what it says and who may change it', () => {
  it('nobody has answered: the default is on, and the page says the default is in force', () => {
    mount();
    const toggle = screen.getByRole('switch', { name: /improve Mudavym/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/the default is in force/i)).toBeInTheDocument();
    expect(screen.getByText(/Names are removed first/i)).toBeInTheDocument();
  });

  it('the owner turns it off: the page asks the gateway to opt the house out', () => {
    const { saveAskTraining } = mount();
    fireEvent.click(screen.getByRole('switch', { name: /improve Mudavym/i }));
    expect(saveAskTraining).toHaveBeenCalledWith(true);
  });

  it('opted out: the switch is off, and answering is said to be unaffected', () => {
    const { saveAskTraining } = mount({
      houseAskTraining: remote(reg({ optedOut: true, statedAt: new Date().toISOString(), statedBy: { userId: 'u1', name: 'Burak' } })),
    });
    const toggle = screen.getByRole('switch', { name: /improve Mudavym/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/kept out of any training/i)).toBeInTheDocument();
    expect(screen.getByText(/set by · Burak/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(saveAskTraining).toHaveBeenCalledWith(false);
  });

  it('a manager sees the choice, cannot flip it, and is told only the owner can', () => {
    const { saveAskTraining } = mount({ isOwner: false });
    const toggle = screen.getByRole('switch', { name: /improve Mudavym/i });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(saveAskTraining).not.toHaveBeenCalled();
    expect(screen.getByText(/Only the house’s owner can change this/i)).toBeInTheDocument();
  });

  it('a failed read says so, and is never shown as the default', () => {
    mount({ houseAskTraining: remote(reg({ readable: false, reason: 'timeout' })) });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read — timeout/);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('a change the audit trail missed is said out loud', () => {
    mount({ houseAskTraining: remote(reg({ optedOut: true, audited: false, auditReason: 'insert refused' })) });
    expect(screen.getByRole('alert')).toHaveTextContent(/not written to the trail — insert refused/);
  });
});
