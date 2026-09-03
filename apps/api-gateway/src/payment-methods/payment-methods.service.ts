import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import {
  CreatePaymentMethodDto,
  PaymentKind,
  PaymentMethodResponse,
  PaymentMethodsResponse,
  PaymentProviderState,
} from "./dto/payment-method.dto";

/**
 * Payment instruments on file for a restaurant.
 *
 * THE CREATE PATH REFUSES, AND SAYS WHY
 * -------------------------------------
 * No payment provider is integrated in this deployment: no Stripe client, no
 * webhook, no secret. There are two ways to build a register in that situation
 * and only one of them is honest.
 *
 *   * Accept the write and store what the operator typed. The row then looks
 *     exactly like a real instrument, the page shows "Visa ••••4242", and
 *     nothing behind it can ever be charged. That is a fabricated record, and it
 *     is the shape ADR 0020 exists to stop.
 *   * Refuse, with the reason, until a provider credential exists. The register
 *     stays empty, and it is empty for a stated cause rather than by silence.
 *
 * This is the second. `assertProviderConnected` is the whole difference, and the
 * page's Add form mirrors it: the form opens, and its submit is disabled with
 * one line saying Stripe is not connected. Nothing anywhere pretends to succeed.
 *
 * When a provider IS configured the code path is complete — the insert, the
 * default-swap and the delete are all real — so connecting Stripe is a
 * credential and a hosted flow, not a rewrite.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  /** The one env var that would flip this register on. */
  static readonly PROVIDER_ENV = "STRIPE_SECRET_KEY";

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Whether a provider credential exists. Deliberately a presence check on the
   * secret and nothing more: this method must never report "connected" on the
   * strength of the table being reachable, which is the absence-as-health
   * inversion in miniature.
   */
  providerState(): PaymentProviderState {
    const secret = this.configService.get<string>(
      PaymentMethodsService.PROVIDER_ENV,
    );
    const connected = typeof secret === "string" && secret.trim().length > 0;
    return {
      id: "stripe",
      connected,
      reason: connected
        ? null
        : "Stripe is not connected — no provider credential is configured in this deployment, so no payment method can be taken or charged.",
    };
  }

  private assertProviderConnected(): void {
    const state = this.providerState();
    if (!state.connected) {
      throw new ServiceUnavailableException(
        state.reason ??
          "No payment provider is connected in this deployment.",
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
    };
  }

  /**
   * The register, plus the state of the provider behind it. A query error
   * throws rather than degrading to `[]`, because an empty list is the answer
   * this register is most likely to give truthfully, and it must not also be
   * the answer it gives when the read failed.
   */
  async list(restaurantId: string): Promise<PaymentMethodsResponse> {
    const { data, error } = await this.databaseService.supabase
      .from("payment_methods")
      .select("id, kind, brand, last4, exp, is_default, provider, created_at")
      .eq("restaurant_id", restaurantId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Failed to list payment methods: ${error.message}`);
      throw new InternalServerErrorException(
        `The payment register could not be read: ${error.message}`,
      );
    }

    return {
      provider: this.providerState(),
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
      .select("id, kind, brand, last4, exp, is_default, provider, created_at")
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
   * Removes the row. No soft delete: the provider is the system of record for an
   * instrument that once existed, and a shadow copy we cannot verify would be a
   * worse record than none. See the migration header.
   */
  async remove(restaurantId: string, id: string): Promise<{ removed: string }> {
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
        `The payment method was not removed: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No payment method with that id belongs to this restaurant.",
      );
    }
    return { removed: String(data.id) };
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
