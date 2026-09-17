import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SealModule } from "../common/seal/seal.module";
import { PriceIndexController } from "./price-index.controller";
import { PriceIndexService } from "./price-index.service";
import { PriceIndexFetchService } from "./price-index-fetch.service";
import { PriceIndexUploadService } from "./price-index-upload.service";
import { PriceIndexReviewService } from "./price-index-review.service";

/**
 * AuthModule is required, not optional: PriceIndexController is guarded by
 * JwtAuthGuard and RolesGuard, and a guard resolves in the context of the
 * module declaring the controller (the same reason VendorIntelModule imports
 * it). The scheduled fetch relies on ScheduleModule.forRoot(), which is
 * registered once in AppModule.
 *
 * SealModule (2026-09-05, ADR 0128): admitting a hand-carried price book puts
 * numbers on every house in that jurisdiction's screens, so it is
 * challenge-and-redeem rather than an assertion. Imported rather than
 * re-implemented — `seal-challenge.service.ts`'s header explains why a second
 * copy of the redemption policy is a fork even when the token arithmetic is
 * shared.
 *
 * NotificationsModule behind a forwardRef, for the reason NotificationsModule
 * itself uses them: it already imports AuthModule and, through it,
 * CommunicationsModule, so a plain import here sits on a cycle even though
 * nothing in the notifications tree imports this module back.
 * `scripts/check_gateway_boots.sh` is what proves the injector resolves — tsc
 * and jest cannot see it.
 */
@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    AuthModule,
    SealModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [PriceIndexController],
  providers: [
    PriceIndexService,
    PriceIndexFetchService,
    PriceIndexUploadService,
    PriceIndexReviewService,
  ],
  exports: [
    PriceIndexService,
    PriceIndexFetchService,
    PriceIndexUploadService,
    PriceIndexReviewService,
  ],
})
export class PriceIndexModule {}
