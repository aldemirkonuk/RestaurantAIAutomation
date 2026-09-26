/**
 * The owner's FORMER-STAFF HISTORY — ADR 0215, founder 2026-09-25 (round 4
 * item 19): "Owner-only history (Recommended)" — "Hidden from the team views;
 * the owner can open a 'former staff' history for pay and legal records."
 *
 * A removed person's shifts, leave, wage changes and credentials are kept five
 * years (`wage_record_retention()`), then deleted by the nightly job. The team
 * views never show them (`onTheRoster`, gateway); this sheet is the one place
 * that does, over `GET /restaurants/:rid/team/former-staff`, which refuses
 * anyone but an owner. The page offers the entry to the owner only.
 *
 * States, kept apart (ADR 0020 / 0051): reading; a failed read said as a
 * failure, never "nobody has left"; nobody has left; and the people. A name
 * the removal's audit row did not carry is said as not recorded, never
 * invented; a cost with an unpriced shift behind it is unknown, never a
 * partial.
 */

import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getFormerStaff, type FormerStaffPerson } from '../../../services/api/team';
import { useActiveRestaurantId } from './useTeamNextData';
import { EM, fmtDayShort, fmtHours, fmtMoneyExact, fmtMoneyWhole, type HouseMoneyLike } from './tm-format';
import { Alert } from './tm-bits';

function day(iso: string | null | undefined): string {
  return iso ? fmtDayShort(iso.slice(0, 10)) : EM;
}

function year(iso: string): string {
  return iso.slice(0, 4);
}

const LEAVE_TYPE: Record<string, string> = {
  paid: 'paid',
  unpaid: 'unpaid',
  unknown: 'type not stated',
};

function Person({ p, money }: { p: FormerStaffPerson; money: HouseMoneyLike }) {
  return (
    <article
      data-testid={`former-${p.memberId}`}
      style={{ padding: '12px 0', borderTop: '1px solid var(--paper-2)' }}
    >
      <h3 style={{ margin: 0, fontSize: 14, color: 'var(--ink-1)' }}>
        {p.name ?? 'Name not recorded'}
        {p.position ? <span className="tm-quiet">{` · ${p.position}`}</span> : null}
      </h3>
      <p className="tm-fact__k" style={{ textTransform: 'none', letterSpacing: '0.1em' }}>
        {`Removed ${day(p.leftAt)} ${year(p.leftAt)} · kept until ${day(p.keptUntil)} ${year(p.keptUntil)}`}
      </p>
      {p.name === null ? (
        <p className="tm-hint">
          The removal left no audit row with a name, so this person is shown by their record
          alone.
        </p>
      ) : null}

      <p className="tm-note" style={{ marginTop: 6 }}>
        {p.totals.shiftsWorked === 0
          ? 'No worked shift kept.'
          : `${p.totals.shiftsWorked} worked shift${p.totals.shiftsWorked === 1 ? '' : 's'}, ${fmtHours(p.totals.workedHours)} worked, ` +
            (p.totals.cost === null
              ? `cost unknown (${p.totals.unpricedShifts} shift${p.totals.unpricedShifts === 1 ? '' : 's'} had no wage on file)`
              : `${fmtMoneyWhole(p.totals.cost, money)} in all`)}
        {p.shifts.length > p.totals.shiftsWorked
          ? ` · ${p.shifts.length - p.totals.shiftsWorked} called out`
          : ''}
      </p>

      {p.shifts.length > 0 ? (
        <details>
          <summary className="tm-quiet" style={{ cursor: 'pointer', fontSize: 12 }}>
            {`The ${p.shifts.length} shift${p.shifts.length === 1 ? '' : 's'}`}
          </summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
            {p.shifts.map((s) => (
              <li key={s.id}>
                {`${day(s.shift_date)} ${year(s.shift_date)} · ${s.start_time}–${s.end_time} · ${fmtHours(s.workedHours)}`}
                {s.state === 'callout' ? ' · called out' : ''}
                {` · ${s.labor_cost === null ? 'no wage on file' : fmtMoneyExact(s.labor_cost, money)}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="tm-note" style={{ marginTop: 6 }}>
        {p.leave.length === 0
          ? 'No leave request kept.'
          : `Leave: ${p.leave
              .map(
                (l) =>
                  `${day(l.start_date)}–${day(l.end_date)} ${year(l.end_date)} (${l.status}, ${LEAVE_TYPE[l.leave_type] ?? l.leave_type})`,
              )
              .join('; ')}`}
      </p>

      <p className="tm-note" style={{ marginTop: 6 }}>
        {p.wageChanges.length === 0
          ? 'No wage change recorded.'
          : `Wage: ${p.wageChanges
              .map((w) => {
                const m = { currency: w.currency, country: money.country, readable: true };
                return `${day(w.changed_at)} ${year(w.changed_at)} ${fmtMoneyExact(w.old_wage, m)} → ${fmtMoneyExact(w.new_wage, m)}${w.changed_by_role ? ` (by the ${w.changed_by_role})` : ''}`;
              })
              .join('; ')}`}
      </p>

      <p className="tm-note" style={{ marginTop: 6 }}>
        {p.credentials.length === 0
          ? 'No credential kept.'
          : `Credentials: ${p.credentials
              .map((c) => `${c.cert_type.replace(/_/g, ' ')} (issued ${day(c.issued_at)}, expires ${day(c.expires_at)})`)
              .join('; ')}`}
      </p>
    </article>
  );
}

export function FormerStaffSheet({ onClose }: { onClose: () => void }) {
  const rid = useActiveRestaurantId();
  const q = useQuery({
    queryKey: ['team-next-former-staff', rid],
    queryFn: () => getFormerStaff(rid ?? undefined),
    enabled: Boolean(rid),
    retry: false,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      label="Former staff"
      eyebrow="The owner's record"
      title="Former staff"
      footer={
        <span>
          Only an owner can open this. What is kept for someone removed from the roster — their
          shifts, leave, wage changes and credentials — stays here for{' '}
          {q.data?.retentionYears ?? 5} years after the removal and is then deleted. Their
          availability is not kept. None of it appears in the week, the roster or the leave list.
        </span>
      }
    >
      <div className="tm-in" style={{ padding: '12px 16px 16px' }} data-testid="former-staff">
        {q.isError ? (
          <Alert>
            The former-staff history could not be read
            {q.error instanceof Error && q.error.message ? ` (${q.error.message})` : ''}, so who
            has left is unknown here — not nobody.
          </Alert>
        ) : q.isLoading || !q.data ? (
          <p className="tm-quiet" role="status">
            Reading the former-staff history…
          </p>
        ) : q.data.people.length === 0 ? (
          <p className="tm-note" data-testid="former-staff-empty">
            Nobody removed from this roster has a record kept here.
          </p>
        ) : (
          q.data.people.map((p) => <Person key={p.memberId} p={p} money={q.data.money} />)
        )}
      </div>
    </Sheet>
  );
}
