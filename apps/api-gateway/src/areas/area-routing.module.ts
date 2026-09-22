import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AreaRoutingService } from "./area-routing.service";

/**
 * The routing half of ADR 0218, on its own so `NotificationsModule` can import
 * it without importing the controller's `AuthModule` edge. It depends on the
 * database and nothing else, so it can sit under the notification funnel
 * without joining any cycle (`scripts/check_gateway_boots.sh` proves it).
 */
@Module({
  imports: [DatabaseModule],
  providers: [AreaRoutingService],
  exports: [AreaRoutingService],
})
export class AreaRoutingModule {}
