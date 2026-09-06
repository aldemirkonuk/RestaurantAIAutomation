import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BillingCustomerService } from "./billing-customer.service";
import { StripeClient } from "./stripe.client";
import { StripeConfigService } from "./stripe-config.service";

/**
 * The provider primitives, in a module of their own so that TWO features can
 * use them without a circular import.
 *
 * `payment-methods/` needs them (to report the provider's state on its list, to
 * detach at the provider when a row is removed, and to set the customer's
 * default instrument); `billing/` needs them (SetupIntents, sync, webhook).
 * If either feature module owned them, the other would have to import it, and
 * `BillingModule ↔ PaymentMethodsModule` is exactly the cycle that takes down
 * the whole Nest injector at boot — the failure `check_gateway_boots.sh` exists
 * to catch. Splitting the primitives out makes the graph a tree:
 *
 *     BillingConfigModule
 *        ↑            ↑
 *   PaymentMethods  Billing
 */
@Module({
  imports: [DatabaseModule],
  providers: [StripeConfigService, StripeClient, BillingCustomerService],
  exports: [StripeConfigService, StripeClient, BillingCustomerService],
})
export class BillingConfigModule {}
