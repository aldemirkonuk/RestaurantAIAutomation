/**
 * "A note from this meeting?" — the owed act on `/calendar`.
 *
 * THE REGRESSION. The legacy prompt asked the question and threw the answer
 * away: `CalendarPage.tsx:325` is an underscore-prefixed argument and the
 * comment `// Future: persist to documents API`. So `writes the note onto the
 * day-book entry` fails against every version of this page that has ever
 * shipped, in both the legacy and the rebuilt tree.
 *
 * The thing that must never happen here is losing what was already written, so
 * `appendNote` is asserted on its own before anything renders.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import {
  MeetingNotePanel,
  appendNote,
  meetingsAwaitingNote,
  MEETING_KINDS,
} from './MeetingNotePanel';
import type { CalEvent, CalendarData } from './useCalendarNextData';

const EVENT = {
  id: 'e1',
  seriesId: 'e1',
  isOccurrence: false,
  title: 'Kavaklıdere tasting',
  description: null,
  type: 'tasting',
  date: '2026-09-01',
  endDate: null,
  startTime: '14:00',
  endTime: '15:00',
  allDay: false,
  status: 'pending',
  providerId: 'prov-1',
  orderId: null,
  source: 'manual',
  color: null,
  isRecurring: false,
  reminderEnabled: false,
  reminderDaysBefore: null,
} as unknown as CalEvent;

function dataWith(update: { mutateAsync: ReturnType<typeof vi.fn> }, over: Partial<CalendarData> = {}) {
  return {
    update,
    providersKnown: true,
    providersById: new Map([['prov-1', { id: 'prov-1', name: 'Kavaklıdere' }]]),
    ...over,
  } as unknown as CalendarData;
}

function draw(over: Partial<React.ComponentProps<typeof MeetingNotePanel>> = {}) {
  const mutateAsync = vi.fn().mockResolvedValue({});
  const data = (over.data as CalendarData | undefined) ?? dataWith({ mutateAsync });
  const onSaved = vi.fn();
  render(
    <MeetingNotePanel
      open
      event={EVENT}
      data={data}
      onClose={() => {}}
      onSaved={onSaved}
      {...over}
    />,
  );
  return { mutateAsync, onSaved };
}

beforeEach(() => vi.clearAllMocks());

describe('appendNote — nothing already written is lost', () => {
  it('writes the first note under a dated heading naming its kind', () => {
    expect(appendNote(null, 'meeting_memo', '  Hasan will hold the price.  ', '1 Sep 2026')).toBe(
      'Meeting note · 1 Sep 2026\nHasan will hold the price.',
    );
  });

  it('appends under what is already there and never replaces it', () => {
    const before = 'Booked by Ayşe.\n';
    const after = appendNote(before, 'tasting_notes', 'Six wines, two worth listing.', '1 Sep 2026');
    expect(after.startsWith('Booked by Ayşe.')).toBe(true);
    expect(after).toContain('Tasting notes · 1 Sep 2026');
    expect(after).toContain('Six wines, two worth listing.');
  });

  it('stacks a third note under the second', () => {
    const one = appendNote(null, 'call_log', 'Rang, no answer.', '1 Sep 2026');
    const two = appendNote(one, 'general', 'Rang again.', '2 Sep 2026');
    expect(two.indexOf('Rang, no answer.')).toBeLessThan(two.indexOf('Rang again.'));
    expect(two.split('Call log · 1 Sep 2026')).toHaveLength(2);
  });

  it('treats a whitespace-only existing description as empty', () => {
    expect(appendNote('   \n\n ', 'general', 'x', '1 Sep 2026')).toBe('Note · 1 Sep 2026\nx');
  });
});

describe('meetingsAwaitingNote — which meetings the house asks about', () => {
  const now = new Date('2026-09-02T09:00:00');
  const base = { ...EVENT };

  it('asks about a meeting kind that has ended and carries no note', () => {
    expect(meetingsAwaitingNote([base], now).map((e) => e.id)).toEqual(['e1']);
  });

  it('never asks twice — an entry that already has notes is answered', () => {
    expect(meetingsAwaitingNote([{ ...base, description: 'Already written.' }], now)).toEqual([]);
  });

  it('never asks about a meeting that did not happen', () => {
    expect(meetingsAwaitingNote([{ ...base, status: 'cancelled' } as CalEvent], now)).toEqual([]);
    expect(meetingsAwaitingNote([{ ...base, status: 'dismissed' } as CalEvent], now)).toEqual([]);
  });

  it('never asks about a meeting that has not ended', () => {
    expect(meetingsAwaitingNote([{ ...base, date: '2026-09-03' }], now)).toEqual([]);
  });

  it('treats an entry with no time as ending when its DAY ends, not at midnight', () => {
    const today = { ...base, date: '2026-09-02', startTime: null, endTime: null };
    // 09:00 on the day itself — the day is not over.
    expect(meetingsAwaitingNote([today], now)).toEqual([]);
    expect(meetingsAwaitingNote([today], new Date('2026-09-03T00:30:00'))).toHaveLength(1);
  });

  it('asks about meetings, not deliveries', () => {
    expect(MEETING_KINDS.has('delivery')).toBe(false);
    expect(meetingsAwaitingNote([{ ...base, type: 'delivery' }], now)).toEqual([]);
  });

  it('puts the oldest first', () => {
    const older = { ...base, id: 'e0', date: '2026-08-20' };
    expect(meetingsAwaitingNote([base, older], now).map((e) => e.id)).toEqual(['e0', 'e1']);
  });
});

describe('the panel', () => {
  it('is a panel, named by its contract, and leaves with words', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'panel');
    expect(dialog).toHaveAttribute('data-motion', 'settle');
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });

  it('writes the note onto the day-book entry — the write the legacy prompt never made', async () => {
    const { mutateAsync, onSaved } = draw();
    fireEvent.change(screen.getByTestId('note-body'), {
      target: { value: 'Hasan will hold the price to the 15th.' },
    });
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const arg = mutateAsync.mock.calls[0][0] as { id: string; patch: { description: string } };
    expect(arg.id).toBe('e1');
    expect(arg.patch.description).toContain('Hasan will hold the price to the 15th.');
    expect(arg.patch.description).toContain('Meeting note ·');
    expect(onSaved).toHaveBeenCalled();
  });

  it('sends the chosen kind in the heading', async () => {
    const { mutateAsync } = draw();
    fireEvent.change(screen.getByTestId('note-body'), { target: { value: 'Six wines.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tasting notes' }));
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(
      (mutateAsync.mock.calls[0][0] as { patch: { description: string } }).patch.description,
    ).toContain('Tasting notes ·');
  });

  it('writes nothing on an empty note', () => {
    const { mutateAsync } = draw();
    expect(screen.getByTestId('note-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('note-save'));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('says what did not happen when the write is refused, and keeps the words', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('409 conflict'));
    draw({ data: dataWith({ mutateAsync }) });
    fireEvent.change(screen.getByTestId('note-body'), { target: { value: 'Kept words.' } });
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() =>
      expect(screen.getByTestId('note-failure')).toHaveTextContent(
        /was not saved \(409 conflict\)\. Nothing was written to the entry/,
      ),
    );
    expect(screen.getByTestId('note-body')).toHaveValue('Kept words.');
  });

  it('shows where it is filed, read from the book', () => {
    draw();
    expect(screen.getByTestId('note-filed')).toHaveTextContent('The day-book · Kavaklıdere');
  });

  it('tells an unreadable vendor book from an entry with no vendor', () => {
    const mutateAsync = vi.fn();
    draw({ data: dataWith({ mutateAsync }, { providersKnown: false, providersById: null }) });
    expect(screen.getByTestId('note-filed')).toHaveTextContent(/could not be read/);
  });

  it('says the kind is written into the heading, because there is no column', () => {
    draw();
    expect(screen.getByTestId('note-kind-note')).toHaveTextContent(/no column for it/);
  });

  it('says how much is already on the entry, so nothing looks replaced', () => {
    draw({ event: { ...EVENT, description: 'Booked by Ayşe.' } });
    expect(screen.getByTestId('note-existing')).toHaveTextContent(/goes underneath them/);
  });
});
