/**
 * `/connections` — what acts for this house.
 *
 * THE FOUNDER'S DECISION, 2026-09-03, VERBATIM
 * -------------------------------------------
 * Asked where the house-scoped connections belong, the founder chose
 * **"Own route, role-gated"**. Three of `/profile`'s seven registers were about
 * the house and not the person, and one of them was the house's cards on file
 * on a page every member reaches. Four further calls the same day shaped this
 * page and are each visible on it:
 *
 *   1. "House declares, each person consents."  — Register I
 *   2. "Per-tool grant plus the seal on every write."  — Register I, tool rows
 *   3. The house gets its own mailbox, or a Mudavym subdomain.  — Register I
 *   4. "A manager may SEE, not approve, what a member has personally
 *      connected", and may cut the HOUSE off from it while the person keeps
 *      their own grant.  — Register III
 *
 * The research is `.planning/06-pages/DESIGN-FOUNDATION.md` §6b (ten products,
 * a placement rule, a 28-item checklist); the surface is sketch 097; the
 * decision is ADR 0114.
 *
 * THE ONE STRUCTURAL IDEA
 * -----------------------
 * ONE row component draws every attachment, with four columns and no fifth:
 * whose it is · what it may do · what it last did · how to stop it. A row that
 * cannot be stopped here names who can (`stopNote` is a required prop). A live
 * POS feed and an unconnected Excel grant get the same amount of design, so
 * the page cannot flatter an empty attachment by drawing it richer than its
 * evidence — and there is no control on it that can appear to succeed.
 *
 * HONESTY, WHERE IT BITES HARDEST
 * -------------------------------
 * The ledger sentence at the top is the most dangerous thing on this page:
 * "Nothing here can spend money today" is enormously reassuring and would be a
 * lie if any register behind it had failed to load. So every count is `null`
 * when its register is unread, the sentence says so in words, and each register
 * that could not be read is NAMED with the gateway's own sentence
 * (ADR 0020 / ADR 0051).
 *
 * Two measured corrections to the sketch, both kept:
 *   - There is no public page for a HOUSE. `vendor_portal_pages` is keyed by
 *     `vendor_catalogue_id` / `provider_id` (20260805155901_vendor_portal.sql:
 *     27-33) — it is a page a VENDOR publishes, not one this restaurant has.
 *     The row says that rather than drawing a page that does not exist.
 *   - The POS bridge has no disconnect endpoint of any kind
 *     (`pos-hub.controller.ts:55-305` has no delete route), so its control is
 *     disabled and names what actually stops the feed.
 *
 * THE COLLAPSE, 2026-09-04 (founder: "Move the registers and collapse the four
 * tabs")
 * ------------------------------------------------------------------------
 * ADR 0114's own justification was a surface count that FELL; until this pass
 * it had risen. Three things changed on this page, and nothing else:
 *
 *   1. Register anchors. `/settings`'s `services`, `pos`, `email` and
 *      `calendar` tabs became one line pointing here, so their `?tab=` deep
 *      links now redirect to `/connections#grants|#till|#sender|#feed` and
 *      this page honours the fragment — see `REGISTER_ANCHORS`.
 *   2. `HouseServerControls`. Declare and revoke arrived from `/profile`,
 *      because both are `assertCanManageRestaurant` acts and a move that left
 *      them behind would have deleted them.
 *   3. Three stopNotes that said "on /profile" were corrected. Two now say
 *      "on this page"; the third — adding or removing a card — said that
 *      nothing could do it today, because the Stripe Elements panel did not
 *      travel. That was a real subtraction, filed as §9 G-C9 rather than
 *      papered over with a link to a page that no longer carried it.
 *
 * THE PANEL ARRIVED, 2026-09-05 (founder: "port the card panel to /connections
 * now")
 * ------------------------------------------------------------------------
 * G-C9 is closed. `components/mudavym/StripeCardPanel.tsx` is the SAME
 * component `/profile` renders — it was moved out of that page's directory and
 * its two bindings cut, rather than copied here. Register II therefore owns the
 * whole payment story: add, prefer, remove, and the provider's own state.
 *
 * All three payment acts are sealed since 2026-09-05. Preferring and removing an
 * instrument each spend a one-time token (`paymentSeal`); adding one spends a
 * `create` token minted by the panel's FIRST hold, which `POST
 * /billing/setup-intent` redeems before it asks the provider for anything and
 * `POST /billing/sync` proves back off the intent. G-PAY-SETUP in `profile.md`
 * §9 is closed.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CreditCard,
  Cpu,
  Globe,
  KeyRound,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Network,
  ShieldCheck,
  Smartphone,
  Store,
} from 'lucide-react';
import { ensureFraunces } from './fonts';
import {
  useConnectionsNextData,
  type McpAnnotationsVM,
  type McpServerVM,
  type McpToolGrantVM,
  type ProviderStateVM,
} from './useConnectionsNextData';
import {
  AttachmentRow,
  LoadingRegister,
  UnreadRegister,
  type RowChip,
  type RowPermission,
} from './AttachmentRow';
import { grantHolds, wouldAskFor } from './cx-permissions';
import { HouseServerControls } from './HouseServerControls';
import { DistributorFeedPanel } from './DistributorFeedPanel';
import { StripeCardPanel } from '../../../components/mudavym/StripeCardPanel';
import {
  DASH,
  count,
  expiry,
  feedUrl,
  onDate,
  personName,
  probeWord,
  readError,
  shortUrl,
  spelled,
  spelledLower,
  when,
} from './cx-format';
import './connections-next.css';

const ICON = { width: 15, height: 15, strokeWidth: 1.8 } as const;

export interface ConnectionsNextProps {
  /** Both grounds ship (ADR 0042); the page owns `data-ground`, not the gate. */
  ground?: 'charcoal';
}

/**
 * The anchors a `/settings?tab=…` deep link lands on (the collapse,
 * 2026-09-04).
 *
 * Four `/settings` tabs became one line pointing here, and every bookmark and
 * in-product link to those four still has to land somewhere true — so each
 * redirects to `/connections#<anchor>` and this page honours the fragment.
 * `settings/next/st-format.ts` holds the mapping; the ids are declared here
 * because the element that carries one is here, and a fragment nothing on the
 * page answers to is a link that silently does nothing.
 */
export const REGISTER_ANCHORS = [
  'attached',
  'till',
  'sender',
  'feed',
  'servers',
  'payment',
  'grants',
  'deployment',
] as const;

export default function ConnectionsNext({ ground }: ConnectionsNextProps) {
  const d = useConnectionsNextData();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureFraunces();
  }, []);

  /**
   * Bring the fragment's register into view once its register has answered.
   *
   * Depends on the four register reads rather than on mount alone: a `#payment`
   * arriving while the payment register is still loading would scroll to a
   * skeleton and then be left behind when the real rows pushed the page down.
   * `scrollIntoView` is guarded because jsdom does not implement it, and the
   * behaviour is `auto` when the reader has asked for less motion.
   */
  const hash = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  const anchorReady =
    !d.pos.loading && !d.payments.loading && !d.mcp.loading && !d.houseGrants.loading;
  useEffect(() => {
    if (!hash || !anchorReady) return;
    if (!(REGISTER_ANCHORS as readonly string[]).includes(hash)) return;
    const el = document.getElementById(hash);
    if (!el?.scrollIntoView) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [hash, anchorReady]);

  const feed = feedUrl(d.ical.data?.token);

  /* ── Register II's add-a-card affordance ──────────────────────────────
   *
   * Three facts decide it, and each is a different sentence when it is false:
   * the gateway's credential, this bundle's credential, and whether anything is
   * on file yet. The ROLE is not one of them — this page returns the refusal
   * above for anyone who is not a manager or an owner, so a "your role is…"
   * reason would describe a reader who cannot be looking at it.
   */
  const [addOpen, setAddOpen] = useState(false);
  const methods = d.payments.data?.methods ?? [];
  const providerConnected = d.payments.data?.provider.connected === true;
  // `?? null` because a caller that never set the member and a deployment whose
  // bundle has no key are the same fact to this page, and `undefined !== null`
  // would quietly make the first one look keyed.
  const publishable: string | null = d.stripePublishableKey ?? null;
  const canAddCard = providerConnected && publishable !== null;

  /**
   * Why the card fields cannot open, or null when they can.
   *
   * The gateway's own sentence is preferred over ours whenever it sent one:
   * `provider.reason` is what `POST /billing/setup-intent` would answer 503
   * with, so the disabled control and the refused request say the same thing.
   */
  const addCardReason: string | null = !providerConnected
    ? (d.payments.data?.provider.reason ??
        'No payment provider credential is configured on this deployment, so no SetupIntent can be minted and nothing could be stored.')
    : publishable === null
      ? 'VITE_STRIPE_PUBLISHABLE_KEY is not set in this web bundle, so Stripe’s own card fields cannot be rendered. The gateway is ready; the browser is not.'
      : null;

  /**
   * What the gateway said about the last attempt on THIS instrument.
   *
   * Keyed by the mutation's own `variables`, so a refusal is reported on the
   * row it was refused for and on no other. A single page-level banner would
   * put "nothing was changed" under a row that was never touched, which is the
   * same class of lie as reporting absence as health — just pointed the other
   * way.
   */
  const paymentAlert = (methodId: string): string | null => {
    if (
      d.setDefaultPayment.isError &&
      d.setDefaultPayment.variables?.methodId === methodId
    ) {
      return readError(d.setDefaultPayment.error);
    }
    if (d.removePayment.isError && d.removePayment.variables?.methodId === methodId) {
      return readError(d.removePayment.error);
    }
    return null;
  };

  /**
   * The opening sentence, assembled from measurements rather than written.
   *
   * Every clause is dropped — not softened — when the register behind it could
   * not be read. A sentence with a hole in it is honest; a sentence with a
   * confident zero in it is not.
   */
  const ledger = useMemo(() => {
    const t = d.tally;
    const parts: string[] = [];
    if (t.house !== null) {
      parts.push(
        `${spelled(t.house)} thing${t.house === 1 ? '' : 's'} the house has attached`,
      );
    }
    if (t.persons !== null && t.persons > 0) {
      parts.push(
        `${spelledLower(t.persons)} belonging to people who work here`,
      );
    }
    return parts;
  }, [d.tally]);

  if (!d.isManager) {
    return (
      <div className="mudavym cx" data-ground={ground}>
        <div className="cx-refused" role="status">
          <h1>This page is for managers and owners.</h1>
          <p>
            What acts for this house — the till, the payment provider, the
            address its letters leave from, the model-context servers — is a
            manager&rsquo;s register, and your account is recorded as{' '}
            <strong>{d.role ?? 'a member'}</strong> here.
          </p>
          <p>
            This is not only a hidden page: the two registers that would matter
            most are refused at the server for your role as well, so nothing
            about them reaches this browser.{' '}
            <a href="/profile">Your own profile</a> holds what is attached to
            you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mudavym cx" data-ground={ground}>
      <div className="cx-wrap">
        <div className="cx-eyebrow">Mudavym</div>
        <h1 className="cx-title">
          Connections<span className="cx-dot">.</span>
        </h1>
        <p className="cx-lede">What acts for this house.</p>
        <div className="cx-rule" />

        {/* ══ THE LEDGER SENTENCE ═══════════════════════════════════════ */}
        <div className="cx-ledger">
          <p className="cx-ledger-line">
            {ledger.length ? (
              <>
                {ledger.join(', ')}.{' '}
                {d.tally.canSpend === null ? (
                  <>
                    <b>Whether anything here can spend is unknown</b> — the
                    payment register did not answer.
                  </>
                ) : d.tally.canSpend === 0 ? (
                  <>
                    <b>Nothing here can spend money today.</b>
                  </>
                ) : (
                  <>
                    <b>
                      {spelled(d.tally.canSpend)} can spend the house&rsquo;s
                      money.
                    </b>
                  </>
                )}{' '}
                {d.tally.mayCallATool === null ? (
                  <>The model-context register did not answer, so what may call a tool is unknown.</>
                ) : d.tally.mayCallATool === 0 ? (
                  <>
                    <b>None may call a tool.</b>
                  </>
                ) : (
                  <>
                    <b>
                      {spelled(d.tally.mayCallATool)} tool
                      {d.tally.mayCallATool === 1 ? ' is' : 's are'} granted
                    </b>
                    , {spelledLower(d.tally.mayWrite)} of them able to change
                    something outside this app.
                  </>
                )}
              </>
            ) : (
              <>
                <b>This ledger could not be counted.</b> The registers below say
                which of them answered and which did not — an unread register is
                not an empty one.
              </>
            )}
          </p>
          <p className="cx-ledger-note">
            Every row below says whose it is, what it may do, what it last did,
            and how to stop it. A row you cannot stop from here says who can.
            Nothing is listed twice, and nothing that acts is missing — a
            connection with no row is a defect, not a feature.
          </p>
          <div className="cx-tally">
            <Tally n={d.tally.house} k="the house's own" />
            <Tally n={d.tally.persons} k="a person's" />
            <Tally n={d.tally.publicToAnyone} k="public to anyone" />
            <Tally n={d.tally.canSpend} k="can spend today" seal />
            <Tally n={d.tally.mayCallATool} k="may call a tool" seal />
            <Tally n={d.tally.mayWrite} k="may write outside" seal />
            <Tally n={d.tally.houseHasLetGoOf} k="the house let go of" />
          </div>
        </div>

        {/* ══ REGISTER I ════════════════════════════════════════════════ */}
        <section className="cx-sec" id="attached">
          <div className="cx-sec-h">
            <span className="cx-sec-n">Register I</span>
            <h2>What the house has attached</h2>
          </div>
          <p className="cx-sec-d">
            Attachments this restaurant is answerable for. They belong to the
            house and survive the person who connected them — deleting an
            account nulls the name on the row and leaves the attachment standing
            (ADR 0114).
          </p>
          <p className="cx-sec-k">
            kept for this restaurant · managers and owners may change · read by
            everyone who works here
          </p>

          {/* — the till — (`/settings?tab=pos` lands here) */}
          <span id="till" aria-hidden />
          {d.pos.loading ? (
            <LoadingRegister name="the till" />
          ) : d.pos.error ? (
            <UnreadRegister
              name="The point-of-sale bridge"
              detail={d.pos.error}
              refused={d.pos.refused}
            />
          ) : (
            <AttachmentRow
              icon={<Store {...ICON} />}
              title="Point of sale"
              owner="the house's"
              chips={posChips(d.pos.data)}
              subtitle={`webhook → /api/v1/pos-hub/webhook/<provider>/${d.restaurantId ?? DASH}`}
              why={
                <>
                  The till pushes closed checks here. It is the only attachment
                  that <em>writes into the ledger without being asked</em>, and
                  everything on /dashboard is downstream of it.
                </>
              }
              permissions={[
                { text: 'Send closed checks, voids and comps', can: true },
                { text: 'Send the menu and its prices', can: true },
                { text: 'May not read our inventory', can: false },
                { text: 'May not place an order', can: false },
              ]}
              lastLabel="Last 30 days"
              last={
                d.pos.data?.unavailable
                  ? null
                  : `${count(d.pos.data?.totalChecks ?? null)} checks`
              }
              lastDetail={
                d.pos.data?.unavailable ? (
                  <>
                    The check table could not be read, so this is silence rather
                    than zero.
                  </>
                ) : (
                  posSources(d.pos.data)
                )
              }
              controls={[{ label: 'Disconnect', disabled: true }]}
              stopNote="No disconnect endpoint exists. The feed stops when the provider's webhook secret is removed from this deployment."
            />
          )}

          {/* — the payment provider — */}
          {d.provider.loading ? (
            <LoadingRegister name="the payment provider" />
          ) : d.provider.error ? (
            <UnreadRegister
              name="The payment provider"
              detail={d.provider.error}
              refused={d.provider.refused}
            />
          ) : (
            <AttachmentRow
              icon={<CreditCard {...ICON} />}
              title="Payment provider"
              owner="the house's"
              chips={[
                d.provider.data?.connected
                  ? { label: d.provider.data.mode ?? 'Connected', tone: 'on' as const }
                  : { label: 'Key missing', tone: 'warn' as const },
              ]}
              subtitle={secretList(d.provider.data, publishable)}
              why={
                <>
                  Everything except the credential exists: SetupIntent, Elements
                  on Stripe&rsquo;s own origin, detach, reconcile and a signed
                  webhook.{' '}
                  {d.provider.data?.connected ? null : (
                    <>
                      Until the secrets are set, <em>no instrument can be
                      recorded</em> — which is why the register below is empty
                      for a stated reason rather than because nobody added a
                      card.
                    </>
                  )}
                </>
              }
              permissionsLabel={d.provider.data?.connected ? 'May do' : 'Will do, once keyed'}
              permissions={[
                { text: 'Hold a card for this restaurant', can: true },
                { text: 'Detach one at the provider', can: true },
                { text: 'May not charge — pricing is undecided', can: false },
              ]}
              lastLabel="Last signed delivery"
              last={
                d.provider.data?.webhookLastReceivedAt
                  ? when(d.provider.data.webhookLastReceivedAt)
                  : null
              }
              lastDetail={
                d.provider.data?.webhookReason ??
                'No signed delivery has ever been authenticated here. That is not the same as healthy.'
              }
              controls={[
                { label: 'Connect', disabled: !d.provider.data?.connected },
              ]}
              stopNote={
                d.provider.data?.reason ??
                'The provider did not say which secrets it holds.'
              }
            />
          )}

          {/* — the sender identity — (`/settings?tab=email` lands here) */}
          <span id="sender" aria-hidden />
          {d.sender.loading ? (
            <LoadingRegister name="the sender identity" />
          ) : d.sender.error ? (
            <UnreadRegister
              name="The sender identity"
              detail={d.sender.error}
              refused={d.sender.refused}
            />
          ) : (
            <AttachmentRow
              icon={<Mail {...ICON} />}
              title="Sender identity"
              owner="the deployment's"
              chips={[{ label: 'Shared, not yours', tone: 'warn' }]}
              subtitle={`${d.sender.data?.address ?? DASH} · ${d.sender.data?.configuredBy ?? DASH}`}
              why={
                <>
                  Every vendor letter this house sends leaves from{' '}
                  <em>one mailbox the whole deployment shares</em>. The sign-off
                  inside the letter carries this house&rsquo;s name; the
                  envelope does not. A vendor who replies is replying to a
                  mailbox other restaurants also send from.
                </>
              }
              permissions={[
                { text: "Send mail signed with this house's name", can: true },
                { text: "Receive the vendor's reply", can: true },
                { text: 'Cannot be changed by this house', can: false },
              ]}
              lastLabel="Resolved from"
              last={
                d.sender.data?.resolvedFromProfile
                  ? "the mailbox's own profile"
                  : 'the deployment variable'
              }
              lastDetail="No per-letter send record is kept against this address, so what it last sent is not on this row."
              controls={[{ label: 'Use our own address', disabled: true }]}
              stopNote={
                d.sender.data?.perHouse.reason ??
                'No per-restaurant sender exists yet.'
              }
            />
          )}

          {/* — the house's text senders — (ADR 0121; the founder's line of
              2026-09-05: the house sends in its OWN name, through its own
              WhatsApp Business number or its own registered SMS sender, and a
              person's phone is never the sender)

              TWO ROWS, NOT ONE. WhatsApp and SMS are different products with
              different registrars, different fees and — in Türkiye — different
              CAPABILITIES: an alphanumeric SMS sender there cannot receive a
              reply at all. One row would have to average that away. */}
          <span id="text" aria-hidden />
          {d.textSenders.loading ? (
            <LoadingRegister name="the text senders" />
          ) : d.textSenders.error ? (
            <UnreadRegister
              name="The text senders"
              detail={d.textSenders.error}
              refused={d.textSenders.refused}
            />
          ) : (
            <>
              <TextSenderRow channel="whatsapp" vm={d.textSenders.data} />
              <TextSenderRow channel="sms" vm={d.textSenders.data} />
            </>
          )}

          {/* — the calendar feed — (`/settings?tab=calendar` lands here) */}
          <span id="feed" aria-hidden />
          {d.ical.loading ? (
            <LoadingRegister name="the calendar feed" />
          ) : d.ical.error ? (
            <UnreadRegister
              name="The calendar feed"
              detail={d.ical.error}
              refused={d.ical.refused}
            />
          ) : (
            <AttachmentRow
              icon={<CalendarDays {...ICON} />}
              title="Calendar feed"
              owner="public to anyone with the link"
              chips={[{ label: feed ? 'Published' : 'Not published', tone: feed ? 'on' : 'off' }]}
              subtitle={feed ?? DASH}
              why={
                <>
                  A read-only iCal address. It is{' '}
                  <em>unauthenticated by design</em> so Outlook and Apple
                  Calendar can subscribe — which means anyone holding the URL
                  reads this house&rsquo;s deliveries, deadlines and shifts.
                </>
              }
              permissionsLabel="Grants"
              permissions={[
                { text: 'Read every calendar event', can: true },
                { text: 'Cannot write, cannot see prices', can: false },
              ]}
              lastLabel="Last fetched"
              last={null}
              lastDetail="Feed fetches are not recorded, so who has subscribed and when they last read is unknown."
              controls={[
                {
                  label: copied ? 'Copied' : 'Copy address',
                  disabled: !feed,
                  onClick: () => {
                    if (!feed) return;
                    void navigator.clipboard?.writeText(feed);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  },
                },
                {
                  // No seal ring on this any more (audit, 2026-09-04). It is a
                  // consequential click and it was wearing the seal's colour
                  // for emphasis, which made the seal mean "this matters" on
                  // one row and "this was proven" on another. Its weight is
                  // carried by `stopNote` below, in words.
                  label: 'Regenerate',
                  busy: d.regenerateFeed.isPending,
                  onClick: () => d.regenerateFeed.mutate(),
                },
              ]}
              stopNote="Regenerating revokes every subscription at once, and nothing here can tell you how many that is."
            />
          )}

          {/* — the public page that does not exist — */}
          <AttachmentRow
            icon={<Globe {...ICON} />}
            title="Public page for this house"
            owner="nobody's"
            chips={[{ label: 'None exists', tone: 'off' }]}
            subtitle="vendor_portal_pages — keyed by vendor_catalogue_id / provider_id"
            why={
              <>
                The public catalogue page in this product belongs to a{' '}
                <em>vendor</em>, not to a restaurant: its table has no
                restaurant column at all. This house therefore publishes
                nothing, and the row is here so that fact is stated rather than
                left to be assumed either way.
              </>
            }
            permissionsLabel="Would show"
            permissions={[{ text: 'Nothing — there is no such page', can: false }]}
            lastLabel="Last published"
            last={null}
            lastDetail="No page has ever existed for a restaurant."
            controls={[{ label: 'Publish a page', disabled: true }]}
            stopNote="Nothing to stop. Building this would need a restaurant-scoped page table and a route; neither exists."
          />

          {/* — model-context servers — (`/profile`'s Register IV lands here) */}
          <span id="servers" aria-hidden />
          {d.mcp.loading ? (
            <LoadingRegister name="the model-context register" />
          ) : d.mcp.error ? (
            <UnreadRegister
              name="The model-context register"
              detail={d.mcp.error}
              refused={d.mcp.refused}
            />
          ) : (
            <>
              <AttachmentRow
                icon={<Network {...ICON} />}
                title={`Model-context servers · ${count(d.mcp.data?.length ?? 0)} declared`}
                owner="the house's"
                chips={mcpChips(d.mcp.data)}
                subtitle={
                  d.mcpRuntime.data
                    ? `invocation ${d.mcpRuntime.data.invocation.enabled ? 'on' : 'off'} · secrets ${d.mcpRuntime.data.secretStorage.configured ? 'stored' : 'unavailable'}`
                    : 'the deployment did not report what it can do with one'
                }
                why={
                  <>
                    Servers this house has declared. The house declares them and{' '}
                    <em>each person consents</em> to being acted for; a tool is
                    granted one at a time, by name, and anything that changes
                    the world outside this app runs only behind the seal.
                  </>
                }
                permissionsLabel="Each row carries"
                permissions={[
                  { text: 'URL, scopes, encrypted secret', can: true },
                  { text: 'The tools it advertises', can: true },
                  { text: 'Which of them are granted', can: true },
                ]}
                lastLabel="Granted tools"
                last={
                  d.tally.mayCallATool === null
                    ? null
                    : `${count(d.tally.mayCallATool)} of ${count(
                        (d.mcp.data ?? []).reduce(
                          (n, s) => n + (s.probe?.toolCount ?? 0),
                          0,
                        ),
                      )} listed`
                }
                lastDetail={
                  d.mcpRuntime.data?.invocation.reason ??
                  'The deployment did not say whether a tool may be called.'
                }
                controls={[]}
                stopNote="Declaring one and revoking one are below, on this page. Both are refused by the gateway for anyone who is not a manager or an owner."
              />

              {/* THE COLLAPSE, 2026-09-04. Declare and revoke arrived here when
                  `/profile` lost this register: both are gated by
                  `assertCanManageRestaurant` at the gateway, so both are the
                  house's, and a move that left them behind would have deleted
                  them. See `HouseServerControls`. */}
              <HouseServerControls
                servers={d.mcp.data ?? []}
                runtime={d.mcpRuntime.data ?? null}
                canManage={d.isManager}
                onChanged={d.refetchMcp}
              />

              {(d.mcp.data ?? []).map((s) => (
                <AttachmentRow
                  key={s.id}
                  nested
                  icon={<Cpu {...ICON} />}
                  title={s.name}
                  owner={
                    s.declaredBy
                      ? `declared by ${personName(s.declaredByName)}`
                      : 'declared by an account since deleted'
                  }
                  chips={serverChips(s)}
                  subtitle={shortUrl(s.url)}
                  why={
                    <>
                      {s.probe?.detail ??
                        'This server has never been called, so nothing is claimed about it either way.'}{' '}
                      {s.consent.given ? (
                        <>
                          You have consented to it acting in your name;{' '}
                          <em>{count(s.consent.liveCount)}</em>{' '}
                          {s.consent.liveCount === 1 ? 'person has' : 'people have'}{' '}
                          in total.
                        </>
                      ) : (
                        <>
                          <em>You have not consented</em> to it acting in your
                          name, so it will not run a tool for you.
                        </>
                      )}
                      {/* One line per suspended grant, naming the tool and what
                          the server changed. The gate refuses these calls right
                          now, and a row that showed only a chip would leave the
                          manager guessing which tool and why. */}
                      {s.toolGrants
                        .filter((g) => g.needsReconsentAt)
                        .map((g) => (
                          <span key={g.toolName} className="cx-reconsent">
                            Needs re-consent — {g.toolName}:{' '}
                            {g.needsReconsentReason ??
                              'its declaration changed and the change was not recorded.'}
                          </span>
                        ))}
                    </>
                  }
                  permissionsLabel="Tools it lists · what it may do"
                  permissions={toolLines(s)}
                  lastLabel="Last answered"
                  last={s.lastUsedAt ? when(s.lastUsedAt) : null}
                  lastDetail={
                    <>
                      {probeWord(s.probe?.status)}
                      {s.lastProbeAt ? ` · called ${when(s.lastProbeAt)}` : null}
                    </>
                  }
                  controls={[
                    {
                      label: s.consent.given ? 'Withdraw consent' : 'Consent',
                      busy: d.setConsent.isPending,
                      onClick: () =>
                        d.setConsent.mutate({ id: s.id, given: !s.consent.given }),
                    },
                    {
                      label: 'Check again',
                      busy: d.probeServer.isPending,
                      onClick: () => d.probeServer.mutate(s.id),
                    },
                    // A HOLD, not a click (audit, 2026-09-04). The first build
                    // was a plain button whose handler sent `sealed: true` —
                    // the client asserting the ceremony it was supposed to be
                    // performing, in the same request that asked for the
                    // change. Now the gesture requests a one-time seal from the
                    // gateway when it BEGINS, and the grant carries that token
                    // back to be redeemed exactly once. Releasing early sends
                    // nothing; a seal that cannot be issued approves nothing.
                    //
                    // It re-grants against the declaration the server offers
                    // NOW, which is why the label carries the classification
                    // the manager is agreeing to rather than the old one.
                    ...s.toolGrants
                      .filter((g) => g.needsReconsentAt)
                      .map((g) => {
                        const nowWrites = declaredWrites(s, g.toolName);
                        return {
                          label: `Re-consent ${g.toolName} as a ${nowWrites ? 'write' : 'read'}`,
                          wrap: true,
                          busy: d.grantTool.isPending,
                          hold: {
                            onChallenge: () =>
                              d.grantSeal({
                                id: s.id,
                                tool: g.toolName,
                                writes: nowWrites,
                              }),
                            onApprove: (challenge?: string | null) =>
                              d.grantTool.mutate({
                                id: s.id,
                                tool: g.toolName,
                                writes: nowWrites,
                                challenge: challenge ?? undefined,
                              }),
                          },
                        };
                      }),
                  ]}
                  stopNote={
                    s.status === 'revoked'
                      ? 'Revoked. It is kept so the register can show what was once trusted.'
                      : 'Withdrawing your consent stops it acting as you and touches nobody else. Revoking the attachment itself is a manager act, and it is on this page, above.'
                  }
                />
              ))}
            </>
          )}
        </section>

        {/*
          Licensed distributors (ADR 0126, batch 56).

          NOT a fifth register, deliberately. The four registers answer "what
          acts for this house"; this answers "what your distributors will send
          you", and every row on it is something that CANNOT be attached —
          which would make "Register V" a register of nothing. It sits after
          Register I because the two ways in are both things the house does,
          and before Register II because neither costs money.
        */}
        <DistributorFeedPanel
          distributors={d.distributors}
          letter={d.feedLetter}
          upload={d.uploadDistributorFile}
          priceCodes={d.priceCodes}
          declareCode={d.declarePriceCode}
          withdrawCode={d.withdrawPriceCode}
          canManage={d.isManager}
          sessionName={d.sessionName}
        />

        {/* ══ REGISTER II ═══════════════════════════════════════════════ */}
        <section className="cx-sec" id="payment">
          <div className="cx-sec-h">
            <span className="cx-sec-n">Register II</span>
            <h2>What the house pays with</h2>
          </div>
          <p className="cx-sec-d">
            Instruments on file for this restaurant. Every field is a copy of
            the provider&rsquo;s answer — the provider stays the system of
            record.
          </p>
          <p className="cx-sec-k">
            kept for this restaurant · managers and owners may read and change ·
            the read is role-gated at the server · every change is held, and the
            seal is redeemed once
          </p>

          {d.payments.loading ? (
            <LoadingRegister name="the payment register" />
          ) : d.payments.error ? (
            <UnreadRegister
              name="The payment register"
              detail={d.payments.error}
              refused={d.payments.refused}
            />
          ) : (d.payments.data?.methods.length ?? 0) === 0 ? (
            <AttachmentRow
              icon={<CreditCard {...ICON} />}
              title="No payment method on file"
              owner="the house's"
              chips={[
                d.payments.data?.provider.connected
                  ? { label: 'None added', tone: 'off' }
                  : { label: 'Provider not connected', tone: 'warn' },
              ]}
              subtitle="payment_methods — 0 rows"
              why={
                d.payments.data?.provider.connected ? (
                  <>Nobody has added one. The provider is connected, so one could be.</>
                ) : (
                  <>
                    Not &ldquo;you have no cards&rdquo;.{' '}
                    <em>No card could exist</em> — the provider has never been
                    keyed, so the create path refuses with the same sentence
                    this row carries.
                  </>
                )
              }
              permissionsLabel="Will hold"
              permissions={[
                { text: 'Brand, last four, printable expiry', can: true },
                { text: "The provider's own reference", can: true },
                { text: 'Never a card number, CVC or address', can: false },
              ]}
              lastLabel="Last reconciled"
              last={null}
              lastDetail="Nothing has ever been synced."
              // THE PANEL ARRIVED, 2026-09-05. Until this pass the control was
              // disabled unconditionally, because the Stripe Elements panel had
              // stayed on `/profile`. It is now the shared
              // `components/mudavym/StripeCardPanel`, opened below this
              // register. What still disables the control is a missing
              // credential — and the stop note prints WHICH one, in the
              // gateway's own words wherever the gateway sent them.
              controls={[
                {
                  label: 'Add a card',
                  disabled: !canAddCard,
                  onClick: () => setAddOpen(true),
                },
              ]}
              stopNote={
                addCardReason ??
                'A provider is connected and this bundle holds the publishable key, so the card fields open below this register. The number is typed into Stripe’s own iframes and never reaches this page.'
              }
            />
          ) : (
            (d.payments.data?.methods ?? []).map((m) => (
              <AttachmentRow
                key={m.id}
                icon={<CreditCard {...ICON} />}
                title={`${m.brand ?? DASH} ending ${m.last4 ?? DASH}`}
                owner="the house's"
                chips={m.isDefault ? [{ label: 'Charged first', tone: 'on' }] : []}
                subtitle={`expires ${expiry(m.expMonth, m.expYear)}`}
                why={
                  <>
                    An instrument on file for this restaurant. It is the
                    provider&rsquo;s record; what is stored here is a reference
                    and four digits, <em>never a card number</em>.
                  </>
                }
                permissions={[
                  { text: 'Be charged for this restaurant', can: true },
                  { text: 'Cannot be charged today — pricing is undecided', can: false },
                ]}
                lastLabel="Last reconciled"
                last={null}
                lastDetail="The register records no reconcile timestamp per instrument."
                // BOTH ACTS ARE HELD, NOT CLICKED (founder, 2026-09-04; ADR
                // 0110's addendum). The gateway redeems a one-time seal on each
                // of these writes, so a button here would not be a lighter
                // ceremony — it would be a control that always fails. The
                // gesture mints the seal for its own act when it BEGINS, and
                // the write carries the token back to be spent exactly once.
                //
                // "Charge this first" appears only while a provider is
                // connected: preferring an instrument is a fact about the
                // Stripe customer, and there is no customer to state it to
                // otherwise. Removal is offered either way, because a row can
                // outlive the credential that created it.
                controls={[
                  ...(m.isDefault || !d.payments.data?.provider.connected
                    ? []
                    : [
                        {
                          label: 'Charge this first',
                          busy: d.setDefaultPayment.isPending,
                          hold: {
                            onChallenge: () =>
                              d.paymentSeal({ act: 'set_default' as const, methodId: m.id }),
                            onApprove: (challenge?: string | null) =>
                              d.setDefaultPayment.mutate({ methodId: m.id, challenge }),
                          },
                        },
                      ]),
                  {
                    label: 'Remove',
                    busy: d.removePayment.isPending,
                    hold: {
                      onChallenge: () =>
                        d.paymentSeal({ act: 'remove' as const, methodId: m.id }),
                      onApprove: (challenge?: string | null) =>
                        d.removePayment.mutate({ methodId: m.id, challenge }),
                    },
                  },
                ]}
                alert={paymentAlert(m.id)}
                stopNote="Removal detaches the instrument at the provider first, then drops the row here — dropping the row alone would leave a live card the next reconcile faithfully restores. Adding one is below this register, in the provider’s own card fields."
              />
            ))
          )}

          {/* ── ADDING ONE ──────────────────────────────────────────────
              The panel is the same component `/profile` mounts, so there is one
              card form in the product and not two that drift.

              WHERE THE BUTTON IS. Exactly one place at a time: in the empty
              row's control column when nothing is on file — the four columns
              are that row's whole subject — and here once instruments exist,
              where an action bar under a list belongs. Two buttons offering the
              same act would make a reader wonder which one is the real one.

              WHEN IT CANNOT OPEN. The control is disabled and the reason is the
              gateway's own sentence (`addCardReason`) — never an empty box, and
              never a form to type a brand and four digits into by hand: a row
              typed by a person looks chargeable and is not. On THIS deployment
              `STRIPE_SECRET_KEY` is unset, so that is the state you will see. */}
          {!d.payments.loading && !d.payments.error && (
            <div className="cx-add">
              {addOpen && canAddCard && publishable ? (
                <StripeCardPanel
                  client={d}
                  publishableKey={publishable}
                  onClose={() => setAddOpen(false)}
                />
              ) : methods.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="cx-btn is-seal"
                    disabled={!canAddCard}
                    onClick={() => setAddOpen(true)}
                  >
                    Add a card
                  </button>
                  <p className="cx-ctl-note">
                    {addCardReason ??
                      'The card fields are Stripe’s own iframes, served from Stripe’s origin. The number never reaches this page or our servers.'}
                  </p>
                </>
              ) : null}
            </div>
          )}
        </section>

        {/* ══ REGISTER III ══════════════════════════════════════════════ */}
        <section className="cx-sec" id="grants">
          <div className="cx-sec-h">
            <span className="cx-sec-n">Register III</span>
            <h2>Personal grants that act inside this house</h2>
          </div>
          <p className="cx-sec-d">
            These belong to a person, not to this restaurant. They are listed
            here because they act here. A manager may <em>see</em> them and may
            stop the house using one — never approve one, and never take
            somebody&rsquo;s own credential away.
          </p>
          <p className="cx-sec-k">
            kept on a person&rsquo;s account · the house may let go of one ·
            only its owner can revoke it
          </p>

          {d.houseGrants.loading ? (
            <LoadingRegister name="the personal grants" />
          ) : d.houseGrants.error ? (
            <UnreadRegister
              name="The personal grants recorded against this house"
              detail={d.houseGrants.error}
              refused={d.houseGrants.refused}
            />
          ) : (
            <>
              {(d.houseGrants.data?.grants ?? []).map((g) => (
                <AttachmentRow
                  key={g.connectionId}
                  icon={<Link2 {...ICON} />}
                  title={`${g.label} · ${g.account ?? DASH}`}
                  owner={`${personName(g.ownerName)}'s`}
                  chips={[
                    g.houseAccess.revoked
                      ? { label: 'House let go', tone: 'off' }
                      : { label: 'Connected', tone: 'on' },
                  ]}
                  subtitle={`${g.scopes.join(' · ') || DASH} — connected ${onDate(g.connectedAt)}`}
                  why={
                    <>
                      This house&rsquo;s work is written into{' '}
                      <em>{personName(g.ownerName)}&rsquo;s own account</em>, not
                      into a folder the restaurant owns. If they leave, the
                      files leave with them.
                      {g.houseAccess.revoked ? (
                        <>
                          {' '}
                          The house stopped using it{' '}
                          {when(g.houseAccess.at)}
                          {g.houseAccess.byName
                            ? `, ${g.houseAccess.byName}'s decision`
                            : null}
                          {g.houseAccess.reason ? `: ${g.houseAccess.reason}` : '.'}
                        </>
                      ) : null}
                    </>
                  }
                  permissionsLabel="Holds"
                  permissions={grantHolds(
                    g.scopes,
                    (d.catalog.data ?? []).find((c) => c.id === g.integrationId) ?? null,
                  )}
                  lastLabel="Token expires"
                  last={g.tokenExpiresAt ? when(g.tokenExpiresAt) : null}
                  lastDetail="No per-use record is kept, so what this grant last did is not knowable from here."
                  controls={[
                    {
                      label: g.houseAccess.revoked
                        ? 'Use it again'
                        : 'Stop the house using it',
                      busy: d.setHouseGrantAccess.isPending,
                      onClick: () =>
                        d.setHouseGrantAccess.mutate({
                          connectionId: g.connectionId,
                          houseUses: g.houseAccess.revoked,
                        }),
                    },
                  ]}
                  stopNote={`Only ${personName(g.ownerName)} can revoke the grant itself, from their own profile. This button stops the house asking for a token — the credential stays theirs.`}
                />
              ))}

              {/*
                THE HOUSE'S OWN MAIL ARCHIVE (ADR 0118 D16; the founder's answer
                to question 1, 2026-09-05: "As built, owner's name printed").
                It sits inside this section rather than beside it because the
                archive IS one of these personal grants doing a house job — and
                the whole point of printing it here is that the house can see
                WHOSE Drive its ten-year record is in.

                Every sentence comes from the gateway. The page does not compose
                `keptIn`, because that sentence has to separate a name that was
                read, an account that records none, and a read that FAILED, and
                only the server can tell those apart. A blank is the one output
                that is never produced.
              */}
              {d.mailArchive.loading ? (
                <LoadingRegister name="the house's mail archive" />
              ) : d.mailArchive.error ? (
                <UnreadRegister
                  name="This house's own copy of its vendor mail"
                  detail={d.mailArchive.error}
                  refused={d.mailArchive.refused}
                />
              ) : d.mailArchive.data ? (
                <AttachmentRow
                  icon={<Link2 {...ICON} />}
                  title="The house's own copy of its vendor mail"
                  owner={
                    d.mailArchive.data.owner.name
                      ? `${d.mailArchive.data.owner.name}'s`
                      : "nobody this page can name"
                  }
                  chips={[
                    d.mailArchive.data.armed
                      ? { label: 'Exporting', tone: 'on' }
                      : d.mailArchive.data.chosen
                        ? { label: 'Chosen, not running', tone: 'off' }
                        : { label: 'Never asked', tone: 'off' },
                  ]}
                  subtitle={d.mailArchive.data.owner.keptIn}
                  why={
                    <>
                      {d.mailArchive.data.says}
                      {d.mailArchive.data.owner.unreadableBecause ? (
                        <> {d.mailArchive.data.owner.unreadableBecause}</>
                      ) : null}
                    </>
                  }
                  permissionsLabel="Writes"
                  permissions={
                    d.mailArchive.data.driveFolderPath
                      ? [
                          {
                            text: `One file per vendor reply into ${d.mailArchive.data.driveFolderPath}`,
                            can: true,
                          },
                          {
                            text: 'Reads back what it wrote, to check the copy arrived whole',
                            can: true,
                          },
                          {
                            text: 'Reads, changes or deletes anything else in that Drive',
                            can: false,
                          },
                        ]
                      : [
                          {
                            text: 'Nothing — no folder is armed, so nothing is written out',
                            can: false,
                          },
                        ]
                  }
                  lastLabel="Chosen"
                  last={null}
                  lastDetail="Choosing an archive and running an export are both sealed acts. The nightly export carries no seal of its own and records none."
                  stopNote={
                    d.mailArchive.data.armed
                      ? "Files already written are the restaurant's own. Disconnecting the grant does not delete them, and neither does anything else here — Mudavym can write them and can never read, change or delete them afterwards."
                      : 'Nothing is being written out, so there is nothing to stop.'
                  }
                />
              ) : null}

              {(d.houseGrants.data?.unattributed ?? 0) > 0 ? (
                <div className="cx-callout">
                  <b>
                    {count(d.houseGrants.data?.unattributed ?? 0)} live grant
                    {(d.houseGrants.data?.unattributed ?? 0) === 1 ? '' : 's'}{' '}
                    belonging to people who work here carry no recorded
                    restaurant.
                  </b>{' '}
                  They were made before a tenant reached the token, so they are
                  on nobody&rsquo;s house page and they still work. Counted here
                  rather than dropped, because a list that quietly omits them is
                  incomplete in exactly the way this page exists to prevent.
                </div>
              ) : null}

              {/* The catalogue — the SAME route the other three surfaces read. */}
              {(d.catalog.data ?? [])
                .filter(
                  (c) =>
                    !(d.houseGrants.data?.grants ?? []).some(
                      (g) => g.integrationId === c.id,
                    ),
                )
                .map((c) => (
                  <AttachmentRow
                    key={c.id}
                    icon={<Smartphone {...ICON} />}
                    title={c.label}
                    owner="would be a person's"
                    chips={[{ label: 'Not connected', tone: 'off' }]}
                    subtitle={c.providerLabel}
                    why={
                      <>
                        {c.description} Drawn at the same weight as the live rows
                        above on purpose —{' '}
                        <em>
                          an attachment nobody has made must not look smaller
                          than one they have
                        </em>
                        , or the page starts flattering itself.
                      </>
                    }
                    permissionsLabel="Would ask for"
                    permissions={wouldAskFor(c)}
                    lastLabel="Last action"
                    last={null}
                    lastDetail="Never connected by anyone here."
                    controls={[{ label: 'Connect yours', disabled: !c.available }]}
                    stopNote={
                      c.available
                        ? 'Connecting happens on your own profile: the grant would be yours, not the house’s.'
                        : (c.unavailableReason ??
                          'This deployment cannot offer it, and did not say why.')
                    }
                  />
                ))}
            </>
          )}
        </section>

        {/* ══ REGISTER IV ═══════════════════════════════════════════════ */}
        <section className="cx-sec" id="deployment">
          <div className="cx-sec-h">
            <span className="cx-sec-n">Register IV</span>
            <h2>Set once for every house on this deployment</h2>
          </div>
          <p className="cx-sec-d">
            Keys nobody in this restaurant can change, listed because they act
            here anyway. A page that shows only what a house controls is not a
            list of what acts on its behalf.
          </p>
          <p className="cx-sec-k">
            kept in the deployment&rsquo;s environment · read-only here · no
            value is ever shown
          </p>

          <AttachmentRow
            icon={<ShieldCheck {...ICON} />}
            title="Token encryption"
            owner="the deployment's"
            chips={[
              d.mcpRuntime.data
                ? d.mcpRuntime.data.secretStorage.configured
                  ? { label: 'Configured', tone: 'on' }
                  : { label: 'Not configured', tone: 'warn' }
                : { label: 'Did not report', tone: 'off' },
            ]}
            subtitle="INTEGRATION_TOKEN_ENCRYPTION_KEY · MCP_CONNECTION_SECRET_KEY"
            why={
              <>
                Two keys, not one. The first encrypts Google and Microsoft
                refresh tokens; the second encrypts model-context secrets.{' '}
                <em>
                  Without either, the connections it protects are disabled rather
                  than stored in the clear
                </em>{' '}
                — the failure is a refusal, never a quiet downgrade.
              </>
            }
            permissionsLabel="Protects"
            permissions={[
              { text: 'Refresh tokens at rest', can: true },
              { text: 'Per-server model-context secrets', can: true },
            ]}
            lastLabel="Last rotated"
            last={null}
            lastDetail="No rotation has ever been recorded — there is no column for one."
            controls={[{ label: 'Rotate', disabled: true }]}
            stopNote={
              d.mcpRuntime.data?.secretStorage.reason ??
              'A deployment setting. Changing it is an operator action, not a page.'
            }
          />

          <AttachmentRow
            icon={<KeyRound {...ICON} />}
            title="Model provider"
            owner="the deployment's"
            chips={[{ label: 'Not reported', tone: 'off' }]}
            subtitle="ANTHROPIC_API_KEY"
            why={
              <>
                The engine behind every drafted vendor letter, every extracted
                invoice line and every insight sentence.{' '}
                <em>It reads this house&rsquo;s data to write them.</em> No
                endpoint reports its state, so this row names it and claims
                nothing about it.
              </>
            }
            permissionsLabel="Sees"
            permissions={[
              { text: 'Order and invoice text, catalogue rows', can: true },
              { text: 'No card, no password, no token', can: false },
            ]}
            lastLabel="Last used"
            last={null}
            lastDetail="Nothing here reports model calls, so this is unknown rather than zero."
            controls={[{ label: 'Change', disabled: true }]}
            stopNote="A deployment setting, and one no route on this gateway exposes."
          />
        </section>

        <div className="cx-foot">
          <p>
            <b>Everything on this page is drawn by one row component.</b> A live
            POS feed and an unconnected grant get the same amount of design —
            what separates them is the chip, whether the control is live, and the
            sentence under it. The page therefore cannot flatter an empty
            attachment by drawing it richer than its evidence, and there is no
            control on it that can appear to succeed.
          </p>
          <p>
            <b>Four things on every row, and no fifth.</b> Whose it is, what it
            may do, what it last did, and how to stop it. A row that cannot be
            stopped from here names who can. An unknown is an em dash — never a
            zero, and never a blank a save could write back.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── small pieces ──────────────────────────────────────────────────────── */

/**
 * One channel's text sender: what this house has, and what it would take.
 *
 * THE ROW IS DRAWN AT FULL WEIGHT WHETHER OR NOT A SENDER EXISTS, which is this
 * page's one structural idea applied to the newest attachment: a live POS feed
 * and an unconnected sender get the same amount of design, so the page cannot
 * flatter an absence by drawing it thinner.
 *
 * NO CONTROL HERE CAN APPEAR TO SUCCEED. Both buttons are disabled, and each
 * carries the server's own reason rather than a sentence this file invented —
 * `transport.built` is false for every house on this deployment, because no
 * provider credential for a per-house sender exists.
 */
/**
 * The state, in the manager's language rather than the column's.
 *
 * "Waiting on a registrar" and "asked for, not sent yet" are the two a manager
 * acts on differently — the first is somebody else's queue and the second is
 * ours — so they are two sentences and not one word with an underscore in it.
 */
const STATE_WORDS: Record<
  'requested' | 'submitted' | 'in_review' | 'connected' | 'rejected' | 'revoked',
  string
> = {
  requested: 'Asked for, not submitted',
  submitted: 'Submitted',
  in_review: 'Waiting on the registrar',
  connected: 'Connected',
  rejected: 'Rejected',
  revoked: 'Stopped',
};

function TextSenderRow({
  channel,
  vm,
}: {
  channel: 'whatsapp' | 'sms';
  vm: import('./useConnectionsNextData').TextSendersVM | null;
}) {
  const definition =
    channel === 'whatsapp'
      ? vm?.catalogue?.whatsapp_business ?? null
      : vm?.catalogue?.sms_sender ?? null;
  const sender = channel === 'whatsapp' ? vm?.senders.whatsapp ?? null : vm?.senders.sms ?? null;
  const readable = vm?.readable ?? false;

  /**
   * SIX STATES AND AN UNREAD ONE, KEPT APART. "Not connected" and "we could not
   * read whether it is connected" are different facts, and folding them would
   * tell a manager the second is the first (ADR 0051 clause 3).
   */
  const chips: RowChip[] = !readable
    ? [{ label: 'Could not be read', tone: 'warn' }]
    : !sender
      ? [{ label: 'None', tone: 'off' }]
      : sender.state === 'connected'
        ? [{ label: 'Connected', tone: 'on' }]
        : sender.state === 'rejected'
          ? [{ label: 'Rejected', tone: 'warn' }]
          : [{ label: STATE_WORDS[sender.state], tone: 'off' }];

  const oneWayMarkets = (definition?.markets ?? [])
    .filter((m) => !m.twoWay)
    .map((m) => m.marketLabel);

  return (
    <AttachmentRow
      icon={channel === 'whatsapp' ? <MessageCircle {...ICON} /> : <MessageSquare {...ICON} />}
      title={definition?.label ?? (channel === 'whatsapp' ? 'WhatsApp Business' : 'SMS sender')}
      owner={sender ? "the house's" : "nobody's"}
      chips={chips}
      subtitle={
        sender
          ? `${sender.identity ?? 'no number issued yet'} · ${sender.market} · ${
              sender.path === 'bring_your_own'
                ? 'the house brought it'
                : 'Mudavym is registering it'
            }`
          : definition?.providerLabel ?? null
      }
      why={
        <>
          {definition?.description}{' '}
          {oneWayMarkets.length > 0 && (
            <>
              In <em>{oneWayMarkets.join(', ')}</em> this channel is one-way: a
              reply cannot come back, so it can carry a notice and never a
              conversation.
            </>
          )}
        </>
      }
      permissionsLabel={sender?.state === 'connected' ? 'May do' : 'Would do, once connected'}
      permissions={[
        { text: "Send in this house's own name, to people who consented", can: true },
        {
          text: 'Carry a reply back into this house’s book',
          can: channel === 'whatsapp',
        },
        {
          text: 'Send to anyone who has not agreed — never',
          can: false,
        },
      ]}
      lastLabel="Last proven reachable"
      last={sender?.lastProbeAt ? when(sender.lastProbeAt) : null}
      lastDetail={
        sender
          ? sender.lastProbeAt
            ? (sender.lastProbeResult ?? 'The probe did not say what it found.')
            : 'This sender has never been probed. That is not the same as unreachable, and it is not health.'
          : 'No sender has ever been recorded for this house on this channel.'
      }
      controls={[
        { label: 'Bring our own', disabled: true },
        { label: 'Ask Mudavym to register one', disabled: true },
      ]}
      stopNote={
        vm?.transport.words ??
        'The deployment did not say whether anything could be sent.'
      }
    />
  );
}

function Tally({ n, k, seal }: { n: number | null; k: string; seal?: boolean }) {
  return (
    <div>
      <span className={seal ? 'cx-tally-n is-seal' : 'cx-tally-n'}>
        {n === null ? DASH : count(n)}
      </span>
      <span className="cx-tally-k">{k}</span>
    </div>
  );
}

function posChips(
  pos: { unavailable: boolean; totalChecks: number | null } | null,
): RowChip[] {
  if (!pos) return [{ label: 'Did not report', tone: 'off' }];
  if (pos.unavailable) return [{ label: 'Could not be read', tone: 'warn' }];
  return (pos.totalChecks ?? 0) > 0
    ? [{ label: 'Sending', tone: 'on' }]
    : [{ label: 'Nothing in 30 days', tone: 'off' }];
}

function posSources(
  pos: {
    sources: Array<{ source: string; providerName?: string; checks?: number }> | null;
  } | null,
) {
  if (!pos?.sources?.length) return 'No source has sent a check in the window.';
  return pos.sources
    .map((s) => `${s.providerName ?? s.source}: ${count(s.checks ?? null)}`)
    .join(' · ');
}

/**
 * Which of the three secrets this deployment holds.
 *
 * Two are the gateway's own answer; the third is baked into THIS bundle and the
 * gateway cannot see it, so it is read from `import.meta.env` here — the same
 * split `/profile` makes, and for the same reason. A field the gateway did not
 * send is reported as unknown rather than as unset: "we were not told" and "it
 * is not set" are different facts about a credential.
 */
function secretList(p: ProviderStateVM | null, publishableKey: string | null): string {
  if (!p) return 'the provider did not report its state';
  const state = (v: boolean | undefined) =>
    v === undefined ? 'not reported' : v ? 'set' : 'unset';
  // Read through the hook (2026-09-05) rather than off `import.meta.env` twice.
  // The card panel decides whether it can open from the same value, and two
  // reads of one variable is how a page ends up printing "set" beside a control
  // disabled for being unset.
  const publishable = publishableKey ? 'set' : 'unset';
  return [
    `STRIPE_SECRET_KEY ${state(p.secretKeyPresent)}`,
    `STRIPE_WEBHOOK_SECRET ${state(p.webhookSecretPresent)}`,
    `VITE_STRIPE_PUBLISHABLE_KEY ${publishable}`,
  ].join(' · ');
}

function mcpChips(
  servers: Array<{ status: string; probe: { status: string } | null }> | null,
): RowChip[] {
  if (!servers?.length) return [{ label: 'None declared', tone: 'off' }];
  const answering = servers.filter((s) => s.probe?.status === 'ok').length;
  return [{ label: `${answering} answering`, tone: answering ? 'on' : 'warn' }];
}

/**
 * Every tool the server LISTS, with two facts a manager has to see together:
 * what the server declared about it, and what this house granted.
 *
 * They are printed on one line each because separating them is how the
 * dangerous case hides. "send_purchase_order — granted" is reassuring;
 * "send_purchase_order — the server declares it a write · granted as a write,
 * behind the seal" is the same row telling the truth. A tool the server lists
 * and nobody granted is shown as refused rather than omitted: a list of only
 * what is permitted cannot be read as a list of what exists.
 *
 * A server that has never answered a probe has no list, and this returns the
 * grants alone with that said in words — never an empty list, which would read
 * as "it offers nothing".
 */
function toolLines(s: McpServerVM): RowPermission[] {
  const grantOf = (name: string) =>
    s.toolGrants.find(
      (g) => g.toolName.trim().toLowerCase() === name.trim().toLowerCase(),
    ) ?? null;

  const grantWords = (g: McpToolGrantVM | null): string => {
    if (!g) return 'not granted';
    if (g.needsReconsentAt) return 'granted, SUSPENDED until re-consent';
    if (g.writes) {
      const how =
        g.classificationSource === 'manager_override'
          ? 'granted as a write by a manager overriding the server'
          : 'granted as a write, behind the seal';
      return `${how} · ${sealWords(g.lastSeal)}`;
    }
    return 'granted as a read';
  };

  if (!s.probe?.tools) {
    // No list to show. The grants are still real and are shown as themselves.
    return s.toolGrants.length
      ? s.toolGrants.map((g) => ({
          text: `${g.toolName} — the server has not listed its tools since this was granted · ${grantWords(g)}`,
          can: !g.needsReconsentAt,
        }))
      : [
          {
            text: 'The server has not answered with a tool list, so what it offers is unknown',
            can: false,
          },
        ];
  }

  return s.probe.tools.map((t) => {
    const g = grantOf(t.name);
    return {
      text: `${t.name} — ${declaredWords(t.annotations)} · ${grantWords(g)}`,
      // `can: false` renders it as something this attachment may NOT do, which
      // is exactly right for both "nobody granted it" and "it is suspended".
      can: Boolean(g) && !g?.needsReconsentAt,
    };
  });
}

/**
 * What the last seal on this tool was actually worth.
 *
 * "sealed" was true of both a redeemed one-time challenge and a boolean the
 * client set on itself, and printing the same word for both would let the
 * weaker one borrow the stronger one's credibility. A tool nobody has ever
 * sealed gets its own sentence rather than the reassuring half of the pair.
 */
function sealWords(last: 'proven' | 'asserted' | null): string {
  if (last === 'proven') return 'last seal: proven';
  if (last === 'asserted') return 'last seal: asserted, never checked';
  return 'never called behind a seal';
}

/** What the server said about one tool, in the server's own vocabulary. */
function declaredWords(a: McpAnnotationsVM | null): string {
  if (!a) return 'the server declares nothing about it, so it counts as a write';
  if (a.readOnlyHint === true) return 'the server declares it read-only';
  if (a.readOnlyHint === false) {
    return a.destructiveHint === false
      ? 'the server declares it changes things, additively'
      : 'the server declares it changes things';
  }
  return 'the server sent no readOnlyHint, so it counts as a write';
}

/**
 * What re-consenting to this tool would classify it as, from the CURRENT list.
 *
 * Deliberately the server's declaration and not the grant's old `writes`: the
 * point of a re-consent is to agree to what the server says now. A manager who
 * wants to tighten it further still can, on the grant control — this is the
 * one-click path back to the default, not a way to carry an old override
 * silently forward.
 */
function declaredWrites(s: McpServerVM, toolName: string): boolean {
  const t = s.probe?.tools?.find(
    (x) => x.name.trim().toLowerCase() === toolName.trim().toLowerCase(),
  );
  return t?.annotations?.readOnlyHint !== true;
}

function serverChips(s: {
  status: string;
  probe: { status: string } | null;
  consent: { given: boolean };
  toolGrants: Array<{ writes: boolean; needsReconsentAt: string | null }>;
}): RowChip[] {
  const chips: RowChip[] = [
    { label: probeWord(s.probe?.status), tone: s.probe?.status === 'ok' ? 'on' : 'off' },
  ];
  if (s.status === 'revoked') chips.push({ label: 'Revoked', tone: 'off' });
  if (s.toolGrants.some((g) => g.writes)) {
    chips.push({ label: 'Can write outside', tone: 'warn' });
  }
  const suspended = s.toolGrants.filter((g) => g.needsReconsentAt).length;
  if (suspended) {
    chips.push({
      label: `${suspended} need${suspended === 1 ? 's' : ''} re-consent`,
      tone: 'warn',
    });
  }
  if (!s.consent.given) chips.push({ label: 'No consent from you', tone: 'off' });
  return chips;
}
