/**
 * The card panel — Stripe's fields, the house's paper.
 *
 * ONE COMPONENT, TWO CALLERS, NO FORK (founder, 2026-09-04: "port the card
 * panel to /connections now")
 * ---------------------------------------------------------------------
 * This file used to be `pages/profile/next/StripeCardPanel.tsx`. The collapse
 * (`28c78397`) moved the payment register to `/connections` and left the panel
 * behind, because it was bound to that page's data hook (`ProfileNextData`) and
 * its UI kit (`pf-ui`) — so adding a card had no home at all while
 * `mudavym_design_connections` was on. That subtraction is what
 * `connections.md` §9 G-C9 and `profile.md` §9 G12a were.
 *
 * Rather than copy four hundred lines into a second directory, the two bindings
 * were cut:
 *
 *   - **The data.** It never needed a page's data object. It calls exactly two
 *     functions, and `CardPanelClient` below is the whole of what it wants.
 *     `ProfileNextData` satisfies it structurally, so `/profile` still passes
 *     its hook straight in; `useConnectionsNextData` grew the same two members.
 *   - **The chrome.** The four `pf-ui` primitives it used are re-drawn here
 *     over the house tokens, so the panel looks the same on a page that has
 *     never heard of `.pf-`. The hover and focus rules travel with it
 *     (`stripe-card-panel.css`).
 *
 * A second copy would have been the easy port and the wrong one: the two would
 * have drifted the first time either page's Stripe story changed, and the whole
 * point of the register having one home is that there is one of it.
 *
 * WHAT IS OURS AND WHAT IS STRIPE'S
 * ---------------------------------
 * Everything you can see except the input boxes is this component. The boxes
 * are iframes served from `js.stripe.com`, so the card number is typed into
 * Stripe's origin and never touches this DOM, this bundle or our gateway —
 * which is the whole reason the product stays in PCI SAQ-A and why the
 * migration behind this register has nowhere to put a PAN.
 *
 * The `appearance` object below is read from the host page's own CSS custom
 * properties at mount, so the fields carry paper/ink and the seal in BOTH
 * grounds and on BOTH pages. There is no second palette hard-coded here for
 * Stripe to disagree with.
 *
 * THE HOLD IS THE COMMITMENT
 * --------------------------
 * `HoldToApprove` is rationed. Confirming a SetupIntent is the moment an
 * instrument becomes chargeable — the one act on either page that changes what
 * the product may do to the house rather than what it knows about it. A routine
 * control would be the wrong die pressed on a decision the operator cannot take
 * back with a click.
 *
 * THE HOLD HERE IS NOT A REDEEMED SEAL, AND SAYS SO (2026-09-04)
 * -------------------------------------------------------------
 * ADR 0110's addendum seals the three `/payment-methods` writes, `create` among
 * them. This panel reaches none of them: it confirms a SetupIntent on Stripe's
 * origin and then calls `POST /billing/sync`, and NOTHING in `apps/web` or
 * `apps/mobile` calls `POST /payment-methods` — measured, not assumed. So
 * minting a `create` challenge on this gesture would produce a token no request
 * ever spends: a seal on the screen with no redemption behind it, which is the
 * shape the addendum exists to remove.
 *
 * The gesture therefore stays and the claim does not, and the gap is filed as
 * G-PAY-SETUP in `profile.md` §9. Sealing `POST /billing/setup-intent` is a
 * separate build (p4ae) and is not asserted here by a single word until it
 * lands: the honest hook for it is `onChallenge` on the `HoldToApprove` below
 * plus a mint in each caller's hook, and nothing else in this file has to
 * change for it.
 *
 * FOUR STATES, EACH REAL
 * ----------------------
 *   opening   the SetupIntent is being minted and Stripe.js fetched
 *   ready     the fields are mounted and the hold is armed
 *   working   confirming; the hold is disabled so it cannot fire twice
 *   failed    the provider's or the loader's own sentence, never "try again"
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { HoldToApprove } from './HoldToApprove';
import { loadStripe, type StripeElements, type StripeInstance } from './stripe-js';
import './stripe-card-panel.css';

const EM = '—';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif';

type Phase = 'opening' | 'ready' | 'working' | 'failed' | 'done';

/**
 * The whole of what the panel asks a page for.
 *
 * Two functions, not a page's data object. `ProfileNextData` and
 * `ConnectionsNextData` both satisfy this structurally, which is what lets one
 * component serve two hooks without either one importing the other's types.
 * Each implementation is expected to refresh its own payment register after a
 * sync — this component does not know either query key and must not.
 */
export interface CardPanelClient {
  createSetupIntent: () => Promise<{
    clientSecret: string;
    setupIntentId: string;
    livemode: boolean;
  }>;
  syncPayments: () => Promise<{
    syncedAt: string;
    kept: number;
    removed: number;
    note: string | null;
  }>;
}

export interface StripeCardPanelProps {
  client: CardPanelClient;
  /** The browser's half of the credential. A caller with none renders a reason instead. */
  publishableKey: string;
  onClose: () => void;
}

/* ── the panel's own chrome, over the house tokens ────────────────────── */

function PanelCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--paper-2)',
        background: 'var(--paper-1)',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 10,
        maxWidth: 640,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--ink-1)',
        }}
      >
        {title}
      </h3>
      {lead ? (
        <p
          style={{
            margin: '2px 0 0',
            fontFamily: SANS,
            fontSize: 12,
            color: 'var(--ink-3)',
          }}
        >
          {lead}
        </p>
      ) : null}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function PanelNote({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: 0, fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>
      {children}
    </p>
  );
}

/** A settled error or a settled confirmation. Always words, never an empty. */
function PanelStatus({ tone, children }: { tone: 'error' | 'done'; children: ReactNode }) {
  return (
    <p
      role="status"
      style={{
        margin: '8px 0 0',
        fontFamily: SANS,
        fontSize: 12,
        lineHeight: 1.5,
        color: tone === 'error' ? 'var(--ink-1)' : 'var(--seal-deep)',
        borderLeft: `2px solid ${tone === 'error' ? 'var(--ink-3)' : 'var(--seal-ring)'}`,
        paddingLeft: 8,
      }}
    >
      {children}
    </p>
  );
}

function PanelBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="scp-btn" onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The house palette, read off the live page rather than restated.
 *
 * `getComputedStyle` on the mudavym root returns the resolved token, so the
 * charcoal ground and the paper ground both produce a correct Stripe theme
 * without this file knowing either one's hex — and `/connections` and
 * `/profile` get the same answer because both mount inside `.mudavym`.
 *
 * WHY THERE IS NO FALLBACK COLOUR
 * -------------------------------
 * The first version fell back to hand-picked hex when a read came back empty —
 * `#FFFFFF` for `--paper-1`, `#1A1A1A` for `--ink-1`, and a `--seal-ring`
 * fallback with the alpha channel dropped. Every one of those was a colour the
 * product does not have: `--paper-1` is `#F3EFE6` on paper and `#1D1813` on
 * charcoal (`styles/mudavym.css:35,73`) and never white. Worse, a fixed hex is
 * necessarily wrong on one of the two grounds, so the "safety net" could only
 * ever be caught looking like a bug.
 *
 * So an unresolved token is now OMITTED. Stripe's own default renders instead
 * of a Mudavym-ish colour that is not Mudavym's — the same rule both pages
 * follow for an unknown value: say nothing rather than invent something
 * plausible.
 */
function houseAppearance(root: HTMLElement | null): Record<string, unknown> {
  /** The resolved token, or null. Never a substitute. */
  const read = (token: string): string | null => {
    if (!root || typeof window === 'undefined' || !window.getComputedStyle) return null;
    const value = window.getComputedStyle(root).getPropertyValue(token).trim();
    return value.length > 0 ? value : null;
  };

  /** Drop every key whose token did not resolve. */
  const only = (pairs: Record<string, string | null>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(pairs).filter(([, v]) => v !== null),
    ) as Record<string, string>;

  const seal = read('--seal');
  const paper1 = read('--paper-1');
  const paper2 = read('--paper-2');
  const sealRing = read('--seal-ring');
  const ink1 = read('--ink-1');
  const ink3 = read('--ink-3');

  return {
    theme: 'stripe',
    variables: only({
      colorPrimary: seal,
      colorBackground: paper1,
      colorText: ink1,
      colorTextSecondary: ink3,
      // The house has no red. A decline reads in ink, like every other
      // settled error on either page (ADR 0042: the seal is the one chromatic
      // mark, and an error is not the seal).
      colorDanger: ink1,
      fontFamily: SANS,
      borderRadius: '8px',
      spacingUnit: '4px',
    }),
    rules: {
      ...(paper2 ? { '.Input': { border: `1px solid ${paper2}`, boxShadow: 'none' } } : {}),
      ...(sealRing
        ? { '.Input:focus': { border: `1px solid ${sealRing}`, boxShadow: 'none' } }
        : {}),
      '.Label': { fontWeight: '600', fontSize: '11.5px' },
    },
  };
}

export function StripeCardPanel({ client, publishableKey, onClose }: StripeCardPanelProps) {
  const [phase, setPhase] = useState<Phase>('opening');
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [livemode, setLivemode] = useState<boolean | null>(null);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  useEffect(() => {
    let cancelled = false;

    const open = async () => {
      try {
        // The intent first: if the gateway refuses (no STRIPE_SECRET_KEY, or
        // the caller is not a manager), we must say THAT rather than load a
        // script and then discover we had nothing to confirm.
        const intent = await client.createSetupIntent();
        if (cancelled) return;
        setLivemode(intent.livemode);

        const stripe = await loadStripe(publishableKey);
        if (cancelled) return;
        stripeRef.current = stripe;

        const elements = stripe.elements({
          clientSecret: intent.clientSecret,
          appearance: houseAppearance(
            mountRef.current?.closest('.mudavym') as HTMLElement | null,
          ),
        });
        elementsRef.current = elements;

        const element = elements.create('payment', {
          layout: 'tabs',
          // No wallet buttons: Apple/Google Pay open a native sheet that would
          // bypass the hold, and the hold is the commitment here.
          wallets: { applePay: 'never', googlePay: 'never' },
        });
        if (!mountRef.current) return;
        element.mount(mountRef.current);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setProblem(String((e as Error)?.message ?? e));
        setPhase('failed');
      }
    };

    void open();
    return () => {
      cancelled = true;
      try {
        elementsRef.current?.getElement('payment')?.destroy();
      } catch {
        // The element is already gone with the node; nothing to report.
      }
    };
    // Mount once. Re-running would mint a second SetupIntent for the same act,
    // and `client` is a fresh object on every render of either hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishableKey]);

  const confirm = useCallback(() => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;

    setPhase('working');
    setProblem(null);

    void (async () => {
      try {
        const submitted = await elements.submit();
        if (submitted?.error?.message) {
          setProblem(submitted.error.message);
          setPhase('ready');
          return;
        }

        const outcome = await stripe.confirmSetup({
          elements,
          // `if_required` keeps the operator on this page unless the bank
          // demands a 3-D Secure step, which is the only reason to leave it.
          redirect: 'if_required',
        });

        if (outcome?.error?.message) {
          setProblem(outcome.error.message);
          setPhase('ready');
          return;
        }

        // Do not draw the row from the confirmation. Reconcile against the
        // provider and let the register show what Stripe actually holds — the
        // difference between "we think it worked" and "the provider says so".
        const sync = await client.syncPayments();
        setResult(
          `Confirmed, and the register was reconciled against the provider at ${new Date(
            sync.syncedAt,
          ).toLocaleTimeString()}. ${sync.kept} instrument(s) on file.`,
        );
        setPhase('done');
      } catch (e) {
        setProblem(String((e as Error)?.message ?? e));
        setPhase('ready');
      }
    })();
  }, [client]);

  return (
    <PanelCard
      title="Add a card"
      lead="The number is typed into Stripe's own fields, on Stripe's origin. It never reaches this page or our servers."
    >
      {phase === 'opening' && (
        <PanelNote>Asking the provider for permission to store an instrument…</PanelNote>
      )}

      {phase === 'failed' && (
        <PanelStatus tone="error">
          The card form did not open — {problem}. Nothing was stored, and no
          instrument was created at the provider.
        </PanelStatus>
      )}

      {/* Mounted whatever the phase, so the iframes are not torn down and
          rebuilt every time a message appears above them. */}
      <div
        ref={mountRef}
        style={{ marginTop: phase === 'failed' ? 0 : 10, minHeight: phase === 'failed' ? 0 : 90 }}
      />

      {problem && phase === 'ready' && (
        <PanelStatus tone="error">
          {problem} Nothing was stored — the card was not attached.
        </PanelStatus>
      )}

      {phase === 'done' && <PanelStatus tone="done">{result}</PanelStatus>}

      {phase !== 'failed' && phase !== 'done' && (
        <div style={{ marginTop: 14 }}>
          <HoldToApprove
            onApprove={confirm}
            label="Hold to put this card on file"
            approvedLabel="On file"
            disabled={phase !== 'ready'}
          />
          <PanelNote>
            Holding authorises the house to be charged on this instrument later.
            It stores the card; it takes nothing now, and there is no price to
            take — this product cannot create a charge at all.
          </PanelNote>
          <PanelNote>
            This hold is the house&rsquo;s ceremony, not a seal the server
            redeems. The two acts on the instrument rows in this register —
            charge this first, and remove — are sealed; adding a card is not,
            because the card is attached on Stripe&rsquo;s origin and the
            register is then reconciled, and neither of those two routes takes a
            seal today (G-PAY-SETUP).
          </PanelNote>
          {livemode !== null && (
            <p
              style={{
                margin: '6px 0 0',
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              {livemode
                ? 'Live key — a real card, really stored.'
                : 'Test key — Stripe will accept only test cards here.'}
            </p>
          )}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <PanelBtn onClick={onClose}>{phase === 'done' ? 'Close' : 'Cancel'}</PanelBtn>
        {phase === 'done' && (
          <span
            style={{
              fontFamily: SANS,
              fontSize: 12,
              color: 'var(--ink-3)',
              alignSelf: 'center',
            }}
          >
            The rows in this register are the provider&rsquo;s answer, not this
            form&rsquo;s.
          </span>
        )}
      </div>

      {phase === 'working' && <PanelNote>Confirming with the provider… {EM}</PanelNote>}
    </PanelCard>
  );
}

export default StripeCardPanel;
