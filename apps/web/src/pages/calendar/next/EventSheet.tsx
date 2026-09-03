/**
 * EventSheet — writing a line into the book, and correcting one.
 *
 * Every control here is backed by a route that exists. Where the gateway
 * cannot do a thing, the control is rendered disabled with one line saying so
 * rather than offered and quietly dropped — which is what today's page does
 * with the email reminder channel, the meeting memo and the labels field
 * (calendar.md §10).
 *
 * The three honest refusals, each cited:
 *  - **email reminders** — the server job writes the inbox row and pushes to
 *    phones (calendar-reminders.service.ts `deliver`); mail would need a
 *    recipient policy of its own, so the tick is drawn disabled;
 *  - **vendor link on edit** — UpdateCalendarEventDto has no `providerId`
 *    (calendar.dto.ts:229-296) and the gateway forbids non-whitelisted keys,
 *    so the field is create-time only;
 *  - **repeat rule on edit** — same DTO, no `recurrence`.
 *
 * Deleting is the one irreversible act on this page, so it is the one place
 * that spends the house ceremony: HoldToApprove, completing into the seal.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { HoldToApprove } from '../../../components/mudavym';
// The browser scheduler is DEMOTED, not imported wholesale: only the canceller
// survives here, so saving an entry clears any copy the legacy page queued for
// it in this browser. Nothing in `pages/calendar/next/**` enqueues any more.
import { cancelRemindersForEvent } from '../../../lib/reminder-scheduler';
import { EM, clock, longDay } from './cal-format';
import ReminderRegister from './ReminderRegister';
import type { CalEvent, CalendarData, CalendarPayload, EventStatus } from './useCalendarNextData';

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

export type SheetTarget =
  | { mode: 'create'; date: string; startTime: string | null }
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
  const closeRef = useRef<HTMLButtonElement>(null);

  const [title, setTitle] = useState(editing?.title ?? '');
  const [typeName, setTypeName] = useState(editing?.type ?? 'delivery');
  // The stored row can carry values the gateway's own enums do not contain —
  // production has `event_type: 'audit'` and `status: 'active'`, neither of
  // which is in CalendarEventType / CalendarEventStatus (calendar.dto.ts:36-59).
  // Sending them back 400s, and coercing them into the enum would silently
  // rewrite the operator's record. So an untouched out-of-enum value is simply
  // not sent, and the sheet says the field is holding a value it cannot re-send.
  const [typeTouched, setTypeTouched] = useState(false);
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
  const [description, setDescription] = useState(editing?.description ?? '');
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
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeColor, setNewTypeColor] = useState('#1A5E6B');

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const custom = useMemo(() => data.eventTypes.filter((t) => !t.isDefault), [data.eventTypes]);
  const saving = data.create.isPending || data.update.isPending;
  const failure = data.create.error ?? data.update.error ?? data.remove.error;

  /**
   * The server owns this entry's reminder from here on, so any copy the legacy
   * page queued for it in THIS browser is dropped. Without this, an entry
   * created on the shipping page and edited here would be reminded twice — once
   * by the cron and once by `main.tsx`'s poller.
   */
  const clearBrowserQueue = (eventId: string) => {
    cancelRemindersForEvent(eventId);
  };

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
      eventDateEnd: allDay || !endDate ? undefined : endDate,
      reminderEnabled: remindOn,
      reminderDaysBefore: remindOn ? remindDays : 0,
    };

    if (editing) {
      const patch: Partial<CalendarPayload> = { ...base };
      if (storedTypeOutside && !typeTouched) delete patch.eventType;
      if (storedStatusOutside && !statusTouched) delete patch.status;
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

    data.create.mutate(
      {
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
      },
      {
        onSuccess: (created) => {
          clearBrowserQueue(created.id);
          onClose();
        },
      },
    );
  };

  /** The stored row can carry a value the gateway's own enum does not hold. */
  const storedTypeOutside = !!editing && !ENUM_TYPES.has(editing.type);
  const storedStatusOutside = !!editing && !STATUSES.includes(editing.status);

  const linkedProvider = editing?.providerId
    ? data.providersById?.get(editing.providerId)?.name
    : null;

  return (
    <>
      <button type="button" className="cn-scrim" aria-label="Close" onClick={onClose} />
      <aside
        className="cn-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `Edit ${editing.title}` : 'New calendar entry'}
      >
        <form onSubmit={submit} className="cn-form">
          <div className="cn-head" style={{ marginBottom: 12 }}>
            <div>
              <span className="cn-eyebrow">{editing ? 'The entry' : 'A new line'}</span>
              <h2 className="cn-h2">{editing ? editing.title : longDay(date)}</h2>
            </div>
            <button ref={closeRef} type="button" className="cn-btn cn-ink" onClick={onClose}>
              Close
            </button>
          </div>

          {editing?.isOccurrence && (
            <p className="cn-quiet">
              This is one occurrence of a repeating entry. The gateway has no per-occurrence route,
              so anything saved here changes the whole series.
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
                    {!t.isDefault && (
                      <button
                        type="button"
                        className="cn-chip cn-ink"
                        aria-label={`Delete the ${t.name} type`}
                        onClick={() => data.deleteType.mutate(t.id)}
                      >
                        ×
                      </button>
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
                disabled={!newTypeName.trim() || data.createType.isPending}
                onClick={() =>
                  data.createType.mutate(
                    { name: newTypeName.trim(), color: newTypeColor },
                    { onSuccess: () => setNewTypeName('') },
                  )
                }
              >
                Add
              </button>
            </div>
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
                onChange={(e) => setEndDate(e.target.value)}
                disabled={allDay}
              />
            </Field>
          </div>

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
          </div>

          {/* ── reminders ──────────────────────────────────────────────── */}
          <ReminderRegister
            status={data.reminderJob.status}
            isLoading={data.reminderJob.isLoading}
            isError={data.reminderJob.isError}
            errorMessage={data.reminderJob.errorMessage}
            enabled={remindOn}
            daysBefore={remindDays}
            alreadySent={editing?.reminderSent === true}
            onChange={(next) => {
              setRemindOn(next.enabled);
              setRemindDays(next.daysBefore);
            }}
          />

          {failure && (
            <p role="status" className="cn-notice" style={{ marginTop: 10 }}>
              The gateway refused this write ({failure instanceof Error ? failure.message : 'unknown error'}).
              Nothing was saved.
            </p>
          )}

          <div className="cn-actions">
            <button type="submit" className="cn-btn cn-ink" data-primary="true" disabled={saving}>
              {saving ? 'Writing…' : editing ? 'Save the entry' : 'Write it in'}
            </button>
          </div>

          {editing && (
            <div style={{ marginTop: 18 }}>
              <div className="cn-rule2" />
              <p className="cn-quiet" style={{ marginTop: 0 }}>
                {editing.isRecurring || editing.isOccurrence
                  ? 'Deleting removes the whole repeating series — every occurrence, past and future.'
                  : 'Deleting removes this entry. It cannot be undone.'}
              </p>
              <HoldToApprove
                label={editing.isRecurring || editing.isOccurrence ? 'Hold to delete the series' : 'Hold to delete'}
                approvedLabel="Deleted"
                onApprove={() =>
                  data.remove.mutate(
                    { id: editing.seriesId, scope: editing.isRecurring ? 'all' : undefined },
                    {
                      onSuccess: () => {
                        cancelRemindersForEvent(editing.seriesId);
                        onClose();
                      },
                    },
                  )
                }
              />
            </div>
          )}
        </form>
      </aside>
    </>
  );
}
