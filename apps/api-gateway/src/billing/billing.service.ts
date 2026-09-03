import {
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

  async createSetupIntent(restaurantId: string): Promise<SetupIntentResponse> {
    this.assertConnected();

    const customerId = await this.customers.ensure(restaurantId);
    const intent = await this.stripe.createSetupIntent({
      customerId,
      restaurantId,
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

  async sync(restaurantId: string): Promise<SyncResponse> {
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
      await this.settle(eventId, outcome.handled, outcome.reason, outcome.restaurantId);
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

    const { data: existing, error: readError } = await this.databaseService.supabase
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
      .update({
        handled,
        outcome,
        ...(restaurantId ? { restaurant_id: restaurantId } : {}),
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
  ): Promise<{ handled: boolean; reason: string; restaurantId: string | null }> {
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
}
