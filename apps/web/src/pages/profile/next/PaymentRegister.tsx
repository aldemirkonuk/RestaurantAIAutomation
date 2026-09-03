/**
 * Register V — Payment.
 *
 * "PAYMENTS AS A STATE, NOT A FORM" (DESIGN-FOUNDATION §6, `/profile`)
 * -------------------------------------------------------------------
 * The competitive read said to borrow Stripe's checklist logic in the house
 * idiom — "Card on file — · Billing contact set · VAT number —" — and to let
 * the provider's own flow do the collecting. That is what this register is: a
 * standing of four facts at the top, then the rows behind them.
 *
 * THIRD PASS, 2026-09-03 — THE PROVIDER IS BUILT (ADR 0110)
 * --------------------------------------------------------
 * The second pass shipped a table, a module and three routes, and filed the
 * remainder as "one credential away" (profile.md §9 G10). That was not true.
 * Nothing in the repo spoke to Stripe, so `provider_ref` was a required field
 * no caller here could fill, and this register's Add form collected `brand`,
 * `last4` and `exp` BY HAND — meaning `STRIPE_SECRET_KEY` would have switched
 * on a form whose typed values became the register's content. One env var away
 * from a fabricated instrument.
 *
 * So the four typed fields are gone. They are not disabled, they are DELETED,
 * because they described a way of creating a payment method that no longer
 * exists: the card is collected by Stripe's own iframes against a SetupIntent
 * (`StripeCardPanel`), and what comes back is a reference only Stripe can mint.
 *
 * THE THREE SENTENCES THIS REGISTER EXISTS TO SEPARATE
 * ---------------------------------------------------
 *     "You have not added a card yet."
 *     "No provider is connected, so no card can exist."
 *     "A provider is connected and has never told us anything."
 *
 * The first two were the second pass's achievement, and they come from the
 * server's `provider.connected`. The third is new and is the one that costs
 * real money: a webhook secret being SET is not a webhook working, and if the
 * endpoint was never registered at Stripe, everything looks healthy until a
 * card is removed there and this page goes on showing it forever. So the
 * provider row prints when a signed delivery last arrived, and never is never.
 *
 * WHAT IS STILL NOT HERE, PER §6: plan MANAGEMENT and any charge. The plan is
 * shown because the restaurant is on one and it already decides something real;
 * changing it is a restaurant decision with a price behind it (OD-23,
 * founder-deferred). The gateway's Stripe client throws before it can build a
 * request to `payment_intents` or `charges` at all.
 */

import { useState } from 'react';
import { CreditCard, KeyRound, Landmark, RefreshCw, Webhook } from 'lucide-react';
import { EM, MONO, SANS, fmtDay, planLabel, roleLabel } from './pf-format';
import {
  Btn,
  Card,
  ConnectionRow,
  Field,
  Note,
  Rail,
  Register,
  RetryLink,
  StatusLine,
} from './pf-ui';
import { StripeCardPanel } from './StripeCardPanel';
import type { PaymentMethodVM, ProfileNextData } from './useProfileNextData';

const KIND_LABEL: Record<PaymentMethodVM['kind'], string> = {
  card: 'Card',
  bank_account: 'Bank account (ACH)',
  apple_pay: 'Apple Pay',
  invoice: 'Invoice terms',
  // Reached when the provider hands back a type our four kinds do not span.
  // The row then prints the provider's own word beside this, rather than being
  // filed as a card it is not.
  other: 'Instrument',
};

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

/** One credential, named, with present/absent stated rather than implied. */
function Secret({
  name,
  present,
  where,
  unlocks,
}: {
  name: string;
  present: boolean;
  where: string;
  unlocks: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0' }}>
      <KeyRound
        size={12}
        aria-hidden
        style={{ marginTop: 2, color: present ? 'var(--seal-deep)' : 'var(--ink-3)', flex: 'none' }}
      />
      <div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: 'var(--ink-1)',
          }}
        >
          {name}
        </span>
        <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)' }}>
          {' '}
          — {present ? 'set' : 'NOT set'} ({where}). {unlocks}
        </span>
      </div>
    </div>
  );
}

export function PaymentRegister({ data }: { data: ProfileNextData }) {
  const [addOpen, setAddOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [rowMsg, setRowMsg] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

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
  const publishable = data.stripePublishableKey;
  const methods = data.paymentMethods;

  /** Everything the browser needs before a card can actually be typed. */
  const canCollect = providerConnected && publishable !== null && data.isManagerOrOwner;

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

  const reconcile = async () => {
    setSyncMsg(null);
    setSyncing(true);
    try {
      const out = await data.syncPayments();
      setSyncMsg({
        tone: 'done',
        text:
          out.note ??
          `Reconciled against the provider. ${out.kept} instrument(s) on file, ${out.removed} dropped.`,
      });
    } catch (e) {
      setSyncMsg({
        tone: 'error',
        text: `Not reconciled — ${String((e as Error).message)}. The rows below are whatever was last recorded, not what the provider holds now.`,
      });
    } finally {
      setSyncing(false);
    }
  };

  const act = async (fn: Promise<unknown>, done: string) => {
    setRowMsg(null);
    try {
      await fn;
      setRowMsg({ tone: 'done', text: done });
    } catch (e) {
      setRowMsg({ tone: 'error', text: `Nothing changed — ${String((e as Error).message)}` });
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
  const standingProvider =
    data.paymentsState !== 'ok' || !provider
      ? EM
      : provider.connected
        ? `Stripe · ${provider.mode ?? 'unknown'} mode`
        : EM;

  return (
    <Register
      eyebrow="Register V"
      icon={<CreditCard size={13} aria-hidden />}
      title="How the house pays"
      lead={
        <Note>
          Four facts, then the rows behind them. This belongs to the restaurant, not to
          you: an instrument added here charges the house, and only its managers and
          owners may add one.
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
        <Standing label="Provider" value={standingProvider} />
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

      {/* ── the provider itself, as a row like any other attachment ────── */}
      <Rail
        title="The provider"
        icon={<Webhook size={12} aria-hidden />}
        lead="Three secrets in two processes. Each is named, and a secret that is set is not the same as a seam that works."
      >
        {data.paymentsState === 'error' && (
          <StatusLine tone="error">
            The provider did not report its state ({data.paymentsError}), so nothing below
            is claimed about it. <RetryLink onClick={data.refetchPayments} />
          </StatusLine>
        )}

        {data.paymentsState === 'ok' && provider && (
          <ConnectionRow
            title="Stripe"
            subtitle={
              provider.connected ? (
                <>
                  {provider.mode === 'live' ? 'Live key' : null}
                  {provider.mode === 'test' ? 'Test key' : null}
                  {provider.mode === 'unknown' || provider.mode === null
                    ? 'A key is set whose prefix names no mode'
                    : null}
                  {' · API '}
                  <span style={{ fontFamily: MONO }}>{provider.apiVersion}</span>
                  {' · last delivery '}
                  <span style={{ fontFamily: MONO }}>
                    {provider.webhookLastReceivedAt
                      ? fmtDay(provider.webhookLastReceivedAt)
                      : EM}
                  </span>
                </>
              ) : (
                'No credential, so nothing can be taken, stored or charged.'
              )
            }
            state={provider.connected ? 'connected' : 'unprovisioned'}
            reason={
              provider.connected
                ? (provider.webhookReason ?? undefined)
                : provider.reason
            }
            controls={
              provider.connected && data.isManagerOrOwner ? (
                <Btn onClick={() => void reconcile()} disabled={syncing}>
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <RefreshCw size={11} aria-hidden />
                    {syncing ? 'Reconciling…' : 'Reconcile now'}
                  </span>
                </Btn>
              ) : undefined
            }
            detail={
              <div>
                <Secret
                  name="STRIPE_SECRET_KEY"
                  present={provider.secretKeyPresent}
                  where="gateway"
                  unlocks="Mints the SetupIntent and reads the instruments back."
                />
                <Secret
                  name="STRIPE_WEBHOOK_SECRET"
                  present={provider.webhookSecretPresent}
                  where="gateway"
                  unlocks="Authenticates Stripe's own account of what changed. Without it every delivery is refused, and this register only changes when someone is looking at it."
                />
                <Secret
                  name="VITE_STRIPE_PUBLISHABLE_KEY"
                  present={publishable !== null}
                  where="web bundle, at build time"
                  unlocks="Lets the card fields render on Stripe's origin. The gateway cannot see this one — it is baked into the bundle — so this page reports it itself."
                />
                <Note>
                  {provider.webhookLastReceivedAt
                    ? `The most recent signed delivery was ${provider.webhookLastEventType ?? 'an event'} on ${fmtDay(provider.webhookLastReceivedAt)}.`
                    : 'No signed delivery has ever been authenticated by this deployment. Until one is, an instrument removed at Stripe would go on being shown here.'}
                </Note>
              </div>
            }
            detailOpen={providerOpen}
            onToggleDetail={() => setProviderOpen((v) => !v)}
            detailLabel="Show the three secrets"
          />
        )}
        {syncMsg && <StatusLine tone={syncMsg.tone}>{syncMsg.text}</StatusLine>}
      </Rail>

      <Rail
        title="Payment methods"
        icon={<Landmark size={12} aria-hidden />}
        lead="Cards, bank debits and whatever else the provider holds for this restaurant. Each row is Stripe's answer, with the moment we last heard it."
      >
        {data.paymentsState === 'loading' && <Note>Reading the payment register…</Note>}

        {data.paymentsState === 'error' && (
          <StatusLine tone="error">
            The payment register could not be read ({data.paymentsError}). Nothing below is
            claimed — this is an unread register, not an empty one.{' '}
            <RetryLink onClick={data.refetchPayments} />
          </StatusLine>
        )}

        {methods.map((m) => (
          <ConnectionRow
            key={m.id}
            title={`${KIND_LABEL[m.kind]}${m.brand ? ` · ${m.brand}` : ''}${
              m.kind === 'other' && m.providerType ? ` · ${m.providerType}` : ''
            }`}
            subtitle={
              <>
                {m.last4 ? `•••• ${m.last4}` : EM} · expires {m.exp ?? EM} · added{' '}
                {fmtDay(m.createdAt)}
                {m.isDefault ? ' · charged first' : ''}
                {m.livemode === false ? ' · test instrument' : ''}
              </>
            }
            state="connected"
            reason={
              m.syncedAt
                ? `Confirmed against the provider on ${fmtDay(m.syncedAt)}. Every field above except the reference is a copy of Stripe's answer at that moment.`
                : 'Never confirmed against the provider since it was written. Reconcile to check it is still there.'
            }
            controls={
              data.isManagerOrOwner ? (
                <>
                  {!m.isDefault && providerConnected && (
                    <Btn
                      onClick={() =>
                        void act(
                          data.setDefaultPaymentMethod(m.id),
                          'The provider now charges this instrument first.',
                        )
                      }
                    >
                      Charge this first
                    </Btn>
                  )}
                  <Btn
                    onClick={() =>
                      void act(
                        data.removePaymentMethod(m.id),
                        providerConnected
                          ? 'Detached at the provider, then removed here.'
                          : 'Removed from the register.',
                      )
                    }
                  >
                    Remove
                  </Btn>
                </>
              ) : undefined
            }
          />
        ))}
        {rowMsg && <StatusLine tone={rowMsg.tone}>{rowMsg.text}</StatusLine>}

        {data.paymentsState === 'ok' && methods.length === 0 && (
          <ConnectionRow
            title="No payment method on file"
            subtitle="Nothing can be charged to this restaurant."
            // NOT `unbuilt`. That chip reads "Not built" and belongs to the
            // four Security rows, which have no code behind them at all. This
            // register has a table, a module, a provider client and six working
            // routes; what is missing is a credential.
            state={providerConnected ? 'available' : 'unprovisioned'}
            reason={
              providerConnected
                ? 'A provider is connected, so one can be added — the card is typed into Stripe’s own fields and this page never sees the number.'
                : 'This register is not empty because nobody has added a card, and it is not unbuilt — the table, the module, the Stripe client and the webhook all exist and answer. It is empty because no payment provider credential is configured on this deployment, so no instrument could exist to list.'
            }
          />
        )}

        <div style={{ marginTop: 10 }}>
          {addOpen && canCollect && publishable ? (
            <StripeCardPanel
              data={data}
              publishableKey={publishable}
              onClose={() => setAddOpen(false)}
            />
          ) : addOpen ? (
            <Card
              title="Add a card"
              lead="This is the panel, exactly where the card fields will be. They are Stripe’s iframes and they need a key this deployment does not have."
            >
              <div
                aria-hidden
                style={{
                  border: '1px dashed var(--paper-2)',
                  borderRadius: 8,
                  padding: '22px 14px',
                  textAlign: 'center',
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                }}
              >
                Stripe card fields
              </div>
              <div style={{ marginTop: 12 }}>
                <Btn emphasis="seal" disabled>
                  Hold to put this card on file
                </Btn>
              </div>
              <Note id="pf-pay-disabled-reason">
                {!providerConnected
                  ? 'Stripe is not connected — STRIPE_SECRET_KEY is not set on the gateway, so no SetupIntent can be minted and this stores nothing.'
                  : publishable === null
                    ? 'VITE_STRIPE_PUBLISHABLE_KEY is not set in this web bundle, so Stripe’s card fields cannot be rendered. The gateway is ready; the browser is not.'
                    : `Managers and owners add payment methods, and the server refuses the write for anyone else. Your role here is ${roleLabel(data.role)}.`}
              </Note>
              <Note>
                There are no fields to type into here on purpose. A card is created by
                confirming a SetupIntent against Stripe’s own iframes; a brand and four
                digits typed by hand would be a row that looks chargeable and is not.
              </Note>
              <div style={{ marginTop: 12 }}>
                <Btn onClick={() => setAddOpen(false)}>Cancel</Btn>
              </div>
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
              ? 'Read from the restaurant record. Changing it is a restaurant decision with a price behind it, not a control on a personal profile — and this product cannot create a charge at all: the gateway’s Stripe client throws before it can call payment_intents or charges (ADR 0110).'
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
