import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import type { PaymentKind } from "../payment-methods/dto/payment-method.dto";
import type { StripePaymentMethod } from "./stripe.client";

/**
 * The provider's answer, written into our register.
 *
 * NOTHING HERE INVENTS A FIELD
 * ----------------------------
 * Every column written below comes from the provider object. Where the
 * provider is silent the column is `null`, and null renders on the page as an
 * em dash — never as "Unknown", never as a zero, never as a plausible default.
 * The one field that is ours is `synced_at`, and it records exactly what it
 * says: the moment we heard this from Stripe.
 *
 * THE `kind` MAP IS EXPLICIT AND ITS DEFAULT IS `other`
 * ----------------------------------------------------
 * Our register offers four kinds; Stripe has roughly thirty types. Filing an
 * unmapped type as `card` because `card` is the closest is a quiet lie about
 * an instrument that will be charged. So an unmapped type becomes `other`, and
 * `provider_type` carries Stripe's own word, which the page prints verbatim.
 * The migration widened the CHECK for exactly this and proves the CHECK still
 * rejects a value outside the set (20260903110000, §5).
 */

/** Stripe type → our kind. Everything absent from this map is `other`. */
const KIND_BY_STRIPE_TYPE: Record<string, PaymentKind> = {
  card: "card",
  us_bank_account: "bank_account",
  sepa_debit: "bank_account",
  bacs_debit: "bank_account",
  acss_debit: "bank_account",
  au_becs_debit: "bank_account",
};

export interface MirrorRow {
  restaurant_id: string;
  kind: PaymentKind;
  brand: string | null;
  last4: string | null;
  exp: string | null;
  provider: "stripe";
  provider_ref: string;
  provider_type: string;
  livemode: boolean;
  synced_at: string;
}

@Injectable()
export class PaymentMethodMirrorService {
  private readonly logger = new Logger(PaymentMethodMirrorService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Map a provider object onto a row. Pure and static so the mapping — the
   * place a fabricated value would enter the register — is testable without a
   * database.
   */
  static toRow(
    restaurantId: string,
    pm: StripePaymentMethod,
    syncedAt: string,
  ): MirrorRow {
    const type = String(pm.type ?? "").trim();
    const card = pm.card ?? null;
    const bank = pm.us_bank_account ?? null;

    const last4 = card?.last4 ?? bank?.last4 ?? null;
    const brand = card?.brand ?? bank?.bank_name ?? null;

    // MM/YYYY, and only when BOTH halves are present. A month with no year is
    // not an expiry, and padding a missing year to the current one would be a
    // fabricated date on a chargeable instrument.
    const exp =
      card?.exp_month && card?.exp_year
        ? `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year)}`
        : null;

    return {
      restaurant_id: restaurantId,
      kind: KIND_BY_STRIPE_TYPE[type] ?? "other",
      brand: brand ? String(brand) : null,
      // Defensive, and not decorative: the CHECK on this column is the PAN
      // guard, and a value that would trip it must never be sent at all.
      last4: last4 && /^[0-9]{4}$/.test(String(last4)) ? String(last4) : null,
      exp,
      provider: "stripe",
      provider_ref: pm.id,
      provider_type: type,
      livemode: Boolean(pm.livemode),
      synced_at: syncedAt,
    };
  }

  /**
   * Reconcile a restaurant's register against the provider's list.
   *
   * The delete half is the point: an instrument removed at Stripe must
   * disappear here, and a sync that only ever inserted would leave the register
   * reporting a card that cannot be charged. Scoped to `provider = 'stripe'`
   * and to this restaurant, so nothing else is touched.
   */
  async reconcile(
    restaurantId: string,
    methods: StripePaymentMethod[],
    syncedAt: string = new Date().toISOString(),
  ): Promise<{ kept: number; removed: number }> {
    const rows = methods.map((pm) =>
      PaymentMethodMirrorService.toRow(restaurantId, pm, syncedAt),
    );

    if (rows.length > 0) {
      const { error } = await this.databaseService.supabase
        .from("payment_methods")
        .upsert(rows, { onConflict: "provider,provider_ref" });
      if (error) {
        this.logger.error(`Failed to mirror payment methods: ${error.message}`);
        throw new InternalServerErrorException(
          `The provider answered, but the register could not be updated: ${error.message}`,
        );
      }
    }

    const keepRefs = rows.map((r) => r.provider_ref);
    let query = this.databaseService.supabase
      .from("payment_methods")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("provider", "stripe");
    if (keepRefs.length > 0) {
      query = query.not(
        "provider_ref",
        "in",
        `(${keepRefs.map((r) => `"${r}"`).join(",")})`,
      );
    }
    const { data: removed, error: deleteError } = await query.select("id");

    if (deleteError) {
      this.logger.error(
        `Failed to drop instruments the provider no longer has: ${deleteError.message}`,
      );
      throw new InternalServerErrorException(
        `The register was partly updated and could not be reconciled: ${deleteError.message}`,
      );
    }

    return { kept: rows.length, removed: (removed ?? []).length };
  }

  /** One instrument, by the provider's reference. Used by the webhook. */
  async upsertOne(
    restaurantId: string,
    pm: StripePaymentMethod,
    syncedAt: string = new Date().toISOString(),
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("payment_methods")
      .upsert(
        [PaymentMethodMirrorService.toRow(restaurantId, pm, syncedAt)],
        { onConflict: "provider,provider_ref" },
      );
    if (error) {
      throw new InternalServerErrorException(
        `The instrument could not be recorded: ${error.message}`,
      );
    }
  }

  /** Drop by provider reference. Returns how many rows actually went. */
  async removeByRef(providerRef: string): Promise<number> {
    const { data, error } = await this.databaseService.supabase
      .from("payment_methods")
      .delete()
      .eq("provider", "stripe")
      .eq("provider_ref", providerRef)
      .select("id");

    if (error) {
      throw new InternalServerErrorException(
        `The instrument could not be removed from the register: ${error.message}`,
      );
    }
    return (data ?? []).length;
  }
}
