/**
 * Team and Locations — the two registers about people and places.
 *
 * Both are genuinely live: the roster, the invite book, the chains and the
 * branches all come from the gateway and every write here changes access
 * immediately. What the redesign adds is the third line under each row — WHO
 * this is, WHAT their role lets them do, and WHEN the invite runs out — plus
 * an honest answer when the invite book refuses a manager's role (403 is said
 * in words; it is not an empty list).
 *
 * The invite dialog and the four location dialogs are the shipping components
 * (`components/team/`, `components/locations/`). They are transient modals with
 * their own visual language; rebuilding them was out of this page's scope and
 * losing the capability would have been worse than the seam. Noted in the page
 * dossier §13.
 */

import { useRef, useState } from 'react';
import { InviteTeamDialog } from '@/components/team/InviteTeamDialog';
import { TeamLaborSettings } from '@/components/team/TeamLaborSettings';
import { TeamGoalsSettings } from '@/components/team/TeamGoalsSettings';
import { AddLocationDialog } from '@/components/locations/AddLocationDialog';
import { CreateChainDialog } from '@/components/locations/CreateChainDialog';
import { AssignToChainDialog } from '@/components/locations/AssignToChainDialog';
import { EditLocationChainDialog } from '@/components/locations/EditLocationChainDialog';
import type { RestaurantBranch } from '@/contexts/AuthContext';
import { Action, ConfirmAction, Disclosure, Micro, Note, Register, Row } from './SectionKit';
import { EM, SANS, fmtExpiry } from './st-format';
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
              <Note role="status">Nobody is on this branch yet — the roster answered, and it is empty.</Note>
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
                  provenance={{ kept: 'restaurant', when: null, whenUnknown: 'the members table records no last-changed date' }}
                  control={
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {role === 'owner' ? (
                        <select
                          aria-label={`Role for ${name}`}
                          value={m.role}
                          disabled={writer.busy === `role:${m.user_id}`}
                          onChange={(e) => void setMemberRole(m.user_id, e.target.value)}
                          className="st-focus"
                          style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8,
                            border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
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
                provenance={{ kept: 'restaurant', when: inv.created_at ?? null, whenUnknown: 'this invite carries no issued date' }}
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

            {writer.failed && (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>
                That change did not go through — {writer.failed.message}. The roster above is still the server’s.
              </p>
            )}

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

export function LocationsSection({ data }: { data: SettingsNextData }) {
  const { chains, locations, restaurantId, isOwner, refreshBranches } = data;
  const [adding, setAdding] = useState(false);
  const [creatingChain, setCreatingChain] = useState(false);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<RestaurantBranch | null>(null);
  const addAnchor = useRef<HTMLButtonElement>(null);

  const standalone = locations.filter((b) => !b.chain_id);
  const asLite = (b: RestaurantBranch) => ({ id: b.id, name: b.name, city: b.city ?? null });

  return (
    <>
      <Note>
        The branches on this account come from your own session — the same list the header switches between. Chains are
        read separately, and only an owner may create or rename one. Both records <em>do</em> carry a last-changed date
        in the database; neither reaches this page — `GET /organizations/chains` selects only id, name and cuisine type,
        and the session’s branch list was never given the column. The em dashes below are that, not an absent history
        (page note §9.8-9, §13.15).
      </Note>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 8px' }}>
        <button ref={addAnchor} type="button" onClick={() => setAdding(true)} className="st-ink st-focus"
          style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 8,
            border: '1px solid var(--seal-ring)', background: 'var(--seal-tint)', color: 'var(--seal-deep)', cursor: 'pointer' }}>
          Add a location
        </button>
        {isOwner && <Action onClick={() => setCreatingChain(true)}>Create a chain</Action>}
      </div>

      <Register remote={chains} name="the chain register"
        deniedNote="Chains were not opened for your role — an owner keeps them. The branches below are still yours.">
        {(rows) => (
          <>
            {rows.length === 0 && <Note role="status">No chain exists. Every branch below stands on its own.</Note>}
            {rows.map((c) => {
              const count = locations.filter((b) => b.chain_id === c.id).length;
              return (
                <Row
                  key={c.id}
                  label={c.name}
                  consequence={count === 1 ? '1 branch in this chain.' : `${count} branches in this chain.`}
                  provenance={{ kept: 'restaurant', when: c.updated_at ?? null, whenUnknown: 'the endpoint does not return one — the table has it' }}
                  control={isOwner ? <Action onClick={() => setAssigning({ id: c.id, name: c.name })}>Assign a branch</Action> : undefined}
                />
              );
            })}
          </>
        )}
      </Register>

      <div style={{ margin: '18px 0 0' }}><Micro tone="seal">Branches · {locations.length}</Micro></div>
      {locations.length === 0 && <Note role="status">Your session carries no branches.</Note>}
      {locations.map((b) => (
        <Row
          key={b.id}
          label={b.name}
          consequence={
            <>
              {b.city ?? <span>{EM} no city on the record</span>}
              <span aria-hidden> · </span>
              {b.chain_name ? `in ${b.chain_name}` : 'standalone'}
              {b.id === restaurantId ? ' · the branch you are working in now' : ''}
            </>
          }
          provenance={{ kept: 'restaurant', when: null, whenUnknown: 'the session’s branch list drops it — the table has it' }}
          control={<Action onClick={() => setEditing(b)}>Edit</Action>}
        />
      ))}

      <AddLocationDialog
        open={adding}
        onClose={() => setAdding(false)}
        anchorRef={addAnchor}
        onLocationAdded={async () => { await refreshBranches(); setAdding(false); }}
      />
      <CreateChainDialog
        open={creatingChain}
        onClose={() => setCreatingChain(false)}
        onCreated={() => { chains.reload(); void refreshBranches(); }}
        standaloneLocations={standalone.map(asLite)}
      />
      {assigning && (
        <AssignToChainDialog
          open
          chainId={assigning.id}
          chainName={assigning.name}
          standaloneLocations={standalone.map(asLite)}
          onClose={() => setAssigning(null)}
          onSaved={async () => { await refreshBranches(); setAssigning(null); }}
          onCreateNew={() => { setAssigning(null); setAdding(true); }}
        />
      )}
      {editing && (
        <EditLocationChainDialog
          open
          branch={editing}
          chains={(chains.data ?? []).map((c) => ({ ...c, locationCount: locations.filter((b) => b.chain_id === c.id).length }))}
          onClose={() => setEditing(null)}
          onSaved={async () => { await refreshBranches(); setEditing(null); }}
        />
      )}
    </>
  );
}
