/**
 * Away dates for one person — the same card for the person themselves (My
 * shifts) and for an owner or manager setting it for them (the roster).
 *
 * The founder, 2026-09-21: *"they set away dates ... with override possible,
 * via either owner/manager account or staff member's account(personal only to
 * that person)"*. So: the person sets or ends their own; an owner or manager
 * can set or end anyone's, and that one is written in the house log and the
 * person is told. Dates only — there is no field for a reason, on purpose.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AwayMarker } from '@/components/mudavym/AwayMarker';
import { awayExplanation } from '@/components/mudavym/awayWords';
import { endAway, setAway, type AwayView } from '../../../services/api/areas';
import { getErrorMessage } from '../../../services/api/client';
import { awayKey } from './useHouseAreas';
import { useActiveRestaurantId } from './useTeamNextData';
import { Card, MutationError } from './tm-bits';

export function AwayCard({
  userId,
  personLabel,
  window,
  today,
  failed,
  self,
}: {
  /** `public.users.user_id`; null for a roster row with no account. */
  userId: string | null;
  personLabel: string;
  window: AwayView | null;
  /** House-local today from the Away read; null while it has not answered. */
  today: string | null;
  failed: boolean;
  self: boolean;
}) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ from: window?.from ?? today ?? '', until: window?.until ?? '' });

  const refresh = () => void qc.invalidateQueries({ queryKey: awayKey(rid) });
  const save = useMutation({
    mutationFn: () => setAway(userId as string, { from: form.from, until: form.until }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const end = useMutation({
    mutationFn: () => endAway(userId as string),
    onSuccess: refresh,
  });

  const title = self ? 'Away' : 'Away dates';

  if (!userId) {
    return (
      <Card title={title}>
        <p className="tm-quiet">
          This person has no account yet, so no alert reaches them and there is nothing
          to pause.
        </p>
      </Card>
    );
  }
  if (failed) {
    return (
      <Card title={title}>
        <p className="tm-alert" role="alert">
          Away dates could not be read, so whether {self ? 'you are' : 'this person is'} away is
          unknown — not &quot;no&quot;.
        </p>
      </Card>
    );
  }
  if (today === null) {
    return (
      <Card title={title}>
        <p className="tm-quiet">Reaching the gateway…</p>
      </Card>
    );
  }

  const valid = form.from !== '' && form.until !== '' && form.until >= form.from;

  return (
    <Card title={title}>
      {window ? (
        <>
          <p className="tm-note" style={{ margin: '0 0 6px' }}>
            <AwayMarker
              name={self ? 'You' : personLabel}
              personLabel={personLabel}
              window={window}
              today={today}
              self={self}
              interactive={false}
            />
          </p>
          <p className="tm-hint">{awayExplanation(window, { personLabel, self })}</p>
        </>
      ) : (
        <p className="tm-quiet">
          {self
            ? 'Not away. Set dates before a holiday and most alerts will skip you on them.'
            : `${personLabel} is not away.`}
        </p>
      )}

      {editing ? (
        <form
          className="tm-form"
          style={{ padding: '8px 0 0' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <div className="tm-two">
            <label>
              <span className="tm-label">From</span>
              <input
                type="date"
                className="tm-input"
                value={form.from}
                min={today}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                required
              />
            </label>
            <label>
              <span className="tm-label">Until (last day away)</span>
              <input
                type="date"
                className="tm-input"
                value={form.until}
                min={form.from || today}
                onChange={(e) => setForm({ ...form, until: e.target.value })}
                required
              />
            </label>
          </div>
          <div className="tm-actions">
            <button type="submit" className="tm-ctl" disabled={!valid || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save Away dates'}
            </button>
            <button type="button" className="tm-ctl tm-ctl--quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {!self && (
            <p className="tm-hint">
              Setting someone else&apos;s dates is written in the house log, and they are told.
            </p>
          )}
        </form>
      ) : (
        <div className="tm-actions">
          <button
            type="button"
            className="tm-ctl tm-ctl--sm"
            onClick={() => {
              setForm({ from: window?.from ?? today, until: window?.until ?? '' });
              setEditing(true);
            }}
          >
            {window ? 'Change dates' : 'Set Away dates'}
          </button>
          {window && (
            <button
              type="button"
              className="tm-ctl tm-ctl--sm tm-ctl--quiet"
              disabled={end.isPending}
              onClick={() => end.mutate()}
            >
              {end.isPending ? 'Ending…' : window.activeNow ? 'End Away now' : 'Cancel Away'}
            </button>
          )}
        </div>
      )}

      <MutationError when={save.isError}>
        Away was not saved: {getErrorMessage(save.error)}
      </MutationError>
      <MutationError when={end.isError}>
        Away was not ended: {getErrorMessage(end.error)}
      </MutationError>
    </Card>
  );
}
