import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import type {
  PaymentProviderState,
  StripeMode,
} from "../payment-methods/dto/payment-method.dto";

/**
 * The state of the payment provider — the field that stops an empty register
 * from lying, now with enough resolution to be actionable.
 *
 * THE ONE BOOLEAN WAS NOT ENOUGH
 * ------------------------------
 * The first pass returned `{connected: false, reason}`. That distinguishes "no
 * cards on file" from "no card CAN exist", which was the point, and it still
 * leaves the operator with nothing to do: three different secrets can be
 * missing and they live in two different processes. So this reports each one
 * by name, and derives the key's MODE from its own prefix rather than from a
 * separate `STRIPE_ENV` variable that could disagree with the key it describes.
 *
 * THE LINE THAT MATTERS IS `webhookLastReceivedAt`
 * ------------------------------------------------
 * A webhook secret being SET is not a webhook working. The endpoint still has
 * to be registered in the Stripe dashboard, and if it is not, everything looks
 * healthy — cards can be added, the register fills — right up until a card is
 * removed at the provider and the page goes on showing it forever. So the
 * state carries when a signed delivery LAST ARRIVED, and null reads as
 * "configured, never delivered" rather than as silence. This is the
 * absence-reported-as-health inversion caught at the seam where it costs most.
 *
 * WHAT THIS SERVICE DELIBERATELY CANNOT SEE
 * -----------------------------------------
 * `VITE_STRIPE_PUBLISHABLE_KEY`. It is a browser variable, baked at build time
 * into the web bundle, and the gateway has no view of the bundle that is
 * running. Reporting it from here would be a guess. The page reads
 * `import.meta.env` itself and reports its own absence in its own words.
 */
@Injectable()
export class StripeConfigService {
  private readonly logger = new Logger(StripeConfigService.name);

  static readonly SECRET_ENV = "STRIPE_SECRET_KEY";
  static readonly WEBHOOK_ENV = "STRIPE_WEBHOOK_SECRET";
  static readonly PUBLISHABLE_BROWSER_ENV = "VITE_STRIPE_PUBLISHABLE_KEY";
  static readonly API_VERSION_ENV = "STRIPE_API_VERSION";

  /**
   * Pinned. We hand-wrote this client, so an upstream shape change must be a
   * deliberate bump rather than something that arrives on a Tuesday.
   */
  static readonly DEFAULT_API_VERSION = "2024-06-20";

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {}

  private read(key: string): string | null {
    const raw = this.configService.get<string>(key);
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  secretKey(): string | null {
    return this.read(StripeConfigService.SECRET_ENV);
  }

  webhookSecret(): string | null {
    return this.read(StripeConfigService.WEBHOOK_ENV);
  }

  apiVersion(): string {
    return (
      this.read(StripeConfigService.API_VERSION_ENV) ??
      StripeConfigService.DEFAULT_API_VERSION
    );
  }

  /**
   * From the key's own prefix. `unknown` is a real answer: a key that is
   * neither `sk_test_` nor `sk_live_` (a restricted key, or a typo) must not
   * be reported as either, because "test" on a live key is the sentence that
   * gets a real card charged in a rehearsal.
   */
  mode(): StripeMode | null {
    const key = this.secretKey();
    if (!key) return null;
    if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
    if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
    return "unknown";
  }

  livemode(): boolean {
    return this.mode() === "live";
  }

  connected(): boolean {
    return this.secretKey() !== null;
  }

  /** The env-only half — synchronous, and safe to call from a hot path. */
  state(): PaymentProviderState {
    const secretKeyPresent = this.secretKey() !== null;
    const webhookSecretPresent = this.webhookSecret() !== null;

    return {
      id: "stripe",
      connected: secretKeyPresent,
      reason: secretKeyPresent
        ? null
        : `Stripe is not connected — ${StripeConfigService.SECRET_ENV} is not set on this deployment, so no payment method can be taken and none could exist to list.`,
      mode: this.mode(),
      secretKeyPresent,
      webhookSecretPresent,
      apiVersion: this.apiVersion(),
      webhookLastReceivedAt: null,
      webhookLastEventType: null,
      webhookReason: webhookSecretPresent
        ? // Overwritten by `stateWithDelivery` when a delivery is on record.
          `${StripeConfigService.WEBHOOK_ENV} is set, but no signed delivery has ever arrived at this deployment. Until one does, a card removed at Stripe would go on showing here.`
        : `${StripeConfigService.WEBHOOK_ENV} is not set, so every delivery is refused and this register only changes when someone is looking at it.`,
    };
  }

  /**
   * The state plus the evidence a delivery ever happened.
   *
   * Read errors are swallowed to `null` here — deliberately, and this is the
   * one place in the module where that is right: the caller is
   * `GET /payment-methods`, whose own read already throws on failure, and a
   * degraded *delivery* fact must not take down the register that reports the
   * cards. It stays null, and null already renders as "never delivered", which
   * is the pessimistic reading. The error is logged, not hidden.
   */
  async stateWithDelivery(): Promise<PaymentProviderState> {
    const base = this.state();

    const { data, error } = await this.databaseService.supabase
      .from("billing_webhook_events")
      .select("received_at, event_type")
      .eq("provider", "stripe")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.warn(
        `Could not read the webhook delivery log: ${error.message}. The provider state reports "never delivered", which is the pessimistic reading.`,
      );
      return base;
    }
    if (!data) return base;

    return {
      ...base,
      webhookLastReceivedAt: String(
        (data as Record<string, unknown>).received_at,
      ),
      webhookLastEventType: String(
        (data as Record<string, unknown>).event_type,
      ),
      webhookReason: null,
    };
  }
}
