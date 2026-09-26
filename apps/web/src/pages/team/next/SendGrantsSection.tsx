/**
 * "Who may send to vendors" — the register of ADR 0112 F12 grants, on the page
 * where the house's people already are.
 *
 * The founder, 2026-09-21: *"An owner, a manager, or a person an owner has
 * granted sends with one hold ... only an owner issues, any owner revokes,
 * every grant/revocation told to all owners, 'granted by' shown where used."*
 * And his answers the same day on the amendment's forks:
 *
 * - WHO READS IT (answer 2): managers see the register by default — they
 *   decide staff requests — and an owner can mark a grant owner-only, hidden
 *   from managers; staff see only the grants naming them. The gateway filters
 *   (`AuthorityGrantsService.list`) and says who is reading (`viewer`), so an
 *   empty list is worded for that reader and never as "nobody" to someone who
 *   cannot see everything.
 * - A GRANT WHOSE OWNER WENT (answer 1): it stops at once and waits here as
 *   "awaiting an owner's re-approval"; only a current owner brings it back
 *   (it then rests on them), or an owner deletes it. *"no owner grant, no
 *   activation, or no going back once grant author gone"*.
 * - THE SEAL (answer 4): naming, revoking, re-approving and deleting are each a
 *   hold that mints a one-time server seal when it begins; every one is on the
 *   house's security ledger and told to every owner.
 * - Naming someone asks three questions and answers none of them by default:
 *   when it ends, and whether it covers deals that commit money (up to how
 *   much, in which currency) or letters only.
 *
 * People-facing and deliberately plain: one sentence per grant, the house's
 * own panel and controls, no table.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import type { TeamMember } from '../../../services/api/team';

type Person = { userId: string | null; name: string | null };

export interface AuthorityGrantView {
  id: string;
  scope: string;
  grantee: { userId: string; name: string | null };
  grantedBy: Person;
  /** The owner it rests on now; differs from grantedBy after a re-approval. */
  vouchedBy: Person;
  limitAmount: number | null;
  limitCurrency: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: Person | null;
  awaitingSince: string | null;
  awaitingReason: string | null;
  ownerOnly: boolean;
  state: 'live' | 'awaiting_reapproval' | 'expired' | 'revoked';
}

interface GrantsReadout {
  viewerIsOwner: boolean;
  viewer?: 'owner' | 'manager' | 'other';
  grants: AuthorityGrantView[];
}

type GrantAct = 'revoke' | 'reapprove' | 'delete';

const grantKeys = (rid: string | null) => ['authority-grants', rid ?? ''] as const;

function day(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : iso;
}

/** One grant, in one sentence. */
export function grantSentence(g: AuthorityGrantView): string {
  const who = g.grantee.name ?? 'Someone whose name could not be read';
  const by = g.grantedBy.name ?? 'an owner whose name could not be read';
  const covers =
    g.limitAmount === null ? 'letters only' : `letters, and deals up to ${g.limitAmount} ${g.limitCurrency ?? ''}`.trim();
  if (g.state === 'revoked') {
    return `${who} — named by ${by}, revoked by ${g.revokedBy?.name ?? 'an owner'} on ${day(g.revokedAt)}.`;
  }
  if (g.state === 'expired') {
    return `${who} — named by ${by}, ended ${day(g.expiresAt)}.`;
  }
  const restsOn = g.vouchedBy?.userId ?? null;
  const voucher = g.vouchedBy?.name ?? by;
  if (g.state === 'awaiting_reapproval') {
    const since = g.awaitingSince ? ` on ${day(g.awaitingSince)}` : '';
    return `${who} can no longer send (${covers}): ${voucher === by ? `${by}, who named them,` : `${voucher}, whom it rested on,`} is no longer an owner here, so it stopped${since}. It waits for an owner to re-approve it, or to delete it.`;
  }
  const reapproved = restsOn && restsOn !== g.grantedBy.userId ? `, re-approved by ${voucher}` : '';
  return `${who} may send to vendors with one hold (${covers}), named by ${by}${reapproved}, ${
    g.expiresAt ? `until ${day(g.expiresAt)}` : 'until an owner revokes it'
  }.`;
}

/** What an empty register means, worded for who is reading it. */
export function emptyRegisterSentence(viewer: 'owner' | 'manager' | 'other'): string {
  if (viewer === 'owner') return 'Nobody has been named. Only owners and managers send with one hold.';
  if (viewer === 'manager')
    return 'Nobody has been named that managers can see. An owner may keep a grant owner-only.';
  return 'No grant names you. Only owners and managers see who else has been named.';
}

export function SendGrantsSection({
  restaurantId,
  members,
}: {
  restaurantId: string | null;
  members: TeamMember[] | null;
}) {
  const qc = useQueryClient();
  const grants = useQuery({
    queryKey: grantKeys(restaurantId),
    queryFn: () => apiClient.get('/authority/grants').then((r) => r.data as GrantsReadout),
    enabled: !!restaurantId,
  });

  const [granteeUserId, setGranteeUserId] = useState('');
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [ends, setEnds] = useState<'revoked' | 'date'>('revoked');
  const [endDate, setEndDate] = useState('');
  const [covers, setCovers] = useState<'letters' | 'deals'>('letters');
  const [limitAmount, setLimitAmount] = useState('');
  const [limitCurrency, setLimitCurrency] = useState('');
  const [says, setSays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Only people who hold an account can be named, and owners and managers
  // already send by role — the gateway refuses both, so neither is offered.
  const candidates = useMemo(
    () => (members ?? []).filter((m) => m.user_id && m.accountLinked && m.role !== 'owner' && m.role !== 'manager'),
    [members],
  );

  const amount = Number(limitAmount);
  const currency = limitCurrency.trim().toUpperCase();
  const formReady =
    !!granteeUserId &&
    (ends === 'revoked' || !!endDate) &&
    (covers === 'letters' || (Number.isFinite(amount) && amount >= 0 && limitAmount.trim() !== '' && /^[A-Z]{3}$/.test(currency)));

  /** The grant exactly as it will be issued: the seal is minted over this. */
  const issueBody = () => ({
    granteeUserId,
    scope: 'vendor_send',
    limitAmount: covers === 'letters' ? null : amount,
    limitCurrency: covers === 'letters' ? null : currency,
    // The end of the day chosen, in the owner's own clock.
    expiresAt: ends === 'revoked' ? null : new Date(`${endDate}T23:59:59`).toISOString(),
    ownerOnly,
  });

  // The seal is minted when the hold BEGINS (founder answer 4, 2026-09-21), so
  // a hold that could not get one names nobody.
  const issueChallenge = async (): Promise<string | null> => {
    setProblem(null);
    try {
      const { data } = await apiClient.post('/authority/grants/seal-challenge', issueBody());
      return (data?.challenge as string | undefined) ?? null;
    } catch (e) {
      setProblem(`Nobody was named: the seal could not be issued (${getErrorMessage(e)}).`);
      setAttempt((a) => a + 1);
      return null;
    }
  };

  const issue = async (challenge?: string | null) => {
    setProblem(null);
    setSays(null);
    try {
      const { data } = await apiClient.post('/authority/grants', issueBody(), {
        headers: { 'x-seal-challenge': challenge ?? '' },
      });
      setSays(data?.says ?? 'Named.');
      setGranteeUserId('');
      setOwnerOnly(false);
      await qc.invalidateQueries({ queryKey: grantKeys(restaurantId) });
    } catch (e) {
      setProblem(`Nobody was named (${getErrorMessage(e)}).`);
      setAttempt((a) => a + 1);
      throw e;
    }
  };

  const actChallenge = (id: string, act: GrantAct) => async (): Promise<string | null> => {
    setProblem(null);
    try {
      const { data } = await apiClient.post(`/authority/grants/${id}/seal-challenge`, { act });
      return (data?.challenge as string | undefined) ?? null;
    } catch (e) {
      setProblem(`Nothing was changed: the seal could not be issued (${getErrorMessage(e)}).`);
      setAttempt((a) => a + 1);
      return null;
    }
  };

  const act = (id: string, what: GrantAct) => async (challenge?: string | null) => {
    setProblem(null);
    setSays(null);
    try {
      const { data } = await apiClient.post(`/authority/grants/${id}/${what}`, undefined, {
        headers: { 'x-seal-challenge': challenge ?? '' },
      });
      setSays(data?.says ?? 'Done.');
      await qc.invalidateQueries({ queryKey: grantKeys(restaurantId) });
    } catch (e) {
      setProblem(
        what === 'revoke'
          ? `The grant was not revoked (${getErrorMessage(e)}). It still counts.`
          : what === 'reapprove'
            ? `The grant was not re-approved (${getErrorMessage(e)}). It still waits.`
            : `The grant was not deleted (${getErrorMessage(e)}). It still waits.`,
      );
      setAttempt((a) => a + 1);
      throw e;
    }
  };

  const visibility = useMutation({
    mutationFn: ({ id, ownerOnly: next }: { id: string; ownerOnly: boolean }) =>
      apiClient.post(`/authority/grants/${id}/owner-only`, { ownerOnly: next }).then((r) => r.data),
    onSuccess: (data) => {
      setSays(data?.says ?? 'Changed.');
      void qc.invalidateQueries({ queryKey: grantKeys(restaurantId) });
    },
    onError: (e) => setProblem(`Who sees the grant was not changed (${getErrorMessage(e)}).`),
  });

  const owner = grants.data?.viewerIsOwner === true;
  const viewer = grants.data?.viewer ?? (owner ? 'owner' : 'other');
  const all = grants.data?.grants ?? [];
  const live = all.filter((g) => g.state === 'live');
  const waiting = all.filter((g) => g.state === 'awaiting_reapproval');
  const past = all.filter((g) => g.state === 'expired' || g.state === 'revoked');

  return (
    <section aria-label="Who may send to vendors" className="tm-panel" data-testid="send-grants">
      <h2 className="tm-panel__title">Who may send to vendors</h2>
      <p className="tm-quiet" style={{ marginTop: 0 }}>
        Owners and managers send letters to vendors with one hold. Anyone else&rsquo;s hold asks a
        manager, who sends their exact words. An owner can name someone to send on their own.
      </p>

      {grants.isPending ? (
        <p className="tm-quiet">Reading who has been named…</p>
      ) : grants.isError ? (
        <p className="tm-note" role="alert">
          Who has been named could not be read ({getErrorMessage(grants.error)}). That is unknown,
          not nobody.
        </p>
      ) : live.length === 0 && waiting.length === 0 ? (
        <p className="tm-note" data-testid="send-grants-none">
          {emptyRegisterSentence(viewer)}
        </p>
      ) : (
        <>
          {live.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="send-grants-live">
              {live.map((g) => (
                <li key={g.id} style={{ padding: '6px 0', fontSize: 12.5 }}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span style={{ flex: 1, minWidth: 0 }}>{grantSentence(g)}</span>
                    {g.ownerOnly && (
                      <span className="tm-quiet" data-testid={`grant-owner-only-${g.id}`}>
                        Owner-only
                      </span>
                    )}
                  </div>
                  {owner && (
                    <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4 }}>
                      <div style={{ width: 180 }}>
                        <HoldToApprove
                          key={`revoke-${g.id}-${attempt}`}
                          label="Hold to revoke"
                          approvedLabel="Revoked"
                          onChallenge={actChallenge(g.id, 'revoke')}
                          onApprove={act(g.id, 'revoke')}
                        />
                      </div>
                      <button
                        type="button"
                        className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                        disabled={visibility.isPending}
                        onClick={() => visibility.mutate({ id: g.id, ownerOnly: !g.ownerOnly })}
                      >
                        {g.ownerOnly ? 'Let managers see it' : 'Make it owner-only'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {waiting.length > 0 && (
            <div style={{ marginTop: 8 }} data-testid="send-grants-waiting">
              <h3 className="tm-quiet" style={{ margin: '0 0 4px', fontSize: 12 }}>
                Waiting for an owner
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {waiting.map((g) => (
                  <li key={g.id} style={{ padding: '6px 0', fontSize: 12.5 }}>
                    <span>{grantSentence(g)}</span>
                    {owner && (
                      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 4 }}>
                        <div style={{ width: 200 }}>
                          <HoldToApprove
                            key={`reapprove-${g.id}-${attempt}`}
                            label="Hold to re-approve"
                            approvedLabel="Re-approved"
                            onChallenge={actChallenge(g.id, 'reapprove')}
                            onApprove={act(g.id, 'reapprove')}
                          />
                        </div>
                        <div style={{ width: 180 }}>
                          <HoldToApprove
                            key={`delete-${g.id}-${attempt}`}
                            label="Hold to delete"
                            approvedLabel="Deleted"
                            onChallenge={actChallenge(g.id, 'delete')}
                            onApprove={act(g.id, 'delete')}
                          />
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {owner && (
                <p className="tm-quiet" style={{ margin: '2px 0 0' }}>
                  Re-approving makes it rest on you. Nothing brings it back by itself.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {past.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="tm-quiet" style={{ cursor: 'pointer' }}>
            Ended and revoked ({past.length})
          </summary>
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
            {past.map((g) => (
              <li key={g.id} className="tm-quiet" style={{ padding: '3px 0', fontSize: 11.5 }}>
                {grantSentence(g)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {owner && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--paper-2)', paddingTop: 10 }} data-testid="send-grants-form">
          <label className="tm-quiet" htmlFor="grant-who" style={{ display: 'block', marginBottom: 4 }}>
            Name someone
          </label>
          <select
            id="grant-who"
            className="tm-select"
            value={granteeUserId}
            onChange={(e) => setGranteeUserId(e.target.value)}
          >
            <option value="">Choose a person with an account…</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.user_id ?? ''}>
                {m.display_name}
              </option>
            ))}
          </select>
          {members !== null && candidates.length === 0 && (
            <p className="tm-quiet" style={{ margin: '4px 0 0' }}>
              Nobody here can be named: everyone with an account is already an owner or a manager.
            </p>
          )}

          <fieldset style={{ border: 'none', padding: 0, margin: '10px 0 0' }}>
            <legend className="tm-quiet">Until</legend>
            <label style={{ marginRight: 12, fontSize: 12.5 }}>
              <input type="radio" name="grant-ends" checked={ends === 'revoked'} onChange={() => setEnds('revoked')} />{' '}
              an owner revokes it
            </label>
            <label style={{ fontSize: 12.5 }}>
              <input type="radio" name="grant-ends" checked={ends === 'date'} onChange={() => setEnds('date')} /> a date
            </label>
            {ends === 'date' && (
              <input
                type="date"
                aria-label="The last day it counts"
                className="tm-input"
                style={{ marginLeft: 8 }}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            )}
          </fieldset>

          <fieldset style={{ border: 'none', padding: 0, margin: '8px 0 0' }}>
            <legend className="tm-quiet">It covers</legend>
            <label style={{ marginRight: 12, fontSize: 12.5 }}>
              <input type="radio" name="grant-covers" checked={covers === 'letters'} onChange={() => setCovers('letters')} />{' '}
              letters only
            </label>
            <label style={{ fontSize: 12.5 }}>
              <input type="radio" name="grant-covers" checked={covers === 'deals'} onChange={() => setCovers('deals')} />{' '}
              letters, and deals up to
            </label>
            {covers === 'deals' && (
              <>
                <input
                  aria-label="The largest deal it covers"
                  inputMode="decimal"
                  className="tm-input"
                  style={{ marginLeft: 8, width: 110 }}
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                />
                <input
                  aria-label="Currency of the limit (three letters)"
                  className="tm-input"
                  style={{ marginLeft: 6, width: 64 }}
                  maxLength={3}
                  value={limitCurrency}
                  onChange={(e) => setLimitCurrency(e.target.value)}
                />
              </>
            )}
          </fieldset>

          <label style={{ display: 'block', marginTop: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={ownerOnly} onChange={(e) => setOwnerOnly(e.target.checked)} />{' '}
            owner-only (managers will not see it)
          </label>

          <div style={{ marginTop: 10 }}>
            <HoldToApprove
              key={attempt}
              label="Hold to name them"
              approvedLabel="Named"
              disabled={!formReady}
              onChallenge={issueChallenge}
              onApprove={issue}
            />
          </div>
          <p className="tm-quiet" style={{ margin: '4px 0 0' }}>
            Every owner, and the person you name, is told. Any owner can revoke it. If the owner it
            rests on stops being an owner, it stops until a current owner re-approves it.
          </p>
        </div>
      )}

      {says && (
        <p role="status" className="tm-note" data-testid="send-grants-says" style={{ marginTop: 8 }}>
          {says}
        </p>
      )}
      {problem && (
        <p role="alert" className="tm-note" data-testid="send-grants-problem" style={{ marginTop: 8 }}>
          {problem}
        </p>
      )}
    </section>
  );
}
