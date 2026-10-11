/**
 * EventSheet — writing a line into the book, and correcting one.
 *
 * Every control here is backed by a route that exists. Where the gateway
 * cannot do a thing, the control is rendered disabled with one line saying so
 * rather than offered and quietly dropped — which is what today's page does
 * with the email reminder channel, the meeting memo and the labels field
 * (calendar.md §10).
 *
 * The honest refusals, each cited:
 *  - **email reminders** — the server job writes the inbox row and pushes to
 *    phones (calendar-reminders.service.ts `deliver`); mail would need a
 *    recipient policy of its own, so the tick is drawn disabled;
 *  - **vendor link on edit** — UpdateCalendarEventDto has no `providerId`
 *    (calendar.dto.ts:229-296) and the gateway forbids non-whitelisted keys,
 *    so the field is create-time only;
 *  - **repeat rule on edit** — same DTO, no `recurrence`;
 *  - **moving a drawn occurrence's date** — the PATCH goes to the series row,
 *    whose start_date it would overwrite; see the note in `submit`.
 *
 * Deleting is the one irreversible act on this page, so it is the one place
 * that spends the house ceremony: HoldToApprove, completing into the seal. A
 * repeating entry opened on a later date also offers to END the series from
 * that date, which keeps every earlier date (F-607).
 *
 * REMINDERS MOVED SERVER-SIDE, 2026-09-03. This sheet no longer enqueues into
 * the browser's localStorage queue; it writes `reminderEnabled` /
 * `reminderDaysBefore` on the row and a cron sends them
 * (`apps/api-gateway/src/calendar/calendar-reminders.service.ts`, ADR 0109). It
 * still CANCELS any browser-queued reminder for an entry it saves, so an entry
 * created on the legacy page and edited here cannot be reminded twice — the
 * localStorage scheduler is demoted to draining what the legacy tree queued,
 * and `ReminderRegister` says so on the row.
 */

import { useMemo, useState } from 'react';
import { HoldToApprove } from '../../../components/mudavym';
import { Sheet } from '../../../components/mudavym/Sheet';
// The browser scheduler is DEMOTED, not imported wholesale: only the canceller
// survives here, so saving an entry clears any copy the legacy page queued for
// it in this browser. Nothing in `pages/calendar/next/**` enqueues any more.
import { cancelRemindersForEvent } from '../../../lib/reminder-scheduler';
import { useDraftWriteKey, writeOutcomeUnknown } from '../../../lib/draftWriteKey';
import { EM, SEAL_HEX, clock, longDay } from './cal-format';
import ReminderRegister from './ReminderRegister';
import { customTypeOf, type CalEvent, type CalendarData, type CalendarPayload, type EventStatus } from './useCalendarNextData';
import { useMayActForTheHouse } from '../../../hooks/useMayActForTheHouse';

/** The gateway's CalendarEventType enum (calendar.dto.ts:44-59). */
const ENUM_TYPES = new Set([
  'delivery',
  'order',
  'meeting',
  'inventory',
  'tasting',
  'reminder',
  'recurring',
  'custom',
  'provider_birthday',
  'holiday',
  'delivery_eta',
  'provider_unavailable',
  'inventory_count',
  'high_volume_expected',
]);

const STATUSES: EventStatus[] = ['pending', 'approved', 'completed', 'cancelled', 'dismissed'];

/** The writes a sheet can ask for; its banner speaks only for these. */
const WRITE_KEYS = ['create', 'update', 'remove', 'endSeries', 'createType', 'deleteType'] as const;
type WriteKey = (typeof WRITE_KEYS)[number];

export type SheetTarget =
  | {
      mode: 'create';
      date: string;
      startTime: string | null;
      /**
       * A draft carried in from another page (`/recommendations`'s "Put it on
       * the day-book"). Every field is optional and every one is only a
       * DEFAULT — the manager edits all of them before anything is written, so
       * a bad link produces a wrong-looking form, never a wrong row.
       *
       * `unreadable` is set INSTEAD of the fields when the link could not be
       * read at all. The sheet still opens, empty, and says so in words: a
       * person clicked something, and silently doing nothing would report the
       * absence of a draft as if it were health.
       */
      prefill?: { title?: string; type?: string; note?: string; unreadable?: string };
    }
  | { mode: 'edit'; event: CalEvent };

export interface EventSheetProps {
  data: CalendarData;
  target: SheetTarget;
  onClose: () => void;
}

/** Slug the chosen type name back onto the enum, or fall through to `custom`. */
function enumTypeFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '_');
  return ENUM_TYPES.has(slug) ? slug : 'custom';
}

/**
 * The gateway's own sentence when it sent one (a worded 409, say), else the
 * error's message. An axios error's message is only "Request failed with
 * status code 409", which says nothing (F-717).
 */
function refusalWords(failure: unknown): string {
  const said = (failure as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof said === 'string' && said) return said;
  return failure instanceof Error ? failure.message : 'unknown error';
}

/**
 * A refusal in one sentence that says "Nothing was saved" exactly once
 * (F-1157): the house's sentence when it already says so (the repeat
 * rollback's does, F-1147), else that sentence and then the promise.
 */
function refusalSentence(failure: unknown): string {
  const words = refusalWords(failure).trim();
  if (/nothing was saved/i.test(words)) return words;
  return `${words}${/[.!?]$/.test(words) ? '' : '.'} Nothing was saved.`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="cn-field">
      <span className="cn-label">{label}</span>
      {children}
    </label>
  );
}

export default function EventSheet({ data, target, onClose }: EventSheetProps) {
  const editing = target.mode === 'edit' ? target.event : null;

  // A draft handed over by another page. Only ever a set of DEFAULTS: every
  // one is editable in this form before anything is written, and `type` is
  // checked against the gateway's own enum below rather than trusted.
  const seed = target.mode === 'create' ? target.prefill : undefined;

  const [title, setTitle] = useState(editing?.title ?? seed?.title ?? '');
  const [typeName, setTypeName] = useState(
    // A custom entry reopens on its own type's chip, found by its colour (F-1110).
    (editing && customTypeOf(editing, data.eventTypes)?.name) ??
      editing?.type ??
      (seed?.type && ENUM_TYPES.has(seed.type) ? seed.type : 'delivery'),
  );
  // The stored row can carry values the gateway's own enums do not contain —
  // production has `event_type: 'audit'` and `status: 'active'`, neither of
  // which is in CalendarEventType / CalendarEventStatus (calendar.dto.ts:36-59).
  // Sending them back 400s, and coercing them into the enum would silently
  // rewrite the operator's record. So an untouched out-of-enum value is simply
  // not sent, and the sheet says the field is holding a value it cannot re-send.
  const [typeTouched, setTypeTouched] = useState(false);
  // A custom type is the whole house's: deleting it is asked first (F-694),
  // and the gateway lets only an owner or a manager do it.
  const [confirmTypeId, setConfirmTypeId] = useState<string | null>(null);
  const mayDeleteType = useMayActForTheHouse();
  const [statusTouched, setStatusTouched] = useState(false);
  const [color, setColor] = useState(editing?.color ?? '');
  const [date, setDate] = useState(editing?.date ?? (target.mode === 'create' ? target.date : ''));
  const [endDate, setEndDate] = useState(editing?.endDate ?? '');
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [startTime, setStartTime] = useState(
    editing ? clock(editing.startTime).replace(EM, '') : (target.mode === 'create' ? (target.startTime ?? '') : ''),
  );
  const [endTime, setEndTime] = useState(editing ? clock(editing.endTime).replace(EM, '') : '');
  const [providerId, setProviderId] = useState(editing?.providerId ?? '');
  const [status, setStatus] = useState<EventStatus>(editing?.status ?? 'pending');
  const [description, setDescription] = useState(editing?.description ?? seed?.note ?? '');
  const [freq, setFreq] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [every, setEvery] = useState(1);
  const [repeatCount, setRepeatCount] = useState(0);
  // The stored row is the source of truth now — not a localStorage queue that
  // only this browser can see. A new entry defaults to the column's own default
  // (reminder_enabled true, reminder_days_before 1: calendar.service.ts:124-125).
  const [remindOn, setRemindOn] = useState<boolean>(editing ? editing.reminderEnabled : true);
  const [remindDays, setRemindDays] = useState<number>(
    editing ? (editing.reminderDaysBefore ?? 1) : 1,
  );
  // Set when a save of a drawn occurrence is refused because its date changed.
  const [occurrenceRefusal, setOccurrenceRefusal] = useState<string | null>(null);
  const [newTypeName, setNewTypeName] = useState('');
  // Not a raw hex: the one named copy of `--seal`, and the note on SEAL_HEX
  // says why a stored swatch cannot be `var(--seal)`.
  const [newTypeColor, setNewTypeColor] = useState(SEAL_HEX);

  const custom = useMemo(() => data.eventTypes.filter((t) => !t.isDefault), [data.eventTypes]);
  // A name already on the list, whatever its case, is said before the click;
  // the gateway refuses the exact name with a 409 (F-717).
  const typeNameTaken = useMemo(() => {
    const wanted = newTypeName.trim().toLocaleLowerCase();
    return wanted !== '' && data.eventTypes.some((t) => t.name.trim().toLocaleLowerCase() === wanted);
  }, [newTypeName, data.eventTypes]);
  const saving = data.create.isPending || data.update.isPending;
  const writeKey = useDraftWriteKey('calendar-event');
  // Adding or deleting a custom type is a write too; its refusal must reach
  // the same banner (sweep 2026-09-28 row 19 — it used to vanish silently).
  // Only writes THIS sheet asked for: a mutation keeps its last error until it
  // runs again, so an earlier sheet's refusal used to greet a new entry (F-201).
  const [asked, setAsked] = useState<ReadonlySet<WriteKey>>(() => new Set());
  const ask = (key: WriteKey) => setAsked((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const failure = WRITE_KEYS.filter((k) => asked.has(k))
    .map((k) => data[k].error)
    .find((err) => err != null);

  /**
   * The server owns this entry's reminder from here on, so any copy the legacy
   * page queued for it in THIS browser is dropped. Without this, an entry
   * created on the shipping page and edited here would be reminded twice — once
   * by the cron and once by `main.tsx`'s poller.
   */
  const clearBrowserQueue = (eventId: string) => {
    cancelRemindersForEvent(eventId);
  };

  /**
   * An end day before the entry's own day is not a range (F-937). The gateway
   * refuses it too; before, it was stored and every subscribed calendar got
   * an entry ending before it starts.
   */
  const reversed = endDate !== '' && date !== '' && endDate < date;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    const base: CalendarPayload = {
      title: title.trim(),
      eventType: enumTypeFor(typeName),
      eventDate: date,
      allDay,
      status,
      description: description.trim() || undefined,
      color: color || undefined,
      eventTime: allDay || !startTime ? undefined : startTime,
      eventTimeEnd: allDay || !endTime ? undefined : endTime,
      // An all-day entry can span days too: a festival weekend (F-198).
      eventDateEnd: endDate || undefined,
      reminderEnabled: remindOn,
      reminderDaysBefore: remindOn ? remindDays : 0,
    };

    if (editing) {
      // An emptied field goes as null, which the gateway writes as a cleared
      // column; undefined would mean "leave it" and keep the old value (F-196).
      // All day carries no clock time, so ticking it clears both times.
      const patch: Partial<CalendarPayload> = {
        ...base,
        description: description.trim() || null,
        eventTime: allDay || !startTime ? null : startTime,
        eventTimeEnd: allDay || !endTime ? null : endTime,
        eventDateEnd: endDate || null,
      };
      if (storedTypeOutside && !typeTouched) delete patch.eventType;
      if (storedStatusOutside && !statusTouched) delete patch.status;
      if (editing.isOccurrence) {
        // A drawn occurrence carries ITS date, not the series row's. The PATCH
        // goes to the series id, and updateEvent writes `eventDate` straight
        // onto the row's start_date (calendar.service.ts updateEvent): sending
        // it would restart the series on this date, dropping every earlier one
        // and restarting an after_count. The only per-occurrence route
        // (`updateScope: 'this'`) needs a stored child row with a
        // parentEventId, which a drawn date does not have — so a changed date
        // is refused here, and an unchanged one is simply not sent.
        if (date !== editing.date || endDate !== (editing.endDate ?? '')) {
          setOccurrenceRefusal(
            `This sheet cannot move one date of a repeating entry. The gateway has no route for a single drawn date, and saving would restart the whole series on ${longDay(date)}, dropping every date before it. Nothing was saved. Put the date back to ${longDay(editing.date)} to save the other fields.`,
          );
          return;
        }
        delete patch.eventDate;
        delete patch.eventDateEnd;
      } else if (reversed) {
        return;
      }
      setOccurrenceRefusal(null);
      ask('update');
      data.update.mutate(
        { id: editing.seriesId, patch },
        {
          onSuccess: () => {
            clearBrowserQueue(editing.seriesId);
            onClose();
          },
        },
      );
      return;
    }

    if (reversed) return;
    ask('create');
    const entry = {
      ...base,
      providerId: providerId || undefined,
      recurrence:
        freq === 'none'
          ? undefined
          : {
              frequency: freq,
              interval: Math.max(1, every),
              endType: repeatCount > 0 ? 'after_count' : 'never',
              endAfterCount: repeatCount > 0 ? repeatCount : undefined,
            },
    };
    data.create.mutate(
      { ...entry, writeKey: writeKey.keyFor(entry) },
      {
        onSuccess: (created) => {
          writeKey.renew();
          clearBrowserQueue(created.id);
          onClose();
        },
      },
    );
  };

  /** The stored row can carry a value the gateway's own enum does not hold. */
  const storedTypeOutside = !!editing && !ENUM_TYPES.has(editing.type);
  const storedStatusOutside = !!editing && !STATUSES.includes(editing.status);

  /** A later date of a series: ending from it still keeps the dates before. */
  const canEndFrom =
    !!editing?.isOccurrence && !!editing.seriesStart && editing.date > editing.seriesStart;

  const linkedProvider = editing?.providerId
    ? data.providersById?.get(editing.providerId)?.name
    : null;

  return (
    <Sheet
      open
      onClose={onClose}
      label={editing ? `Edit ${editing.title}` : 'New calendar entry'}
      eyebrow={editing ? 'The entry' : 'A new line'}
      title={editing ? editing.title : longDay(date)}
    >
      <form onSubmit={submit} className="cn-form">
        {seed?.unreadable && (
          <p className="cn-quiet">
            {seed.unreadable} Nothing is filled in below, and nothing was written. Fill the
            line in by hand, or go back and open it from the page that sent you.
          </p>
        )}

        {editing?.isOccurrence && (
          <p className="cn-quiet">
            This is one occurrence of a repeating entry. The gateway has no per-occurrence route,
            so anything saved here changes the whole series. The series keeps its own start date:
            this date cannot be moved from here.
          </p>
        )}

        <Field label="Title">
          <input
            className="cn-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What is happening"
            required
          />
        </Field>

        <div className="cn-field">
          <span className="cn-label">Type</span>
          <div className="cn-chiprow">
            {data.eventTypes.map((t) => {
              const name = t.isDefault ? t.name.toLowerCase().replace(/\s+/g, '_') : t.name;
              const on = typeName === name;
              return (
                <span key={t.id} className="cn-row" style={{ gap: 2 }}>
                  <button
                    type="button"
                    className="cn-chip cn-ink"
                    aria-pressed={on}
                    onClick={() => {
                      setTypeName(name);
                      setTypeTouched(true);
                      setColor(t.color);
                    }}
                  >
                    <span className="cn-swatch" style={{ background: t.color }} aria-hidden />
                    {t.name}
                  </button>
                  {!t.isDefault && mayDeleteType && confirmTypeId !== t.id && (
                    <button
                      type="button"
                      className="cn-chip cn-ink"
                      aria-label={`Delete the ${t.name} type`}
                      onClick={() => setConfirmTypeId(t.id)}
                    >
                      ×
                    </button>
                  )}
                  {!t.isDefault && mayDeleteType && confirmTypeId === t.id && (
                    <span className="cn-row" role="group" aria-label={`Confirm deleting ${t.name}`} style={{ gap: 2 }}>
                      <span className="cn-quiet cn-tight">
                        Delete “{t.name}” for the whole house? Entries marked with it keep its colour but
                        lose its name.
                      </span>
                      <button
                        type="button"
                        className="cn-chip cn-ink"
                        onClick={() => {
                          setConfirmTypeId(null);
                          ask('deleteType');
                          data.deleteType.mutate(t.id);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="cn-chip cn-ink"
                        onClick={() => setConfirmTypeId(null)}
                      >
                        Keep
                      </button>
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          {!data.typesKnown && (
            <p className="cn-quiet cn-tight">
              {EM} The type list has not answered yet.
            </p>
          )}
          {storedTypeOutside && !typeTouched && (
            <p className="cn-quiet cn-tight">
              This entry is stored as <code>{editing?.type}</code>, which is outside the
              gateway&apos;s event-type enum — no chip above matches it. It is left exactly as it
              is unless you pick one.
            </p>
          )}
          {enumTypeFor(typeName) === 'custom' && typeName !== 'custom' && (
            <p className="cn-quiet cn-tight">
              “{typeName}” is stored as <code>custom</code> with its colour — the gateway&apos;s
              event-type enum has no slot for a custom name. The name lives on the type list, not
              on the entry.
            </p>
          )}
          <div className="cn-row" style={{ marginTop: 6 }}>
            <input
              className="cn-input"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="New type name"
              aria-label="New type name"
            />
            <input
              type="color"
              value={newTypeColor}
              onChange={(e) => setNewTypeColor(e.target.value)}
              aria-label="New type colour"
              style={{ width: 36, height: 32, padding: 0, border: 0, background: 'none' }}
            />
            <button
              type="button"
              className="cn-btn cn-ink"
              disabled={!newTypeName.trim() || typeNameTaken || data.createType.isPending}
              onClick={() => {
                ask('createType');
                data.createType.mutate(
                  { name: newTypeName.trim(), color: newTypeColor },
                  { onSuccess: () => setNewTypeName('') },
                );
              }}
            >
              Add
            </button>
          </div>
          {typeNameTaken && (
            <p role="status" className="cn-quiet cn-tight">
              A type called “{newTypeName.trim()}” is already on the list. Pick it above, or give
              the new one another name.
            </p>
          )}
          {custom.length === 0 && data.typesKnown && (
            <p className="cn-quiet cn-tight">
              No custom types yet — the eight above are the gateway&apos;s built-ins.
            </p>
          )}
        </div>

        <div className="cn-two">
          <Field label="Date">
            <input
              type="date"
              className="cn-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Ends on (optional)">
            <input
              type="date"
              className="cn-input"
              value={endDate}
              // A drawn occurrence's days are not sent; its own refusal says why.
              min={editing?.isOccurrence ? undefined : date || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
        </div>
        {reversed && !editing?.isOccurrence && (
          <p role="alert" className="cn-notice" style={{ marginTop: 6 }}>
            It ends before it starts. Pick an end day on or after {longDay(date)}, or leave it
            empty.
          </p>
        )}

        <label className="cn-field cn-check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>

        {!allDay && (
          <div className="cn-two">
            <Field label="Starts">
              <input
                type="time"
                className="cn-input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
            <Field label="Ends">
              <input
                type="time"
                className="cn-input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>
          </div>
        )}
        {/* One overnight rule with the grid and the feed (F-820): an end before
            the start is the next morning unless "Ends on" names a later day;
            equal times are a single moment, again unless it names a later day
            (F-821). */}
        {!allDay && startTime && endTime && endTime < startTime && (!endDate || endDate === date) && (
          <p className="cn-quiet cn-tight">Ends after midnight, at {endTime} the next morning.</p>
        )}
        {!allDay && startTime && endTime && endTime === startTime && (!endDate || endDate === date) && (
          <p className="cn-quiet cn-tight">Starts and ends at {startTime}, so it shows as a single moment.</p>
        )}

        <Field label="Vendor">
          {editing ? (
            <p className="cn-quiet" style={{ margin: 0 }}>
              {linkedProvider ?? (editing.providerId ? `${EM} not in the vendor book` : 'None linked')}
              {' — '}the update route accepts no vendor field, so a link is set when the entry is
              written and changed nowhere else.
            </p>
          ) : (
            <select
              className="cn-input"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">
                {data.providersKnown ? 'No vendor' : 'The vendor book has not answered'}
              </option>
              {data.providerList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="cn-field">
          <span className="cn-label">Status</span>
          <div className="cn-chiprow">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="cn-chip cn-ink"
                aria-pressed={status === s}
                onClick={() => {
                  setStatus(s);
                  setStatusTouched(true);
                }}
              >
                {s}
              </button>
            ))}
          </div>
          {storedStatusOutside && !statusTouched && (
            <p className="cn-quiet cn-tight">
              This entry is stored as <code>{editing?.status}</code>, which the gateway&apos;s
              status enum does not contain — sending it back would be refused, so it is left
              untouched unless you choose one above.
            </p>
          )}
          <p className="cn-quiet cn-tight">
            A delivery marked <strong>completed</strong> is ruled off in the book — as is one
            whose linked order the orders book says arrived.
          </p>
        </div>

        <Field label="Note">
          <textarea
            className="cn-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {/* ── repeat ─────────────────────────────────────────────────── */}
        <div className="cn-field">
          <span className="cn-label">Repeat</span>
          {editing ? (
            <p className="cn-quiet" style={{ margin: 0 }}>
              {editing.isRecurring
                ? 'This entry repeats. The update route carries no recurrence field, so the rule cannot be changed here.'
                : 'A repeat rule is set when the entry is written; the update route carries no recurrence field.'}
            </p>
          ) : (
            <div className="cn-row">
              <select
                className="cn-input"
                style={{ width: 'auto' }}
                value={freq}
                onChange={(e) => setFreq(e.target.value as typeof freq)}
                aria-label="Repeat frequency"
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
              {freq !== 'none' && (
                <>
                  <input
                    type="number"
                    min={1}
                    className="cn-input"
                    style={{ width: 70 }}
                    value={every}
                    onChange={(e) => setEvery(Number(e.target.value))}
                    aria-label="Repeat interval"
                  />
                  <input
                    type="number"
                    min={0}
                    className="cn-input"
                    style={{ width: 90 }}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Number(e.target.value))}
                    aria-label="Number of occurrences (0 for no end)"
                    placeholder="times"
                  />
                  <span className="cn-meta">0 = no end date</span>
                </>
              )}
            </div>
          )}
          {!editing && freq === 'monthly' && Number(date.slice(8, 10)) >= 29 && (
            <p className="cn-quiet cn-tight">
              In a shorter month it falls on the last day of that month.
            </p>
          )}
        </div>

        {/* ── reminders ──────────────────────────────────────────────── */}
        <ReminderRegister
          status={data.reminderJob.status}
          isLoading={data.reminderJob.isLoading}
          isError={data.reminderJob.isError}
          errorMessage={data.reminderJob.errorMessage}
          enabled={remindOn}
          daysBefore={remindDays}
          // A repeating entry is reminded date by date, so one stamp on the
          // series row says nothing about this date (F-605).
          alreadySent={
            editing?.reminderSent === true && !editing.isRecurring && !editing.isOccurrence
          }
          onChange={(next) => {
            setRemindOn(next.enabled);
            setRemindDays(next.daysBefore);
          }}
        />

        {occurrenceRefusal && (
          <p role="status" className="cn-notice" style={{ marginTop: 10 }}>
            {occurrenceRefusal}
          </p>
        )}

        {failure && (
          <p role="status" className="cn-notice" style={{ marginTop: 10 }}>
            {writeOutcomeUnknown(failure) ? (
              // A timeout or a 5xx can land after the write did (F-1083), so
              // this one says what MAY have happened; the book is read again.
              <>
                No answer came back, so this may already be on the calendar. Check the calendar
                before trying again.
              </>
            ) : (
              refusalSentence(failure)
            )}
          </p>
        )}

        <div className="cn-actions">
          <button type="submit" className="cn-btn cn-ink" data-primary="true" disabled={saving}>
            {saving ? 'Writing…' : editing ? 'Save the entry' : 'Write it in'}
          </button>
        </div>

        {editing && canEndFrom && (
          <div style={{ marginTop: 18 }}>
            <div className="cn-rule2" />
            <p className="cn-quiet" style={{ marginTop: 0 }}>
              Ending the series from {longDay(editing.date)} takes that date and every later one
              off the book. Every date before it stays.
            </p>
            <HoldToApprove
              label={`Hold to end the series from ${longDay(editing.date)}`}
              approvedLabel="Ended"
              onApprove={() => {
                ask('endSeries');
                data.endSeries.mutate(
                  { id: editing.seriesId, fromDate: editing.date },
                  { onSuccess: onClose },
                );
              }}
            />
          </div>
        )}

        {editing && (
          <div style={{ marginTop: 18 }}>
            <div className="cn-rule2" />
            <p className="cn-quiet" style={{ marginTop: 0 }}>
              {editing.isRecurring || editing.isOccurrence
                ? `Deleting removes the whole repeating series — every occurrence, past and future.${
                    canEndFrom ? ' To keep the earlier dates, end the series from this date above.' : ''
                  }`
                : 'Deleting removes this entry. It cannot be undone.'}
            </p>
            <HoldToApprove
              label={editing.isRecurring || editing.isOccurrence ? 'Hold to delete the series' : 'Hold to delete'}
              approvedLabel="Deleted"
              onApprove={() => {
                ask('remove');
                data.remove.mutate(
                  { id: editing.seriesId, scope: editing.isRecurring ? 'all' : undefined },
                  {
                    onSuccess: () => {
                      cancelRemindersForEvent(editing.seriesId);
                      onClose();
                    },
                  },
                );
              }}
            />
          </div>
        )}
      </form>
    </Sheet>
  );
}
