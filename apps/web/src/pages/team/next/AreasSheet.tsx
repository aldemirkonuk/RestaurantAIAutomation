/**
 * Areas — who works where, and who leads it (ADR 0218). Owners and managers.
 *
 * The founder, 2026-09-21: *"they have labels, classifcation responsible for
 * each so different alerts different notifications for different areas"*, and
 * for the lead: *"Yes, cards only"*.
 *
 * One block per area, in the same order every time. Each block says its name
 * (renamable), whether it is on, and who is in it; a person can be in several
 * areas. The lead mark sits on the person inside the area, because a lead is
 * always one of that area's people. Every change here is written in the house
 * log ("What changed here"), and a lead is told when they gain or lose it.
 *
 * Nothing on this sheet hides anything from anyone: areas decide who is
 * ALERTED first and what a staff list shows first. Owners and managers keep
 * seeing everything.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { AwayMarker } from '@/components/mudavym/AwayMarker';
import {
  AREA_KINDS,
  removeMembership,
  setArea,
  setMembership,
  type AreaKind,
  type AreaView,
  type AreasReadout,
  type AwayView,
  type MembershipView,
} from '../../../services/api/areas';
import { getErrorMessage } from '../../../services/api/client';
import type { TeamMember } from '../../../services/api/team';
import { resolveName } from './tm-format';
import { MutationError, Tag } from './tm-bits';
import { areasKey } from './useHouseAreas';
import { useActiveRestaurantId } from './useTeamNextData';

function useAreaMutations() {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: areasKey(rid) });
    // The house log reads the same trail; a grant should show there at once.
    void qc.invalidateQueries({ queryKey: ['team-next-trail', rid] });
  };
  const rename = useMutation({
    mutationFn: (v: { kind: AreaKind; name?: string; enabled?: boolean }) =>
      setArea(v.kind, { name: v.name, enabled: v.enabled }),
    onSuccess: refresh,
  });
  const put = useMutation({
    mutationFn: (v: { kind: AreaKind; memberId: string; lead?: boolean }) =>
      setMembership(v.kind, v.memberId, v.lead === undefined ? {} : { lead: v.lead }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: { kind: AreaKind; memberId: string }) => removeMembership(v.kind, v.memberId),
    onSuccess: refresh,
  });
  return { rename, put, remove };
}

function AreaBlock({
  area,
  people,
  roster,
  awayByUser,
  today,
  inUse,
  m,
}: {
  area: AreaView;
  people: MembershipView[];
  roster: TeamMember[];
  awayByUser: Map<string, AwayView>;
  today: string | null;
  /** Somebody is in a switched-on area (`AreasReadout.inUse`). */
  inUse: boolean;
  m: ReturnType<typeof useAreaMutations>;
}) {
  const [name, setName] = useState(area.name);
  const [adding, setAdding] = useState('');
  const byId = useMemo(() => new Map(roster.map((r) => [r.id, r])), [roster]);
  const inArea = new Set(people.map((p) => p.memberId));
  const candidates = roster.filter((r) => !inArea.has(r.id) && r.status !== 'inactive');
  const renamed = name.trim() !== '' && name.trim() !== area.name;

  return (
    <section className="tm-card" data-area={area.kind} data-enabled={String(area.enabled)}>
      <div className="tm-headline" style={{ justifyContent: 'space-between', gap: 8 }}>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span className="tm-label">
            {area.defaultName}
            {area.name !== area.defaultName ? ' · renamed' : ''}
          </span>
          <input
            className="tm-input"
            value={name}
            maxLength={40}
            aria-label={`Name of the ${area.defaultName} area`}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {renamed && (
          <button
            type="button"
            className="tm-ctl tm-ctl--sm"
            disabled={m.rename.isPending}
            onClick={() => m.rename.mutate({ kind: area.kind, name: name.trim() })}
          >
            Save name
          </button>
        )}
        <button
          type="button"
          className="tm-ctl tm-ctl--sm tm-ctl--quiet"
          disabled={m.rename.isPending}
          onClick={() => m.rename.mutate({ kind: area.kind, enabled: !area.enabled })}
        >
          {/* The words say what pressing does; the state is said below when off. */}
          {area.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {!area.enabled && (
        <p className="tm-hint">
          Off: anything labelled {area.name} goes to the whole house, as if it had no area.
        </p>
      )}

      {people.length === 0 ? (
        <p className="tm-quiet" style={{ margin: '8px 0' }}>
          {/* The ladder's step 0: while nobody is in any area, a labelled alert
              still goes to everyone (`area-routing.ts`, `areasInUse`). */}
          {inUse
            ? `Nobody here yet. ${area.name} alerts go to the owners and managers.`
            : `Nobody here yet. While nobody is in any area, ${area.name} alerts go to everyone.`}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '8px 0', padding: 0 }}>
          {people.map((p) => {
            const member = byId.get(p.memberId);
            const label = member ? resolveName(member).text : 'Someone no longer on the roster';
            const away = p.userId ? awayByUser.get(p.userId) : undefined;
            return (
              <li
                key={p.memberId}
                className="tm-kv"
                style={{ alignItems: 'center', gap: 8, padding: '4px 0' }}
              >
                <span style={{ minWidth: 0 }}>
                  {today ? (
                    <AwayMarker name={label} personLabel={label} window={away} today={today} />
                  ) : (
                    label
                  )}
                  {p.lead && (
                    <>
                      {' '}
                      <Tag mark>lead</Tag>
                    </>
                  )}
                  {!p.userId && (
                    <span className="tm-hint" style={{ display: 'block' }}>
                      No account yet — in the area, but no alert can reach them.
                    </span>
                  )}
                </span>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    type="button"
                    className="tm-ctl tm-ctl--sm tm-ctl--quiet"
                    disabled={m.put.isPending}
                    onClick={() => m.put.mutate({ kind: area.kind, memberId: p.memberId, lead: !p.lead })}
                  >
                    {p.lead ? 'Remove lead' : 'Make lead'}
                  </button>
                  <button
                    type="button"
                    className="tm-ctl tm-ctl--sm tm-ctl--quiet"
                    disabled={m.remove.isPending}
                    onClick={() => m.remove.mutate({ kind: area.kind, memberId: p.memberId })}
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="tm-headline" style={{ gap: 8 }}>
          <select
            className="tm-select"
            value={adding}
            aria-label={`Add someone to ${area.name}`}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">Add someone to {area.name}…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {resolveName(c).text}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tm-ctl tm-ctl--sm"
            disabled={adding === '' || m.put.isPending}
            onClick={() => {
              m.put.mutate({ kind: area.kind, memberId: adding });
              setAdding('');
            }}
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

export function AreasSheet({
  readout,
  failed,
  roster,
  awayByUser,
  today,
  awayFailed = false,
  onClose,
}: {
  readout: AreasReadout | null;
  failed: boolean;
  roster: TeamMember[] | null;
  awayByUser: Map<string, AwayView>;
  today: string | null;
  /** The Away read failed: no name below can be marked, and that is unknown, not "nobody". */
  awayFailed?: boolean;
  onClose: () => void;
}) {
  const m = useAreaMutations();
  const peopleByKind = useMemo(() => {
    const out = new Map<AreaKind, MembershipView[]>(AREA_KINDS.map((k) => [k, []]));
    for (const p of readout?.memberships ?? []) out.get(p.kind)?.push(p);
    return out;
  }, [readout]);

  return (
    <Sheet
      open
      onClose={onClose}
      label="Areas: who works where and who leads it. Every change is written in the house log."
      eyebrow="Areas"
      title="Who works where"
      bodyClassName="tm-in"
      footer={
        <span>
          A lead can snooze, finish, dismiss and undo that area&apos;s cards for everyone. It
          gives no pay and no roster access. Every change here is written in the house log.
        </span>
      }
    >
      <div style={{ padding: '12px 16px 16px', display: 'grid', gap: 12 }}>
        <p className="tm-note" style={{ margin: 0 }}>
          An alert for an area goes to the people in it first. If none of them can take it —
          nobody is in the area, or they are all Away — it goes to the owners and managers.
          Owners and managers always keep a copy. With nobody in any area, every alert still
          goes to everyone.
        </p>

        {awayFailed && !failed && (
          <p className="tm-alert" role="alert">
            Away dates could not be read, so nobody below is marked Away. Whether anyone is
            away is unknown — not &quot;no&quot;.
          </p>
        )}

        {failed ? (
          <p className="tm-alert" role="alert">
            The areas could not be read, so who works where is unknown — not empty.
          </p>
        ) : readout === null || roster === null ? (
          <p className="tm-quiet">Reaching the gateway…</p>
        ) : (
          readout.areas.map((area) => (
            <AreaBlock
              key={`${area.kind}:${area.name}`}
              area={area}
              people={peopleByKind.get(area.kind) ?? []}
              roster={roster}
              awayByUser={awayByUser}
              today={today}
              inUse={readout.inUse}
              m={m}
            />
          ))
        )}

        <MutationError when={m.rename.isError}>
          The area was not changed: {getErrorMessage(m.rename.error)}
        </MutationError>
        <MutationError when={m.put.isError}>
          That was not saved: {getErrorMessage(m.put.error)}
        </MutationError>
        <MutationError when={m.remove.isError}>
          Nobody was removed: {getErrorMessage(m.remove.error)}
        </MutationError>
      </div>
    </Sheet>
  );
}
