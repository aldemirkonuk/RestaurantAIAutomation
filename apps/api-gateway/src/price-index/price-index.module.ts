import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { PriceIndexController } from "./price-index.controller";
import { PriceIndexService } from "./price-index.service";
import { PriceIndexFetchService } from "./price-index-fetch.service";

/**
 * AuthModule is required, not optional: PriceIndexController is guarded by
 * JwtAuthGuard and RolesGuard, and a guard resolves in the context of the
 * module declaring the controller (the same reason VendorIntelModule imports
 * it). The scheduled fetch relies on ScheduleModule.forRoot(), which is
 * registered once in AppModule.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [PriceIndexController],
  providers: [PriceIndexService, PriceIndexFetchService],
  exports: [PriceIndexService, PriceIndexFetchService],
})
export class PriceIndexModule {}
