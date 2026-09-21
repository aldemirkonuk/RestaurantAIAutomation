/**
 * "Who may send to vendors" — the owners' register of ADR 0112 F12 grants, on
 * the page where the house's people already are.
 *
 * The founder, 2026-09-21: *"An owner, a manager, or a person an owner has
 * granted sends with one hold ... only an owner issues, any owner revokes,
 * every grant/revocation told to all owners, 'granted by' shown where used."*
 *
 * - Owners see every grant, name a person, and revoke any grant — not only
 *   their own. Everyone else, managers included, is sent only the grants that
 *   name them (`AuthorityGrantsService.list`), so for them an empty list means
 *   "no grant names you", never "nobody has been named" [last-call fix,
 *   2026-09-21: the page said the latter to managers, off a list the gateway
 *   had filtered]. They are offered nothing the gateway would refuse.
 * - Naming someone asks three questions and answers none of them by default:
 *   when it ends ("until an owner revokes it" is an answer the owner picks,
 *   not a blank), and whether it covers deals that commit money (and up to how
 *   much, in which currency) or letters only.
 * - Every grant and revocation is told to every owner and to the person named;
 *   the sentence the gateway returns says how many were told, and says so
 *   plainly when nobody could be.
 *
 * People-facing and deliberately plain: one sentence per grant, the house's
 * own panel and controls, no table.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import type { TeamMember } from '../../../services/api/team';

export interface AuthorityGrantView {
  id: string;
  scope: string;
  grantee: { userId: string; name: string | null };
  grantedBy: { userId: string | null; name: string | null };
  limitAmount: number | null;
  limitCurrency: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: { userId: string | null; name: string | null } | null;
  state: 'live' | 'expired' | 'revoked';
}

interface GrantsReadout {
  viewerIsOwner: boolean;
  grants: AuthorityGrantView[];
}

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
  return `${who} may send to vendors with one hold (${covers}), named by ${by}, ${
    g.expiresAt ? `until ${day(g.expiresAt)}` : 'until an owner revokes it'
  }.`;
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

  const issue = async () => {
    setProblem(null);
    setSays(null);
    try {
      const { data } = await apiClient.post('/authority/grants', {
        granteeUserId,
        scope: 'vendor_send',
        limitAmount: covers === 'letters' ? null : amount,
        limitCurrency: covers === 'letters' ? null : currency,
        // The end of the day chosen, in the owner's own clock.
        expiresAt: ends === 'revoked' ? null : new Date(`${endDate}T23:59:59`).toISOString(),
      });
      setSays(data?.says ?? 'Named.');
      setGranteeUserId('');
      await qc.invalidateQueries({ queryKey: grantKeys(restaurantId) });
    } catch (e) {
      setProblem(`Nobody was named (${getErrorMessage(e)}).`);
      setAttempt((a) => a + 1);
      throw e;
    }
  };

  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.post(`/authority/grants/${id}/revoke`).then((r) => r.data),
    onSuccess: (data) => {
      setSays(data?.says ?? 'Revoked.');
      void qc.invalidateQueries({ queryKey: grantKeys(restaurantId) });
    },
    onError: (e) => setProblem(`The grant was not revoked (${getErrorMessage(e)}). It still counts.`),
  });

  const owner = grants.data?.viewerIsOwner === true;
  const live = (grants.data?.grants ?? []).filter((g) => g.state === 'live');
  const past = (grants.data?.grants ?? []).filter((g) => g.state !== 'live');

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
      ) : live.length === 0 ? (
        owner ? (
          <p className="tm-note" data-testid="send-grants-none">
            Nobody has been named. Only owners and managers send with one hold.
          </p>
        ) : (
          <p className="tm-note" data-testid="send-grants-none">
            No grant names you. Only owners see who else has been named.
          </p>
        )
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="send-grants-live">
          {live.map((g) => (
            <li key={g.id} className="flex flex-wrap items-baseline gap-2" style={{ padding: '6px 0', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0 }}>{grantSentence(g)}</span>
              {owner && (
                <button
                  type="button"
                  className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(g.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
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

          <div style={{ marginTop: 10 }}>
            <HoldToApprove
              key={attempt}
              label="Hold to name them"
              approvedLabel="Named"
              disabled={!formReady}
              onApprove={issue}
            />
          </div>
          <p className="tm-quiet" style={{ margin: '4px 0 0' }}>
            Every owner, and the person you name, is told. Any owner can revoke it.
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
