/**
 * Register V — Payment.
 *
 * "PAYMENTS AS A STATE, NOT A FORM" (DESIGN-FOUNDATION §6, `/profile`)
 * -------------------------------------------------------------------
 * The competitive read said to borrow Stripe's checklist logic in the house
 * idiom — "Card on file — · Billing contact set · VAT number —" — and to let the
 * provider's hosted flow do the collecting. That is what this register is: a
 * standing of three facts at the top, then the rows behind them.
 *
 * THE ONE SENTENCE THIS PAGE EXISTS TO GET RIGHT
 * ----------------------------------------------
 * The register is empty, and there are two completely different reasons a
 * payment register can be empty:
 *
 *     "You have not added a card yet."
 *     "No provider is connected, so no card can exist."
 *
 * In an API that returns a bare array these are the same response, and in a UI
 * that counts rows they are the same screen. `GET /payment-methods` therefore
 * returns the PROVIDER's state beside the rows, and this register prints the
 * second sentence, from the server, not from page prose.
 *
 * The founder asked for "Add a card" to open — so it opens. The form is real,
 * every field is real, and the submit is DISABLED with one line saying Stripe is
 * not connected and this saves nothing until it is. The gateway agrees with the
 * button: `POST /payment-methods` refuses with 503 and the same reason while no
 * credential is configured (payment-methods.service.ts). There is no path
 * through this register that can appear to succeed.
 *
 * What is NOT here, per §6: plan MANAGEMENT. The plan is shown because the
 * restaurant is on one and it already decides something real; changing it is a
 * restaurant decision with a price behind it (OD-23, founder-deferred), and
 * putting an upgrade button on a personal profile is the shape §6 tells us to
 * refuse.
 */

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { EM, MONO, SANS, fmtDay, planLabel, roleLabel } from './pf-format';
import {
  Btn,
  Card,
  Choice,
  ConnectionRow,
  Field,
  Note,
  Rail,
  Register,
  RetryLink,
  StatusLine,
} from './pf-ui';
import type { PaymentMethodVM, ProfileNextData } from './useProfileNextData';

const KIND_LABEL: Record<PaymentMethodVM['kind'], string> = {
  card: 'Card',
  bank_account: 'Bank account (ACH)',
  apple_pay: 'Apple Pay',
  invoice: 'Invoice terms',
};

const KIND_OPTIONS = [
  { value: 'card', label: 'Card' },
  { value: 'bank_account', label: 'Bank account (ACH direct debit)' },
  { value: 'apple_pay', label: 'Apple Pay' },
  { value: 'invoice', label: 'Invoice terms (net 30)' },
];

/** The standing of one fact, in the checklist idiom: name, then value or dash. */
function Standing({ label, value }: { label: string; value: string }) {
  const unknown = value === EM;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '7px 0',
        borderBottom: '1px solid var(--paper-2)',
      }}
    >
      <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)' }}>{label}</span>
      <span
        style={{
          fontFamily: MONO,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 12,
          color: unknown ? 'var(--ink-3)' : 'var(--ink-1)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function PaymentRegister({ data }: { data: ProfileNextData }) {
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState('card');
  const [brand, setBrand] = useState('');
  const [last4, setLast4] = useState('');
  const [exp, setExp] = useState('');

  const [billingEmail, setBillingEmail] = useState<string | null>(null);
  const [billingPhone, setBillingPhone] = useState<string | null>(null);
  const [billingMsg, setBillingMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(
    null,
  );
  const [savingBilling, setSavingBilling] = useState(false);

  const loc = data.location;
  const locReadable = data.locationState === 'ok' && loc !== null;
  const emailValue = billingEmail ?? loc?.billingEmail ?? '';
  const phoneValue = billingPhone ?? loc?.billingPhone ?? '';

  const provider = data.paymentProvider;
  const providerConnected = provider?.connected === true;
  const methods = data.paymentMethods;

  const saveBilling = async () => {
    setBillingMsg(null);
    setSavingBilling(true);
    try {
      await data.saveBillingContact(emailValue, phoneValue);
      setBillingEmail(null);
      setBillingPhone(null);
      setBillingMsg({ tone: 'done', text: 'Billing contact saved to the restaurant record.' });
    } catch (e) {
      setBillingMsg({ tone: 'error', text: `Not saved — ${String((e as Error).message)}` });
    } finally {
      setSavingBilling(false);
    }
  };

  const cardOnFile = methods.find((m) => m.isDefault) ?? methods[0] ?? null;
  const standingCard =
    data.paymentsState !== 'ok'
      ? EM
      : cardOnFile
        ? `${KIND_LABEL[cardOnFile.kind]}${cardOnFile.last4 ? ` ••••${cardOnFile.last4}` : ''}`
        : EM;
  const standingContact = locReadable && loc?.billingEmail ? loc.billingEmail : EM;
  const standingPlan = locReadable ? planLabel(loc?.subscriptionTier) : EM;

  return (
    <Register
      eyebrow="Register V"
      icon={<CreditCard size={13} aria-hidden />}
      title="How the house pays"
      lead={
        <Note>
          Three facts, then the rows behind them. This belongs to the restaurant, not to you:
          an instrument added here charges the house, and only its managers and owners may
          add one.
        </Note>
      }
    >
      <Card
        title="Standing"
        lead="What is on file today. A dash is a fact that is missing, not a zero."
      >
        <Standing label="Payment method on file" value={standingCard} />
        <Standing label="Billing contact" value={standingContact} />
        <Standing label="Plan" value={standingPlan} />
        {!locReadable && (
          <Note>
            The billing contact and the plan come from the restaurant record, which this
            session has not read
            {data.locationState === 'idle'
              ? ` — managers and owners read it, and your role here is ${roleLabel(data.role)}.`
              : '.'}
          </Note>
        )}
      </Card>

      <Rail
        title="Payment methods"
        icon={<CreditCard size={12} aria-hidden />}
        lead="Cards, bank debits, Apple Pay and invoice terms — the four kinds this register is built for."
      >
        {data.paymentsState === 'loading' && <Note>Reading the payment register…</Note>}

        {data.paymentsState === 'error' && (
          <StatusLine tone="error">
            The payment register could not be read ({data.paymentsError}). Nothing below is
            claimed — this is an unread register, not an empty one.{' '}
            <RetryLink onClick={data.refetchPayments} />
          </StatusLine>
        )}

        {data.paymentsState === 'ok' && provider && !provider.connected && (
          <StatusLine tone="error">
            {provider.reason}
          </StatusLine>
        )}

        {methods.map((m) => (
          <ConnectionRow
            key={m.id}
            title={`${KIND_LABEL[m.kind]}${m.brand ? ` · ${m.brand}` : ''}`}
            subtitle={
              <>
                {m.last4 ? `•••• ${m.last4}` : EM} · expires {m.exp ?? EM} · added{' '}
                {fmtDay(m.createdAt)}
                {m.isDefault ? ' · charged first' : ''}
              </>
            }
            state="connected"
            controls={
              data.isManagerOrOwner ? (
                <Btn onClick={() => void data.removePaymentMethod(m.id)}>Remove</Btn>
              ) : undefined
            }
          />
        ))}

        {data.paymentsState === 'ok' && methods.length === 0 && (
          <ConnectionRow
            title="No payment method on file"
            subtitle="Nothing can be charged to this restaurant."
            // NOT `unbuilt`. That chip reads "Not built" and belongs to the
            // four Security rows, which have no code behind them at all. This
            // register has a table, a module and three working routes; what is
            // missing is one credential. `unprovisioned` says so on the chip,
            // so a reader who skims and never opens the row is told the same
            // thing the reason below tells a reader who does.
            state={providerConnected ? 'available' : 'unprovisioned'}
            reason={
              providerConnected
                ? 'A provider is connected, so one can be added.'
                : 'This register is not empty because nobody has added a card, and it is not unbuilt — the table, the module and the routes all exist and answer. It is empty because no payment provider is connected to this deployment, so no instrument could exist to list.'
            }
          />
        )}

        <div style={{ marginTop: 10 }}>
          {addOpen ? (
            <Card
              title="Add a payment method"
              lead="The real form, with the real fields. It is disabled at the submit, not at the door."
            >
              <Choice
                id="pf-pay-kind"
                label="Kind"
                value={kind}
                onChange={setKind}
                options={KIND_OPTIONS}
              />
              <Field
                id="pf-pay-brand"
                label={kind === 'invoice' ? 'Arrangement' : 'Brand or bank'}
                value={brand}
                onChange={setBrand}
                placeholder={kind === 'invoice' ? 'Net 30' : 'Visa'}
              />
              <Field
                id="pf-pay-last4"
                label="Last four digits"
                value={last4}
                onChange={setLast4}
                placeholder="4242"
                hint={
                  <Note>
                    Four digits only. There is nowhere in this product to put a full card
                    number — the provider takes it in its own hosted flow and hands back
                    exactly these four.
                  </Note>
                }
              />
              <Field
                id="pf-pay-exp"
                label="Expires"
                value={exp}
                onChange={setExp}
                placeholder="04/2029"
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Btn emphasis="seal" disabled>
                  Save payment method
                </Btn>
                <Btn onClick={() => setAddOpen(false)}>Cancel</Btn>
              </div>
              <Note id="pf-pay-disabled-reason">
                Stripe is not connected — this saves nothing until it is.
              </Note>
            </Card>
          ) : (
            <Btn onClick={() => setAddOpen(true)} disabled={!data.isManagerOrOwner}>
              Add a card
            </Btn>
          )}
          {!data.isManagerOrOwner && !addOpen && (
            <Note>
              Managers and owners add payment methods, and the server refuses the write for
              anyone else. Your role here is {roleLabel(data.role)}.
            </Note>
          )}
        </div>
      </Rail>

      <Rail
        title="Billing contact and plan"
        icon={<CreditCard size={12} aria-hidden />}
        lead="Where notices go, and which plan the restaurant is on. Both live on the restaurant record."
      >
        {data.isManagerOrOwner ? (
          <Card
            title="Billing contact"
            lead="Where invoices and plan notices would go. Saved onto the restaurant record."
          >
            {data.locationState === 'loading' && <Note>Reading the restaurant record…</Note>}
            {data.locationState === 'error' && (
              <StatusLine tone="error">
                The restaurant record could not be read ({data.locationError}). The fields stay
                empty and saving is refused — a value nobody read must not be written back.{' '}
                <RetryLink onClick={data.refetchLocation} />
              </StatusLine>
            )}
            <div style={{ marginTop: 10 }}>
              <Field
                id="pf-billing-email"
                label="Billing email"
                type="email"
                value={emailValue}
                onChange={setBillingEmail}
                disabled={!locReadable}
                placeholder="billing@restaurant.com"
              />
              <Field
                id="pf-billing-phone"
                label="Billing phone"
                type="tel"
                value={phoneValue}
                onChange={setBillingPhone}
                disabled={!locReadable}
                placeholder="+1 555 000 0000"
              />
              <Btn
                emphasis="seal"
                onClick={() => void saveBilling()}
                disabled={!locReadable || savingBilling}
              >
                {savingBilling ? 'Saving…' : 'Save billing contact'}
              </Btn>
            </div>
            {billingMsg && <StatusLine tone={billingMsg.tone}>{billingMsg.text}</StatusLine>}
          </Card>
        ) : (
          <ConnectionRow
            title="Billing contact"
            subtitle="Where invoices and plan notices would go."
            state="unknown"
            reason={`Managers and owners read and change the billing contact, and the server refuses both for anyone else — the read check was added on 2026-09-03, so this is now a rule the endpoint enforces rather than one this page keeps. Your role here is ${roleLabel(data.role)}.`}
          />
        )}

        <ConnectionRow
          title="Plan"
          subtitle={
            locReadable ? (
              <>
                This restaurant is on{' '}
                <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
                  {planLabel(loc?.subscriptionTier)}
                </span>
                , and it already decides something real — the ceiling on model spend.
              </>
            ) : (
              <>
                The plan decides something real — the ceiling on model spend. Its value is{' '}
                <span style={{ fontFamily: MONO }}>{EM}</span> here.
              </>
            )
          }
          state={locReadable && loc?.subscriptionTier ? 'connected' : 'unknown'}
          reason={
            locReadable && loc?.subscriptionTier
              ? 'Read from the restaurant record. Changing it is a restaurant decision with a price behind it, not a control on a personal profile.'
              : data.locationState === 'idle'
                ? 'The plan is on the restaurant record, and the server now refuses that read for anyone but a manager or owner.'
                : 'The restaurant record has not answered, so the plan is unknown rather than free.'
          }
        />
      </Rail>
    </Register>
  );
}

export default PaymentRegister;
