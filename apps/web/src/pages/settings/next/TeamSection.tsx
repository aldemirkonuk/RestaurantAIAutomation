/**
 * Team — who can reach this restaurant, and what each of them may change.
 *
 * The roster, the invite book and every write here are genuinely live. What the
 * redesign adds is the third line under each row, and the second pass made two
 * of those lines true where the first pass had guessed:
 *
 *   member  `created_at` from `user_restaurant_access` — the date access was
 *           GRANTED. It was on the wire all along (`members.service.ts:68-70`)
 *           and the row type dropped it. It is shown under the word "granted",
 *           never "changed": that table has `created_at` and `valid_from` and no
 *           update column (baseline_from_production.sql:5810-5822), so a later
 *           role change moves nothing, and the row says so beneath.
 *   invite  `created_at` — the date it was ISSUED. Also always on the wire
 *           (`members.service.ts:101-107`), also dropped by the row type, which
 *           is how the page came to print "an invite records its expiry, not
 *           when it was issued" over data it had been handed (audit BLOCKER 4).
 *
 * A failed roster read now throws (`members.service.ts`, getMembers), so it
 * reaches this page as the register's error, never as an empty list; an empty
 * roster really is an empty one (F-195).
 *
 * A role change waits for a second tap, like Remove, and the only owner cannot
 * step down here; the gateway refuses that too (F-193).
 */

import { useRef, useState } from 'react';
import { InviteTeamDialog } from '@/components/team/InviteTeamDialog';
import { TeamLaborSettings } from '@/components/team/TeamLaborSettings';
import { TeamGoalsSettings } from '@/components/team/TeamGoalsSettings';
import { Action, ConfirmAction, Disclosure, Micro, Note, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, PROVENANCE_UNKNOWN, SANS, fmtExpiry } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

const ROLE_MEANS: Record<string, string> = {
  owner: 'may change every setting on this page, including roles and chains.',
  manager: 'may invite, order and receive; may not change roles or chains.',
  staff: 'may not open restaurant settings at all — only their own profile.',
};

const ROLE_WORD: Record<string, string> = { owner: 'an owner', manager: 'a manager', staff: 'staff' };

/**
 * Picking a role arms the change; nothing is sent until "Yes, change". The
 * only owner gets no picker at all: someone else must be made an owner first.
 */
function RoleChange({ name, current, isSelf, onlyOwner, busy, onConfirm }: {
  name: string;
  current: string;
  isSelf: boolean;
  onlyOwner: boolean;
  busy: boolean;
  onConfirm: (next: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  if (onlyOwner) {
    return (
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4)', maxWidth: 260, textAlign: 'right' }}>
        Owner. {isSelf ? 'You are' : 'They are'} the only owner here, so make someone else an owner before changing this.
      </span>
    );
  }
  const next = pending ?? current;
  const consequence = isSelf
    ? `You become ${ROLE_WORD[next] ?? next} here${current === 'owner' ? ' and can no longer change roles or chains' : ''}.`
    : `${name} becomes ${ROLE_WORD[next] ?? next} here.`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <select
        aria-label={`Role for ${name}`}
        value={next}
        disabled={busy}
        onChange={(e) => setPending(e.target.value === current ? null : e.target.value)}
        className="st-focus"
        style={fieldStyle}
      >
        <option value="owner">Owner</option>
        <option value="manager">Manager</option>
        <option value="staff">Staff</option>
      </select>
      {pending && (
        <>
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2)', maxWidth: 260, textAlign: 'right' }}>
            {consequence}
          </span>
          <Action tone="grave" disabled={busy} onClick={() => { setPending(null); onConfirm(pending); }}>Yes, change</Action>
          <Action tone="quiet" onClick={() => setPending(null)}>Keep as is</Action>
        </>
      )}
    </span>
  );
}

export function TeamSection({ data }: { data: SettingsNextData }) {
  const { team, role, canManage, restaurantId, writer, setMemberRole, removeMember, revokeInvite, userId } = data;
  const [inviting, setInviting] = useState(false);
  const [labourOpen, setLabourOpen] = useState(false);
  const inviteAnchor = useRef<HTMLButtonElement>(null);

  if (!restaurantId) {
    return <Note role="status">No branch is selected. Choose one from the header and the roster will load for it.</Note>;
  }

  return (
    <>
      <Note>
        Your role here is <strong>{role ?? EM}</strong> — {role ? ROLE_MEANS[role] ?? 'its powers are not described here.' : 'the gateway has not said which, so nothing is claimed about what you may change.'}
      </Note>

      {canManage && (
        <div style={{ margin: '0 0 6px' }}>
          <button ref={inviteAnchor} type="button" onClick={() => setInviting(true)} className="st-ink st-focus"
            style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 8,
              border: '1px solid var(--seal-ring)', background: 'var(--seal-tint)', color: 'var(--seal-deep)', cursor: 'pointer' }}>
            Invite someone
          </button>
        </div>
      )}

      <Register remote={team} name="the team roster">
        {(reg) => (
          <>
            <div style={{ margin: '14px 0 0' }}><Micro tone="seal">Members · {reg.members.length}</Micro></div>
            {reg.members.length === 0 && (
              <Note role="status">
                Nobody is on this branch&rsquo;s team yet. Invite someone and they will appear here once they accept.
              </Note>
            )}
            {reg.members.map((m) => {
              const name = m.users?.name?.trim() || m.users?.email || 'Team member';
              const isSelf = m.user_id === userId;
              const onlyOwner = m.role === 'owner' && reg.members.filter((x) => x.role === 'owner').length === 1;
              return (
                <Row
                  key={m.user_id}
                  label={`${name}${isSelf ? ' (you)' : ''}`}
                  consequence={
                    <>
                      {m.users?.email ?? <span>{EM} no email on the record</span>}
                      <span aria-hidden> · </span>
                      {ROLE_MEANS[m.role] ?? `role “${m.role}” — this page holds no description of it.`}
                    </>
                  }
                  provenance={{
                    kept: 'restaurant',
                    verb: 'granted',
                    when: m.created_at ?? null,
                    whenUnknown: 'this access row carries no granted date',
                  }}
                  control={
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {role === 'owner' ? (
                        <RoleChange
                          name={name}
                          current={m.role}
                          isSelf={isSelf}
                          onlyOwner={onlyOwner}
                          busy={writer.busy === `role:${m.user_id}`}
                          onConfirm={(next) => void setMemberRole(m.user_id, next)}
                        />
                      ) : (
                        <Micro>{m.role}</Micro>
                      )}
                      {(isSelf || role === 'owner') && (
                        <ConfirmAction
                          label={isSelf ? 'Leave' : 'Remove'}
                          confirmLabel={isSelf ? 'Yes, leave' : 'Yes, remove'}
                          busy={writer.busy === `remove:${m.user_id}`}
                          consequence={isSelf
                            ? 'You lose access to this branch and need a new invite to come back.'
                            : 'They lose access to this branch immediately.'}
                          onConfirm={() => void removeMember(m.user_id)}
                        />
                      )}
                    </span>
                  }
                />
              );
            })}
            {reg.members.length > 0 && (
              <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '8px 0 0' }}>
                “Granted” is when the access row was written, not when the role last changed —{' '}
                {PROVENANCE_UNKNOWN.memberChange}. A role change <em>is</em> filed, but in the audit log rather than
                here: <code>system_audit_log</code>, action <code>member_role_changed</code>, with the actor and the
                before/after. Nothing on this page reads that log yet (page note §13.16).
              </p>
            )}

            <div style={{ margin: '18px 0 0' }}>
              <Micro tone="seal">Pending invites{reg.invites ? ` · ${reg.invites.length}` : ''}</Micro>
            </div>
            {reg.invitesDenied && (
              <Note role="status">
                The invite book was not opened for your role. That is a refusal, not an empty book — there may be invites
                outstanding that you cannot see.
              </Note>
            )}
            {reg.invites?.length === 0 && <Note role="status">No invite is outstanding.</Note>}
            {reg.invites?.map((inv) => (
              <Row
                key={inv.id}
                label={inv.code}
                consequence={`Joins as ${inv.role}. ${fmtExpiry(inv.expires_at)}.`}
                provenance={{
                  kept: 'restaurant',
                  verb: 'issued',
                  when: inv.created_at ?? null,
                  whenUnknown: 'this invite carries no issued date',
                }}
                control={
                  <ConfirmAction
                    label="Revoke"
                    confirmLabel="Yes, revoke"
                    busy={writer.busy === `invite:${inv.code}`}
                    consequence="The link stops working for anyone holding it."
                    onConfirm={() => void revokeInvite(inv.code)}
                  />
                }
              />
            ))}

            <SaveFailure failed={writer.failed} what="The roster above is still the server’s." />

            {canManage && (
              <Disclosure summary="Labour & goals" open={labourOpen} onToggle={() => setLabourOpen((o) => !o)}>
                <Note>
                  These two panels are the shipping ones, not yet in the Mudavym hand — they are here so the settings stay
                  reachable while the redesign is behind its flag.
                </Note>
                <TeamLaborSettings />
                <TeamGoalsSettings />
              </Disclosure>
            )}
          </>
        )}
      </Register>

      <InviteTeamDialog
        open={inviting}
        onClose={() => { setInviting(false); team.reload(); }}
        restaurantId={restaurantId}
        anchorRef={inviteAnchor}
      />
    </>
  );
}

export default TeamSection;
