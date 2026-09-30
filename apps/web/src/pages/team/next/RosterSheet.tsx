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

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/mudavym';
import {
  createTeamMember,
  deleteTeamMember,
  getHandoverPreview,
  setMemberPayAccess,
  updateTeamMember,
  type Certification,
  type HandoverCheckCode,
  type HandoverPreview,
  type HouseMoney,
  type RemovalHandover,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import {
  EM,
  fmtDayShort,
  fmtHours,
  fmtMoneyExact,
  fmtTime,
  fmtWeekday,
  resolveName,
  workedHours,
} from './tm-format';
import { Card, Fact, KV, Mark, MutationError, Tag } from './tm-bits';
import {
  useSetZoneSetupAccess,
  useZoneSetupAccess,
} from '../../../hooks/useStorageLocations';

/**
 * An owner or manager assigns this staff member to set up zones, or
 * withdraws it (ADR 0238, the founder 2026-09-29: "managers/owners+ the
 * people they assign"). Shown only when the gateway lists who is assigned,
 * which it does for an owner or manager alone: anyone else is never offered a
 * switch the server would refuse.
 */
function ZoneSetupSwitch({ userId }: { userId: string }) {
  const access = useZoneSetupAccess();
  const write = useSetZoneSetupAccess();
  if (access.assigned === null) return null;
  const on = write.isSuccess && write.variables?.userId === userId
    ? write.data.allowed
    : access.assigned.includes(userId);
  return (
    <div data-testid="zone-setup-access">
      <span className="tm-label">Zones</span>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={on}
          disabled={write.isPending}
          onChange={(e) => write.mutate({ userId, allowed: e.target.checked })}
        />
        <span style={{ fontSize: 12.5 }}>Sets up storage zones</span>
      </label>
      <p className="tm-hint">
        On, this person can add, rename, resize and delete storage zones, as owners and
        managers can. Everyone places and counts wines either way. Each switch is written to
        the record, and they are told.
      </p>
      <MutationError when={write.isError}>
        The switch did not save, so this person&apos;s zone access is as it was.
      </MutationError>
    </div>
  );
}
import { PerformanceCard } from './PerformanceCard';
import { useActiveRestaurantId, type TimeOffRow } from './useTeamNextData';
import { AwayMarker } from '@/components/mudavym/AwayMarker';
import { AwayCard } from './AwayCard';
import type { HouseAreasData } from './useHouseAreas';
import { mayChangeAway } from '../../../services/api/areas';
import { useAuth } from '../../../contexts/AuthContext';

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

/** Paid, unpaid, or not said — a leave row's type in words (ADR 0215). */
function leaveWords(t: string | null | undefined): string {
  return t === 'paid' ? 'paid' : t === 'unpaid' ? 'unpaid' : 'paid or unpaid not said';
}

/* ── the expanded row ────────────────────────────────────────────────────── */

function MemberDetail({
  member,
  shifts,
  certs,
  timeOff,
  moneyVisible,
  money,
  house,
  onEdit,
  onCertificates,
}: {
  member: TeamMember;
  /** `null` while the week has not answered — the card says so. */
  shifts: Shift[] | null;
  certs: Certification[] | null;
  timeOff: TimeOffRow[] | null;
  /** The owner only (ADR 0215). */
  moneyVisible: boolean;
  money: HouseMoney | null;
  /** Areas and Away (ADR 0218). */
  house: HouseAreasData;
  onEdit: () => void;
  /** Open this person's certificate FILE — the owed act (census 102). */
  onCertificates: () => void;
}) {
  const name = resolveName(member);
  const { user } = useAuth();
  // An owner opening their own row sets their OWN dates: not logged, and the
  // card must not claim it will be.
  const isSelf = !!user?.userId && member.user_id === user.userId;
  const mine = (shifts ?? []).filter((s) => s.member_id === member.id);
  // Worked hours: breaks out, a called-out shift out — as the gateway counts.
  const hours = mine
    .filter((s) => s.state !== 'callout')
    .reduce((sum, s) => sum + workedHours(s), 0);
  const myCerts = (certs ?? []).filter((c) => c.member_id === member.id);
  const myLeave = (timeOff ?? []).filter((r) => r.member_id === member.id);
  const areaNames = house.areas
    ? house.areas.memberships
        .filter((a) => a.memberId === member.id)
        .map((a) => {
          const area = house.areas!.areas.find((x) => x.kind === a.kind);
          return `${area?.name ?? a.kind}${a.lead ? ' (lead)' : ''}${area && !area.enabled ? ' — off' : ''}`;
        })
    : null;

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
        {moneyVisible && (
          <Fact
            k="Hourly wage"
            v={
              // An owner's row, to a manager who sees pay (founder 2026-09-27,
              // item 71: "if owner taking money, manager can't see it").
              member.pay_withheld === 'owner'
                ? "the owner's — an owner's pay is seen by an owner only"
                : fmtMoneyExact(member.hourly_wage, money)
            }
          />
        )}
        <Fact
          k="Areas"
          v={
            house.areasFailed
              ? `${EM} not read`
              : areaNames === null
                ? EM
                : areaNames.length === 0
                  ? 'none (the whole house)'
                  : areaNames.join(', ')
          }
        />
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
                v={r.status === 'approved' ? `approved · ${leaveWords(r.leave_type)}` : r.status}
              />
            ))
          )}
        </Card>

        <AwayCard
          userId={member.user_id}
          personLabel={name.text}
          window={member.user_id ? (house.awayByUser.get(member.user_id) ?? null) : null}
          today={house.away?.today ?? null}
          failed={house.awayFailed}
          self={isSelf}
          // Only an owner sets or ends an owner's Away (round-2 answer 7).
          canChange={mayChangeAway(
            { role: house.away?.role ?? house.areas?.role, self: isSelf },
            member.role,
          )}
        />

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
  moneyVisible,
  money,
  house,
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
  moneyVisible: boolean;
  money: HouseMoney | null;
  house: HouseAreasData;
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
      if (!s.member_id || s.state === 'callout') continue;
      m.set(
        s.member_id,
        (m.get(s.member_id) ?? 0) + workedHours(s),
      );
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
        <>
        {house.awayFailed && (
          // Without this line every name would simply show no Away marker,
          // which reads as "nobody is away" — a failed read shown as empty.
          <p className="tm-alert" role="alert" style={{ margin: 16 }}>
            Away dates could not be read, so nobody here is marked Away. Whether anyone is
            away is unknown — not &quot;no&quot;.
          </p>
        )}
        {members.map((m) => {
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
                    {house.away && m.user_id ? (
                      // Static inside the row's own button; the expanded row's
                      // Away card says the sentence.
                      <AwayMarker
                        name={name.text}
                        personLabel={name.text}
                        window={house.awayByUser.get(m.user_id)}
                        today={house.away.today}
                        interactive={false}
                      />
                    ) : (
                      name.text
                    )}
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
                  moneyVisible={moneyVisible}
                  money={money}
                  house={house}
                  onEdit={() => onEdit(m)}
                  onCertificates={() => onCertificates(m)}
                />
              )}
            </div>
          );
        })}
        </>
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
  moneyVisible,
  viewerIsOwner = false,
  viewerUserId = null,
  ownerCount,
  roster = [],
  onClose,
  onChanged,
}: {
  /** `null` for a new member. */
  member: TeamMember | null;
  /**
   * This house's roster, for "Replace with" on the remove dialog (ADR 0215
   * item 27). Empty = no picker; everything goes to the open pool.
   */
  roster?: TeamMember[];
  /**
   * The owner only (ADR 0215): only an owner may set a wage, and the gateway
   * refuses anyone else. So the field is the owner's, and nobody else is shown
   * a control that would be refused.
   */
  moneyVisible: boolean;
  /**
   * The owner switches a manager's pay access here (ADR 0215, founder
   * 2026-09-25 round 4 item 19, "Pay visibility only").
   */
  viewerIsOwner?: boolean;
  /**
   * The viewer's `user_id`: a manager with pay access setting their own wage is
   * told the owner hears of it (founder 2026-09-25, round 5 item 32).
   */
  viewerUserId?: string | null;
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
  // A manager the owner switched on sets anyone's wage, their own included
  // (founder 2026-09-25, round 5 item 32, replacing the round-4 refusal); on
  // their own row the page says the owner is told before they save.
  const ownRowAsManager =
    !viewerIsOwner && viewerUserId != null && member?.user_id === viewerUserId;
  // Never an owner's, whatever the viewer's pay access (founder 2026-09-27,
  // item 71): the gateway withholds it and refuses the write; the page does
  // not offer it.
  const ownersPay = member?.pay_withheld === 'owner';
  const mayWriteWage = moneyVisible && !ownersPay;
  const [ownWageUntold, setOwnWageUntold] = useState<string | null>(null);
  const hasPaySwitch = viewerIsOwner && member?.role === 'manager';
  const paySwitch = useMutation({
    mutationFn: (on: boolean) => setMemberPayAccess(member!.id, on),
    onSuccess: () => onChanged(),
  });
  const payOn = paySwitch.isSuccess ? paySwitch.data.payAccess : (member?.payAccess ?? null);

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
        // would be a priced hour that costs nothing (ADR 0088). Only an owner
        // sends one at all (ADR 0215).
        hourlyWage:
          !mayWriteWage || form.hourlyWage.trim() === '' ? undefined : Number(form.hourlyWage),
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
    onSuccess: (saved: { ownWage?: { audited: boolean; ownersNotified: number; ownersFound: number | null } } | undefined) => {
      onChanged();
      // The wage is saved either way. A notice that did not reach the owner is
      // said here instead of closing on it (ADR 0215 item 21).
      const own = saved?.ownWage;
      if (own && (own.ownersNotified === 0 || !own.audited)) {
        setOwnWageUntold(
          own.ownersFound === null
            ? 'Your wage was saved, but the owners of this house could not be read, so none was told. Tell an owner yourself.'
            : own.ownersNotified === 0
              ? 'Your wage was saved, but the notice to the owner did not go out. Tell an owner yourself.'
              : 'Your wage was saved and the owner was told, but the entry in the record did not save.',
        );
        return;
      }
      onClose();
    },
  });

  // What the removal could not settle on the house's own clock, said before
  // the sheet closes (ADR 0215 item 26, 2026-09-28): a removal judged on
  // this device's zone because the house records none, or shifts it could
  // not judge at all. `null` = nothing to say, and the sheet closes.
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  // "Replace with" (ADR 0215 item 27): who takes which shifts, if anyone.
  const [handover, setHandover] = useState<HandoverChoice>(NO_HANDOVER);
  // Keyed by house: the gateway scopes the preview by restaurant, so a key
  // without it would serve the previous house's shifts after a switch.
  const rid = useActiveRestaurantId();
  const handoverPreview = useQuery({
    queryKey: ['team', 'handover', rid, member?.id ?? null, handover.to],
    queryFn: () => getHandoverPreview(member!.id, handover.to),
    enabled: !!member && !!handover.to && confirmRemove,
  });
  const handingOver = handoverOf(handover, handoverPreview.data);
  const needsAck = (handingOver?.accept.length ?? 0) > 0 && !handover.ack;
  // The hand-over travels WITH the click (`remove.mutate(handingOver)`), not
  // in a closure: React Query takes a new mutationFn in an effect after the
  // paint, so a click between the two sent the previous render's hand-over —
  // `null` from a button already reading "hand over 1 shift" (CI run
  // 36728755317). The click handler is the committed render's own.
  const remove = useMutation({
    mutationFn: (sent: RemovalHandover | null) => deleteTeamMember(member!.id, undefined, sent),
    onSuccess: (receipt) => {
      onChanged();
      const unjudged = receipt?.shiftsUnjudged ?? 0;
      const notes: string[] = [];
      if (receipt?.clock?.source === 'device' && receipt.clock.zone) {
        notes.push(
          `This restaurant has no time zone set, so which of their shifts had started was judged on this device's clock (${receipt.clock.zone}). Set the restaurant's time zone in Settings so the next one is judged on its own.`,
        );
      }
      if (unjudged > 0) {
        notes.push(
          `${unjudged === 1 ? 'One shift' : `${unjudged} shifts`} of theirs may already have started, and with no time zone for this restaurant it could not be told, so ${unjudged === 1 ? 'it was' : 'they were'} kept with them, whole. An owner can check ${unjudged === 1 ? 'it' : 'them'} in the former-staff history; add cover if needed.`,
        );
      }
      if (notes.length === 0) {
        onClose();
        return;
      }
      setConfirmRemove(false);
      setRemovedNotice(notes.join(' '));
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
        <MutationError when={ownWageUntold !== null}>{ownWageUntold}</MutationError>
        <MutationError when={remove.isError}>
          The removal did not go through — this person is still on the roster and still
          has whatever access they had.
          {removalRefusal(remove.error) ? ` ${removalRefusal(remove.error)}` : ''}
        </MutationError>
        {removedNotice && (
          <div className="tm-alert" role="status">
            <p style={{ margin: 0 }}>Removed. {removedNotice}</p>
            <div className="tm-actions">
              <button type="button" className="tm-ctl tm-ctl--sm" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}

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
          {mayWriteWage ? (
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
                Each change is kept: who, when, the old and the new figure.
              </p>
              {ownRowAsManager && (
                <p className="tm-hint" data-testid="own-wage-note">
                  This is your own wage. You may change it; an owner of this house is told
                  when you do, with the old and the new figure, and the record names you.
                </p>
              )}
            </label>
          ) : (
            <div>
              <span className="tm-label">Hourly wage</span>
              <p className="tm-hint" data-testid={ownersPay ? 'owner-pay-note' : undefined}>
                {ownersPay
                  ? "This is an owner's pay. Only an owner sees or sets it, whatever a manager's pay access, so this field is withheld rather than blank."
                  : "Wages are the owner's to see and to set, and a manager's only when the owner switches their pay access on, so this field is withheld rather than blank."}
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

        {hasPaySwitch && (
          <div data-testid="pay-access">
            <span className="tm-label">Pay access</span>
            {payOn === null ? (
              <p className="tm-hint" role="status">
                Whether this manager&apos;s pay access is on could not be read, so it is not
                offered here. Nothing about their access changed.
              </p>
            ) : (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={payOn}
                  disabled={paySwitch.isPending}
                  onChange={(e) => paySwitch.mutate(e.target.checked)}
                />
                <span style={{ fontSize: 12.5 }}>Sees and sets pay</span>
              </label>
            )}
            <p className="tm-hint">
              On, this manager sees wages, shift cost and labour totals, and can set wages —
              their own too, and then you are told. Their other rights are unchanged. Each
              switch is written to the record, and they are told.
            </p>
            <MutationError when={paySwitch.isError}>
              The switch did not save, so this manager&apos;s pay access is as it was.
            </MutationError>
          </div>
        )}

        {editing && member?.role === 'staff' && member.user_id ? (
          <ZoneSetupSwitch userId={member.user_id} />
        ) : null}

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
              audit log and they are notified. This cannot be undone. Their shifts that have
              not started yet go back to the open pool, for someone else to take. A shift they
              are working right now is cut at this minute: the part worked stays theirs, paid
              for the time worked, and the rest of it goes to the open pool. Their past
              shifts, leave, wage changes and credentials are kept for five years, for an owner
              only, in the former-staff history; their availability is not kept.
            </p>
            {member && (
              <ReplaceWithPicker
                leaving={member}
                roster={roster}
                choice={handover}
                preview={handoverPreview}
                onChoice={setHandover}
              />
            )}
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
                disabled={remove.isPending || needsAck || (!!handover.to && handoverPreview.isFetching)}
                onClick={() => remove.mutate(handingOver)}
              >
                {remove.isPending
                  ? 'Removing…'
                  : handingOver
                    ? `Remove and hand over ${handingOver.shiftIds.length === 1 ? '1 shift' : `${handingOver.shiftIds.length} shifts`}`
                    : 'Remove and revoke access'}
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

/**
 * "Replace with" on the remove dialog (ADR 0215 item 27; the founder,
 * 2026-09-28: "'Replace with' picker"; checks: "refuse overlap warn rest but
 * owner has a say to change it into warn all four to allow double booking").
 *
 * Pick someone on this roster and the leaving person's upcoming shifts —
 * and the rest of one they are working now — go to them instead of the open
 * pool; untick any to leave it for the pool. The page only SHOWS what the
 * gateway's four checks said (`getHandoverPreview`): a refused shift cannot
 * be ticked, and warnings must be acknowledged before the button works. The
 * gateway re-runs every check when it writes and refuses on anything new.
 */
export interface HandoverChoice {
  to: string | null;
  picked: Set<string>;
  ack: boolean;
  /** The person whose checks ticked `picked`; a new person ticks afresh. */
  seededFor: string | null;
}

export const NO_HANDOVER: HandoverChoice = { to: null, picked: new Set(), ack: false, seededFor: null };

export function handoverOf(
  choice: HandoverChoice,
  preview: HandoverPreview | undefined,
): RemovalHandover | null {
  if (!choice.to || !preview) return null;
  const shifts = preview.shifts.filter(
    (s) => choice.picked.has(s.id) && !s.checks.some((c) => c.level === 'refuse'),
  );
  if (shifts.length === 0) return null;
  const accept = new Set<HandoverCheckCode>();
  for (const s of shifts) for (const c of s.checks) if (c.level === 'warn') accept.add(c.code);
  return { to: choice.to, shiftIds: shifts.map((s) => s.id), accept: [...accept] };
}

function ReplaceWithPicker({
  leaving,
  roster,
  choice,
  preview,
  onChoice,
}: {
  leaving: TeamMember;
  roster: TeamMember[];
  choice: HandoverChoice;
  /** The gateway's checks for `choice.to` (`getHandoverPreview`). */
  preview: { data?: HandoverPreview; isError: boolean; isFetching: boolean };
  onChoice: (c: HandoverChoice) => void;
}) {
  const others = roster.filter((m) => m.id !== leaving.id);
  const shifts = preview.data?.shifts ?? [];
  const chosen = choice.to ? handoverOf(choice, preview.data) : null;
  const warnings = chosen ? chosen.accept.length : 0;

  const pick = (to: string | null) => onChoice({ ...NO_HANDOVER, to });
  // Once this person's checks are in, tick every shift that may go to them;
  // a refused one never is.
  const data = preview.data;
  useEffect(() => {
    if (!choice.to || !data || preview.isFetching || choice.seededFor === choice.to) return;
    const may = data.shifts.filter((s) => !s.checks.some((c) => c.level === 'refuse')).map((s) => s.id);
    onChoice({ ...choice, picked: new Set(may), ack: false, seededFor: choice.to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice.to, data, preview.isFetching]);

  if (others.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8, margin: '10px 0' }}>
      <label>
        <span className="tm-label">Their upcoming shifts go to</span>
        <select
          className="tm-select"
          aria-label="Replace with"
          value={choice.to ?? ''}
          onChange={(e) => pick(e.target.value || null)}
        >
          <option value="">The open pool (nobody yet)</option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
              {m.position ? ` — ${m.position}` : ''}
            </option>
          ))}
        </select>
      </label>
      {preview.isError && (
        <p className="tm-hint" role="alert">
          Could not read their upcoming shifts, so none can be handed over from here. Removing
          them now sends every upcoming shift to the open pool.
        </p>
      )}
      {choice.to && preview.data && shifts.length === 0 && (
        <p className="tm-hint">They have no upcoming shifts to hand over.</p>
      )}
      {choice.to && preview.data && shifts.length > 0 && (
        <ul aria-label="Shifts to hand over" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {shifts.map((s) => {
            const refused = s.checks.find((c) => c.level === 'refuse');
            return (
              <li key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!!refused}
                    checked={!refused && choice.picked.has(s.id)}
                    onChange={(e) => {
                      const picked = new Set(choice.picked);
                      if (e.target.checked) picked.add(s.id);
                      else picked.delete(s.id);
                      onChoice({ ...choice, picked, ack: false });
                    }}
                  />{' '}
                  {fmtDayShort(s.shift_date)} {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                  {s.role ? ` · ${s.role}` : ''}
                  {s.part === 'rest' ? ' · the rest of the shift they are on now' : ''}
                </label>
                {s.checks.map((c) => (
                  <p key={c.code} className="tm-hint" data-level={c.level}>
                    {c.level === 'refuse' ? 'Goes to the open pool: ' : 'Warning: '}
                    {c.message}
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {choice.to && preview.data?.doubleBooking === 'refuse' && (
        <p className="tm-hint">
          Double booking is off in this house, so a shift that overlaps one of theirs cannot
          go to them. The owner can allow it in Settings → Team.
        </p>
      )}
      {warnings > 0 && (
        <label className="tm-hint">
          <input
            type="checkbox"
            checked={choice.ack}
            onChange={(e) => onChoice({ ...choice, ack: e.target.checked })}
          />{' '}
          I have read the warnings above and want to hand these shifts over anyway.
        </label>
      )}
    </div>
  );
}

/** The gateway's words for a refused removal (a 409 from the hand-over checks), if any. */
function removalRefusal(err: unknown): string | null {
  const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : null;
}
