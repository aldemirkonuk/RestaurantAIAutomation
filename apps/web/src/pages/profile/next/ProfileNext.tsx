/**
 * ProfileNext — the Mudavym redesign of `/profile`, behind
 * `mudavym_design_profile` (ADR 0044 p4 wave).
 *
 * THE VERDICT (MAKEOVER-VERDICTS.md:216, `/profile` — KEEP+)
 * ----------------------------------------------------------
 *   "Let's make this a lot cooler." The redesign is acceptable but thin. Must
 *   include: MCPs — connected model-context servers as a first-class section;
 *   Linked accounts — "to be cooler than this, not just like that"; Payments —
 *   "we should be able to add the payment here", Stripe or comparable.
 *
 * THE STRUCTURE THAT ENFORCES IT
 * ------------------------------
 * The shipping page is eight boxes down a scroll-spy rail, each a different
 * shape, and the two sections with no backend are drawn exactly like the six
 * with one. This page is a ledger in four registers — who you are, what is
 * connected to you, the house, and the account ruled off — and the founder's
 * three additions all land inside ONE of them, on ONE row shape, next to the
 * connections that already work. One component draws every row, so what
 * separates a live Google link from an MCP server with no backend is its state
 * chip and whether its control is a live link or a `disabled` one carrying its
 * reason in words — never the amount of design spent on it. The page therefore
 * cannot flatter an empty section by drawing it richer than its evidence, and
 * there is no Connect on it that can appear to succeed.
 *
 * Honesty, page-wide (ADR 0020): the two reads the shipping page swallows are
 * first-class states here (see useProfileNextData's header); an unknown is an
 * em dash, never a zero and never a blank that a Save could write back; and
 * the plan — which exists in the database and is exposed by no endpoint — is a
 * dash rather than the hardcoded "Free" the shipping page prints.
 *
 * Ceremony is rationed. The hold-to-approve seal appears exactly once, on the
 * one irreversible act on the page: deleting the account.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HoldToApprove, Wordmark } from '../../../components/mudavym';
import { animate, settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, countWord, ensureFraunces, roleLabel } from './pf-format';
import { Btn, Card, Note, PF_CSS, Register, StatusLine } from './pf-ui';
import { IdentityRegister } from './IdentityRegister';
import { ConnectionsRegister } from './ConnectionsRegister';
import { HouseRegister } from './HouseRegister';
import { useProfileNextData, type ProfileNextData } from './useProfileNextData';

export interface ProfileNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

/**
 * The opening sentence. It says only what has actually been read: a clause is
 * omitted when its count is unknown, and both counts unknown produces a
 * sentence about the read, not about the account.
 */
function standingLine(data: ProfileNextData): string {
  const parts: string[] = [];
  if (data.credentialCount !== null) {
    const n = data.credentialCount;
    parts.push(n === 1 ? 'One way in' : `${countWord(n)} ways in`);
  }
  if (data.connectedWorkspaceCount !== null) {
    const n = data.connectedWorkspaceCount;
    parts.push(
      n === 0 ? 'no workspace connected' : n === 1 ? 'one workspace connected' : `${countWord(n)} workspaces connected`,
    );
  }
  if (parts.length === 0) {
    return data.meState === 'error'
      ? 'Your account record could not be read, so nothing on this page is claimed about it.'
      : 'Reading your account…';
  }
  parts.push('nothing yet that can bill you');
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export default function ProfileNext({ ground }: ProfileNextProps) {
  const data = useProfileNextData();
  const headRef = useRef<HTMLElement | null>(null);

  const [leaveArmed, setLeaveArmed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exitMsg, setExitMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  useEffect(() => {
    ensureFraunces();
  }, []);

  useEffect(() => {
    if (!headRef.current) return;
    animate(
      headRef.current,
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      settle,
    );
  }, []);

  const activeBranch = data.memberships.find((r) => r.id === data.activeRestaurantId);

  const goToSecurity = () => {
    const el = document.getElementById('pf-security');
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    document.getElementById('pf-new-password')?.focus({ preventScroll: true });
  };

  const leave = async () => {
    if (!leaveArmed) {
      setLeaveArmed(true);
      window.setTimeout(() => setLeaveArmed(false), 4000);
      return;
    }
    setLeaveArmed(false);
    setLeaving(true);
    setExitMsg(null);
    try {
      await data.leaveRestaurant();
      setExitMsg({ tone: 'done', text: 'You have left this restaurant. Re-entry needs a new invitation.' });
    } catch (e) {
      setExitMsg({ tone: 'error', text: `You were not removed — ${String((e as Error).message)}` });
    } finally {
      setLeaving(false);
    }
  };

  const destroy = () => {
    setExitMsg(null);
    void data
      .deleteAccount()
      .catch((e: unknown) =>
        setExitMsg({
          tone: 'error',
          text: `The account was NOT deleted — ${String((e as Error).message)}`,
        }),
      );
  };

  return (
    <div
      className="mudavym"
      data-ground={ground}
      style={{
        minHeight: '100%',
        background: 'var(--paper-0)',
        color: 'var(--ink-1)',
        fontFamily: SANS,
      }}
    >
      <style>{PF_CSS}</style>
      <div style={{ margin: '0 auto', maxWidth: 860, padding: '24px 16px 40px' }}>
        {/* ── the opening — Fraunces speaks ───────────────────────────── */}
        <header ref={headRef}>
          <Wordmark size={13} />
          <p
            style={{
              margin: '10px 0 0',
              fontFamily: MONO,
              fontSize: 9.5,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            {roleLabel(data.role)} · {activeBranch?.name ?? EM}
          </p>
          <h1
            style={{
              margin: '4px 0 0',
              fontFamily: SERIF,
              fontSize: 34,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--ink-1)',
            }}
          >
            {data.user?.name || 'Your account'}
            <span style={{ color: 'var(--seal)' }}>.</span>
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 15,
              color: 'var(--ink-2)',
            }}
          >
            {standingLine(data)}
          </p>
        </header>

        <IdentityRegister data={data} />
        <ConnectionsRegister data={data} onGoToSecurity={goToSecurity} />
        <HouseRegister data={data} />

        {/* ── Register IV — the account, ruled off ────────────────────── */}
        <Register
          eyebrow="Register IV"
          title="Ruled off"
          ruledOff
          lead={
            <Note>
              Two ways to end this. One is reversible with an invitation; the other is not
              reversible at all, and is the only thing on this page that asks for the seal.
            </Note>
          }
        >
          <Card
            title="Leave this restaurant"
            lead={`Removes you from ${activeBranch?.name ?? 'the active restaurant'}. Your account survives; access does not, until someone invites you back.`}
          >
            <Btn onClick={() => void leave()} disabled={leaving || !data.activeRestaurantId}>
              {leaving ? 'Leaving…' : leaveArmed ? 'Click again to leave' : 'Leave restaurant'}
            </Btn>
          </Card>

          <Card
            title="Delete account"
            lead="Permanently deletes your Mudavym account. It cannot be undone. The server refuses while you are the sole owner of any restaurant — that check runs before anything is destroyed, so hand ownership over first if it stops you."
          >
            <label
              htmlFor="pf-confirm-delete"
              style={{ display: 'block', marginBottom: 4, fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}
            >
              Type DELETE to arm the seal
            </label>
            <input
              id="pf-confirm-delete"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="DELETE"
              className="pf-focus"
              style={{
                width: '100%',
                maxWidth: 200,
                padding: '8px 10px',
                marginBottom: 10,
                borderRadius: 8,
                border: '1px solid var(--paper-2)',
                background: 'var(--paper-0)',
                color: 'var(--ink-1)',
                fontFamily: MONO,
                fontSize: 13,
                letterSpacing: '0.08em',
              }}
            />
            <div style={{ maxWidth: 280 }}>
              <HoldToApprove
                onApprove={destroy}
                disabled={confirmDelete !== 'DELETE'}
                label="Hold to delete this account"
                approvedLabel="Sent to the server"
              />
            </div>
            {confirmDelete !== 'DELETE' && (
              <Note>The hold does nothing until DELETE is typed above.</Note>
            )}
          </Card>
          {exitMsg && <StatusLine tone={exitMsg.tone}>{exitMsg.text}</StatusLine>}
          <p style={{ margin: '12px 0 0', fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
            Looking for restaurant settings instead?{' '}
            <Link to="/settings" style={{ color: 'var(--seal-deep)' }}>
              Open Settings
            </Link>
            .
          </p>
        </Register>

        <footer
          style={{
            marginTop: 36,
            paddingTop: 12,
            borderTop: '1px solid var(--paper-2)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'baseline',
            justifyContent: 'space-between',
          }}
        >
          <Wordmark size={14} />
          <p style={{ margin: 0, fontFamily: SANS, fontSize: 11, color: 'var(--ink-3)' }}>
            Every state on this page is read from the gateway; anything unread says so.
          </p>
        </footer>
      </div>
    </div>
  );
}
