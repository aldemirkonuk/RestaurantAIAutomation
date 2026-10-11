/**
 * One shift, as a `Sheet` (ADR 0112: a record arriving from the right).
 *
 * The fields are the legacy editor's, one for one — member, date, start, end,
 * station, type, note, and a delete on an existing shift
 * (`pages/team/command/editors.tsx:45-141`). What changes is where failure
 * goes: the legacy editor reported every error through a toast, and the
 * redesigned half mounts no toaster, so a failed save says so inside the sheet
 * and the sheet stays open with the operator's values still in it.
 *
 * THE BREAK (ADR 0215; founder 2026-09-21, "Take all five", and 2026-09-22
 * round 6y for shifts of 4 hours or less). Whoever edits the shift records the
 * break taken, in minutes. Left empty, nothing is recorded, and the shift —
 * any length — is counted with the Labour Law 4857 Art. 68 minimum and shown
 * as assumed; the sheet says which minimum, live, as the times move. Emptying
 * a recorded break clears the record rather than keeping it.
 */

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import {
  createShift,
  deleteShift,
  getWeek,
  updateShift,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import {
  art68BreakForWork,
  breakCounted,
  breakUnderMinimum,
  fmtHours,
  houseLocale,
  mondayOf,
  resolveName,
  shiftHours,
  todayIso,
} from './tm-format';
import { MutationError, useHouseRegion } from './tm-bits';
import { serverMessage } from './TeamOverlays';
import { NotConfirmedError, saveOrConfirm } from './confirmSave';
import { useDraftWriteKey, writeOutcomeUnknown } from '@/lib/draftWriteKey';

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

/**
 * A delete whose answer was lost (F-1118). The shift may be gone, so a retry
 * that finds no shift (404) is the first try's delete, answered as done.
 * `tried` holds the ids whose last delete went unconfirmed.
 */
export async function deleteOrConfirm(
  id: string,
  remove: () => Promise<unknown>,
  tried: Set<string>,
): Promise<void> {
  try {
    await remove();
  } catch (e) {
    const status = (e as { response?: { status?: unknown } } | null)?.response?.status;
    if (tried.has(id) && status === 404) {
      tried.delete(id);
      return;
    }
    if (writeOutcomeUnknown(e)) tried.add(id);
    throw e;
  }
  tried.delete(id);
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
  /** The break on record when the sheet opened; `null` = nothing recorded. */
  const recordedAtOpen = target.shift?.recorded_break_min ?? null;
  const [form, setForm] = useState({
    memberId: target.shift?.member_id ?? target.memberId ?? '',
    shiftDate: target.shift?.shift_date ?? target.date ?? todayIso(),
    startTime: target.shift?.start_time?.slice(0, 5) ?? '17:00',
    endTime: target.shift?.end_time?.slice(0, 5) ?? '22:00',
    role: target.shift?.role ?? '',
    shiftType: target.shift?.shift_type ?? 'pm',
    note: target.shift?.note ?? '',
    /** Minutes, as typed. Empty = nothing recorded. */
    breakMin: recordedAtOpen == null ? '' : String(recordedAtOpen),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const spanMin = Math.round(shiftHours(form.startTime, form.endTime) * 60);
  const breakText = form.breakMin.trim();
  const breakTyped = breakText === '' ? null : Number(breakText);
  const breakValid =
    breakTyped === null ||
    (Number.isInteger(breakTyped) && breakTyped >= 0 && breakTyped < spanMin);
  /**
   * What the save sends for the break: a number records it; `null` clears a
   * break that was on record; omitted leaves the record as it was (or, on a
   * new shift, records nothing).
   */
  const breakForSave = (): { breakMinutes?: number | null } => {
    if (breakTyped !== null) return { breakMinutes: breakTyped };
    if (editing && recordedAtOpen !== null) return { breakMinutes: null };
    return {};
  };
  const preview = {
    start_time: form.startTime,
    end_time: form.endTime,
    shift_breaks: target.shift?.shift_breaks ?? null,
    recorded_break_min: breakValid ? breakTyped : null,
  };
  const counted = breakCounted(preview);
  // F-1020: Labour Law 4857 is Turkey's. A house elsewhere, or one whose
  // country is not known, is told what is counted, never another country's law.
  const region = useHouseRegion();
  const turkish = region === 'TR';
  // F-1149: the hours in the break sentence carry the house's decimal mark.
  const hoursIn = houseLocale(region);
  const breakHint = !breakValid
    ? `A break is a whole number of minutes, less than the shift's ${spanMin}.`
    : counted.assumed
      ? turkish
        ? `Nothing recorded, so this shift is counted with a ${counted.minutes}-minute break: the legal minimum for it (Labour Law 4857 Art. 68), shown as assumed. Type the real break to replace it.`
        : `Nothing recorded, so this shift is counted with a ${counted.minutes}-minute break, shown as assumed. Type the real break to replace it.`
      : breakTyped === 0
        ? 'Recorded as no break taken: the whole shift counts as worked.'
        : breakTyped !== null
          ? `Recorded: ${counted.minutes} minutes, not counted as work.`
          : 'Nothing recorded.';
  const underMinimum = breakValid && breakUnderMinimum(preview);

  /**
   * On an edit, an emptied field is sent as `null` so the gateway clears it:
   * "Open shift — nobody assigned" takes the person off, and an emptied role
   * or note is emptied (F-1032). `undefined` there means "leave as it is", so
   * the sheet used to close as saved with the person still on the shift.
   */
  const cleared = editing ? null : undefined;
  const body = () => ({
    // camelCase: `forbidNonWhitelisted` (main.ts:54) 400s a snake_case body.
    memberId: form.memberId || cleared,
    shiftDate: form.shiftDate,
    startTime: form.startTime,
    endTime: form.endTime,
    role: form.role.trim() || cleared,
    shiftType: form.shiftType,
    note: form.note.trim() || cleared,
    ...breakForSave(),
  });
  /**
   * The shift as this sheet saw it when it opened (F-1033). Another manager's
   * change since then makes the save a 409 in words, so an old sheet cannot
   * put the old person back. The schedule is not sent on an edit: the edit
   * body has no such field, and the gateway refuses one it does not know.
   */
  const asOpened = () => ({
    expectMemberId: target.shift!.member_id ?? null,
    ...(target.shift!.updated_at ? { expectUpdatedAt: target.shift!.updated_at } : {}),
  });

  /**
   * An edit whose reply was lost may have landed (F-1084): the shift is read
   * back, and one that holds what was sent is saved — not refused on retry as
   * "someone else changed" it, when the change was this sheet's own.
   */
  const triedUnconfirmed = useRef(false);
  const landedAsSent = async (sent: ReturnType<typeof body>): Promise<boolean | null> => {
    const week = await getWeek(mondayOf(new Date(`${sent.shiftDate}T00:00:00`)));
    const row = week.shifts?.find((s) => s.id === target.shift!.id);
    if (!row) return false;
    return (
      (row.member_id ?? null) === (sent.memberId ?? null) &&
      row.shift_date === sent.shiftDate &&
      row.start_time?.slice(0, 5) === sent.startTime &&
      row.end_time?.slice(0, 5) === sent.endTime &&
      (row.role ?? null) === (sent.role ?? null) &&
      row.shift_type === sent.shiftType &&
      (row.note ?? null) === (sent.note ?? null) &&
      (!('breakMinutes' in sent) || (row.recorded_break_min ?? null) === sent.breakMinutes)
    );
  };
  const writeKey = useDraftWriteKey('shift');
  const save = useMutation({
    mutationFn: () => {
      if (!editing) {
        const draft = { scheduleId: scheduleId ?? undefined, ...body() };
        return createShift(draft, undefined, writeKey.keyFor(draft));
      }
      const sent = body();
      return saveOrConfirm(
        () => updateShift(target.shift!.id, { ...sent, ...asOpened() }),
        () => landedAsSent(sent),
        triedUnconfirmed,
      );
    },
    onSuccess: () => {
      onChanged();
      onClose();
    },
    // A lost answer may be a saved shift (F-1083): read the week again.
    onError: (e) => {
      if (writeOutcomeUnknown(e)) onChanged();
    },
  });
  const triedDelete = useRef(new Set<string>());
  const remove = useMutation({
    mutationFn: () => {
      const id = target.shift!.id;
      return deleteOrConfirm(id, () => deleteShift(id, undefined, `shift-delete:${id}`), triedDelete.current);
    },
    onSuccess: () => {
      onChanged();
      onClose();
    },
    // A lost answer may be a deleted shift (F-1118): read the week again.
    onError: (e) => {
      if (writeOutcomeUnknown(e)) onChanged();
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
          {/* A 409 says why — time off, inactive, a clash — and what to do. */}
          {save.error instanceof NotConfirmedError
            ? 'This save could not be confirmed, and the shift could not be read back to check. Close this and open the shift again to see what is on the schedule now.'
            : !editing && writeOutcomeUnknown(save.error)
              ? 'No answer came back, so this shift may already be on the schedule. Check the schedule before adding it again.'
            : (serverMessage(save.error) ??
              'The shift was not saved, so the schedule is unchanged. Your values are still here — try again.')}
        </MutationError>
        <MutationError when={remove.isError}>
          {writeOutcomeUnknown(remove.error)
            ? 'No answer came back, so the shift may already be gone. Check the schedule before removing it again.'
            : 'The shift was not removed. It is still on the schedule.'}
        </MutationError>

        <label>
          <span className="tm-label">Who</span>
          <select
            className="tm-select"
            value={form.memberId}
            onChange={(e) => setForm({ ...form, memberId: e.target.value })}
          >
            <option value="">Open shift — nobody assigned</option>
            {(members ?? [])
              // An inactive person is not offered a shift (F-171) — unless
              // this shift is already theirs, so its row still reads true.
              .filter((m) => m.status !== 'inactive' || m.id === target.shift?.member_id)
              .map((m) => {
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
          <span className="tm-label">Break, in minutes</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className="tm-input"
            value={form.breakMin}
            placeholder="Not recorded"
            aria-label="Break, in minutes"
            aria-describedby="tm-break-hint"
            aria-invalid={!breakValid}
            onChange={(e) => setForm({ ...form, breakMin: e.target.value })}
          />
          <p className="tm-hint" id="tm-break-hint">
            {breakHint}
            {/* Owed for the work THIS break leaves, not "for this shift": an
                8-hour shift complies with 30, but a 20-minute break leaves 7h40m
                of work, which is owed 60 (Art. 68 counts working time). */}
            {underMinimum && breakTyped !== null
              ? turkish
                ? ` That is under the legal minimum of ${art68BreakForWork(spanMin - breakTyped)} minutes for the ${fmtHours((spanMin - breakTyped) / 60, hoursIn)} of work it leaves (Art. 68).`
                : ` That is under the ${art68BreakForWork(spanMin - breakTyped)}-minute break counted for the ${fmtHours((spanMin - breakTyped) / 60, hoursIn)} of work it leaves.`
              : ''}
          </p>
        </label>

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
            disabled={save.isPending || !timesValid || !breakValid}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save the shift' : 'Add the shift'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
