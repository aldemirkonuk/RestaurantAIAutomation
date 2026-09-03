import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PaymentMethodsController } from "./payment-methods.controller";
import { PaymentMethodsService } from "./payment-methods.service";

/**
 * Payment types as a real register on `/profile`.
 *
 * Built 2026-09-03 to close gap G5 in `.planning/06-pages/profile.md` §9, which
 * read "nothing exists". The table, the routes and the list are real; the create
 * path refuses while no provider credential is configured, which is the honest
 * half of the same build. See `payment-methods.service.ts`'s header.
 */
@Module({
  imports: [DatabaseModule, AuthModule, OrganizationsModule],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
