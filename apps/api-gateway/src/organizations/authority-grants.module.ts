import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { VendorSendAuthorityModule } from "./vendor-send-authority.module";
import { AuthorityGrantsController } from "./authority-grants.controller";
import { AuthorityGrantsService } from "./authority-grants.service";

/**
 * The owners' register of who may send to vendors (ADR 0112 F12; ADR 0175
 * D10). Imported by `AppModule` only. `NotificationsModule` is a forwardRef for
 * the reason `ProcurementModule` gives: it sits behind `AuthModule`'s cycle
 * with `CommunicationsModule`. `scripts/check_gateway_boots.sh` is what proves
 * the graph resolves.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    VendorSendAuthorityModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [AuthorityGrantsController],
  providers: [AuthorityGrantsService],
})
export class AuthorityGrantsModule {}
