/**
 * "This vendor usually invoices in" — the vendor profile's own currency fact.
 *
 * THE FOUNDER, 2026-09-06, batch 65, verbatim:
 *   "maybe Every vendor and their profile will show their default currency, but
 *    we won't use that as the invoice... definitely invoice receipt. However, we
 *    will use the currency from where we order it. We will show the user the
 *    currency the vendor always uses, and they have the ability to change it or
 *    not in the orders page."
 *
 * WHAT THIS SECTION IS CAREFUL TO SAY, EVERY TIME IT IS SHOWN: this code files
 * no invoice. It is offered as the starting value on the order sheet and it is
 * printed here, and nothing else reads it. An invoice takes the currency printed
 * on it, then the currency of the order it is matched to, then the house's. The
 * sentence is not decoration — a vendor-level default that a reader believes
 * prices their paper is one short step from `restaurants.currency DEFAULT 'USD'`,
 * which put a currency nobody chose under fourteen houses' money.
 *
 * NOTHING IS PRE-FILLED. The field starts empty for a vendor nobody has asked,
 * and the sentence says so rather than leaving a silent box. A pre-filled value
 * saved without reading is indistinguishable afterwards from one somebody
 * thought about, and `usual_currency_set_by` exists precisely to tell them
 * apart.
 *
 * STAFF SEE THE CONTROL, DISABLED, WITH THE REASON. Never hidden: a person who
 * cannot do something should learn who can, not that the thing does not exist.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import { CURRENCY_CODES, currencyLabel } from '../../../lib/currency';
import { EM, MONO, SANS } from './pv-format';

interface UsualCurrency {
  providerId: string;
  code: string | null;
  setAt: string | null;
  setByName: string | null;
  sentence: string;
}

function serverMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data
    ?.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export function UsualCurrencySection({
  providerId,
  providerName,
  takeFocus,
}: {
  providerId: string;
  providerName: string;
  /**
   * Set when the sheet was opened FROM the currency prompt (the coverage
   * panel's link, or `?vendor=` from the order sheet's empty field). The
   * section then scrolls itself into view and, for a person allowed to use it,
   * takes focus on the control.
   *
   * ONCE, AND ONLY ONCE. The latch below is not politeness: this section
   * refetches after a save and on window focus, and an effect that re-ran on
   * every settled query would yank the caret out of whatever the person had
   * moved on to. It also fires only after the read has SETTLED — before that
   * there is no control to focus, and scrolling to a sentence that is about to
   * be replaced moves the page under the reader.
   */
  takeFocus?: boolean;
}) {
  const { activeRole, user } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  const canManage = role === 'owner' || role === 'manager';

  const sectionRef = useRef<HTMLElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const tookFocus = useRef(false);

  const [choice, setChoice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const qc = useQueryClient();

  const stated = useQuery({
    queryKey: ['vendor-usual-currency', providerId],
    queryFn: async () => {
      const { data } = await apiClient.get<UsualCurrency>(
        `/providers/${providerId}/usual-currency`,
      );
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.patch<{ sentence: string }>(
        `/providers/${providerId}/usual-currency`,
        { currency: choice },
      );
      return data;
    },
    onSuccess: (res) => {
      setError(null);
      // The SERVER's sentence, verbatim. It names what changed and this
      // component does not hold the previous value.
      setSaved(res.sentence);
      setChoice('');
      void stated.refetch();
      // The order sheet offers this code; its cached answer is now stale.
      void qc.invalidateQueries({ queryKey: ['agreement-currency'] });
    },
    onError: (e) => {
      setSaved(null);
      setError(serverMessage(e, 'The currency was not changed.'));
    },
  });

  const settled = !stated.isLoading;
  useEffect(() => {
    if (!takeFocus || tookFocus.current || !settled) return;
    tookFocus.current = true;
    // `scrollIntoView` is absent in jsdom and in older embedded webviews; its
    // absence must not take the focus call down with it.
    sectionRef.current?.scrollIntoView?.({ block: 'center' });
    // A disabled control cannot hold focus, so a staff member is brought to the
    // section and reads why they cannot use it, rather than being sent to a
    // field that refuses them silently.
    selectRef.current?.focus();
  }, [takeFocus, settled]);

  const label = (
    <h3
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-3, #7C7365)',
        margin: '14px 0 6px',
      }}
    >
      This vendor usually invoices in
    </h3>
  );

  const note = (text: string, tone?: string) => (
    <p
      style={{
        fontFamily: SANS,
        fontSize: 11.5,
        lineHeight: 1.45,
        color: tone ?? 'var(--ink-3, #7C7365)',
        margin: '6px 0 0',
      }}
    >
      {text}
    </p>
  );

  /*
   * A FAILED READ IS NEVER AN EMPTY ONE (ADR 0067). Without this arm an outage
   * renders as "this vendor has not stated a usual currency" — the page
   * confidently telling a manager that a fact they entered does not exist, and
   * inviting them to enter it again.
   */
  if (stated.isError)
    return (
      <section data-testid="vendor-usual-currency" ref={sectionRef}>
        {label}
        <p
          style={{
            fontFamily: SANS,
            fontSize: 11.5,
            color: 'var(--alarm, #A33A2B)',
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
          <span>
            {serverMessage(
              stated.error,
              "This vendor's usual currency could not be read.",
            )}{' '}
            That is a failed read, not a vendor who has stated none — nothing here
            says what they invoice in.
          </span>
        </p>
      </section>
    );

  if (stated.isLoading)
    return (
      <section data-testid="vendor-usual-currency" ref={sectionRef}>
        {label}
        {note('Reading what this vendor usually invoices in…')}
      </section>
    );

  const code = stated.data?.code ?? null;

  return (
    <section data-testid="vendor-usual-currency" ref={sectionRef}>
      {label}

      <div className="flex items-baseline justify-between gap-4 py-1">
        <span
          data-testid="vendor-usual-currency-code"
          style={{
            fontFamily: MONO,
            fontSize: 16,
            letterSpacing: '0.06em',
            color: code ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
          }}
        >
          {code ?? EM}
        </span>
        {code && stated.data?.setByName ? (
          <span
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: 'var(--ink-3, #7C7365)',
              textAlign: 'right',
            }}
          >
            stated by {stated.data.setByName}
            {stated.data.setAt ? ` on ${stated.data.setAt.slice(0, 10)}` : ''}
          </span>
        ) : null}
      </div>

      {/* The server's own sentence: it says what the code is for and, more
          importantly, what it is NOT for. */}
      {note(stated.data?.sentence ?? '')}

      <div className="flex gap-2 items-center" style={{ marginTop: 10 }}>
        <select
          ref={selectRef}
          aria-label="Currency this vendor usually invoices in"
          data-testid="vendor-usual-currency-select"
          disabled={!canManage || save.isPending}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          style={{
            fontFamily: MONO,
            fontSize: 12,
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: canManage ? 'var(--paper-0, #FDFBF6)' : 'var(--paper-1, #F5F1E8)',
            color: 'var(--ink-1, #211C16)',
            opacity: canManage ? 1 : 0.6,
          }}
        >
          {/* Nothing is offered as a starting value. */}
          <option value="">Choose a code…</option>
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {currencyLabel(c)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="vendor-usual-currency-save"
          disabled={!canManage || !choice || save.isPending}
          onClick={() => save.mutate()}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '7px 12px',
            borderRadius: 6,
            border: '1px solid var(--seal-ring, #14515C)',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            opacity: !canManage || !choice ? 0.45 : 1,
            cursor: !canManage || !choice ? 'not-allowed' : 'pointer',
          }}
        >
          {save.isPending ? 'Saving…' : code ? 'Change it' : 'State it'}
        </button>
      </div>

      {!canManage
        ? note(
            `Stating what ${providerName} usually invoices in changes the currency every future order to them starts with, so it is a manager's or an owner's decision. ` +
              (role
                ? `You are signed in as ${role} at this house.`
                : 'This session holds no role at this house.') +
              ' Ask a manager or an owner to state it.',
          )
        : null}

      {saved ? note(saved, 'var(--seal-deep, #14515C)') : null}
      {error ? note(error, 'var(--alarm, #A33A2B)') : null}
    </section>
  );
}

export default UsualCurrencySection;
