import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { BillingCustomerService } from "../billing/billing-customer.service";
import { StripeClient } from "../billing/stripe.client";
import { StripeConfigService } from "../billing/stripe-config.service";
import {
  CreatePaymentMethodDto,
  PaymentKind,
  PaymentMethodResponse,
  PaymentMethodsResponse,
  PaymentProviderState,
} from "./dto/payment-method.dto";

/**
 * Every column this module reads, as a module-level `const` of literal names.
 *
 * WHY A BARE CONST AND NOT A CLASS STATIC
 * ---------------------------------------
 * `scripts/check_read_columns_exist.py` resolves a `.select()` argument that is
 * a literal, a `${}`-free template, a `+` chain of those, or a **same-file
 * `const`** — and nothing else. A `PaymentMethodsService.COLUMNS` static reads
 * to it as a runtime value, so all three reads here landed in its UNREADABLE
 * bucket: not "these columns are fine", but "nobody is checking these columns",
 * which is the guard's own bug class and is why it ceilings them rather than
 * ignoring them. Writing the list once, at module scope, keeps the single
 * source of truth AND keeps every read inside the guard's universe.
 *
 * `provider_type`, `synced_at` and `livemode` are declared by
 * `supabase/migrations/20260903110000_billing_stripe_provider.sql`.
 */
const PAYMENT_METHOD_COLUMNS =
  "id, kind, brand, last4, exp, is_default, provider, provider_type, synced_at, livemode, created_at";

/**
 * Payment instruments on file for a restaurant.
 *
 * THE CREATE PATH STILL REFUSES WITHOUT A CREDENTIAL, AND SAYS WHY
 * ----------------------------------------------------------------
 * There are two ways to build a register when no provider is configured and
 * only one of them is honest:
 *
 *   * Accept the write and store what the operator typed. The row then looks
 *     exactly like a real instrument, the page shows "Visa ••••4242", and
 *     nothing behind it can ever be charged. That is a fabricated record, and
 *     it is the shape ADR 0020 exists to stop.
 *   * Refuse, with the reason, until a provider credential exists.
 *
 * This is the second, and `assertProviderConnected` is still the whole
 * difference.
 *
 * WHAT CHANGED WITH THE PROVIDER PATH (ADR 0110)
 * ----------------------------------------------
 * The first pass filed the remainder as "one credential away". That was not
 * true — nothing in the repo spoke to Stripe, so `providerRef` was a required
 * field no caller in this product could fill, and setting the env var would
 * have enabled a form whose four typed fields became the register's content.
 * The provider path now exists (`billing/`), so:
 *
 *   * `create` is reached only by the provider path, and the browser never
 *     calls it — the browser confirms a SetupIntent on Stripe's origin and asks
 *     for a `POST /billing/sync`. The route stays for a server-side caller and
 *     keeps its refusal.
 *   * `remove` DETACHES AT THE PROVIDER FIRST when one is connected. Deleting
 *     our row alone would leave a live instrument attached to the customer that
 *     the next sync would faithfully restore — the delete would appear to work
 *     and then silently undo itself.
 *   * `setDefault` writes the default AT THE PROVIDER before flipping the local
 *     flag, for the same reason: "charged first" is a fact about Stripe's
 *     customer, not about our column.
 *   * `providerState` is delegated to `StripeConfigService`, so there is one
 *     implementation of "is the provider connected" and it is the one the
 *     billing routes use.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  /** Kept for callers and docs that name it; the reader is `StripeConfigService`. */
  static readonly PROVIDER_ENV = StripeConfigService.SECRET_ENV;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly stripeConfig: StripeConfigService,
    private readonly stripe: StripeClient,
    private readonly customers: BillingCustomerService,
  ) {}

  /**
   * Whether a provider credential exists, plus which secrets are set and
   * whether a signed delivery has ever arrived. Deliberately never reports
   * "connected" on the strength of the table being reachable, which is the
   * absence-as-health inversion in miniature.
   */
  providerState(): PaymentProviderState {
    return this.stripeConfig.state();
  }

  private assertProviderConnected(): void {
    const state = this.providerState();
    if (!state.connected) {
      throw new ServiceUnavailableException(
        state.reason ?? "No payment provider is connected in this deployment.",
      );
    }
  }

  private static row(r: Record<string, unknown>): PaymentMethodResponse {
    return {
      id: String(r.id),
      kind: String(r.kind) as PaymentKind,
      brand: (r.brand as string | null) ?? null,
      last4: (r.last4 as string | null) ?? null,
      exp: (r.exp as string | null) ?? null,
      isDefault: Boolean(r.is_default),
      provider: String(r.provider),
      createdAt: String(r.created_at),
      providerType: (r.provider_type as string | null) ?? null,
      // Null, never `created_at` as a stand-in. A row that has never been
      // confirmed against the provider must not claim a confirmation.
      syncedAt: (r.synced_at as string | null) ?? null,
      livemode:
        r.livemode === null || r.livemode === undefined
          ? null
          : Boolean(r.livemode),
    };
  }

  /**
   * The register, plus the state of the provider behind it. A query error
   * throws rather than degrading to `[]`, because an empty list is the answer
   * this register is most likely to give truthfully, and it must not also be
   * the answer it gives when the read failed.
   */
  async list(restaurantId: string): Promise<PaymentMethodsResponse> {
    const [{ data, error }, provider] = await Promise.all([
      this.databaseService.supabase
        .from("payment_methods")
        .select(PAYMENT_METHOD_COLUMNS)
        .eq("restaurant_id", restaurantId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false }),
      this.stripeConfig.stateWithDelivery(),
    ]);

    if (error) {
      this.logger.error(`Failed to list payment methods: ${error.message}`);
      throw new InternalServerErrorException(
        `The payment register could not be read: ${error.message}`,
      );
    }

    return {
      provider,
      methods: (data ?? []).map((r) =>
        PaymentMethodsService.row(r as Record<string, unknown>),
      ),
    };
  }

  async create(
    restaurantId: string,
    dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    this.assertProviderConnected();

    if (dto.isDefault) await this.clearDefault(restaurantId);

    const { data, error } = await this.databaseService.supabase
      .from("payment_methods")
      .insert({
        restaurant_id: restaurantId,
        kind: dto.kind,
        brand: dto.brand ?? null,
        last4: dto.last4 ?? null,
        exp: dto.exp ?? null,
        is_default: dto.isDefault ?? false,
        provider: "stripe",
        provider_ref: dto.providerRef,
      })
      .select(PAYMENT_METHOD_COLUMNS)
      .single();

    if (error) {
      this.logger.error(`Failed to add payment method: ${error.message}`);
      throw new InternalServerErrorException(
        `The payment method was not saved: ${error.message}`,
      );
    }

    return PaymentMethodsService.row(data as Record<string, unknown>);
  }

  /**
   * Removes the instrument — at the provider first, then here.
   *
   * The order is the whole correctness argument. Deleting our row first and
   * then failing to detach leaves a live instrument on the customer that the
   * next `POST /billing/sync` would faithfully put back, so the removal would
   * appear to work and silently undo itself minutes later. Detaching first
   * means the worst case is a row we still show and can retry removing — an
   * over-report we can see, not an under-report we cannot.
   *
   * No soft delete: the provider is the system of record for an instrument that
   * once existed, and a shadow copy we cannot verify would be a worse record
   * than none. See the migration header.
   */
  async remove(restaurantId: string, id: string): Promise<{ removed: string }> {
    const { data: existing, error: readError } = await this.databaseService.supabase
      .from("payment_methods")
      .select("id, provider, provider_ref")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (readError) {
      throw new InternalServerErrorException(
        `The payment method could not be read before removal: ${readError.message}`,
      );
    }
    if (!existing) {
      throw new NotFoundException(
        "No payment method with that id belongs to this restaurant.",
      );
    }

    const providerRef = String(
      (existing as Record<string, unknown>).provider_ref ?? "",
    );
    if (this.stripeConfig.connected() && providerRef.startsWith("pm_")) {
      await this.stripe.detachPaymentMethod(providerRef);
    }

    const { data, error } = await this.databaseService.supabase
      .from("payment_methods")
      .delete()
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .select("id")
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to remove payment method: ${error.message}`);
      throw new InternalServerErrorException(
        `The payment method was detached at the provider but its row was not removed: ${error.message}. A reconcile will drop it.`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No payment method with that id belongs to this restaurant.",
      );
    }
    return { removed: String(data.id) };
  }

  /**
   * Which instrument is charged first.
   *
   * Written at the PROVIDER before it is written here, because "charged first"
   * is a fact about Stripe's customer and not about our column: flipping the
   * local flag alone would make the page say one thing and the charge do
   * another, which is the most expensive kind of disagreement this register can
   * produce. When no provider is connected there is nothing to charge and
   * nothing to prefer, so the call refuses with the same sentence as `create`.
   */
  async setDefault(
    restaurantId: string,
    id: string,
  ): Promise<PaymentMethodResponse> {
    this.assertProviderConnected();

    const { data: existing, error: readError } = await this.databaseService.supabase
      .from("payment_methods")
      .select("id, provider_ref")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (readError) {
      throw new InternalServerErrorException(
        `The payment method could not be read: ${readError.message}`,
      );
    }
    if (!existing) {
      throw new NotFoundException(
        "No payment method with that id belongs to this restaurant.",
      );
    }

    const customerId = await this.customers.ensure(restaurantId);
    await this.stripe.setDefaultPaymentMethod(
      customerId,
      String((existing as Record<string, unknown>).provider_ref),
    );

    await this.clearDefault(restaurantId);

    const { data, error } = await this.databaseService.supabase
      .from("payment_methods")
      .update({ is_default: true })
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .select(PAYMENT_METHOD_COLUMNS)
      .single();

    if (error) {
      this.logger.error(`Failed to set the default: ${error.message}`);
      throw new InternalServerErrorException(
        `The provider now charges this instrument first, but the register did not record it: ${error.message}. A reconcile will correct the page.`,
      );
    }

    return PaymentMethodsService.row(data as Record<string, unknown>);
  }

  private async clearDefault(restaurantId: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("payment_methods")
      .update({ is_default: false })
      .eq("restaurant_id", restaurantId)
      .eq("is_default", true);
    if (error) {
      this.logger.error(`Failed to clear default: ${error.message}`);
      throw new InternalServerErrorException(
        `The default payment method was not changed: ${error.message}`,
      );
    }
  }
}
