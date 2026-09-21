/**
 * "A note from this meeting?" — the owed act on `/calendar`.
 *
 * WHAT WAS OWED, AND WHAT WAS HOLLOW. The legacy prompt
 * (`pages/calendar/MeetingMemoPrompt.tsx:109`) asked the question well and then
 * threw the answer away: `CalendarPage.tsx:325` is
 *
 *     const handleMemoSave = useCallback((_memo: MeetingMemo) => {
 *       // Future: persist to documents API
 *       setMemoPromptOpen(false)
 *     }, [])
 *
 * — an underscore-prefixed argument and a comment where the write should be. So
 * this act is not a migration; it is the first time the note is kept.
 *
 * WHERE THE NOTE GOES, AND WHY THERE (REVISED 2026-09-21)
 * ---------------------------------------------------------
 * `calendar_day_notes`, its own table — never `calendar_events.description`
 * (founder, 2026-09-21, answer 2, "Build all now"). This panel used to
 * `PATCH /calendar/events/:eventId` and append the note under a dated heading
 * inside `description`, reasoning at the time that a documents table or a new
 * event column were both worse. The founder's own words override that: a
 * migration is exactly the right size for this, `calendar_day_notes`
 * (`20260921113800_a_meeting_note_gets_its_own_table.sql`) is additive, and
 * folding an independent fact into a column two authors race to overwrite —
 * "what this event is" and "what was actually discussed" — was never right
 * either. `appendNote` / `hasNoteFor` below are KEPT (read by
 * `meetingsAwaitingNote`'s legacy branch and covered by their own tests) but
 * are no longer written by this panel; a meeting noted in the table is kept
 * off the "without a note" list by `withoutNotedMeetings` below, read by
 * `CalendarNext.tsx` from `GET /calendar/day-notes?from=&to=`.
 *
 * THE KIND OF NOTE now has a real column (`doc_type`) on `calendar_day_notes` —
 * see the migration — rather than being folded into free text.
 *
 * WHERE IT IS FILED is still SHOWN and never chosen: the entry's own vendor,
 * read from the book. A filing picker that wrote nowhere is what was wrong
 * with the legacy prompt.
 */

import { useMemo, useRef, useState } from 'react';
import { Panel } from '@/components/mudavym';
import { getErrorMessage } from '@/services/api/client';
import { createDayNote } from '@/services/api/calendar';
import { useDayNotes } from '@/hooks/queries';
import type { CalEvent, CalendarData } from './useCalendarNextData';

export type NoteKind = 'meeting_memo' | 'call_log' | 'tasting_notes' | 'general';

/** The legacy prompt's four kinds, with its own descriptions. */
export const NOTE_KINDS: { id: NoteKind; label: string; description: string }[] = [
  { id: 'meeting_memo', label: 'Meeting note', description: 'What was said and what was decided' },
  { id: 'call_log', label: 'Call log', description: 'A phone or video call, summarised' },
  { id: 'tasting_notes', label: 'Tasting notes', description: 'Bottles tasted and what they were like' },
  { id: 'general', label: 'A note', description: 'Anything else worth keeping' },
];

const KIND_LABEL: Record<NoteKind, string> = {
  meeting_memo: 'Meeting note',
  call_log: 'Call log',
  tasting_notes: 'Tasting notes',
  general: 'Note',
};

/**
 * True when this entry is ONE DATE of a repeating series.
 *
 * A repeating meeting is one row in the day-book; the page expands it into its
 * dates (`useCalendarNextData.ts`, `isOccurrence`), and every date carries the
 * series row's id and the series row's description. So a note about one date
 * can only be written onto the series row — and without saying which date it is
 * about, it would read as a note about every date. A series whose dates fall
 * outside the window arrives unexpanded, with `isRecurring` and no
 * `isOccurrence`; it is the same kind of row.
 */
export function isSeriesDate(e: Pick<CalEvent, 'isOccurrence' | 'isRecurring'>): boolean {
  return e.isOccurrence || e.isRecurring;
}

/** `Meeting note · for 2026-09-10 · 17 Sep 2026`, as written and as read back. */
function noteHeading(kind: NoteKind, writtenOn: string, aboutDate?: string | null): string {
  return aboutDate
    ? `${KIND_LABEL[kind]} · for ${aboutDate} · ${writtenOn}`
    : `${KIND_LABEL[kind]} · ${writtenOn}`;
}

/**
 * Whether a repeating entry's description already holds a note about `date`.
 *
 * Read from the heading `appendNote` writes, because the heading is the only
 * place the date is kept: there is no notes table and no per-date row.
 */
export function hasNoteFor(description: string | null | undefined, date: string): boolean {
  if (!description || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const kinds = Object.values(KIND_LABEL).join('|');
  return new RegExp(`^(?:${kinds}) · for ${date} · `, 'm').test(description);
}

/**
 * The entry's description with this note appended under a dated heading.
 *
 * Pure, and tested on its own, because the thing that must never happen here is
 * losing what was already written. `existing` may be null, empty, or already
 * hold several notes; all three append the same way.
 *
 * `writtenOn` is passed in rather than read from the clock so the result is a
 * function of its inputs — a heading that changed with the machine's timezone
 * would make the test pass in one place and fail in another.
 *
 * `aboutDate` is the meeting's own date, and is given for a date of a repeating
 * series (`isSeriesDate`): the note lands on the series row, which every date
 * of the series shows, so the heading has to say which meeting it is about.
 */
export function appendNote(
  existing: string | null | undefined,
  kind: NoteKind,
  note: string,
  writtenOn: string,
  aboutDate?: string | null,
): string {
  const body = note.trim();
  const heading = noteHeading(kind, writtenOn, aboutDate);
  const block = `${heading}\n${body}`;
  const before = (existing ?? '').replace(/\s+$/, '');
  return before === '' ? block : `${before}\n\n${block}`;
}

/**
 * What this house means by "a meeting" for the purposes of asking about a note.
 *
 * The gateway's own `CalendarEventType` vocabulary, narrowed to the kinds a
 * person comes back from with something to write down. A delivery is not on the
 * list: the note that matters about a delivery is the receipt, and the door has
 * its own act for that.
 */
export const MEETING_KINDS = new Set([
  'provider_meeting',
  'meeting',
  'tasting',
  'call',
  'appointment',
]);

/**
 * Meetings that have ENDED and carry no note yet, oldest first.
 *
 * Since 2026-09-21 a note lives in `calendar_day_notes`, not in the entry's
 * `description`. This function still honours a description written before
 * then (the legacy branch below); the table half is `withoutNotedMeetings`,
 * applied by `CalendarNext.tsx` once that read has answered, so a meeting
 * noted in an earlier session is not listed again after a reload.
 *
 * Pure and exported so the rule is testable without a calendar. Three things it
 * deliberately does NOT do:
 *
 *  - it does not ask about an entry that already has a description. Somebody
 *    has written something about it, and asking again is nagging. A date of a
 *    repeating series is the exception: its description is the SERIES', shared
 *    by every date, so it is answered only by a note headed with its own date
 *    (`hasNoteFor`) — otherwise one note would silence the question for every
 *    past and future meeting in the series;
 *  - it does not ask about a cancelled or dismissed entry — the meeting did not
 *    happen, so there is nothing to note;
 *  - it does not ask about an all-day entry whose day is today. A day is not
 *    over until it is over, and an entry with no end time is treated as ending
 *    at the end of its day rather than at midnight that morning. A date of a
 *    series ends on its own day: the end date it carries is the series row's,
 *    and would call next month's meeting over.
 */
export function meetingsAwaitingNote(events: CalEvent[], now: Date): CalEvent[] {
  const out = events.filter((e) => {
    if (!MEETING_KINDS.has(e.type)) return false;
    if (e.status === 'cancelled' || e.status === 'dismissed') return false;
    const series = isSeriesDate(e);
    if (series ? hasNoteFor(e.description, e.date) : (e.description ?? '').trim() !== '') return false;

    const day = series ? e.date : (e.endDate ?? e.date);
    if (!day) return false;
    const clock = e.endTime ?? e.startTime ?? null;
    // No time on the entry means it ends when its day does, not at midnight.
    const ended = clock ? new Date(`${day}T${clock}`) : new Date(`${day}T23:59:59`);
    return Number.isFinite(ended.getTime()) && ended.getTime() < now.getTime();
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * `meetingsAwaitingNote` minus the meetings a `calendar_day_notes` row already
 * answers (2026-09-21). A note is matched to a meeting by its day and the
 * event title it was written against — `event_title` is the snapshot the note
 * keeps, never a foreign key (a note is a day's marginalia and must survive
 * its event being edited or deleted; see the migration header), so day +
 * title is the only link there is. A meeting renamed after it was noted is
 * asked about again, which is the safe direction: asking twice, never hiding
 * a meeting nobody wrote about.
 *
 * Only ever called with notes that were actually READ. A read that failed or
 * has not answered is not "no notes" — `CalendarNext.tsx` says so instead.
 */
export function withoutNotedMeetings(
  candidates: CalEvent[],
  notes: ReadonlyArray<{ businessDate: string; eventTitle?: string | null }>,
): CalEvent[] {
  const key = (day: string, title: string | null | undefined) => `${day}\u0000${(title ?? '').trim()}`;
  const noted = new Set(notes.map((n) => key(n.businessDate, n.eventTitle)));
  return candidates.filter((e) => !noted.has(key(e.date, e.title)));
}

export interface MeetingNotePanelProps {
  open: boolean;
  /** The entry this note is about. Null closes the question. */
  event: CalEvent | null;
  data: CalendarData;
  onClose: () => void;
  /** Called after the gateway accepted the note. */
  onSaved?: () => void;
}

export function MeetingNotePanel({ open, event, data, onClose, onSaved }: MeetingNotePanelProps) {
  const [kind, setKind] = useState<NoteKind>('meeting_memo');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Where the note is filed, READ from the book rather than chosen.
   *
   * `providersKnown` is false when the vendor book could not be read, and that
   * is a different sentence from "this entry names no vendor" — the legacy
   * prompt showed a filing picker that could not tell them apart because it
   * filed nothing either way.
   */
  const filedUnder = useMemo(() => {
    if (!event?.providerId) return 'The day-book · this entry';
    if (!data.providersKnown) {
      return 'The day-book · this entry — the vendor book could not be read, so whose entry it is cannot be shown';
    }
    const name = data.providersById?.get(event.providerId)?.name;
    return name ? `The day-book · ${name}` : 'The day-book · a vendor no longer in the book';
  }, [event?.providerId, data.providersKnown, data.providersById]);

  // What this day already holds, read back rather than assumed from
  // `event.description` (2026-09-21 — notes no longer live there; see the
  // file header). Only fetched while the panel is actually open.
  const { data: existingNotes } = useDayNotes(open ? (event?.date ?? null) : null);

  if (!event) return null;

  const save = async () => {
    if (busy || note.trim() === '') return;
    setBusy(true);
    setFailure(null);
    try {
      // Its own table (2026-09-21) — never calendar_events.description. See
      // the file header. `event.date` is this occurrence's own day, real for
      // both a plain entry and a date of a repeating series.
      await createDayNote({
        businessDate: event.date,
        docType: kind,
        eventTitle: event.title,
        body: note,
      });
      setNote('');
      onSaved?.();
      onClose();
    } catch (e) {
      setFailure(
        `The note was not saved (${getErrorMessage(e)}). Nothing was written and your words are still here.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const when = [event.date, event.startTime].filter(Boolean).join(' · ');

  return (
    <Panel
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name. */
      label="This asks whether to keep a note from this meeting. Saving records it against this day, in its own place — never inside the entry's own description. Leaving writes nothing."
      eyebrow={`${when} · ${event.title}`}
      title="A note from this meeting?"
      closeLabel="Later"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="cn-quiet" style={{ fontSize: 11.5 }}>
            The note is saved against this day, on its own — the entry itself is untouched.
          </span>
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              className="cn-btn"
              data-testid="note-skip"
              onClick={() => {
                setNote('');
                onClose();
              }}
            >
              Nothing to note
            </button>
            <button
              type="button"
              className="cn-btn"
              data-primary="true"
              data-testid="note-save"
              disabled={busy || note.trim() === ''}
              onClick={() => void save()}
            >
              {busy ? 'Writing it down…' : 'Save the note'}
            </button>
          </span>
        </div>
      }
      initialFocusRef={noteRef}
    >
      <label className="cn-label" htmlFor="note-body">
        What was said, what was decided
      </label>
      <textarea
        id="note-body"
        ref={noteRef}
        className="cn-input"
        data-testid="note-body"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ minHeight: 130, width: '100%' }}
      />

      <fieldset style={{ border: 0, padding: 0, marginTop: 12 }}>
        <legend className="cn-label">What kind of note</legend>
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 4 }}>
          {NOTE_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="cn-btn"
              aria-pressed={kind === k.id}
              data-on={kind === k.id}
              title={k.description}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="cn-quiet" style={{ marginTop: 4, fontSize: 11 }} data-testid="note-kind-note">
          The kind is its own column on the note — saved as chosen, never folded into the words.
        </p>
      </fieldset>

      <p className="cn-quiet" style={{ marginTop: 12, fontSize: 11.5 }} data-testid="note-filed">
        Filed under {filedUnder}.
      </p>

      {isSeriesDate(event) ? (
        <p className="cn-quiet" style={{ marginTop: 4, fontSize: 11 }} data-testid="note-series">
          This meeting repeats. The note is about THIS date, {event.date}, only — it will not show
          against any other date of the series.
        </p>
      ) : null}

      {existingNotes && existingNotes.length > 0 ? (
        <p className="cn-quiet" style={{ marginTop: 4, fontSize: 11 }} data-testid="note-existing">
          {event.date} already has {existingNotes.length}{' '}
          {existingNotes.length === 1 ? 'note' : 'notes'}. Yours is added, not a replacement.
        </p>
      ) : null}

      {failure && (
        <p role="status" className="cn-quiet" style={{ marginTop: 10, fontSize: 11.5 }} data-testid="note-failure">
          {failure}
        </p>
      )}
    </Panel>
  );
}

export default MeetingNotePanel;
