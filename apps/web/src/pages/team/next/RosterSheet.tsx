/**
 * The roster — "People · N" in the header opens this `Sheet`.
 *
 * One row per member with the essentials on a line (name · position · role ·
 * account · hours this week · credential · skills), and the row EXPANDS IN
 * PLACE rather than pushing a second overlay: the /inventory anatomy the
 * founder confirmed as the house shape for a ledger table
 * (`pages/inventory/command/RowExpansion.tsx`) — a fact strip, then cards, then
 * an action bar. Editing is the one thing that leaves the row, because it is a
 * form that commits.
 *
 * WHAT THE NAME IS. `team_members.display_name` is not always a name: the
 * gateway's backfill wrote the literal "Team member" into it whenever it could
 * not read the linked account, and it could not read the linked account for a
 * year because the query named a column `public.users` does not have. Those
 * rows are durable. So every name on this sheet goes through `resolveName`,
 * which prefers a stored name, falls back to the linked account, and otherwise
 * says "No name on file" and explains where the row came from — it never prints
 * the placeholder as though somebody chose it. The Edit sheet prefills the
 * account's name so one save repairs the row for good.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/mudavym';
import {
  createTeamMember,
  deleteTeamMember,
  updateTeamMember,
  type Certification,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import {
  EM,
  fmtDayShort,
  fmtHours,
  fmtTime,
  fmtWeekday,
  resolveName,
  shiftHours,
} from './tm-format';
import { Card, Fact, KV, Mark, MutationError, Tag } from './tm-bits';
import { PerformanceCard } from './PerformanceCard';
import type { TimeOffRow } from './useTeamNextData';

const EMPLOYMENT: ReadonlyArray<[string, string]> = [
  ['full_time', 'full time'],
  ['part_time', 'part time'],
  ['trial', 'trial'],
  ['borrowed', 'borrowed'],
];

const STATUSES: ReadonlyArray<[string, string]> = [
  ['active', 'Active'],
  ['trial', 'Trial'],
  ['inactive', 'Inactive'],
];

function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : EM;
}

/* ── the expanded row ────────────────────────────────────────────────────── */

function MemberDetail({
  member,
  shifts,
  certs,
  timeOff,
  wageVisible,
  onEdit,
  onCertificates,
}: {
  member: TeamMember;
  /** `null` while the week has not answered — the card says so. */
  shifts: Shift[] | null;
  certs: Certification[] | null;
  timeOff: TimeOffRow[] | null;
  wageVisible: boolean;
  onEdit: () => void;
  /** Open this person's certificate FILE — the owed act (census 102). */
  onCertificates: () => void;
}) {
  const name = resolveName(member);
  const mine = (shifts ?? []).filter((s) => s.member_id === member.id);
  const hours = mine.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0);
  const myCerts = (certs ?? []).filter((c) => c.member_id === member.id);
  const myLeave = (timeOff ?? []).filter((r) => r.member_id === member.id);

  return (
    <div className="tm-rrow__body">
      <div className="tm-facts">
        <Fact k="Position" v={member.position ?? EM} />
        <Fact k="Employment" v={member.employment_type?.replace('_', ' ') ?? EM} />
        <Fact k="Access" v={member.role ?? 'no membership row'} />
        <Fact
          k="This week"
          v={shifts === null ? `${EM} not read` : `${mine.length} shifts · ${fmtHours(hours)}`}
        />
        {wageVisible && <Fact k="Wage" v={money(member.hourly_wage)} />}
      </div>

      {!name.known && (
        <p className="tm-hint" style={{ marginBottom: 10 }}>
          {`This row has no name of its own — ${name.source}. Edit it to enter one; nothing else on the page can.`}
        </p>
      )}

      <div className="tm-cards">
        <Card title="This week's shifts">
          {shifts === null ? (
            <p className="tm-quiet">The week has not answered, so this is unknown.</p>
          ) : mine.length === 0 ? (
            <p className="tm-quiet">Nothing scheduled in the week on screen.</p>
          ) : (
            mine
              .slice()
              .sort((a, b) => a.shift_date.localeCompare(b.shift_date))
              .map((s) => (
                <KV
                  key={s.id}
                  k={`${fmtWeekday(s.shift_date)}${s.role ? ` · ${s.role}` : ''}`}
                  v={`${fmtTime(s.start_time)}–${fmtTime(s.end_time)}`}
                />
              ))
          )}
        </Card>

        <Card title="Credentials">
          {certs === null ? (
            <p className="tm-quiet">The credential file has not answered.</p>
          ) : myCerts.length === 0 ? (
            <p className="tm-quiet">
              Nothing on file for this person — an empty file, not a clean one.
            </p>
          ) : (
            myCerts.map((c) => (
              <KV
                key={c.id}
                k={c.cert_type}
                v={`${c.status}${c.expires_at ? ` · ${fmtDayShort(c.expires_at.slice(0, 10))}` : ''}`}
              />
            ))
          )}
          <p className="tm-hint">
            A certification carries no role and no shift, so which shifts require it is
            not recorded.
          </p>
          {/* The read-only card could only LIST. Filing, correcting and removing
              live in the file itself (census 102) — the legacy desk that had
              them is deleted with packet 4. */}
          <div className="tm-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="tm-ctl"
              data-testid="open-certificates"
              onClick={onCertificates}
            >
              Open the certificate file
            </button>
          </div>
        </Card>

        <Card title="Time off on file">
          {timeOff === null ? (
            <p className="tm-quiet">The request file has not answered.</p>
          ) : myLeave.length === 0 ? (
            <p className="tm-quiet">No request from this person.</p>
          ) : (
            myLeave.map((r) => (
              <KV
                key={r.id}
                k={`${fmtDayShort(r.start_date)} – ${fmtDayShort(r.end_date)}`}
                v={r.status}
              />
            ))
          )}
        </Card>

        <PerformanceCard memberId={member.id} memberName={name.text} />
      </div>

      <div className="tm-actions">
        <button type="button" className="tm-ctl" onClick={onEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}

/* ── the sheet ───────────────────────────────────────────────────────────── */

export function RosterSheet({
  members,
  membersFailed,
  shifts,
  certs,
  timeOff,
  wageVisible,
  onClose,
  onEdit,
  onCertificates,
  onAdd,
}: {
  members: TeamMember[] | null;
  membersFailed: boolean;
  shifts: Shift[] | null;
  certs: Certification[] | null;
  timeOff: TimeOffRow[] | null;
  wageVisible: boolean;
  onClose: () => void;
  onEdit: (m: TeamMember) => void;
  /** Open one person's certificate file. */
  onCertificates: (m: TeamMember) => void;
  onAdd: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const hoursById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shifts ?? []) {
      if (!s.member_id) continue;
      m.set(s.member_id, (m.get(s.member_id) ?? 0) + shiftHours(s.start_time, s.end_time));
    }
    return m;
  }, [shifts]);
  const flagById = useMemo(() => {
    const m = new Map<string, Certification>();
    for (const c of certs ?? []) {
      if (c.status === 'expired' || c.status === 'expiring') m.set(c.member_id, c);
    }
    return m;
  }, [certs]);

  return (
    <Sheet
      open
      onClose={onClose}
      label="People"
      eyebrow="The roster"
      title="People"
      action={
        <button type="button" className="tm-ctl tm-ctl--sm" onClick={onAdd}>
          Add
        </button>
      }
      bodyClassName="tm-in"
      footer={
        <span>
          Hours are for the week on screen. A person with no linked account cannot be
          messaged and cannot claim a cover.
        </span>
      }
    >
      {membersFailed ? (
        <p className="tm-alert" role="alert" style={{ margin: 16 }}>
          The roster could not be read, so who is on this team is unknown — not empty.
        </p>
      ) : members === null ? (
        <p className="tm-quiet" style={{ padding: 16 }}>
          Reaching the gateway…
        </p>
      ) : members.length === 0 ? (
        <p className="tm-note" style={{ padding: 16 }}>
          Nobody is on the roster yet. Add the first person, or invite them from the
          header.
        </p>
      ) : (
        members.map((m) => {
          const name = resolveName(m);
          const flag = flagById.get(m.id);
          const open = openId === m.id;
          return (
            <div className="tm-rrow" key={m.id}>
              <button
                type="button"
                className="tm-rrow__btn"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : m.id)}
              >
                {open ? (
                  <ChevronDown className="tm-icon" aria-hidden="true" />
                ) : (
                  <ChevronRight className="tm-icon" aria-hidden="true" />
                )}
                <Mark name={name} avatarUrl={m.avatar_url} owner={m.role === 'owner'} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="tm-membercell__name" data-known={String(name.known)}>
                    {name.text}
                  </span>
                  <span className="tm-rrow__line">
                    {[
                      m.position ?? m.employment_type,
                      m.role ?? 'no access row',
                      m.accountLinked ? 'account linked' : 'no account yet',
                      shifts === null ? `${EM} h` : fmtHours(hoursById.get(m.id) ?? 0),
                      flag ? `${flag.cert_type} ${flag.status}` : null,
                      m.skills.length > 0 ? m.skills.slice(0, 3).join(', ') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {m.status !== 'active' && <Tag>{m.status}</Tag>}
                {flag && <Tag mark>credential</Tag>}
              </button>
              {open && (
                <MemberDetail
                  member={m}
                  shifts={shifts}
                  certs={certs}
                  timeOff={timeOff}
                  wageVisible={wageVisible}
                  onEdit={() => onEdit(m)}
                  onCertificates={() => onCertificates(m)}
                />
              )}
            </div>
          );
        })
      )}
    </Sheet>
  );
}

/* ── the member editor ───────────────────────────────────────────────────── */

/**
 * The legacy `MemberEditor`'s fields, one for one (`editors.tsx:143-304`), with
 * two changes:
 *
 * - the name field PREFILLS from the linked account when the stored value is
 *   the gateway's placeholder, so saving once repairs a row that has read
 *   "Team member" since it was backfilled;
 * - removal keeps the legacy two-step confirmation AND states the sole-owner
 *   refusal in words instead of hiding the control, because a button that is
 *   simply absent teaches nothing about why.
 */
export function MemberSheet({
  member,
  wageVisible,
  ownerCount,
  onClose,
  onChanged,
}: {
  /** `null` for a new member. */
  member: TeamMember | null;
  wageVisible: boolean;
  /** `null` when the roster has not answered — the sole-owner rule then abstains. */
  ownerCount: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const editing = member !== null;
  const resolved = member ? resolveName(member) : null;
  const [form, setForm] = useState({
    displayName: resolved?.known ? resolved.text : '',
    email: member?.email ?? member?.linkedUser?.email ?? '',
    phone: member?.phone ?? '',
    position: member?.position ?? '',
    employmentType: member?.employment_type ?? 'full_time',
    homeLocation: member?.home_location ?? '',
    hourlyWage: member?.hourly_wage != null ? String(member.hourly_wage) : '',
    skills: (member?.skills ?? []).join(', '),
    status: member?.status ?? 'active',
    notes: member?.notes ?? '',
  });
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isSoleOwner = member?.role === 'owner' && ownerCount !== null && ownerCount <= 1;

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        displayName: form.displayName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        position: form.position.trim() || undefined,
        employmentType: form.employmentType,
        homeLocation: form.homeLocation.trim() || undefined,
        // A wage nobody typed stays unknown. `Number('')` is 0, and a 0 here
        // would be a priced hour that costs nothing (ADR 0088).
        hourlyWage: form.hourlyWage.trim() === '' ? undefined : Number(form.hourlyWage),
        skills: form.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        notes: form.notes.trim() || undefined,
      };
      if (editing) payload.status = form.status;
      return editing
        ? updateTeamMember(member!.id, payload)
        : createTeamMember(payload as never);
    },
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteTeamMember(member!.id),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  return (
    <Sheet
      open
      onClose={onClose}
      label={editing ? 'Edit member' : 'Add member'}
      eyebrow={editing ? 'On the roster' : 'New person'}
      title={editing ? (resolved?.known ? resolved.text : 'Name this person') : 'Add someone'}
    >
      <div className="tm-in tm-form">
        <MutationError when={save.isError}>
          Nothing was saved, so the roster is unchanged. Your values are still here.
        </MutationError>
        <MutationError when={remove.isError}>
          The removal did not go through — this person is still on the roster and still
          has whatever access they had.
        </MutationError>

        {editing && resolved && !resolved.known && (
          <p className="tm-hint">
            {`This row carries the gateway's placeholder rather than a name (${resolved.source}). Saving a name here replaces it for good.`}
          </p>
        )}

        <label>
          <span className="tm-label">Name</span>
          <input
            className="tm-input"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </label>

        <div className="tm-two">
          <label>
            <span className="tm-label">Email</span>
            <input
              className="tm-input"
              value={form.email}
              placeholder="links the account on signup"
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            <span className="tm-label">Phone</span>
            <input
              className="tm-input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
        </div>

        <div className="tm-two">
          <label>
            <span className="tm-label">Position</span>
            <input
              className="tm-input"
              value={form.position}
              placeholder="Server, Sommelier…"
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </label>
          <label>
            <span className="tm-label">Employment</span>
            <select
              className="tm-select"
              value={form.employmentType}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
            >
              {EMPLOYMENT.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tm-two">
          <label>
            <span className="tm-label">Home location</span>
            <input
              className="tm-input"
              value={form.homeLocation}
              onChange={(e) => setForm({ ...form, homeLocation: e.target.value })}
            />
          </label>
          {wageVisible ? (
            <label>
              <span className="tm-label">Hourly wage</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="tm-input"
                value={form.hourlyWage}
                placeholder="leave blank for unknown"
                onChange={(e) => setForm({ ...form, hourlyWage: e.target.value })}
              />
              <p className="tm-hint">
                Blank stays unknown. Every hour this person works is uncosted until a
                real figure is here — the week total says so rather than showing a zero.
              </p>
            </label>
          ) : (
            <div>
              <span className="tm-label">Hourly wage</span>
              <p className="tm-hint">
                Wages are hidden for this restaurant, so this field is withheld rather
                than blank. Change it in team settings.
              </p>
            </div>
          )}
        </div>

        <label>
          <span className="tm-label">Skills</span>
          <input
            className="tm-input"
            value={form.skills}
            placeholder="bar, somm, closer — comma separated"
            onChange={(e) => setForm({ ...form, skills: e.target.value })}
          />
          <p className="tm-hint">
            A skill that matches a coverage rule&apos;s role is what makes this person a
            candidate for that gap.
          </p>
        </label>

        {editing && (
          <label>
            <span className="tm-label">Status</span>
            <select
              className="tm-select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          <span className="tm-label">Notes</span>
          <input
            className="tm-input"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>

        {editing && isSoleOwner && (
          <p className="tm-hint">
            This is the restaurant&apos;s only owner, so they cannot be removed here. Make
            someone else an owner first, and the control returns.
          </p>
        )}

        {confirmRemove && (
          <div className="tm-alert">
            <p style={{ margin: 0 }}>
              Removing {resolved?.known ? resolved.text : 'this person'} deletes their
              roster row and revokes their access to this restaurant. It is written to the
              audit log and they are notified. This cannot be undone.
            </p>
            <div className="tm-actions">
              <button
                type="button"
                className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                onClick={() => setConfirmRemove(false)}
              >
                Keep them
              </button>
              <button
                type="button"
                className="tm-ctl tm-ctl--sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Removing…' : 'Remove and revoke access'}
              </button>
            </div>
          </div>
        )}

        <div className="tm-actions" style={{ justifyContent: 'space-between' }}>
          {editing && !isSoleOwner && !confirmRemove ? (
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="tm-ctl tm-ctl--seal"
            disabled={save.isPending || form.displayName.trim() === ''}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : editing ? 'Save' : 'Add to the roster'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
