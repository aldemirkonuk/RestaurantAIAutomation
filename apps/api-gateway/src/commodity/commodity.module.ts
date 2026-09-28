import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { SealModule } from "../common/seal/seal.module";
import { CommodityController } from "./commodity.controller";
import { CommodityService } from "./commodity.service";
import { CommodityFetchService } from "./commodity-fetch.service";
import { CommodityAlertService } from "./commodity-alert.service";
import { CommodityAdminService } from "./commodity-admin.service";
import { CommodityExposureService } from "./commodity-exposure.service";
import { BottleFactsService } from "./bottle-facts";

/**
 * The class-E index register (ADR 0117; the founder's *"a seperate table for
 * index series"*, 2026-09-05).
 *
 * AuthModule is required rather than optional, for the reason PriceIndexModule
 * gives: `CommodityController` is guarded by `JwtAuthGuard` and `RolesGuard`,
 * and a guard resolves in the context of the module declaring the controller.
 *
 * SealModule (2026-09-05, the founder's Q5 answer): asserting that one of this
 * house's items is exposed to a series is what turns a world index into a claim
 * about this kitchen, and it is retired rather than deleted — so it is
 * challenge-and-redeem rather than an assertion. Imported rather than
 * re-implemented, for the reason `seal-challenge.service.ts`'s own header
 * gives: a second copy of the redemption policy is a fork even when the token
 * arithmetic is shared. ARMING a series is NOT sealed through it, because
 * `mcp_seal_challenges.actor_user_id` is a NOT NULL FK to `public.users` and
 * the admin caller is a service key with no such row — see
 * `commodity-calibration.ts`.
 *
 * **NotificationsModule is deliberately NOT imported**, and that is the whole
 * shape of "the alert is dark". `CommodityAlertService` has no way to reach a
 * person because it has no `NotificationsService` to reach one with — the
 * guarantee lives in the injector rather than in a conditional somebody could
 * delete. It writes to the footprint ledger through `DatabaseService` and
 * nothing else. Making the alert real means adding an import here, in front of
 * a reviewer, which is where that decision belongs.
 *
 * There is no `ScheduleModule` registration and no `@Cron` anywhere in this
 * module: the fetch runs only when something calls it AND
 * `COMMODITY_INDEX_FETCH_ENABLED` is armed. A cron plus a flag is two things
 * that must both be off; one of them is enough.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule, SealModule],
  controllers: [CommodityController],
  providers: [
    CommodityService,
    CommodityFetchService,
    CommodityAlertService,
    CommodityAdminService,
    CommodityExposureService,
    BottleFactsService,
  ],
  exports: [
    CommodityService,
    CommodityFetchService,
    CommodityAlertService,
    CommodityAdminService,
    CommodityExposureService,
    BottleFactsService,
  ],
})
export class CommodityModule {}
