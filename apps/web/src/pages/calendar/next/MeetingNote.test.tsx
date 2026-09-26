/**
 * "A note from this meeting?" — the owed act on `/calendar`.
 *
 * THE ORIGINAL REGRESSION. The legacy prompt asked the question and threw the
 * answer away: `CalendarPage.tsx:325` was an underscore-prefixed argument and
 * the comment `// Future: persist to documents API`. So `saves the note` fails
 * against every version of this page that has ever shipped, in both the
 * legacy and the rebuilt tree, unless it is actually wired to a write.
 *
 * REVISED 2026-09-21 (founder answer 2, "Build all now"). The write moved
 * again: this panel used to `PATCH /calendar/events/:eventId` and append the
 * note under a dated heading inside `description` — the founder's own words
 * ("own table, not the calendar event description") end that. It now POSTs
 * to `/calendar/day-notes`. `appendNote` / `hasNoteFor` are KEPT below and
 * still tested on their own (they still back `meetingsAwaitingNote`'s
 * across-reload signal — see that function's own comment for the shortcut
 * this leaves, stated rather than hidden), but the panel's save button no
 * longer calls them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const dayNotesApi = vi.hoisted(() => ({ createDayNote: vi.fn() }));
const existingDayNotes = vi.hoisted(() => ({ current: [] as { id: string }[] }));

vi.mock('@/services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));
vi.mock('@/services/api/calendar', () => ({
  createDayNote: (...a: unknown[]) => dayNotesApi.createDayNote(...a),
}));
vi.mock('@/hooks/queries', () => ({
  // `existingDayNotes.current` lets one test set what "already recorded"
  // looks like; every other test leaves it empty.
  useDayNotes: () => ({ data: existingDayNotes.current, isLoading: false }),
}));

import {
  withoutNotedMeetings,
  MeetingNotePanel,
  appendNote,
  hasNoteFor,
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

function dataWith(over: Partial<CalendarData> = {}) {
  return {
    update: { mutateAsync: vi.fn().mockResolvedValue({}) },
    providersKnown: true,
    providersById: new Map([['prov-1', { id: 'prov-1', name: 'Kavaklıdere' }]]),
    ...over,
  } as unknown as CalendarData;
}

function draw(over: Partial<React.ComponentProps<typeof MeetingNotePanel>> = {}) {
  const data = (over.data as CalendarData | undefined) ?? dataWith();
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
  return { onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
  dayNotesApi.createDayNote.mockResolvedValue({ id: 'note-1' });
  existingDayNotes.current = [];
});

describe('appendNote — nothing already written is lost (kept for meetingsAwaitingNote)', () => {
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

/*
 * A REPEATING MEETING is one row. The page expands it into its dates, and every
 * date carries the series row's id and the series row's description
 * (`useCalendarNextData.ts`: `seriesId` is the parent for an occurrence).
 * `appendNote`/`hasNoteFor` still carry the per-date heading shape that made
 * that safe for the OLD description-based write; they are exercised here as
 * pure functions independent of the panel's own (now table-based) save.
 */
describe('a repeating meeting — a note is about ONE date of it', () => {
  const SERIES_ROW = 'weekly-1';
  const occurrence = (date: string, over: Partial<CalEvent> = {}) =>
    ({
      ...EVENT,
      id: `${SERIES_ROW}__occ_${date}`,
      seriesId: SERIES_ROW,
      isOccurrence: true,
      isRecurring: true,
      title: 'Weekly call with Hasan',
      type: 'call',
      date,
      // The series row's own end date, copied onto every date by the expander.
      endDate: '2026-09-03',
      ...over,
    }) as CalEvent;

  it('names the date the note is about in its heading', () => {
    expect(appendNote(null, 'call_log', 'Price held.', '17 Sep 2026', '2026-09-10')).toBe(
      'Call log · for 2026-09-10 · 17 Sep 2026\nPrice held.',
    );
  });

  it('reads a note back for its own date only', () => {
    const written = appendNote('Agenda: stock and price.', 'call_log', 'Price held.', '17 Sep 2026', '2026-09-10');
    expect(hasNoteFor(written, '2026-09-10')).toBe(true);
    expect(hasNoteFor(written, '2026-09-03')).toBe(false);
    expect(hasNoteFor(written, '2026-09-17')).toBe(false);
    // A one-off note's heading names no meeting date, so it answers no date.
    expect(hasNoteFor(appendNote(null, 'call_log', 'x', '10 Sep 2026'), '2026-09-10')).toBe(false);
  });

  it('a note about the 10th does not answer the 3rd, and a series description answers nothing', () => {
    const now = new Date('2026-09-12T09:00:00');
    const noted = appendNote('Agenda: stock and price.', 'call_log', 'Price held.', '11 Sep 2026', '2026-09-10');
    const dates = [
      occurrence('2026-09-03', { description: noted }),
      occurrence('2026-09-10', { description: noted }),
    ];
    expect(meetingsAwaitingNote(dates, now).map((e) => e.date)).toEqual(['2026-09-03']);
  });

  it('never asks about a future date of the series, whatever end date the series row carries', () => {
    const now = new Date('2026-09-12T09:00:00');
    expect(meetingsAwaitingNote([occurrence('2026-09-17'), occurrence('2026-09-24')], now)).toEqual([]);
  });

  it('saves against THIS date of the series, and names the meeting in the record', async () => {
    const event = occurrence('2026-09-10', { description: 'Agenda: stock and price.' });
    const data = dataWith();
    render(<MeetingNotePanel open event={event} data={data} onClose={() => {}} />);
    expect(screen.getByTestId('note-series')).toHaveTextContent(
      /repeats.*THIS date, 2026-09-10.*will not show against any other date/,
    );
    fireEvent.change(screen.getByTestId('note-body'), { target: { value: 'Price held.' } });
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() => expect(dayNotesApi.createDayNote).toHaveBeenCalled());
    expect(dayNotesApi.createDayNote).toHaveBeenCalledWith({
      businessDate: '2026-09-10',
      docType: 'meeting_memo',
      eventTitle: 'Weekly call with Hasan',
      body: 'Price held.',
    });
    // The series row itself is never touched by this panel any more: the
    // event update (the old PATCH into `description`) is not called at all.
    expect(data.update.mutateAsync).not.toHaveBeenCalled();
  });

  it('a one-off meeting says nothing about a series', async () => {
    draw();
    expect(screen.queryByTestId('note-series')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('note-body'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() => expect(dayNotesApi.createDayNote).toHaveBeenCalled());
    expect(dayNotesApi.createDayNote).toHaveBeenCalledWith(
      expect.objectContaining({ businessDate: '2026-09-01' }),
    );
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

  it('saves the note to its own table — the write the legacy prompt never made', async () => {
    const { onSaved } = draw();
    fireEvent.change(screen.getByTestId('note-body'), {
      target: { value: 'Hasan will hold the price to the 15th.' },
    });
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() => expect(dayNotesApi.createDayNote).toHaveBeenCalled());
    expect(dayNotesApi.createDayNote).toHaveBeenCalledWith({
      businessDate: '2026-09-01',
      docType: 'meeting_memo',
      eventTitle: 'Kavaklıdere tasting',
      body: 'Hasan will hold the price to the 15th.',
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('sends the chosen kind as its own field, never folded into the words', async () => {
    draw();
    fireEvent.change(screen.getByTestId('note-body'), { target: { value: 'Six wines.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tasting notes' }));
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() => expect(dayNotesApi.createDayNote).toHaveBeenCalled());
    expect(dayNotesApi.createDayNote).toHaveBeenCalledWith(
      expect.objectContaining({ docType: 'tasting_notes', body: 'Six wines.' }),
    );
  });

  it('writes nothing on an empty note', () => {
    draw();
    expect(screen.getByTestId('note-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('note-save'));
    expect(dayNotesApi.createDayNote).not.toHaveBeenCalled();
  });

  it('says what did not happen when the write is refused, and keeps the words', async () => {
    dayNotesApi.createDayNote.mockRejectedValue(new Error('409 conflict'));
    draw();
    fireEvent.change(screen.getByTestId('note-body'), { target: { value: 'Kept words.' } });
    fireEvent.click(screen.getByTestId('note-save'));
    await waitFor(() =>
      expect(screen.getByTestId('note-failure')).toHaveTextContent(
        /was not saved \(409 conflict\)\. Nothing was written/,
      ),
    );
    expect(screen.getByTestId('note-body')).toHaveValue('Kept words.');
  });

  it('shows where it is filed, read from the book', () => {
    draw();
    expect(screen.getByTestId('note-filed')).toHaveTextContent('The day-book · Kavaklıdere');
  });

  it('tells an unreadable vendor book from an entry with no vendor', () => {
    draw({ data: dataWith({ providersKnown: false, providersById: null }) });
    expect(screen.getByTestId('note-filed')).toHaveTextContent(/could not be read/);
  });

  it('says the kind is its own column now, not folded into the words', () => {
    draw();
    expect(screen.getByTestId('note-kind-note')).toHaveTextContent(/its own column/);
  });

  it('shows what this day already has, read from the table — not from event.description', () => {
    existingDayNotes.current = [{ id: 'n1' }, { id: 'n2' }];
    draw({ event: { ...EVENT, description: 'Unrelated event copy, not a note.' } });
    expect(screen.getByTestId('note-existing')).toHaveTextContent('2026-09-01 already has 2 notes');
  });

  it('says nothing already exists when the day has no notes, even with an event description', () => {
    existingDayNotes.current = [];
    draw({ event: { ...EVENT, description: 'Just a description, not a note.' } });
    expect(screen.queryByTestId('note-existing')).not.toBeInTheDocument();
  });
});

describe('withoutNotedMeetings — a kept note answers its own meeting, and only it', () => {
  const m = (id: string, date: string, title: string) =>
    ({ ...EVENT, id, seriesId: id, date, title }) as unknown as CalEvent;

  it('drops a meeting whose day and title a note carries', () => {
    const out = withoutNotedMeetings(
      [m('a', '2026-09-10', 'Weekly call'), m('b', '2026-09-11', 'Tasting')],
      [{ businessDate: '2026-09-10', eventTitle: 'Weekly call' }],
    );
    expect(out.map((e) => e.id)).toEqual(['b']);
  });

  it('keeps a meeting on the same day with a different title, and the same title on another day', () => {
    const out = withoutNotedMeetings(
      [m('a', '2026-09-10', 'Tasting'), m('b', '2026-09-17', 'Weekly call')],
      [{ businessDate: '2026-09-10', eventTitle: 'Weekly call' }],
    );
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('a note kept against no event answers no meeting', () => {
    const out = withoutNotedMeetings(
      [m('a', '2026-09-10', 'Weekly call')],
      [{ businessDate: '2026-09-10', eventTitle: null }],
    );
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  it('matches through surrounding whitespace in either title', () => {
    const out = withoutNotedMeetings(
      [m('a', '2026-09-10', ' Weekly call ')],
      [{ businessDate: '2026-09-10', eventTitle: 'Weekly call' }],
    );
    expect(out).toEqual([]);
  });
});
