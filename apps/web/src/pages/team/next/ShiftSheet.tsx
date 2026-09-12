/**
 * One shift, as a `Sheet` (ADR 0112: a record arriving from the right).
 *
 * The fields are the legacy editor's, one for one — member, date, start, end,
 * station, type, note, and a delete on an existing shift
 * (`pages/team/command/editors.tsx:45-141`). What changes is where failure
 * goes: the legacy editor reported every error through a toast, and the
 * redesigned half mounts no toaster, so a failed save says so inside the sheet
 * and the sheet stays open with the operator's values still in it.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import {
  createShift,
  deleteShift,
  updateShift,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import { resolveName, todayIso } from './tm-format';
import { MutationError } from './tm-bits';

/** The gateway's `shift_type` vocabulary (`dto/team.dto.ts`), said as service. */
const SHIFT_TYPES: ReadonlyArray<[string, string]> = [
  ['am', 'day'],
  ['pm', 'evening'],
  ['double', 'double'],
  ['split', 'split'],
  ['training', 'training'],
  ['borrowed', 'borrowed'],
];

export interface ShiftSheetTarget {
  shift?: Shift;
  date?: string;
  memberId?: string;
}

export function ShiftSheet({
  target,
  members,
  scheduleId,
  onClose,
  onChanged,
}: {
  target: ShiftSheetTarget;
  /** `null` when the roster has not answered — the picker then says so. */
  members: TeamMember[] | null;
  scheduleId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const editing = Boolean(target.shift);
  const [form, setForm] = useState({
    memberId: target.shift?.member_id ?? target.memberId ?? '',
    shiftDate: target.shift?.shift_date ?? target.date ?? todayIso(),
    startTime: target.shift?.start_time?.slice(0, 5) ?? '17:00',
    endTime: target.shift?.end_time?.slice(0, 5) ?? '22:00',
    role: target.shift?.role ?? '',
    shiftType: target.shift?.shift_type ?? 'pm',
    note: target.shift?.note ?? '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const body = () => ({
    // camelCase: `forbidNonWhitelisted` (main.ts:54) 400s a snake_case body.
    scheduleId: scheduleId ?? undefined,
    memberId: form.memberId || undefined,
    shiftDate: form.shiftDate,
    startTime: form.startTime,
    endTime: form.endTime,
    role: form.role.trim() || undefined,
    shiftType: form.shiftType,
    note: form.note.trim() || undefined,
  });

  const save = useMutation({
    mutationFn: () =>
      editing ? updateShift(target.shift!.id, body()) : createShift(body()),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteShift(target.shift!.id),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const timesValid = form.startTime !== '' && form.endTime !== '';

  return (
    <Sheet
      open
      onClose={onClose}
      label={editing ? 'Edit shift' : 'Add shift'}
      eyebrow={editing ? 'Shift on the schedule' : 'New shift'}
      title={editing ? 'Edit this shift' : 'Add a shift'}
      footer={
        <span>
          A shift with nobody on it is an open shift, and the crew can claim it from My
          Shifts.
        </span>
      }
    >
      <div className="tm-in tm-form">
        <MutationError when={save.isError}>
          The shift was not saved, so the schedule is unchanged. Your values are still
          here — try again.
        </MutationError>
        <MutationError when={remove.isError}>
          The shift was not removed. It is still on the schedule.
        </MutationError>

        <label>
          <span className="tm-label">Who</span>
          <select
            className="tm-select"
            value={form.memberId}
            onChange={(e) => setForm({ ...form, memberId: e.target.value })}
          >
            <option value="">Open shift — nobody assigned</option>
            {(members ?? []).map((m) => {
              const n = resolveName(m);
              return (
                <option key={m.id} value={m.id}>
                  {n.text}
                  {m.position ? ` · ${m.position}` : ''}
                </option>
              );
            })}
          </select>
          {members === null && (
            <p className="tm-hint">
              The roster has not answered, so this list is empty because it is unknown —
              not because nobody works here. The shift can still be saved as an open one.
            </p>
          )}
        </label>

        <label>
          <span className="tm-label">Date</span>
          <input
            type="date"
            className="tm-input"
            value={form.shiftDate}
            onChange={(e) => setForm({ ...form, shiftDate: e.target.value })}
          />
        </label>

        <div className="tm-two">
          <label>
            <span className="tm-label">Start</span>
            <input
              type="time"
              className="tm-input"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
          <label>
            <span className="tm-label">End</span>
            <input
              type="time"
              className="tm-input"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </label>
        </div>

        <div className="tm-two">
          <label>
            <span className="tm-label">Station</span>
            <input
              className="tm-input"
              value={form.role}
              placeholder="Floor, Main bar, Pass…"
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </label>
          <label>
            <span className="tm-label">Kind</span>
            <select
              className="tm-select"
              value={form.shiftType}
              onChange={(e) => setForm({ ...form, shiftType: e.target.value })}
            >
              {SHIFT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span className="tm-label">Note</span>
          <input
            className="tm-input"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>

        {confirmDelete && (
          <div className="tm-alert">
            <p style={{ margin: 0 }}>
              Removing this shift deletes it from the week. Anyone who has already seen
              the published schedule will not be told it changed.
            </p>
            <div className="tm-actions">
              <button
                type="button"
                className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
              <button
                type="button"
                className="tm-ctl tm-ctl--sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Removing…' : 'Remove the shift'}
              </button>
            </div>
          </div>
        )}

        <div className="tm-actions" style={{ justifyContent: 'space-between' }}>
          {editing && !confirmDelete ? (
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setConfirmDelete(true)}
            >
              Remove
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="tm-ctl tm-ctl--seal"
            disabled={save.isPending || !timesValid}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save the shift' : 'Add the shift'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
