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
 * AND ONE THING THE ROSTER CANNOT TELL YOU
 * ----------------------------------------
 * `getMembers` swallows a failed read into an empty array
 * (`members.service.ts:75-80`), so "nobody works here" and "the roster could not
 * be read" arrive at this page identically. That is the
 * absence-reported-as-health shape, one layer below anything this page can fix,
 * so an empty roster says both possibilities out loud rather than picking the
 * flattering one. A concrete suspect is named in the page note §9.9.
 */

import { useRef, useState } from 'react';
import { InviteTeamDialog } from '@/components/team/InviteTeamDialog';
import { TeamLaborSettings } from '@/components/team/TeamLaborSettings';
import { TeamGoalsSettings } from '@/components/team/TeamGoalsSettings';
import { ConfirmAction, Disclosure, Micro, Note, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, PROVENANCE_UNKNOWN, SANS, fmtExpiry } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

const ROLE_MEANS: Record<string, string> = {
  owner: 'may change every setting on this page, including roles and chains.',
  manager: 'may invite, order and receive; may not change roles or chains.',
  staff: 'may not open restaurant settings at all — only their own profile.',
};

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
                The roster came back empty. That is either a branch with nobody on it <em>or</em> a read that failed:
                the endpoint logs a failed read and returns an empty list, so the two arrive here identically and this
                page cannot tell them apart. You are signed in, so at least your own access exists.
              </Note>
            )}
            {reg.members.map((m) => {
              const name = m.users?.name?.trim() || m.users?.email || 'Team member';
              const isSelf = m.user_id === userId;
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
                        <select
                          aria-label={`Role for ${name}`}
                          value={m.role}
                          disabled={writer.busy === `role:${m.user_id}`}
                          onChange={(e) => void setMemberRole(m.user_id, e.target.value)}
                          className="st-focus"
                          style={fieldStyle}
                        >
                          <option value="owner">Owner</option>
                          <option value="manager">Manager</option>
                          <option value="staff">Staff</option>
                        </select>
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
              <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>
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

      {restaurantId && (
        <InviteTeamDialog
          open={inviting}
          onClose={() => { setInviting(false); team.reload(); }}
          restaurantId={restaurantId}
          anchorRef={inviteAnchor}
        />
      )}
    </>
  );
}

export default TeamSection;
