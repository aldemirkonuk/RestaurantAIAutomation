/**
 * Everything the desk opens that is not a shift or a person.
 *
 * The shapes are ADR 0112's, chosen by what the overlay is FOR:
 *   · `Panel`   — publish, re-publish, copy last week. Each one asks for a
 *                 decision, and each one DELETES before it writes, so each is
 *                 sealed with `HoldToApprove` and says in words what it
 *                 destroys.
 *   · `Sheet`   — the broadcast composer and the time-off file: one object, or
 *                 one act, arriving from the right.
 *   · `Popover` — export, hanging off the control that opened it.
 *
 * WHY THE SEAL IS ON THESE THREE AND NOTHING ELSE. `HoldToApprove` is the house
 * ceremony for real commitment and it is rationed. Copy-week DELETES every shift
 * already on the target week before it writes (`schedule.service.ts:202-207`),
 * and a re-publish DELETES every read receipt — the record of who has seen the
 * schedule (`:248-251`). Both were one click on the legacy desk. A first
 * publish destroys nothing, so it gets the die pressed dry: a plain confirm.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ClipboardCopy,
  FileSpreadsheet,
  FileText,
  Printer,
  Sheet as SheetIcon,
} from 'lucide-react';
import { HoldToApprove, Panel, Popover, Sheet } from '@/components/mudavym';
import {
  copyWeek,
  createTeamNote,
  createSchedule,
  createTimeOff,
  publishSchedule,
  reviewTimeOff,
  type Shift,
  type TeamMember,
  type TeamNotesReadout,
} from '../../../services/api/team';
import { exportTable, type TableExportColumn, type TableExportFormat } from '../../../lib/tableExport';
import { EM, addDays, fmtDayShort, fmtWeekRange, resolveName } from './tm-format';
import { MutationError, Tag } from './tm-bits';
import type { TimeOffRow } from './useTeamNextData';

/** The gateway's own words when it has them — a 409 says exactly what is missing. */
function serverMessage(e: unknown): string | null {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

/* ── publish / re-publish ────────────────────────────────────────────────── */

export function PublishPanel({
  weekStart,
  scheduleId,
  republish,
  receiptsSeen,
  onClose,
  onDone,
}: {
  weekStart: string;
  scheduleId: string | null;
  republish: boolean;
  /** `null` when the week has not answered — the sentence then says so. */
  receiptsSeen: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const publish = useMutation({
    mutationFn: async () => {
      let id = scheduleId;
      if (!id) id = (await createSchedule(weekStart)).id;
      // The flag is sent ONLY from a branch that has already shown what it
      // destroys, so the gateway's 409 keeps guarding every other path.
      return publishSchedule(id, republish ? { resetReceipts: true } : {});
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <Panel
      open
      onClose={onClose}
      label={republish ? 'Re-publish this week' : 'Publish this week'}
      eyebrow={fmtWeekRange(weekStart)}
      title={republish ? 'Re-publish this week' : 'Publish this week'}
    >
      <div className="tm-in" style={{ padding: '12px 16px 16px' }}>
        <MutationError when={publish.isError}>
          {serverMessage(publish.error) ??
            'The week was not published. Nothing changed and nobody was notified.'}
        </MutationError>
        {republish ? (
          <p className="tm-note">
            Re-publishing clears every read receipt, so the record of who has already seen
            this schedule{' '}
            {receiptsSeen === null
              ? `(${EM} — the week has not answered, so how many is unknown)`
              : `(${receiptsSeen} so far)`}{' '}
            is deleted, and everyone is notified again. This cannot be undone.
          </p>
        ) : (
          <p className="tm-note">
            Publishing tells the whole crew the week is final and starts collecting read
            receipts. Nothing is deleted.
          </p>
        )}
        <div className="tm-actions" style={{ marginTop: 14 }}>
          <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
            Not yet
          </button>
          {republish ? (
            <HoldToApprove
              onApprove={() => publish.mutate()}
              label="Hold to re-publish and clear receipts"
              approvedLabel="Re-published"
              disabled={publish.isPending}
            />
          ) : (
            <button
              type="button"
              className="tm-ctl tm-ctl--seal"
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? 'Publishing…' : 'Publish the week'}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ── copy last week ──────────────────────────────────────────────────────── */

export function CopyWeekPanel({
  weekStart,
  shiftsOnTarget,
  onClose,
  onDone,
}: {
  weekStart: string;
  /** `null` when the week has not answered — then the sentence refuses a number. */
  shiftsOnTarget: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const copy = useMutation({
    mutationFn: () => copyWeek(addDays(weekStart, -7), weekStart, { replaceTarget: true }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <Panel
      open
      onClose={onClose}
      label="Copy last week"
      eyebrow={`into ${fmtWeekRange(weekStart)}`}
      title="Copy last week"
    >
      <div className="tm-in" style={{ padding: '12px 16px 16px' }}>
        <MutationError when={copy.isError}>
          {serverMessage(copy.error) ??
            'Nothing was copied, and this week is exactly as it was.'}
        </MutationError>
        <p className="tm-note">
          Copying replaces this week first:{' '}
          {shiftsOnTarget === null
            ? 'every shift already on it'
            : `all ${shiftsOnTarget} shift${shiftsOnTarget === 1 ? '' : 's'} already on it`}{' '}
          is deleted before last week&apos;s arrive — including anything added by hand.
          This cannot be undone.
        </p>
        <div className="tm-actions" style={{ marginTop: 14 }}>
          <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
            Leave it
          </button>
          <HoldToApprove
            onApprove={() => copy.mutate()}
            label="Hold to replace the week"
            approvedLabel="Replaced"
            disabled={copy.isPending}
          />
        </div>
      </div>
    </Panel>
  );
}

/* ── the crew note — inline comms on the week ────────────────────────────── */

/**
 * A crew message on `/team` is a NOTE ON THE SCHEDULE, not correspondence.
 *
 * The founder's rule, 2026-09-04: the message sits in the page beside the week
 * it concerns, it always names who it went to, and nothing leaves through the
 * house's vendor mailbox. So the composer sends `channels: ['inbox', 'push']`
 * — the two the product owns — and the gateway's email and SMS legs (which go
 * out through `GmailService`, the single configured `GMAIL_SENDER_EMAIL` that
 * procurement writes to vendors from) are never reached. The gateway half is
 * `dto/team.dto.ts`'s `channels` and the gate in `team.controller.ts`.
 *
 * WHAT THE STRIP CAN AND CANNOT SAY. There is exactly one durable read-receipt
 * store on this page and it is `schedule_receipts` (baseline `:5293-5298`,
 * written by `POST …/schedules/:id/acknowledge`) — and it records that someone
 * opened the PUBLISHED WEEK, not that they read a note. Nothing anywhere
 * records a sent crew message: `broadcast` writes a notification row per
 * recipient and returns its reach, and no route reads those back for a
 * manager. So the strip shows two different things and never blends them: who
 * has opened the published week (durable, named), and what this page sent just
 * now (a receipt from the response, marked as not persisted). §13 of the page
 * note carries the request for a `team_notes` store that would make the second
 * one durable.
 */

/**
 * The strip is a READ of the register now, not a memory of this page.
 *
 * Until 2026-09-04 it could only report the send it had just made, because
 * `broadcast` left nothing behind — so an empty strip had to be captioned "not
 * from here, this session". `team_notes` and `team_note_recipients` (migration
 * 20260904180000) give a note an author, the audience it named at send time,
 * and a per-person `openedAt`, so the strip survives a reload and can say who
 * has read the note as distinct from who has opened the SCHEDULE.
 *
 * The two receipts stay apart, deliberately. `schedule_receipts` records
 * opening the published week; `team_note_recipients.opened_at` records reading
 * one note. Blending them would make "saw the roster" and "read the message"
 * the same fact.
 */
export function CrewNoteStrip({
  members,
  notes,
  notesFailed,
  receipts,
  published,
  weekStart,
  onCompose,
}: {
  members: TeamMember[] | null;
  /** `null` until the register answers; `readable: false` is a failed read. */
  notes: TeamNotesReadout | null;
  notesFailed: boolean;
  /** `schedule_receipts` rows for the published week; `null` until it answers. */
  receipts: Array<{ member_id: string; seen_at: string }> | null;
  published: boolean;
  weekStart: string;
  onCompose: () => void;
}) {
  const seenNames = useMemo(() => {
    if (receipts === null || members === null) return null;
    const byId = new Map(members.map((m) => [m.id, resolveName(m).text]));
    return receipts.map((r) => byId.get(r.member_id) ?? 'someone no longer on the roster');
  }, [receipts, members]);
  const crew = (members ?? []).filter((m) => m.status === 'active' && m.accountLinked).length;
  const latest = notes?.notes[0] ?? null;
  const unreadable = notesFailed || (notes !== null && !notes.readable);

  return (
    <section className="tm-panel" aria-label="Crew note" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2 className="tm-panel__title">The week&apos;s note</h2>
          {unreadable ? (
            <p className="tm-alert" role="alert">
              The note register could not be read
              {notes?.reason ? ` (${notes.reason})` : ''}, so whether anything has been
              said about this week is unknown — not no.
            </p>
          ) : notes === null ? (
            <p className="tm-quiet">Reading the week&apos;s notes…</p>
          ) : latest === null ? (
            <p className="tm-note">
              Nothing has been written about {fmtWeekRange(weekStart)}. That is the
              register answering, not this page forgetting.
            </p>
          ) : (
            <>
              <p className="tm-note">{latest.body}</p>
              <p className="tm-hint">
                {`Sent to ${latest.addressedCount} ${latest.addressedCount === 1 ? 'person' : 'people'} through ${latest.channels.join(' and ')} — `}
                {latest.openedCount === 0
                  ? 'nobody has opened it yet'
                  : `${latest.openedCount} of ${latest.addressedCount} have opened it: ${latest.recipients
                      .filter((r) => r.openedAt)
                      .map((r) => r.name ?? `${EM} name unreadable`)
                      .join(', ')}`}
                . No email and no SMS left the building.
              </p>
              {notes.notes.length > 1 && (
                <p className="tm-hint">
                  {notes.notes.length - 1} earlier note
                  {notes.notes.length - 1 === 1 ? '' : 's'} about this week.
                </p>
              )}
            </>
          )}
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h2 className="tm-panel__title">Who has opened the week</h2>
          {!published ? (
            <p className="tm-quiet">
              The week is not published, so there is nothing for anyone to have opened.
            </p>
          ) : seenNames === null ? (
            <p className="tm-quiet">
              The read receipts have not answered — {EM} of {crew || EM}.
            </p>
          ) : seenNames.length === 0 ? (
            <p className="tm-note">
              Nobody has opened the published week yet ({crew} on the crew). That is a
              measured zero: `schedule_receipts` holds no row for this schedule.
            </p>
          ) : (
            <>
              <p className="tm-note">
                {seenNames.length} of {crew} have opened it: {seenNames.join(', ')}.
              </p>
              <p className="tm-hint">
                From `schedule_receipts`, which records opening the SCHEDULE — a different
                fact from reading the note beside it.
              </p>
            </>
          )}
        </div>
        <button type="button" className="tm-ctl" onClick={onCompose}>
          Write a note
        </button>
      </div>
    </section>
  );
}

/**
 * The composer. Small, always targeted, and it writes a RECORD: the note, its
 * author, the people it named and a per-person receipt. `broadcast` without
 * `memberIds` used to mean the whole restaurant across four channels, and a
 * control labelled "Message {name}" sent exactly that (ADR 0088/0089).
 */
export function CrewNoteSheet({
  members,
  membersFailed,
  only,
  weekStart,
  scheduleId,
  onClose,
  onSent,
}: {
  members: TeamMember[] | null;
  membersFailed: boolean;
  /** A single member id, or null for the whole active crew. */
  only: string | null;
  weekStart: string;
  scheduleId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const recipients = useMemo(() => {
    const all = members ?? [];
    if (only) return all.filter((m) => m.id === only);
    return all.filter((m) => m.status === 'active' && m.accountLinked);
  }, [members, only]);

  const send = useMutation({
    mutationFn: () =>
      createTeamNote({
        weekStart,
        body: message,
        memberIds: recipients.map((m) => m.id),
        scheduleId: scheduleId ?? undefined,
      }),
    onSuccess: () => {
      onSent();
      onClose();
    },
  });

  const n = recipients.length;
  return (
    <Sheet
      open
      onClose={onClose}
      label={only ? 'A note to one person' : 'A note to the crew'}
      eyebrow={`On the week of ${weekStart}`}
      title={only ? 'A note to one person' : 'A note to the crew'}
      footer={
        <span>
          Goes to the in-app inbox and the phone. It does not become an email: this house
          has one mailbox and it is the one vendors are written from.
        </span>
      }
    >
      <div className="tm-in tm-form">
        <MutationError when={send.isError}>
          {serverMessage(send.error) ?? 'The note was not written, so nothing was sent.'}
        </MutationError>
        <div>
          <span className="tm-label">
            Reaches {n} {n === 1 ? 'person' : 'people'}
          </span>
          {membersFailed ? (
            <p className="tm-hint">
              The roster could not be read, so who this would reach is unknown. Sending is
              held until it can be named.
            </p>
          ) : members === null ? (
            <p className="tm-hint">Reading the roster…</p>
          ) : n === 0 ? (
            <p className="tm-hint">
              Nobody here has a linked account, so this note would reach nobody. The send
              control stays off rather than reporting a delivery that did not happen.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {recipients.map((m) => (
                <Tag key={m.id}>{resolveName(m).text}</Tag>
              ))}
            </div>
          )}
        </div>
        <label>
          <span className="tm-label">Note</span>
          <textarea
            className="tm-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="tm-hint">
            It is kept against this week and each person&apos;s reading of it is recorded,
            so it is still here after a reload — and you can see who has read it.
          </p>
        </label>
        <div className="tm-actions">
          <button type="button" className="tm-ctl tm-ctl--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tm-ctl tm-ctl--seal"
            disabled={send.isPending || message.trim() === '' || n === 0}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Sending…' : `Send to ${n}`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── time off ────────────────────────────────────────────────────────────── */

export function TimeOffSheet({
  requests,
  failed,
  members,
  weekStart,
  onClose,
  onChanged,
}: {
  requests: TimeOffRow[] | null;
  failed: boolean;
  members: TeamMember[] | null;
  weekStart: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [addFor, setAddFor] = useState('');
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members ?? []) m.set(x.id, resolveName(x).text);
    return m;
  }, [members]);

  const review = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'denied' }) =>
      reviewTimeOff(v.id, v.status),
    onSuccess: onChanged,
  });
  const add = useMutation({
    mutationFn: () =>
      createTimeOff({
        memberId: addFor,
        startDate: weekStart,
        endDate: addDays(weekStart, 6),
        reason: 'Entered by a manager from the team desk',
      }),
    onSuccess: () => {
      setAddFor('');
      onChanged();
    },
  });

  const pending = (requests ?? []).filter((r) => r.status === 'pending');
  const settled = (requests ?? []).filter((r) => r.status !== 'pending');

  return (
    <Sheet
      open
      onClose={onClose}
      label="Time off"
      eyebrow="Requests on file"
      title="Time off"
      footer={
        <span>
          Approving a request changes its status and nothing else — it does not remove the
          person from shifts they already hold.
        </span>
      }
    >
      <div className="tm-in">
        <div style={{ padding: '12px 16px 0' }}>
          <MutationError when={review.isError}>
            The decision was not recorded, so the request is still where it was.
          </MutationError>
          <MutationError when={add.isError}>
            The request was not filed. Nothing is on the manager&apos;s desk.
          </MutationError>
          {failed ? (
            <p className="tm-alert" role="alert">
              The time-off file could not be read, so whether anyone has asked for this
              week is unknown — not no.
            </p>
          ) : requests === null ? (
            <p className="tm-quiet">Reaching the gateway…</p>
          ) : requests.length === 0 ? (
            <p className="tm-note">
              No request is on file for anyone. That is an empty file, and it is the only
              thing this page knows about availability — nothing records who is simply
              unavailable.
            </p>
          ) : null}
        </div>

        {pending.length > 0 && <span className="mdv-sect">Waiting on you</span>}
        {pending.map((r) => (
          <div key={r.id} className="tm-rrow" style={{ padding: '8px 16px' }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-1)' }}>
              {nameOf.get(r.member_id) ?? 'Someone no longer on the roster'}
            </div>
            <div className="tm-rrow__line">
              {fmtDayShort(r.start_date)} – {fmtDayShort(r.end_date)}
              {r.reason ? ` · ${r.reason}` : ''}
            </div>
            <div className="tm-actions">
              <button
                type="button"
                className="tm-ctl tm-ctl--sm"
                disabled={review.isPending}
                onClick={() => review.mutate({ id: r.id, status: 'approved' })}
              >
                Approve
              </button>
              <button
                type="button"
                className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                disabled={review.isPending}
                onClick={() => review.mutate({ id: r.id, status: 'denied' })}
              >
                Deny
              </button>
            </div>
          </div>
        ))}

        {settled.length > 0 && <span className="mdv-sect">Decided</span>}
        {settled.map((r) => (
          <div key={r.id} className="tm-rrow" style={{ padding: '8px 16px' }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              {nameOf.get(r.member_id) ?? 'Someone no longer on the roster'} · {r.status}
            </div>
            <div className="tm-rrow__line">
              {fmtDayShort(r.start_date)} – {fmtDayShort(r.end_date)}
            </div>
          </div>
        ))}

        <div className="tm-form" style={{ borderTop: '1px solid var(--paper-2)' }}>
          <label>
            <span className="tm-label">File a request for someone</span>
            <select
              className="tm-select"
              value={addFor}
              onChange={(e) => setAddFor(e.target.value)}
            >
              <option value="">Choose a person</option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {resolveName(m).text}
                </option>
              ))}
            </select>
            <p className="tm-hint">
              Covers the whole week on screen ({fmtWeekRange(weekStart)}). The gateway has
              no route for a part-week request from here, so this page does not offer one.
            </p>
          </label>
          <div className="tm-actions">
            <button
              type="button"
              className="tm-ctl"
              disabled={add.isPending || addFor === ''}
              onClick={() => add.mutate()}
            >
              {add.isPending ? 'Filing…' : 'File it'}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* ── export ──────────────────────────────────────────────────────────────── */

const FORMATS: ReadonlyArray<[TableExportFormat, string]> = [
  ['csv', 'CSV'],
  ['excel', 'Excel'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['pdf', 'PDF'],
  ['clipboard', 'Copy to clipboard'],
];

export function ExportPopover({
  anchorRef,
  weekStart,
  shifts,
  members,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  weekStart: string;
  /** `null` when the week has not answered — exporting is then refused in words. */
  shifts: Shift[] | null;
  members: TeamMember[] | null;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      (shifts ?? [])
        .slice()
        .sort(
          (a, b) =>
            a.shift_date.localeCompare(b.shift_date) ||
            a.start_time.localeCompare(b.start_time),
        ),
    [shifts],
  );
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members ?? []) m.set(x.id, resolveName(x).text);
    return m;
  }, [members]);

  const columns: TableExportColumn<Shift>[] = [
    { header: 'Date', value: (s) => s.shift_date },
    { header: 'Who', value: (s) => (s.member_id ? (nameOf.get(s.member_id) ?? '') : 'open') },
    { header: 'Start', value: (s) => s.start_time },
    { header: 'End', value: (s) => s.end_time },
    { header: 'Station', value: (s) => s.role ?? '' },
    { header: 'Kind', value: (s) => s.shift_type },
    { header: 'State', value: (s) => s.state },
    // An unpriced shift exports as blank, never as 0 — a spreadsheet sums a 0.
    { header: 'Labour cost', value: (s) => (s.labor_cost == null ? '' : s.labor_cost) },
  ];

  const run = async (format: TableExportFormat) => {
    setFailed(null);
    try {
      await exportTable({
        format,
        rows,
        columns,
        filename: `schedule-${weekStart}`,
        title: `Schedule — week of ${weekStart}`,
      });
      onClose();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'the export did not complete');
    }
  };

  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      label="Export the week"
      width={260}
      showClose={false}
    >
      <span className="mdv-sect">
        {shifts === null ? 'The week has not answered' : `${rows.length} shifts`}
      </span>
      {shifts === null ? (
        <p className="mdv-note">
          Nothing is exported while the week is unknown — an empty file would read as a
          week with no shifts.
        </p>
      ) : (
        FORMATS.map(([format, label]) => (
          <button
            key={format}
            type="button"
            className="mdv-item"
            onClick={() => void run(format)}
          >
            {format === 'clipboard' ? (
              <ClipboardCopy size={14} aria-hidden className="mdv-item__icon" />
            ) : format === 'pdf' ? (
              <FileText size={14} aria-hidden className="mdv-item__icon" />
            ) : format === 'excel' ? (
              <SheetIcon size={14} aria-hidden className="mdv-item__icon" />
            ) : (
              <FileSpreadsheet size={14} aria-hidden className="mdv-item__icon" />
            )}
            <span className="mdv-item__text">{label}</span>
          </button>
        ))
      )}
      <button type="button" className="mdv-item" onClick={() => void run('print')}>
        <Printer size={14} aria-hidden className="mdv-item__icon" />
        <span className="mdv-item__text">Print the floor sheet</span>
      </button>
      {failed && <p className="mdv-note">The export did not run — {failed}.</p>}
    </Popover>
  );
}
