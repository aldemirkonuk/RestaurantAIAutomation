import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { BillingConfigModule } from "./billing-config.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PaymentMethodMirrorService } from "./payment-method-mirror.service";
// The seal on opening a card form (founder, 2026-09-05; ADR 0110 addendum,
// G-PAY-SETUP). Not circular: SealModule imports DatabaseModule and nothing
// else, and `PaymentMethodsModule` imports it the same way.
import { SealModule } from "../common/seal/seal.module";

/**
 * Stripe as the live payment provider — ADR 0110.
 *
 * Closes gap G10 in `.planning/06-pages/profile.md` §9, which claimed
 * "everything except the credential is built" and was wrong: nothing in the
 * repo spoke to Stripe at all, so the required `provider_ref` was a field no
 * caller could fill and setting `STRIPE_SECRET_KEY` on the pre-existing tree
 * would have turned an honest refusal into an operator-typed fabrication.
 *
 * The build stops at "a card on file". `StripeClient` throws before building a
 * request to any money-moving resource, because pricing is OD-23 and open.
 *
 * `AuthModule` is imported because `BillingController` uses `JwtAuthGuard`, and
 * a guard resolves in the context of the module that declares the controller —
 * the omission that crash-looped the gateway in production on 2026-08-24 and
 * the reason `check_gateway_boots.sh` exists.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
    BillingConfigModule,
    SealModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, PaymentMethodMirrorService],
  exports: [BillingService],
})
export class BillingModule {}
