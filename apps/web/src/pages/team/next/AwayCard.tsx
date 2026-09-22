/**
 * Away dates for one person — the same card for the person themselves (My
 * shifts) and for an owner or manager setting it for them (the roster).
 *
 * The founder, 2026-09-21: *"they set away dates ... with override possible,
 * via either owner/manager account or staff member's account(personal only to
 * that person)"*. So: the person sets or ends their own; an owner or manager
 * can set or end someone's, and that one is written in the house log and the
 * person is told — except an owner's, which only an owner can set or end (his
 * round-2 answer 7, 2026-09-21). Dates only — there is no field for a reason,
 * on purpose.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AwayMarker } from '@/components/mudavym/AwayMarker';
import { awayExplanation } from '@/components/mudavym/awayWords';
import { endAway, setAway, type AwayReadout, type AwayView } from '../../../services/api/areas';
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
  canChange = true,
}: {
  /** `public.users.user_id`; null for a roster row with no account. */
  userId: string | null;
  personLabel: string;
  window: AwayView | null;
  /** House-local today from the Away read; null while it has not answered. */
  today: string | null;
  failed: boolean;
  self: boolean;
  /**
   * The reader may set or end these dates (`mayChangeAway`). False on an
   * owner's row read by a manager: the dates show, the controls do not, and
   * the card says who can change them. The gateway refuses it either way.
   */
  canChange?: boolean;
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

      {!self && !canChange ? (
        <p className="tm-hint">Only an owner can set or end an owner&apos;s Away dates.</p>
      ) : editing ? (
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

/**
 * Who else in the house is Away — the founder's round-2 answer 5 (2026-09-21):
 * staff also see a colleague's quiet Away marker, dates only, never a reason.
 *
 * Staff have no roster (it carries wages), so this is where a staff member
 * meets a colleague's name at all: one quiet line per person, the same marker
 * the roster draws. Nothing is drawn while nobody else is away. A failed read
 * says so — never an empty card that reads as "nobody is away".
 */
export function HouseAwayCard({
  away,
  failed,
  selfId,
}: {
  away: AwayReadout | null;
  failed: boolean;
  /** The reader's own `public.users.user_id`: their own window is on their own card. */
  selfId: string | null;
}) {
  if (failed) {
    return (
      <Card title="Away in the house">
        <p className="tm-alert" role="alert" style={{ margin: 0 }}>
          Away dates could not be read, so who else is away is unknown — not &quot;nobody&quot;.
        </p>
      </Card>
    );
  }
  if (away === null) return null;
  const others = away.windows.filter((w) => w.userId !== selfId);
  if (others.length === 0) return null;
  if (away.namesReadable === false) {
    return (
      <Card title="Away in the house">
        <p className="tm-alert" role="alert" style={{ margin: 0 }}>
          {others.length === 1 ? 'One colleague is' : `${others.length} colleagues are`} away or
          about to be, but the names could not be read.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Away in the house">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {others.map((w) => {
          const label = w.name ?? 'Someone with no name on the roster';
          return (
            <li key={w.userId} className="tm-note" style={{ margin: 0 }}>
              <AwayMarker name={label} personLabel={label} window={w} today={away.today} />
            </li>
          );
        })}
      </ul>
      <p className="tm-hint">Only the dates are kept.</p>
    </Card>
  );
}
