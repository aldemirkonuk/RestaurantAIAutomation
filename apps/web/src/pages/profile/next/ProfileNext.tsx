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
 * SECOND PASS, 2026-09-03 (founder: "make sure it is almost identical to the
 * ones startups with $100B+ valuations have … add MCP servers as well, payment
 * types as well, we're going to need those")
 * -----------------------------------------------------------------------------
 * Pass one was a permissions ledger in four registers, and it was honest about
 * three absences: MCP had no backend, payments had no provider, and the plan was
 * on the restaurant record with no endpoint to fetch it. The founder read those
 * dashes and asked for the things. So this pass BUILT them:
 *
 *   Register IV  Model context — a real list model over a new gateway module
 *                (`apps/api-gateway/src/mcp-connections/`) and a new table
 *                (`user_mcp_connections`). List, add, revoke, all authenticated
 *                and tenant-scoped. "Last call" is an em dash because nothing
 *                calls these servers yet, and the register says so in one line.
 *   Register V   Payment — a real list model over a new gateway module
 *                (`apps/api-gateway/src/payment-methods/`) and a new table. The
 *                Add form opens with every real field, and its submit is
 *                DISABLED with one line: Stripe is not connected, so this saves
 *                nothing until it is. The gateway agrees — the create path
 *                refuses with the same reason.
 *   Register II  Security — the register the field opens on (Stripe, Linear,
 *                Vercel all do). One session row built from evidence this
 *                browser holds, and three protections (other devices, two-factor
 *                and passkeys, API tokens) rendered `Not built` with the
 *                measurement behind each claim. No fake toggles.
 *
 * And the plan is a figure: `GET /organizations/locations/:id` now returns
 * `subscription_tier` — and gained the manager/owner check its write already
 * had, so the page's permission copy states a server rule instead of describing
 * the gap between two postures.
 *
 * THE STRUCTURE THAT ENFORCES IT
 * ------------------------------
 * The shipping page is eight boxes down a scroll-spy rail, each a different
 * shape, and the two sections with no backend are drawn exactly like the six
 * with one. This page is a ledger in seven numbered registers, and ONE component
 * (`ConnectionRow`) draws every ATTACHMENT in it — its fifteen call sites are
 * spread across Registers II-VI (5 · 4 · 1 · 4 · 1), two of them inside a
 * `.map()`, and there is no second row component anywhere on the page. What separates a live Google link from a passkey with
 * no backend is its state chip and whether its control is live or `disabled`
 * carrying its reason in words — never the amount of design spent on it. The
 * page therefore cannot flatter an empty section by drawing it richer than its
 * evidence, and there is no control on it that can appear to succeed.
 *
 * The claim is deliberately about attachments, not about every element: Register
 * I (your name, phone, theme) and Register VII (the exit) are forms, drawn with
 * `Card`, because a field you edit about yourself is a different kind of object
 * from a thing that acts on your behalf. Five chips carry that second kind —
 * `Connected` / `Not connected` / `Unavailable` / `Provider not connected` /
 * `Not built` / `—` — and the last two are kept apart on purpose: "no code
 * exists" and "the code exists, unconfigured" have different fixes.
 *
 * Honesty, page-wide (ADR 0020): the two reads the shipping page swallows are
 * first-class states here (see useProfileNextData's header); an unknown is an
 * em dash, never a zero and never a blank that a Save could write back; and an
 * empty register always says WHICH kind of empty it is — nothing recorded, or
 * nothing readable.
 *
 * Ceremony is rationed. The hold-to-approve seal appears exactly once, on the
 * one irreversible act on the page: deleting the account.
 *
 * FIFTH PASS, 2026-09-04 — THE COLLAPSE. THIS PAGE BECOMES PERSONAL.
 * ------------------------------------------------------------------
 * The founder, asked whether the house registers leave and whether the four
 * `/settings` connection tabs collapse, chose **"Move the registers and
 * collapse the four tabs."** ADR 0114 justified `/connections` on a surface
 * count that FELL; until this pass it had risen. So, when
 * `mudavym_design_connections` is on:
 *
 *   Register IV  Model context  → `/connections#servers`, and in its place a
 *                NEW personal register, `ConsentRegister` — see its header for
 *                why the consent control could not travel with the rest.
 *   Register V   How the house pays → `/connections#payment`
 *   Register VI  The house → `/connections`, `/settings?tab=locations` and
 *                `/settings?tab=team`
 *
 * Seven registers become five. With the flag OFF this file renders exactly
 * what it rendered before — the route redirects here and the flag is off in
 * production — so every branch below is conditional, and the test file proves
 * both sides.
 *
 * WHAT THE MOVE COST, STATED RATHER THAN HIDDEN
 * ---------------------------------------------
 * Three controls had their only mount on this page. Two of them are
 * manager-only at the gateway and are being rebuilt on the manager-only
 * surface (declare / revoke a server — `connections/next/HouseServerControls`).
 * The third is not: adding a card mounts Stripe's own iframes through
 * `StripeCardPanel`, which is bound to this page's data hook and UI kit. It
 * did not move, so with the flag on there is nowhere to add a card. That is a
 * real subtraction and it is filed, not glossed: `connections.md` §9 G-C9 and
 * `profile.md` §9 G12a. It costs nothing today — `STRIPE_SECRET_KEY` is unset
 * on this deployment, so the create path 503s and the control was already
 * disabled with that sentence — but it is a debt, and the day a key is set it
 * becomes urgent.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DoorOpen } from 'lucide-react';
import { HoldToApprove, Wordmark } from '../../../components/mudavym';
import { animate, settle } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, countWord, ensureFraunces, roleLabel } from './pf-format';
import { Btn, Card, Note, PF_CSS, Register, StatusLine } from './pf-ui';
import { IdentityRegister } from './IdentityRegister';
import { SecurityRegister } from './SecurityRegister';
import { ConnectionsRegister } from './ConnectionsRegister';
import { useMudavymDesign } from '../../../lib/mudavym/useMudavymDesign';
import { McpRegister } from './McpRegister';
import { PaymentRegister } from './PaymentRegister';
import { HouseRegister } from './HouseRegister';
import { ConsentRegister } from './ConsentRegister';
import { useProfileNextData, type ProfileNextData } from './useProfileNextData';

export interface ProfileNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

/**
 * The opening sentence — a tally of every register that answered.
 *
 * The rule that makes it honest is that a clause is OMITTED when its register
 * did not answer, rather than counted as zero. Four registers can contribute and
 * a sentence with two clauses is a sentence about two reads; none of them
 * contributing produces a sentence about the read itself, not about the account.
 *
 * The payment clause is the one that changed this pass. It used to be a constant
 * — "nothing yet that can bill you" — because no payment backend existed at all.
 * There is a register now, so the clause is a reading of it, and it appears only
 * when that read succeeded.
 */
function standingLine(data: ProfileNextData, connectionsOn: boolean): string {
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
  if (data.mcpState === 'ok') {
    // With the collapse on, this page's model-context clause is about the
    // READER, not the house: how many of the house's servers may act as them.
    // "Three declared" is a fact about the restaurant and belongs in the
    // ledger sentence on `/connections`, which counts it there.
    if (connectionsOn) {
      const agreed = data.mcpServers.filter(
        (s) => s.status === 'active' && s.consent?.given === true,
      ).length;
      const unknown = data.mcpServers.some((s) => s.consent === undefined);
      if (!unknown) {
        parts.push(
          agreed === 0
            ? 'nothing agreed to act as you'
            : agreed === 1
              ? 'one server may act as you'
              : `${countWord(agreed)} servers may act as you`,
        );
      }
    } else {
      const n = data.mcpServers.filter((s) => s.status === 'active').length;
      parts.push(
        n === 0
          ? 'no model-context server declared'
          : n === 1
            ? 'one model-context server declared'
            : `${countWord(n)} model-context servers declared`,
      );
    }
  }
  if (data.paymentsState === 'ok') {
    const n = data.paymentMethods.length;
    parts.push(
      n === 0
        ? 'nothing on file that can bill you'
        : n === 1
          ? 'one payment method on file'
          : `${countWord(n)} payment methods on file`,
    );
  }
  if (parts.length === 0) {
    return data.meState === 'error'
      ? 'Your account record could not be read, so nothing on this page is claimed about it.'
      : 'Reading your account…';
  }
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export default function ProfileNext({ ground }: ProfileNextProps) {
  const data = useProfileNextData();
  const connectionsOn = useMudavymDesign('connections');
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
            {standingLine(data, connectionsOn)}
          </p>
        </header>

        <IdentityRegister data={data} />
        <SecurityRegister data={data} />
        <ConnectionsRegister data={data} onGoToSecurity={goToSecurity} />
        {/* THE COLLAPSE (founder, 2026-09-04): "Move the registers and collapse
            the four tabs."

            Registers IV, V and VI are about the HOUSE, not this person — the
            whole finding of DESIGN-FOUNDATION §6b. With
            `mudavym_design_connections` ON they are GONE from this page and one
            line says where each went; with it OFF they render exactly as they
            did, because the route redirects here and a page that pointed at a
            redirect would be a loop (ADR 0114).

            What replaces Register IV is not a pointer but a real register: the
            reader's own consents. `PUT /mcp-connections/:id/consent` is the one
            model-context write with no manager gate, and `/connections` is
            manager-only — so had it travelled with the rest, staff would have
            lost every way to stop a server acting in their name. See
            `ConsentRegister`'s header. */}
        {connectionsOn ? (
          <>
            <ConsentRegister data={data} />
            <ConnectionsMoved isManagerOrOwner={data.isManagerOrOwner} />
          </>
        ) : (
          <>
            <McpRegister data={data} />
            <PaymentRegister data={data} />
            <HouseRegister data={data} />
          </>
        )}

        {/* ── The exit, ruled off — Register VII, or V once three have left ─
            The number is the reader's place in a ledger, so it counts the
            registers actually on the page. A gap where three used to be would
            read as three that failed to render. */}
        <Register
          eyebrow={connectionsOn ? 'Register V' : 'Register VII'}
          icon={<DoorOpen size={13} aria-hidden />}
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

/**
 * The trace the three moved registers leave behind.
 *
 * Rendered only when `/connections` is actually routed — a line pointing at a
 * URL that redirects straight back here would be a loop.
 *
 * It names each register and where it went, because "see Connections" tells a
 * reader who came looking for their cards on file nothing about whether the
 * thing still exists. A manager gets the link; a staff member is told, in
 * words, that the surface is manager-and-owner only — a link that refuses on
 * arrival is worse than a sentence that says so first.
 */
function ConnectionsMoved({ isManagerOrOwner }: { isManagerOrOwner: boolean }) {
  return (
    <p
      style={{
        margin: '26px 0 0',
        paddingLeft: 13,
        borderLeft: '2px solid var(--seal)',
        fontSize: 12.5,
        lineHeight: 1.65,
        color: 'var(--ink-2)',
        maxWidth: 760,
      }}
    >
      <strong>Three registers left this page.</strong> What the house pays with,
      the servers it has declared, and the house record itself are the{' '}
      <strong>house&rsquo;s</strong> — kept for this restaurant, and they outlive
      whoever attached them.{' '}
      {isManagerOrOwner ? (
        <>
          They are on{' '}
          <a href="/connections#payment" style={{ color: 'var(--seal-deep)' }}>
            Connections
          </a>
          , with the till, the address this house&rsquo;s letters leave from, the
          calendar feed and every personal grant that acts here; the restaurant
          record and its people are in{' '}
          <a href="/settings?tab=locations" style={{ color: 'var(--seal-deep)' }}>
            Settings
          </a>
          .
        </>
      ) : (
        <>
          They are on Connections, which is open to managers and owners only —
          the gateway refuses those reads for every other role, so this is a
          statement of what exists, not a door being held shut by a hidden link.
        </>
      )}{' '}
      What stays here is yours: who you are, what protects this account, what is
      attached to you, and what may act as you.
    </p>
  );
}
