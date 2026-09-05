import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CommodityController } from "./commodity.controller";
import { CommodityService } from "./commodity.service";
import { CommodityFetchService } from "./commodity-fetch.service";
import { CommodityAlertService } from "./commodity-alert.service";

/**
 * The class-E index register (ADR 0117; the founder's *"a seperate table for
 * index series"*, 2026-09-05).
 *
 * AuthModule is required rather than optional, for the reason PriceIndexModule
 * gives: `CommodityController` is guarded by `JwtAuthGuard` and `RolesGuard`,
 * and a guard resolves in the context of the module declaring the controller.
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
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [CommodityController],
  providers: [CommodityService, CommodityFetchService, CommodityAlertService],
  exports: [CommodityService, CommodityFetchService, CommodityAlertService],
})
export class CommodityModule {}
