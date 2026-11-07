import { Module, forwardRef } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WebsocketModule } from "../websocket/websocket.module";
import { FloorAdminService } from "./floor-admin.service";
import { FloorBoardService } from "./floor-board.service";
import { FloorEnabledGuard } from "./floor-enabled.guard";
import { FloorManagerController } from "./floor-manager.controller";
import { FloorNudgeScanner } from "./floor-nudge.scanner";
import { FloorStaffController } from "./floor-staff.controller";
import { FloorTablesService } from "./floor-tables.service";
import { FloorService } from "./floor.service";

/**
 * The floor (ADR 0345): the waiter's phone (`/floor/me`), the owner's and
 * manager's view (`/floor`), and the nudge scanner. Every route is dark while
 * the house's `floor_checker` switch is off (E7).
 *
 * NotificationsModule is imported through forwardRef: it already sits on the
 * AuthModule ↔ CommunicationsModule cycle, and `scripts/check_gateway_boots.sh`
 * is what proves the injector resolves it — tsc and jest cannot.
 */
@Module({
  imports: [DatabaseModule, AuthModule, WebsocketModule, forwardRef(() => AnalyticsModule), forwardRef(() => NotificationsModule)],
  controllers: [FloorStaffController, FloorManagerController],
  providers: [
    FloorService,
    FloorBoardService,
    FloorAdminService,
    FloorTablesService,
    FloorEnabledGuard,
    FloorNudgeScanner,
  ],
})
export class FloorModule {}
