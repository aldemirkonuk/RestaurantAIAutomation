/**
 * ReminderRegister — the reminder rows, and the job that keeps them.
 *
 * WHAT THIS REPLACES. Until 2026-09-03 this block said "Reminders — on this
 * browser", offered four minute-granular presets, and wrote them into
 * `localStorage` for a poller booted in `main.tsx:20`. It was honest, and it was
 * a promise no product can make: a reminder set on the office laptop did not
 * exist on the phone and none fired with the tab closed. The founder's answer to
 * an honest dash was to build the thing, so the reminder is now a server job
 * (`apps/api-gateway/src/calendar/calendar-reminders.service.ts`) and this block
 * is its register.
 *
 * A register states its source. Three sentences here are load-bearing and none
 * of them is computed in the browser:
 *  - **whether the job serves this house at all** — the cron enumerates
 *    opted-in tenants (ADR 0022); for a restaurant it does not serve, showing a
 *    next-run time would promise a run that will never come;
 *  - **when it last actually ran**, beside when it is next scheduled — a
 *    schedule is not evidence that a process is alive;
 *  - **the reader's own quiet window**, because a reminder due inside it is
 *    held, per person, until the window closes.
 *
 * No emoji: the marks are lucide icons in ink, sized by the house tokens.
 */

import {
  AlertTriangle,
  BellRing,
  CircleSlash,
  Clock3,
  Moon,
  MonitorSmartphone,
  PauseCircle,
} from 'lucide-react';
import { EM, sinceOrUntil, stamp } from './cal-format';
import type { ReminderJobStatus } from './useCalendarNextData';

/**
 * The offsets the COLUMN can hold. `calendar_events.reminder_days_before` is an
 * INTEGER of days (supabase/migrations/20260805000000_baseline_from_production.sql:2358),
 * so "15 minutes before" is not representable and is not offered. Offering it
 * and rounding to a day would be the page inventing a value the house never
 * chose — see calendar.md §13 for the column that would fix it.
 */
export const DAY_OFFSETS: Array<[number, string]> = [
  [0, 'On the day'],
  [1, '1 day before'],
  [2, '2 days before'],
  [7, '1 week before'],
];

const ICON = { width: 13, height: 13, strokeWidth: 1.75 } as const;

export interface ReminderRegisterProps {
  /** null while the gateway has not answered. */
  status: ReminderJobStatus | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  /** This entry's stored setting, as the row carries it. */
  enabled: boolean;
  daysBefore: number;
  onChange: (next: { enabled: boolean; daysBefore: number }) => void;
  /** True once this entry's reminder has already been sent by the job. */
  alreadySent?: boolean;
}

export default function ReminderRegister({
  status,
  isLoading,
  isError,
  errorMessage,
  enabled,
  daysBefore,
  onChange,
  alreadySent,
}: ReminderRegisterProps) {
  return (
    <div className="cn-field">
      <span className="cn-label">Reminders — kept by the house</span>

      <div className="cn-chiprow">
        <button
          type="button"
          className="cn-chip cn-ink"
          aria-pressed={!enabled}
          onClick={() => onChange({ enabled: false, daysBefore })}
        >
          <CircleSlash {...ICON} aria-hidden="true" />
          No reminder
        </button>
        {DAY_OFFSETS.map(([days, label]) => (
          <button
            key={days}
            type="button"
            className="cn-chip cn-ink"
            aria-pressed={enabled && daysBefore === days}
            onClick={() => onChange({ enabled: true, daysBefore: days })}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="cn-quiet cn-tight">
        Whole days only — the entry stores a number of days, not minutes, so the
        house does not offer an offset it cannot keep.
      </p>

      {alreadySent && (
        <p className="cn-quiet cn-tight cn-noteline">
          <BellRing {...ICON} aria-hidden="true" /> This entry&rsquo;s reminder has already been
          sent. Changing the offset will not send it again.
        </p>
      )}

      <div className="cn-rule2" style={{ margin: '10px 0 8px' }} />

      <JobAccount
        status={status}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
      />

      <div className="cn-chiprow cn-tight">
        <button type="button" className="cn-chip" aria-pressed={true} disabled>
          In app and on your phone
        </button>
        <button type="button" className="cn-chip" disabled>
          Email
        </button>
      </div>
      <p className="cn-quiet cn-tight">
        The job writes a notification row and pushes it to members&rsquo; phones. Email stays
        disabled because nothing sends it: mail would need a recipient policy of its own, which
        this build did not decide.
      </p>
    </div>
  );
}

/** The job's own account of itself. Every branch says something true. */
function JobAccount({
  status,
  isLoading,
  isError,
  errorMessage,
}: Pick<ReminderRegisterProps, 'status' | 'isLoading' | 'isError' | 'errorMessage'>) {
  if (isLoading) {
    return (
      <p className="cn-quiet cn-tight" role="status">
        Reading the reminder job&rsquo;s ledger{EM}
      </p>
    );
  }

  if (isError || !status) {
    return (
      <p className="cn-quiet cn-tight cn-noteline" role="status">
        <AlertTriangle {...ICON} aria-hidden="true" /> The reminder job could not be read
        {errorMessage ? ` (${errorMessage})` : ''}. Whether reminders are being sent for this
        house is unknown right now — this line is not a claim that they are.
      </p>
    );
  }

  if (!status.armed) {
    return (
      <p className="cn-quiet cn-tight cn-noteline" role="status">
        <PauseCircle {...ICON} aria-hidden="true" /> <strong>The reminder job is built but not
        switched on.</strong> It sends nothing until <code>{status.armedFlag}</code> is set on
        the gateway, and it is off by default because it writes to every member&rsquo;s inbox
        and phone. Turning it on is the founder&rsquo;s call.
      </p>
    );
  }

  if (status.served === false) {
    return (
      <p className="cn-quiet cn-tight cn-noteline" role="status">
        <CircleSlash {...ICON} aria-hidden="true" /> <strong>No reminder will be sent.</strong>{' '}
        {status.servedReason}
      </p>
    );
  }

  if (status.served === null) {
    return (
      <p className="cn-quiet cn-tight cn-noteline" role="status">
        <AlertTriangle {...ICON} aria-hidden="true" /> {status.servedReason}
      </p>
    );
  }

  const { lastRun } = status;

  return (
    <>
      <p className="cn-quiet cn-tight cn-noteline" style={{ marginBottom: 4 }}>
        <Clock3 {...ICON} aria-hidden="true" />{' '}
        {!status.ledgerReadable ? (
          <>
            The run ledger could not be read, so <em>when this job last ran is unknown</em> — which
            is not the same as it never having run.
          </>
        ) : lastRun ? (
          <>
            Last run <strong>{sinceOrUntil(lastRun.startedAt)}</strong> ({stamp(lastRun.startedAt)}
            ): {lastRun.considered} due, {lastRun.sent} sent
            {lastRun.deferredQuietHours > 0
              ? `, ${lastRun.deferredQuietHours} held for quiet hours`
              : ''}
            {lastRun.failed > 0 ? `, ${lastRun.failed} failed` : ''}
            {lastRun.finishedAt ? '' : ' — and it did not finish'}.
          </>
        ) : (
          <>
            This job has <strong>never run for this restaurant</strong>. It is scheduled, but no
            sweep has been recorded yet.
          </>
        )}
      </p>

      <p className="cn-quiet cn-tight cn-noteline" style={{ marginBottom: 4 }}>
        <BellRing {...ICON} aria-hidden="true" /> Next run{' '}
        <strong>{status.nextRunAt ? sinceOrUntil(status.nextRunAt) : EM}</strong>
        {status.nextRunAt ? ` (${stamp(status.nextRunAt)})` : ''} — every{' '}
        {status.intervalMinutes} minutes, on the server, whether or not this page is open.
        {status.pending !== null
          ? ` ${status.pending} ${status.pending === 1 ? 'entry is' : 'entries are'} still waiting.`
          : ' How many entries are waiting could not be counted.'}
      </p>

      {status.viewer.quietHours.enabled ? (
        <p className="cn-quiet cn-tight cn-noteline" style={{ marginBottom: 4 }}>
          <Moon {...ICON} aria-hidden="true" /> Your quiet hours are{' '}
          {status.viewer.quietHours.start}
          {EM}
          {status.viewer.quietHours.end}
          {status.timeZone ? ` (${status.timeZone})` : ''}. A reminder that falls inside them is
          held for you alone until the window closes, not dropped and not sent to anyone else
          early.
        </p>
      ) : (
        <p className="cn-quiet cn-tight cn-noteline" style={{ marginBottom: 4 }}>
          <Moon {...ICON} aria-hidden="true" /> You have no quiet hours set
          {status.viewer.usingDefaults ? ' (no stored preference — the defaults stand in)' : ''}, so
          a reminder reaches you at any hour. Settings holds the window.
        </p>
      )}

      {status.viewer.remindersEnabled === false && (
        <p className="cn-quiet cn-tight cn-noteline" style={{ marginBottom: 4 }}>
          <CircleSlash {...ICON} aria-hidden="true" /> You have turned calendar reminders off, so
          this one will go to the rest of the house and not to you.
        </p>
      )}

      {status.unconfirmed !== null && status.unconfirmed > 0 && (
        <p className="cn-quiet cn-tight cn-noteline" role="status" style={{ marginBottom: 4 }}>
          <AlertTriangle {...ICON} aria-hidden="true" /> {status.unconfirmed} reminder
          {status.unconfirmed === 1 ? ' was' : 's were'} claimed and never confirmed — the job
          stopped between taking the claim and writing the notification. Those are not counted as
          sent.
        </p>
      )}

      {lastRun?.truncated && (
        <p className="cn-quiet cn-tight cn-noteline" role="status" style={{ marginBottom: 4 }}>
          <AlertTriangle {...ICON} aria-hidden="true" /> The last sweep read a full page of
          entries and stopped there; the rest wait for the next run.
        </p>
      )}

      <p className="cn-quiet cn-tight cn-noteline">
        <MonitorSmartphone {...ICON} aria-hidden="true" /> The old per-browser scheduler is
        retired for entries written here: it still drains reminders queued by the legacy calendar
        in this browser, and this sheet clears an entry&rsquo;s browser-queued copies when you
        save, so nothing is reminded twice.
      </p>
    </>
  );
}
