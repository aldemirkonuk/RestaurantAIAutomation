import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { StripeClient } from "./stripe.client";
import { StripeConfigService } from "./stripe-config.service";

/**
 * The restaurant's identity at the provider, and the reason it is a table
 * rather than a lookup by metadata.
 *
 * Stripe can search customers by metadata, but that search is eventually
 * consistent and rate-limited, and "which customer is this restaurant?" is a
 * question that must be answered identically by a page load and by a webhook
 * arriving three milliseconds later. So the mapping is ours, unique-indexed,
 * and the uniqueness is enforced by the schema
 * (`billing_customers UNIQUE (restaurant_id, provider, livemode)`).
 *
 * WHY `livemode` IS PART OF THE KEY
 * ---------------------------------
 * A house that tests and then goes live needs two customers, and they are not
 * interchangeable: a SetupIntent created on a live key against a test customer
 * fails in a way that reads like a card decline. Recording the mode makes the
 * two rows distinct instead of making the second insert collide with the first.
 */
@Injectable()
export class BillingCustomerService {
  private readonly logger = new Logger(BillingCustomerService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly stripe: StripeClient,
    private readonly config: StripeConfigService,
  ) {}

  /** The stored customer id for this restaurant in the CURRENT key mode, or null. */
  async find(restaurantId: string): Promise<string | null> {
    const { data, error } = await this.databaseService.supabase
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("restaurant_id", restaurantId)
      .eq("provider", "stripe")
      .eq("livemode", this.config.livemode())
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to read the billing customer: ${error.message}`);
      throw new InternalServerErrorException(
        `The provider account for this restaurant could not be read: ${error.message}`,
      );
    }
    return data
      ? String((data as Record<string, unknown>).provider_customer_id)
      : null;
  }

  /**
   * Reverse lookup, for a webhook that names a customer and nothing else.
   * Returns null rather than throwing when nothing matches: an event about a
   * customer we have never heard of is a fact to RECORD (as ignored, with the
   * reason) and not an error to fail the delivery over — a 500 there would make
   * Stripe retry forever.
   */
  async restaurantFor(customerId: string): Promise<string | null> {
    const { data, error } = await this.databaseService.supabase
      .from("billing_customers")
      .select("restaurant_id")
      .eq("provider", "stripe")
      .eq("provider_customer_id", customerId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to resolve the restaurant for ${customerId}: ${error.message}`,
      );
      return null;
    }
    return data ? String((data as Record<string, unknown>).restaurant_id) : null;
  }

  /**
   * The customer, creating it at the provider on first use.
   *
   * The idempotency key is `(restaurant, mode)`, so two tabs racing to open the
   * Add-a-card panel get ONE customer: Stripe replays the first response for
   * the second call rather than minting a second account the register would
   * then have to choose between.
   */
  async ensure(restaurantId: string): Promise<string> {
    const existing = await this.find(restaurantId);
    if (existing) return existing;

    const { data: restaurant, error: restaurantError } =
      await this.databaseService.supabase
        .from("restaurants")
        .select("id, name, email")
        .eq("id", restaurantId)
        .maybeSingle();

    if (restaurantError) {
      throw new InternalServerErrorException(
        `The restaurant record could not be read: ${restaurantError.message}`,
      );
    }
    if (!restaurant) {
      throw new NotFoundException(
        "No restaurant with that id, so no provider account can be opened for it.",
      );
    }

    const livemode = this.config.livemode();
    const customer = await this.stripe.createCustomer({
      name: String((restaurant as Record<string, unknown>).name ?? restaurantId),
      email: ((restaurant as Record<string, unknown>).email as string) ?? null,
      restaurantId,
      idempotencyKey: `mudavym:customer:${restaurantId}:${livemode ? "live" : "test"}`,
    });

    const { error: insertError } = await this.databaseService.supabase
      .from("billing_customers")
      .insert({
        restaurant_id: restaurantId,
        provider: "stripe",
        provider_customer_id: customer.id,
        livemode: customer.livemode ?? livemode,
      });

    if (insertError) {
      // The customer EXISTS at Stripe now. Losing the mapping would orphan it,
      // so a unique-violation (the racing tab won) is resolved by re-reading
      // rather than by inventing a second one.
      const raced = await this.find(restaurantId);
      if (raced) return raced;
      this.logger.error(
        `Stripe customer ${customer.id} was created but not recorded: ${insertError.message}`,
      );
      throw new InternalServerErrorException(
        `The provider account was created but could not be recorded: ${insertError.message}. It must be linked by hand before a card is added, or the next attempt will open a second account.`,
      );
    }

    return customer.id;
  }
}
