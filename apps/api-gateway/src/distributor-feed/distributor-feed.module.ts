import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DistributorFeedController } from "./distributor-feed.controller";
import { DistributorFeedService } from "./distributor-feed.service";

/**
 * AuthModule is required, not optional: the controller is guarded by
 * JwtAuthGuard and RolesGuard, and a guard resolves in the context of the module
 * declaring the controller — the same reason PriceIndexModule and
 * VendorIntelModule import it.
 *
 * No schedule, no fetch service and no writer. Nothing in this module reaches
 * the network or a database except the one read of `restaurants.state_province`
 * that scopes the catalogue to the caller's own jurisdiction.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [DistributorFeedController],
  providers: [DistributorFeedService],
  exports: [DistributorFeedService],
})
export class DistributorFeedModule {}
