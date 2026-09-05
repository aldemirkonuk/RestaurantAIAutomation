import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { BillingConfigModule } from "../billing/billing-config.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PaymentMethodsController } from "./payment-methods.controller";
import { PaymentMethodsService } from "./payment-methods.service";
// The seal on a card-on-file change (founder, 2026-09-04; ADR 0110 addendum).
// Not circular: SealModule imports DatabaseModule and nothing else.
import { SealModule } from "../common/seal/seal.module";

/**
 * Payment types as a real register on `/profile`.
 *
 * Built 2026-09-03 to close gap G5 in `.planning/06-pages/profile.md` §9, which
 * read "nothing exists". The table, the routes and the list are real; the create
 * path refuses while no provider credential is configured, which is the honest
 * half of the same build. See `payment-methods.service.ts`'s header.
 *
 * Extended the same day by ADR 0110: removal now detaches at the provider
 * before dropping the row, `PATCH /payment-methods/:id/default` writes the
 * default at the provider before flipping the local flag, and the provider
 * state on the list comes from the one `StripeConfigService` the billing routes
 * also use — so there is a single implementation of "is the provider
 * connected", and it reports which secrets are set rather than one boolean.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
    // The provider primitives live in their own module so this one and
    // `BillingModule` can both use them without a cycle — see
    // `billing/billing-config.module.ts`.
    BillingConfigModule,
    SealModule,
  ],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
