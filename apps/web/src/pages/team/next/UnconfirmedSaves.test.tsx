/**
 * A write whose reply was lost (integ9 errors-offline-recovery, wave 38):
 *
 *   F-1082  a week publish that timed out after it landed said "nobody was
 *           notified". It now says the week may already be live and reads
 *           the week again.
 *   F-1084  an edit that landed with its reply lost was retried, and the
 *           retry was refused as "someone else changed" the shift or the
 *           person. The row is read back now, and one that holds what was
 *           sent is saved. A sheet kept open after its own save compares the
 *           next save against the stamp that save returned.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { type ReactNode } from 'react';

const api = vi.hoisted(() => ({
  publishSchedule: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  updateShift: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  getWeek: vi.fn((..._a: unknown[]) => Promise.resolve({ shifts: [] as unknown[] })),
  updateTeamMember: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  getTeamMembers: vi.fn((..._a: unknown[]) => Promise.resolve([] as unknown[])),
}));

vi.mock('../../../services/api/team', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api/team')>()),
  publishSchedule: api.publishSchedule,
  updateShift: api.updateShift,
  getWeek: api.getWeek,
  updateTeamMember: api.updateTeamMember,
  getTeamMembers: api.getTeamMembers,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { userId: 'u-owner', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { PublishPanel } from './TeamOverlays';
import { ShiftSheet } from './ShiftSheet';
import { MemberSheet } from './RosterSheet';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** The request went out and nothing came back: the 30 s timeout. */
const timedOut = () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', undefined, {});
const someoneElse = (message: string) =>
  new AxiosError('conflict', 'ERR_BAD_REQUEST', undefined, {}, {
    status: 409,
    data: { message },
  } as AxiosResponse);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('F-1082: a publish whose reply was lost', () => {
  it('says the week may already be live, and reads the week again', async () => {
    api.publishSchedule.mockRejectedValue(timedOut());
    const onDone = vi.fn();
    render(
      <PublishPanel
        weekStart="2026-09-07"
        scheduleId="s1"
        republish={false}
        receiptsSeen={0}
        onClose={() => {}}
        onDone={onDone}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    expect(await screen.findByText(/may already be live and the crew told/)).toBeInTheDocument();
    expect(screen.queryByText(/nobody was notified/)).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('still says nothing changed when the gateway refused it', async () => {
    api.publishSchedule.mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, {}, { status: 400, data: {} } as AxiosResponse),
    );
    const onDone = vi.fn();
    render(
      <PublishPanel
        weekStart="2026-09-07"
        scheduleId="s1"
        republish={false}
        receiptsSeen={0}
        onClose={() => {}}
        onDone={onDone}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    expect(await screen.findByText(/nobody was notified/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

/** The hold, on the keyboard: the first Enter arms it, the second approves. */
function hold(die: HTMLElement) {
  fireEvent.keyDown(die, { key: 'Enter' });
  fireEvent.keyDown(die, { key: 'Enter' });
}

describe('F-1114: re-publishing a live week nothing on which changed', () => {
  it('says nobody was notified again, never "Re-published", and offers to send it again', async () => {
    api.publishSchedule.mockResolvedValue({ republished: false, receiptsCleared: 0 });
    const onClose = vi.fn();
    render(
      <PublishPanel
        weekStart="2026-09-07"
        scheduleId="s1"
        republish
        receiptsSeen={0}
        onClose={onClose}
        onDone={() => {}}
      />,
      { wrapper },
    );
    hold(screen.getByRole('button', { name: /Hold to re-publish/ }));
    expect(await screen.findByText(/nobody was notified again/)).toBeInTheDocument();
    expect(api.publishSchedule).toHaveBeenLastCalledWith('s1', {});
    expect(screen.queryByText('Re-published')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    api.publishSchedule.mockResolvedValue({ republished: true, receiptsCleared: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Send the announcement again' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.publishSchedule).toHaveBeenLastCalledWith('s1', { resetReceipts: true });
  });
});

describe('F-1148: a publish says when the announcement did not reach the crew', () => {
  const panel = (onClose = vi.fn()) =>
    render(
      <PublishPanel
        weekStart="2026-09-07"
        scheduleId="s1"
        republish={false}
        receiptsSeen={0}
        onClose={onClose}
        onDone={() => {}}
      />,
      { wrapper },
    );

  it('a live week that reached nobody says so and offers to send it again', async () => {
    api.publishSchedule.mockResolvedValue({ republished: false, receiptsCleared: 0, notified: 0, heldAway: 0 });
    const onClose = vi.fn();
    panel(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    expect(await screen.findByText(/did not reach anyone/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    api.publishSchedule.mockResolvedValue({ republished: true, receiptsCleared: 0, notified: 5, heldAway: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Send the announcement again' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.publishSchedule).toHaveBeenLastCalledWith('s1', { resetReceipts: true });
  });

  it('names how many people who are Away were not told', async () => {
    api.publishSchedule.mockResolvedValue({ republished: true, receiptsCleared: 0, notified: 4, heldAway: 2 });
    const onClose = vi.fn();
    panel(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    expect(await screen.findByText(/except 2 people who are Away/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // A first publish answers `republished: false` too; it is not "nothing changed".
  it('closes when a first publish told everyone', async () => {
    api.publishSchedule.mockResolvedValue({ republished: false, receiptsCleared: 0, notified: 5, heldAway: 0 });
    const onClose = vi.fn();
    panel(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('F-1115: the week moved after the publish panel opened', () => {
  it('a refusal reads the week again and never shows the gateway\'s field names', async () => {
    api.publishSchedule.mockRejectedValue(
      someoneElse(
        'Re-publishing clears the 1 read receipt(s) on this week, so nobody will be recorded as having seen it. Re-send with resetReceipts: true to publish the new version.',
      ),
    );
    const onDone = vi.fn();
    const props = { weekStart: '2026-09-07', scheduleId: 's1', onClose: () => {}, onDone };
    const { rerender } = render(<PublishPanel {...props} republish={false} receiptsSeen={0} />, {
      wrapper,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish the week' }));
    expect(await screen.findByText(/changed after you opened this panel/)).toBeInTheDocument();
    expect(screen.queryByText(/resetReceipts/)).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);

    // The re-read week is live with one receipt: the panel redraws from it.
    rerender(<PublishPanel {...props} republish receiptsSeen={1} />);
    expect(screen.getByText(/\(1 so far\)/)).toBeInTheDocument();
    api.publishSchedule.mockResolvedValue({ republished: true, receiptsCleared: 1 });
    hold(screen.getByRole('button', { name: /Hold to re-publish and clear receipts/ }));
    await waitFor(() =>
      expect(api.publishSchedule).toHaveBeenLastCalledWith('s1', { resetReceipts: true }),
    );
  });
});

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
  updated_at: '2026-09-01T10:00:00.000Z',
};
const MEMBERS = [{ id: 'm1', display_name: 'Ada', status: 'active' }] as never;

describe('F-1084: a shift edit that landed with its reply lost', () => {
  function drawShift(onClose = vi.fn(), onChanged = vi.fn()) {
    render(
      <ShiftSheet
        target={{ shift: SHIFT as never }}
        members={MEMBERS}
        scheduleId="sch1"
        onClose={onClose}
        onChanged={onChanged}
      />,
      { wrapper },
    );
    return { onClose, onChanged };
  }

  it('is saved when the shift on file holds what was sent', async () => {
    api.updateShift.mockRejectedValue(timedOut());
    api.getWeek.mockResolvedValue({
      shifts: [{ ...SHIFT, end_time: '18:00:00', updated_at: '2026-09-07T08:00:00.000Z' }],
    });
    const { onClose, onChanged } = drawShift();
    fireEvent.change(screen.getByDisplayValue('17:00'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect(api.getWeek).toHaveBeenCalledWith('2026-09-07');
  });

  it('a retry refused as changed is saved when the change was its own', async () => {
    const onClose = vi.fn();
    // First press: the reply is lost and the shift cannot be read back.
    api.updateShift.mockRejectedValueOnce(timedOut());
    api.getWeek.mockRejectedValueOnce(timedOut());
    drawShift(onClose);
    fireEvent.change(screen.getByDisplayValue('17:00'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText(/could not be confirmed/)).toBeInTheDocument();
    // Second press: the gateway's compare-and-set refuses it; the row is ours.
    api.updateShift.mockRejectedValueOnce(
      someoneElse('Someone else changed or removed this shift after you opened it, so nothing was saved.'),
    );
    api.getWeek.mockResolvedValueOnce({ shifts: [{ ...SHIFT, end_time: '18:00' }] });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it('still says someone else changed it when the shift on file is not what was sent', async () => {
    api.updateShift.mockRejectedValueOnce(timedOut());
    api.getWeek.mockRejectedValueOnce(timedOut());
    const { onClose } = drawShift();
    fireEvent.change(screen.getByDisplayValue('17:00'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await screen.findByText(/could not be confirmed/);
    api.updateShift.mockRejectedValueOnce(
      someoneElse('Someone else changed or removed this shift after you opened it, so nothing was saved.'),
    );
    api.getWeek.mockResolvedValueOnce({ shifts: [{ ...SHIFT, member_id: 'm2' }] });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText(/Someone else changed/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

const PERSON = {
  id: 'm1',
  restaurant_id: 'r1',
  user_id: null,
  display_name: 'Ayşe Yılmaz',
  email: 'ayse@tuzlu.com.tr',
  phone: '0532 000 00 00',
  position: 'Server',
  employment_type: 'full_time',
  home_location: 'Kadıköy',
  hourly_wage: 150,
  skills: [],
  status: 'active',
  notes: 'old note',
  role: 'staff',
  updated_at: '2026-10-10T09:00:00.000Z',
};

function drawPerson(onClose = vi.fn()) {
  render(
    <MemberSheet
      member={PERSON as never}
      moneyVisible
      viewerIsOwner
      ownerCount={2}
      onClose={onClose}
      onChanged={() => {}}
    />,
    { wrapper },
  );
  return onClose;
}

describe('F-1084: a roster edit that landed with its reply lost', () => {
  it('is saved when the person on file holds what was sent', async () => {
    api.updateTeamMember.mockRejectedValue(timedOut());
    api.getTeamMembers.mockResolvedValue([
      { ...PERSON, phone: '0555 111 11 11', updated_at: '2026-10-10T09:05:00.000Z' },
    ]);
    const onClose = drawPerson();
    fireEvent.change(screen.getByDisplayValue('0532 000 00 00'), {
      target: { value: '0555 111 11 11' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument();
  });

  it('a retry refused as changed is saved when the change was its own', async () => {
    api.updateTeamMember.mockRejectedValueOnce(timedOut());
    api.getTeamMembers.mockRejectedValueOnce(timedOut());
    const onClose = drawPerson();
    fireEvent.change(screen.getByDisplayValue('0532 000 00 00'), {
      target: { value: '0555 111 11 11' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/could not be confirmed/)).toBeInTheDocument();
    api.updateTeamMember.mockRejectedValueOnce(
      someoneElse('Someone else changed this person while you had them open, so nothing was saved.'),
    );
    api.getTeamMembers.mockResolvedValueOnce([{ ...PERSON, phone: '0555 111 11 11' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a sheet kept open after its own save compares the next save against that save', async () => {
    api.updateTeamMember.mockResolvedValueOnce({
      ...PERSON,
      hourly_wage: 160,
      updated_at: '2026-10-10T09:05:00.000Z',
      ownWage: { audited: true, ownersNotified: 0, ownersFound: 1 },
    });
    const onClose = drawPerson();
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/notice to the owner did not go out/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    api.updateTeamMember.mockResolvedValueOnce({ ...PERSON, updated_at: '2026-10-10T09:06:00.000Z' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateTeamMember).toHaveBeenCalledTimes(2));
    expect(api.updateTeamMember.mock.calls[1][1]).toMatchObject({
      expectUpdatedAt: '2026-10-10T09:05:00.000Z',
    });
  });
});
