/**
 * The card panel — Stripe's fields, the house's paper.
 *
 * WHAT IS OURS AND WHAT IS STRIPE'S
 * ---------------------------------
 * Everything you can see except the input boxes is this page. The boxes are
 * iframes served from `js.stripe.com`, so the card number is typed into
 * Stripe's origin and never touches this DOM, this bundle or our gateway —
 * which is the whole reason the product stays in PCI SAQ-A and why the
 * migration behind this register has nowhere to put a PAN.
 *
 * The `appearance` object below is read from the page's own CSS custom
 * properties at mount, so the fields carry paper/ink and the seal in BOTH
 * grounds. It is re-read when the ground changes; there is no second palette
 * hard-coded here for Stripe to disagree with.
 *
 * THE HOLD IS THE COMMITMENT, AND IT IS THE SECOND ONE ON THIS PAGE
 * ----------------------------------------------------------------
 * `HoldToApprove` was rationed to exactly one place — deleting the account.
 * This is the second, and it is the only other act on `/profile` that changes
 * what the product may do to the house rather than what it knows about it:
 * confirming a SetupIntent is the moment an instrument becomes chargeable. A
 * routine control would be the wrong die pressed on a decision the operator
 * cannot take back with a click.
 *
 * THE HOLD HERE IS NOT A REDEEMED SEAL, AND SAYS SO (2026-09-04)
 * -------------------------------------------------------------
 * ADR 0110's addendum seals the three `/payment-methods` writes, `create`
 * among them. This panel does not reach any of them: it confirms a SetupIntent
 * on Stripe's origin and then calls `POST /billing/sync`
 * (`useProfileNextData.ts`), and NOTHING in `apps/web` or `apps/mobile` calls
 * `POST /payment-methods` — measured, not assumed. So minting a `create`
 * challenge on this gesture would produce a token no request ever spends: a
 * seal on the screen with no redemption behind it, which is the shape the
 * addendum exists to remove. The gesture stays, the claim does not, and the
 * gap is filed as G-PAY-SETUP in `profile.md` §9.
 *
 * FOUR STATES, EACH REAL
 * ----------------------
 *   opening   the SetupIntent is being minted and Stripe.js fetched
 *   ready     the fields are mounted and the hold is armed
 *   working   confirming; the hold is disabled so it cannot fire twice
 *   failed    the provider's or the loader's own sentence, never "try again"
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { HoldToApprove } from '../../../components/mudavym/HoldToApprove';
import { EM, MONO, SANS } from './pf-format';
import { Btn, Card, Note, StatusLine } from './pf-ui';
import { loadStripe, type StripeElements, type StripeInstance } from './stripe-js';
import type { ProfileNextData } from './useProfileNextData';

type Phase = 'opening' | 'ready' | 'working' | 'failed' | 'done';

/**
 * The house palette, read off the live page rather than restated.
 *
 * `getComputedStyle` on the mudavym root returns the resolved token, so the
 * charcoal ground and the paper ground both produce a correct Stripe theme
 * without this file knowing either one's hex.
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
 * of a Mudavym-ish colour that is not Mudavym's — the same rule the rest of the
 * page follows for an unknown value: say nothing rather than invent something
 * plausible. The reads only come back empty before `mudavym.css` is loaded,
 * which cannot happen once the panel is mounted inside `.mudavym`.
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
      // settled error on this page (ADR 0042: the seal is the one chromatic
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

export function StripeCardPanel({
  data,
  publishableKey,
  onClose,
}: {
  data: ProfileNextData;
  publishableKey: string;
  onClose: () => void;
}) {
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
        const intent = await data.createSetupIntent();
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
          // bypass the hold, and the hold is the commitment on this page.
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
    // Mount once. Re-running would mint a second SetupIntent for the same act.
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
        const sync = await data.syncPayments();
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
  }, [data]);

  return (
    <Card
      title="Add a card"
      lead="The number is typed into Stripe's own fields, on Stripe's origin. It never reaches this page or our servers."
    >
      {phase === 'opening' && (
        <Note>Asking the provider for permission to store an instrument…</Note>
      )}

      {phase === 'failed' && (
        <StatusLine tone="error">
          The card form did not open — {problem}. Nothing was stored, and no
          instrument was created at the provider.
        </StatusLine>
      )}

      {/* Mounted whatever the phase, so the iframes are not torn down and
          rebuilt every time a message appears above them. */}
      <div
        ref={mountRef}
        style={{ marginTop: phase === 'failed' ? 0 : 10, minHeight: phase === 'failed' ? 0 : 90 }}
      />

      {problem && phase === 'ready' && (
        <StatusLine tone="error">
          {problem} Nothing was stored — the card was not attached.
        </StatusLine>
      )}

      {phase === 'done' && <StatusLine tone="done">{result}</StatusLine>}

      {phase !== 'failed' && phase !== 'done' && (
        <div style={{ marginTop: 14 }}>
          <HoldToApprove
            onApprove={confirm}
            label="Hold to put this card on file"
            approvedLabel="On file"
            disabled={phase !== 'ready'}
          />
          <Note>
            Holding authorises the house to be charged on this instrument later.
            It stores the card; it takes nothing now, and there is no price to
            take — this product cannot create a charge at all.
          </Note>
          <Note>
            This hold is the house&rsquo;s ceremony, not a seal the server
            redeems. The two acts on the rows below are sealed; adding a card is
            not, because the card is attached on Stripe&rsquo;s origin and the
            register is then reconciled, and neither of those two routes takes a
            seal today (G-PAY-SETUP).
          </Note>
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
        <Btn onClick={onClose}>{phase === 'done' ? 'Close' : 'Cancel'}</Btn>
        {phase === 'done' && (
          <span
            style={{
              fontFamily: SANS,
              fontSize: 12,
              color: 'var(--ink-3)',
              alignSelf: 'center',
            }}
          >
            The row below is the provider&rsquo;s answer, not this form&rsquo;s.
          </span>
        )}
      </div>

      {phase === 'working' && <Note>Confirming with the provider… {EM}</Note>}
    </Card>
  );
}

export default StripeCardPanel;
