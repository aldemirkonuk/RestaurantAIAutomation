/**
 * Two tabs on /team (integ8 two-tabs-races, wave 37):
 *
 *   F-1030  "Copy last week" sent `replaceTarget: true` always, so a tab
 *           loaded before another manager filled the week wiped it. It now
 *           sends the count the person was shown, and asks to replace only
 *           when there is something to replace.
 *   F-1032  the shift sheet sent `undefined` for an emptied person, role or
 *           note, which the gateway reads as "leave it", so "Open shift —
 *           nobody assigned" kept the person on. An edit now sends `null`.
 *   F-1033  the sheet sent the whole form back with nothing to compare, so a
 *           sheet opened earlier put the old person back. An edit now sends
 *           the person and `updated_at` it opened with.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const api = vi.hoisted(() => ({
  copyWeek: vi.fn((..._args: unknown[]) => Promise.resolve({ copied: 1, deleted: 0 })),
  updateShift: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  createShift: vi.fn((..._args: unknown[]) => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api/team')>()),
  copyWeek: api.copyWeek,
  updateShift: api.updateShift,
  createShift: api.createShift,
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
}));

import { ShiftSheet } from './ShiftSheet';
import { CopyWeekPanel } from './TeamOverlays';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** The seal on the keyboard: the first Enter arms it, the second approves. */
function hold(name: RegExp) {
  const die = screen.getByRole('button', { name });
  fireEvent.keyDown(die, { key: 'Enter' });
  fireEvent.keyDown(die, { key: 'Enter' });
}

const SHIFT = {
  id: 'sh1',
  restaurant_id: 'r1',
  schedule_id: 'sch1',
  member_id: 'm1',
  shift_date: '2026-09-07',
  start_time: '09:00',
  end_time: '17:00',
  role: 'Bar',
  shift_type: 'am',
  state: 'scheduled',
  note: 'Patio',
  recorded_break_min: 45,
  updated_at: '2026-09-01T10:00:00.123456+00:00',
};
const MEMBERS = [{ id: 'm1', display_name: 'Ada', status: 'active' }] as never;

beforeEach(() => {
  api.copyWeek.mockClear();
  api.updateShift.mockClear();
  api.createShift.mockClear();
});

describe('F-1030: a copy carries what the person was shown', () => {
  it('copies into an empty week without asking to replace it', async () => {
    render(
      <CopyWeekPanel weekStart="2026-09-07" shiftsOnTarget={0} onClose={() => {}} onDone={() => {}} />,
      { wrapper },
    );
    expect(screen.getByText(/nothing is deleted/)).toBeInTheDocument();
    hold(/Hold to copy last week/);
    await vi.waitFor(() => expect(api.copyWeek).toHaveBeenCalled());
    expect(api.copyWeek.mock.calls[0][2]).toEqual({ replaceTarget: false, expectShifts: 0 });
  });

  it('replaces a filled week only with the count it showed', async () => {
    render(
      <CopyWeekPanel weekStart="2026-09-07" shiftsOnTarget={3} onClose={() => {}} onDone={() => {}} />,
      { wrapper },
    );
    expect(screen.getByText(/all 3 shifts already on it/)).toBeInTheDocument();
    hold(/Hold to replace the week/);
    await vi.waitFor(() => expect(api.copyWeek).toHaveBeenCalled());
    expect(api.copyWeek.mock.calls[0][2]).toEqual({ replaceTarget: true, expectShifts: 3 });
  });
});

describe('F-1032, F-1033: an edit clears what was emptied and says what it opened with', () => {
  it('sends null for an emptied person, role and note, and the shift as it opened', async () => {
    render(
      <ShiftSheet target={{ shift: SHIFT as never }} members={MEMBERS} scheduleId="sch1" onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    fireEvent.change(screen.getByRole('combobox', { name: /Who/ }), { target: { value: '' } });
    fireEvent.change(screen.getByDisplayValue('Bar'), { target: { value: '' } });
    fireEvent.change(screen.getByDisplayValue('Patio'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the shift' }));
    await vi.waitFor(() => expect(api.updateShift).toHaveBeenCalled());
    const body = api.updateShift.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({
      memberId: null,
      role: null,
      note: null,
      expectMemberId: 'm1',
      expectUpdatedAt: '2026-09-01T10:00:00.123456+00:00',
    });
    // The edit body has no schedule field; the gateway refuses one it does not know.
    expect('scheduleId' in body).toBe(false);
  });

  it('still creates a new shift on its week, with nothing emptied sent', async () => {
    render(
      <ShiftSheet target={{ date: '2026-09-07' }} members={MEMBERS} scheduleId="sch1" onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add the shift' }));
    await vi.waitFor(() => expect(api.createShift).toHaveBeenCalled());
    const body = api.createShift.mock.calls[0][0] as Record<string, unknown>;
    expect(body.scheduleId).toBe('sch1');
    expect(body.memberId).toBeUndefined();
    expect('expectMemberId' in body).toBe(false);
  });
});
