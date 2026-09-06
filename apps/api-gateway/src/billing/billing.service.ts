import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BillingCustomerService } from "./billing-customer.service";
import { PaymentMethodMirrorService } from "./payment-method-mirror.service";
import { StripeClient, StripePaymentMethod } from "./stripe.client";
import { StripeConfigService } from "./stripe-config.service";
import {
  SIGNATURE_FAILURE_MESSAGE,
  verifyStripeSignature,
} from "./stripe-signature";
import type {
  SetupIntentResponse,
  SyncProvenance,
  SyncResponse,
  WebhookResponse,
} from "./dto/billing.dto";

/**
 * Stripe, as far as "a card on file" and not one step further.
 *
 * THREE THINGS THIS SERVICE DOES
 * ------------------------------
 *  1. `createSetupIntent` — permission to STORE an instrument. Not a payment.
 *     The client secret goes to the browser, Stripe.js collects the card on
 *     Stripe's own origin, and what comes back to us is a `pm_...` reference.
 *     No PAN ever reaches this process (PCI SAQ-A; ADR 0110 option 2.3).
 *  2. `sync` — reconcile the register against the provider's list, on demand.
 *     Called right after a confirmation so the row appears without waiting for
 *     a delivery, and callable at any time by a manager.
 *  3. `handleWebhook` — the same reconciliation, driven by the provider, so
 *     the register keeps up with changes nobody made from this product.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * Charge. `StripeClient` throws before building a request to `payment_intents`,
 * `charges`, `subscriptions`, `invoices`, `refunds`, `transfers` or `payouts`.
 * Pricing is OD-23 and open; the guard is the version of that promise that
 * outlives the ADR.
 *
 * IDEMPOTENCY, AND THE HALF OF IT PEOPLE GET WRONG
 * ------------------------------------------------
 * `billing_webhook_events` has the provider's event id as its PRIMARY KEY, so
 * a redelivery cannot re-apply an effect. The subtle half: a delivery that was
 * CLAIMED and then failed halfway must still be retryable, or a transient
 * database error would permanently swallow the event that tells us a card was
 * removed. So the claim row records `handled`, and a redelivery of an event
 * whose row says `handled = false` is PROCESSED rather than refused. Only a
 * completed event is idempotently ignored.
 */
/**
 * Every column the charge path reads, as a module-level `const` of literal
 * names, for `scripts/check_read_columns_exist.py` (a class static reads to
 * that guard as unreadable — see `seal-challenge.service.ts`).
 */
const PAYMENT_INSTRUMENT_COLUMNS =
  "id, restaurant_id, kind, brand, last4, provider, provider_ref, is_default, synced_at";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  /** Events this build acts on. Everything else is RECORDED as ignored. */
  static readonly HANDLED_EVENTS = [
    "setup_intent.succeeded",
    "payment_method.attached",
    "payment_method.updated",
    "payment_method.automatically_updated",
    "payment_method.detached",
  ];

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly config: StripeConfigService,
    private readonly stripe: StripeClient,
    private readonly customers: BillingCustomerService,
    private readonly mirror: PaymentMethodMirrorService,
  ) {}

  private assertConnected(): void {
    if (!this.config.connected()) {
      throw new ServiceUnavailableException(
        this.config.state().reason ??
          "No payment provider is connected in this deployment.",
      );
    }
  }

  /* ── 1. permission to store an instrument ───────────────────────────── */

  /**
   * @param sealId the seal the CONTROLLER already redeemed for this act. It is
   * stamped onto the intent so `POST /billing/sync` can prove, one request
   * later, that the instrument it is about to record was sealed by a person.
   * The redemption itself is not done here: this service does not know who is
   * calling, and a service that redeemed on its own would be a second opinion
   * about authority.
   */
  async createSetupIntent(
    restaurantId: string,
    sealId: string,
  ): Promise<SetupIntentResponse> {
    this.assertConnected();

    const customerId = await this.customers.ensure(restaurantId);
    const intent = await this.stripe.createSetupIntent({
      customerId,
      restaurantId,
      sealId,
    });

    if (!intent?.client_secret) {
      throw new InternalServerErrorException(
        "Stripe returned a SetupIntent with no client secret, so the card form cannot be opened. Nothing was stored.",
      );
    }

    return {
      setupIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      livemode: Boolean(intent.livemode),
      mode: this.config.mode(),
      apiVersion: this.config.apiVersion(),
    };
  }

  /* ── 2. reconcile on demand ─────────────────────────────────────────── */

  /**
   * The seal id this house stamped on that SetupIntent, read back from the
   * provider.
   *
   * WHY THE PROVIDER IS ASKED RATHER THAN THE BROWSER
   * ------------------------------------------------
   * The browser hands us a SetupIntent id and nothing else. If it also handed
   * us the seal id, the pairing would be the caller's own claim about itself —
   * the assertion model, one level down. Stripe holds the metadata we wrote
   * when the seal was redeemed, so asking Stripe is the only reading of "this
   * intent was minted against a seal" that the caller cannot author.
   *
   * The house is checked HERE and not by the caller, because an intent
   * belonging to another restaurant must be refused before its metadata is
   * treated as meaning anything at all.
   *
   * Returns null when the intent carries no seal id — an intent minted before
   * this addendum, or one created in the Stripe dashboard. Null is a refusal
   * the caller turns into the `absent` sentence; it is never read as "fine".
   */
  async sealOnSetupIntent(
    restaurantId: string,
    setupIntentId: string,
  ): Promise<string | null> {
    this.assertConnected();

    const intent = await this.stripe.retrieveSetupIntent(setupIntentId);
    const metadata = (intent?.metadata ?? {}) as Record<string, unknown>;

    const house =
      typeof metadata.mudavym_restaurant_id === "string"
        ? metadata.mudavym_restaurant_id
        : null;
    if (house !== restaurantId) {
      throw new ForbiddenException(
        "That card form was opened by a different restaurant, so nothing on it can be recorded here. Nothing was changed.",
      );
    }

    const sealId =
      typeof metadata.mudavym_seal_id === "string"
        ? metadata.mudavym_seal_id.trim()
        : "";
    return sealId.length > 0 ? sealId : null;
  }

  /**
   * @param provenance which check the CONTROLLER ran before calling. Carried
   * through into the response rather than derived here, so the answer names the
   * check that actually happened instead of the one this method assumes.
   */
  async sync(
    restaurantId: string,
    provenance: SyncProvenance,
  ): Promise<SyncResponse> {
    this.assertConnected();

    const customerId = await this.customers.find(restaurantId);
    if (!customerId) {
      // Not an error, and not silence either: a restaurant that has never
      // opened the card form has no provider account, so there is nothing to
      // reconcile AGAINST and the register is correctly empty.
      return {
        syncedAt: new Date().toISOString(),
        kept: 0,
        removed: 0,
        note: "This restaurant has no account at the provider yet, so there is nothing to reconcile. Adding a card opens one.",
        provenance,
      };
    }

    const methods = await this.stripe.listPaymentMethods(customerId);
    const syncedAt = new Date().toISOString();
    const { kept, removed } = await this.mirror.reconcile(
      restaurantId,
      methods,
      syncedAt,
    );

    return {
      syncedAt,
      kept,
      removed,
      note:
        removed > 0
          ? `${removed} instrument(s) were on file here and no longer exist at the provider; they have been dropped.`
          : null,
      provenance,
    };
  }

  /* ── 3. the provider's own account of what changed ──────────────────── */

  /**
   * @param rawBody the exact bytes Express received (`main.ts` sets `rawBody: true`)
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
  ): Promise<WebhookResponse> {
    const verdict = verifyStripeSignature(
      rawBody,
      signatureHeader,
      this.config.webhookSecret(),
    );

    if (!verdict.ok) {
      // The endpoint answers with WHICH check failed. It is a public URL and
      // the reasons are not secret — every one of them is a deployment fault,
      // not a hint about the key — and a bare "invalid signature" is the line
      // that costs an afternoon when the real cause is an unset env var.
      return {
        received: false,
        handled: false,
        reason: SIGNATURE_FAILURE_MESSAGE[verdict.reason],
        failure: verdict.reason,
      };
    }

    let event: {
      id?: string;
      type?: string;
      livemode?: boolean;
      data?: { object?: Record<string, unknown> };
    };
    try {
      event = JSON.parse((rawBody as Buffer).toString("utf8"));
    } catch {
      return {
        received: false,
        handled: false,
        reason:
          "The signature verified but the body was not JSON, which should be impossible; nothing was applied.",
        failure: "malformed-header",
      };
    }

    const eventId = String(event?.id ?? "").trim();
    const eventType = String(event?.type ?? "").trim();
    if (!eventId || !eventType) {
      return {
        received: false,
        handled: false,
        reason:
          "The signed payload carried no event id or no type, so it cannot be recorded exactly once and was not applied.",
        failure: "malformed-header",
      };
    }

    const claim = await this.claim(eventId, eventType, Boolean(event.livemode));
    if (claim === "already-handled") {
      return {
        received: true,
        handled: false,
        duplicate: true,
        reason: `Event ${eventId} was already applied. Redelivery is refused by the primary key on billing_webhook_events, not by a race-prone check.`,
      };
    }

    try {
      const outcome = await this.apply(eventType, event?.data?.object ?? {});
      await this.settle(
        eventId,
        outcome.handled,
        outcome.reason,
        outcome.restaurantId,
      );
      return {
        received: true,
        handled: outcome.handled,
        reason: outcome.reason,
      };
    } catch (error) {
      const message = (error as Error)?.message ?? "unknown failure";
      // Left `handled = false` on purpose, so Stripe's redelivery is PROCESSED
      // rather than swallowed as a duplicate.
      await this.settle(eventId, false, `failed: ${message}`, null);
      this.logger.error(`Webhook ${eventId} (${eventType}) failed: ${message}`);
      throw new InternalServerErrorException(
        `The delivery verified but could not be applied: ${message}. It is recorded as unhandled so a redelivery will be retried.`,
      );
    }
  }

  /**
   * Claim the event id. Returns `already-handled` only when a COMPLETED row
   * exists; a claimed-but-unfinished row is reclaimed so a failed delivery can
   * be retried.
   */
  private async claim(
    eventId: string,
    eventType: string,
    livemode: boolean,
  ): Promise<"claimed" | "already-handled"> {
    const { error } = await this.databaseService.supabase
      .from("billing_webhook_events")
      .insert({
        provider: "stripe",
        event_id: eventId,
        event_type: eventType,
        livemode,
        handled: false,
        outcome: "claimed — not yet applied",
      });

    if (!error) return "claimed";

    const { data: existing, error: readError } =
      await this.databaseService.supabase
        .from("billing_webhook_events")
        .select("handled")
        .eq("provider", "stripe")
        .eq("event_id", eventId)
        .maybeSingle();

    if (readError || !existing) {
      // The insert failed for a reason that is not "already there". Fail loudly
      // rather than applying an effect we cannot record — an unrecorded apply
      // is exactly the double-apply the table exists to stop.
      throw new InternalServerErrorException(
        `The delivery could not be recorded (${error.message}), so it was not applied.`,
      );
    }

    return (existing as Record<string, unknown>).handled === true
      ? "already-handled"
      : "claimed";
  }

  private async settle(
    eventId: string,
    handled: boolean,
    outcome: string,
    restaurantId: string | null,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("billing_webhook_events")
      // Explicit keys, not a conditional spread: check_order_capture_contract.py
      // reads column names from the literal, and supabase-js drops an undefined
      // value from the payload, so "only when known" keeps the same semantics.
      .update({
        handled,
        outcome,
        restaurant_id: restaurantId ?? undefined,
      })
      .eq("provider", "stripe")
      .eq("event_id", eventId);
    if (error) {
      this.logger.error(
        `Event ${eventId} was applied but its outcome was not recorded: ${error.message}`,
      );
    }
  }

  /**
   * Apply one event. Every branch returns a SENTENCE, including the branches
   * that do nothing — an event we ignored is recorded as ignored with its
   * reason, because a delivery log holding only the events we liked would
   * report absence as health.
   */
  private async apply(
    eventType: string,
    object: Record<string, unknown>,
  ): Promise<{
    handled: boolean;
    reason: string;
    restaurantId: string | null;
  }> {
    if (!BillingService.HANDLED_EVENTS.includes(eventType)) {
      return {
        handled: false,
        reason: `ignored: ${eventType} is not one of the ${BillingService.HANDLED_EVENTS.length} event types this build acts on`,
        restaurantId: null,
      };
    }

    if (eventType === "payment_method.detached") {
      // A detached instrument carries no customer any more, so the reference is
      // the only handle — which is why `UNIQUE (provider, provider_ref)` exists.
      const ref = String(object?.id ?? "");
      if (!ref) {
        return {
          handled: false,
          reason: "ignored: the detach event named no payment method",
          restaurantId: null,
        };
      }
      const removed = await this.mirror.removeByRef(ref);
      return {
        handled: removed > 0,
        reason:
          removed > 0
            ? `detached ${ref} and removed it from the register`
            : `ignored: ${ref} was not on file here, so nothing was removed`,
        restaurantId: null,
      };
    }

    const customerId =
      typeof object?.customer === "string"
        ? object.customer
        : typeof (object?.customer as Record<string, unknown>)?.id === "string"
          ? String((object.customer as Record<string, unknown>).id)
          : null;

    if (!customerId) {
      return {
        handled: false,
        reason: `ignored: ${eventType} named no customer, so no restaurant could own it`,
        restaurantId: null,
      };
    }

    const restaurantId = await this.customers.restaurantFor(customerId);
    if (!restaurantId) {
      return {
        handled: false,
        reason: `ignored: no restaurant is linked to customer ${customerId} in this deployment`,
        restaurantId: null,
      };
    }

    const paymentMethodId =
      eventType === "setup_intent.succeeded"
        ? typeof object?.payment_method === "string"
          ? object.payment_method
          : null
        : String(object?.id ?? "") || null;

    if (!paymentMethodId) {
      return {
        handled: false,
        reason: `ignored: ${eventType} named no payment method to record`,
        restaurantId,
      };
    }

    // Re-fetch rather than trusting the event's embedded object. The event may
    // be minutes old by the time a retry lands, and the register's whole claim
    // is that its rows are the provider's CURRENT answer with a timestamp.
    const pm: StripePaymentMethod =
      eventType === "setup_intent.succeeded"
        ? await this.stripe.retrievePaymentMethod(paymentMethodId)
        : (object as unknown as StripePaymentMethod);

    await this.mirror.upsertOne(restaurantId, pm);

    return {
      handled: true,
      reason: `recorded ${pm.id} (${pm.type}) on restaurant ${restaurantId}`,
      restaurantId,
    };
  }
  /* ── 4. taking money, in exactly one place ──────────────────────────── */

  /**
   * Charge this house's card on file for message credits.
   *
   * THE FOUNDER'S DECISION THIS IMPLEMENTS (Q2, 2026-09-05, ADR 0121 addendum):
   * *"Wire it to the card on file, sealed."* The purchase route redeems a seal,
   * calls this, and writes the credit row ONLY if this succeeds. A refused
   * charge writes nothing and says why. Rejected: leaving it unwired.
   *
   * IT DOES NOT REDEEM THE SEAL AND IT DOES NOT WRITE THE LEDGER. This service
   * does not know who is calling — the same reason `createSetupIntent` takes a
   * `sealId` it did not mint. Authority is the controller's; the ledger is the
   * caller's; taking the money is this method's, and nothing else's.
   *
   * FIVE OUTCOMES, NOT TWO. "This house has no card" and "we could not read
   * whether it has one" are different facts, and a caller that could not tell
   * them apart would tell a manager to add a card during a database outage.
   */
  async chargeForMessageCredits(input: {
    restaurantId: string;
    amountMinor: number;
    currency: string;
    sealId: string;
  }): Promise<
    | {
        charged: true;
        paymentIntentId: string;
        status: string | null;
        words: string;
      }
    | {
        charged: false;
        reason:
          | "provider_not_connected"
          | "no_customer"
          | "no_instrument"
          | "read_failed"
          | "refused_by_provider";
        words: string;
      }
  > {
    if (!this.config.connected()) {
      return {
        charged: false,
        reason: "provider_not_connected",
        words: `No payment provider is connected in this deployment, so nothing was charged and no credits were added: ${
          this.config.state().reason ?? "STRIPE_SECRET_KEY is not set."
        }`,
      };
    }

    const customerId = await this.customers.find(input.restaurantId);
    if (!customerId) {
      return {
        charged: false,
        reason: "no_customer",
        words:
          "This house has no billing account with the payment provider yet, so nothing was charged and no credits were added. Adding a card on file creates one.",
      };
    }

    const instrument = await this.instrumentToCharge(input.restaurantId);
    if (instrument.state === "read_failed") {
      return {
        charged: false,
        reason: "read_failed",
        words: `This house's payment methods could not be read, so nothing was charged and no credits were added: ${instrument.reason}. That is not the same as this house having no card.`,
      };
    }
    if (!instrument.providerRef) {
      return {
        charged: false,
        reason: "no_instrument",
        words:
          "This house has no card on file, so nothing was charged and no credits were added. Add one on the profile's payment register first.",
      };
    }

    try {
      const intent = await this.stripe.chargeCardOnFile({
        customerId,
        paymentMethodId: instrument.providerRef,
        amountMinor: input.amountMinor,
        currency: input.currency,
        restaurantId: input.restaurantId,
        sealId: input.sealId,
        // IDEMPOTENT ON THE SEAL. A retry after a crash between this call and
        // the ledger write returns Stripe's ORIGINAL intent rather than making
        // a second one, and `uq_house_message_credits_purchase_seal` stops the
        // second row even if this key were bypassed.
        idempotencyKey: `text-credits:${input.sealId}`,
        description: "Mudavym message credits",
      });

      const status = intent.status ?? null;
      // `succeeded` is the only status that means the money moved. Stripe can
      // answer 200 with `requires_action` (an authentication the operator is
      // not present for) or `requires_payment_method` (the card declined at
      // confirmation), and reading the HTTP code alone would file either as a
      // payment.
      if (status !== "succeeded") {
        return {
          charged: false,
          reason: "refused_by_provider",
          words: `The payment did not complete (${status ?? "no status returned"}), so no credits were added.${
            status === "requires_action"
              ? " The card asked for authentication, which cannot be given without the cardholder present; a different instrument, or the same one re-confirmed on the register, is the way through."
              : ""
          } Nothing is queued and nothing will settle later.`,
        };
      }

      return {
        charged: true,
        paymentIntentId: intent.id,
        status,
        words: `Charged ${input.amountMinor} ${input.currency} minor units to the card on file.`,
      };
    } catch (error) {
      const said = (error as Error)?.message ?? "the provider gave no reason";
      this.logger.error(`message-credit charge failed: ${said}`);
      return {
        charged: false,
        reason: "refused_by_provider",
        words: `The payment was refused, so no credits were added: ${said}. Nothing is queued and nothing will settle later.`,
      };
    }
  }

  /**
   * Ask the provider what a seal actually produced (ADR 0121 addendum, the
   * reconcile half).
   *
   * FOUR OUTCOMES, AND `readable: false` IS THE IMPORTANT ONE. "The provider
   * says there is no such charge" and "the provider could not be asked" are
   * different facts, and a reconcile that confused them would VOID an intent —
   * throwing away the record of a charge that may well exist — because a
   * network was down.
   *
   * A note the caller must not lose: an empty answer here is not proof. Stripe's
   * search index is eventually consistent, so `PurchaseIntentReconciler` ages an
   * empty result against the attempt time before it will act on it.
   */
  async findChargeForSeal(sealId: string): Promise<{
    readable: boolean;
    succeeded: boolean;
    paymentIntentId: string | null;
    status: string | null;
    words: string;
  }> {
    if (!this.config.connected()) {
      return {
        readable: false,
        succeeded: false,
        paymentIntentId: null,
        status: null,
        words: `No payment provider is connected in this deployment, so nothing could be asked about this purchase: ${
          this.config.state().reason ?? "STRIPE_SECRET_KEY is not set."
        }`,
      };
    }

    let found;
    try {
      found = await this.stripe.findChargeBySeal(sealId);
    } catch (error) {
      const said = (error as Error)?.message ?? "the provider gave no reason";
      this.logger.error(`findChargeForSeal failed: ${said}`);
      return {
        readable: false,
        succeeded: false,
        paymentIntentId: null,
        status: null,
        words: `The provider could not be asked about this purchase: ${said}.`,
      };
    }

    if (found.length === 0) {
      return {
        readable: true,
        succeeded: false,
        paymentIntentId: null,
        status: null,
        words:
          "The provider reports no charge carrying this seal. Its search index runs behind, so this is only meaningful once the attempt is old enough.",
      };
    }

    // Prefer a succeeded one if the search returned several. A seal produces at
    // most one charge through this product — the idempotency key sees to that —
    // so more than one here means something outside this product also charged,
    // and the succeeded one is the one that matters to the house.
    const succeeded = found.find((p) => p.status === "succeeded");
    const chosen = succeeded ?? found[0];
    return {
      readable: true,
      succeeded: Boolean(succeeded),
      paymentIntentId: chosen.id,
      status: chosen.status ?? null,
      words: succeeded
        ? `The provider confirms ${chosen.id} succeeded.`
        : `The provider holds ${chosen.id} with status "${chosen.status ?? "unknown"}"; no money moved.`,
    };
  }

  /**
   * The instrument this house is charged on: its default, or its only one.
   *
   * Reads the MIRROR rather than asking the provider, because the register is
   * what the house was shown and charging something the page never displayed is
   * how a dispute starts. `read_failed` is a first-class outcome: supabase-js
   * resolves `{ data, error }` and never throws, so a caller ignoring `error`
   * would turn an outage into "this house has no card".
   */
  private async instrumentToCharge(
    restaurantId: string,
  ): Promise<
    | { state: "read"; providerRef: string | null }
    | { state: "read_failed"; providerRef: null; reason: string }
  > {
    const { data, error } = await this.databaseService.supabase
      .from("payment_methods")
      .select(PAYMENT_INSTRUMENT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("kind", "card")
      .order("is_default", { ascending: false })
      .order("synced_at", { ascending: false });

    if (error) {
      return { state: "read_failed", providerRef: null, reason: error.message };
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    const first = rows[0];
    return {
      state: "read",
      providerRef: first ? String(first.provider_ref) : null,
    };
  }
}
