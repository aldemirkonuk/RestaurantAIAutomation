import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { WebsocketModule } from "../websocket/websocket.module";
// ADR 0242 (OD-204): a member removed here is removed by TeamService's one
// removal path. TeamModule reaches nothing that imports this module, so the
// edge adds no ring (checked over every *.module.ts import, 2026-09-29).
import { TeamModule } from "../team/team.module";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";
import { OperatingHoursController } from "./operating-hours.controller";
import { OperatingHoursService } from "./operating-hours.service";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    TeamModule,
    forwardRef(() => WebsocketModule),
  ],
  controllers: [MembersController, OperatingHoursController],
  providers: [MembersService, OperatingHoursService],
  // OperatingHoursService is exported so the ADR 0093 verifier can ask a
  // scenario run's venue whether it was open, without a second copy of the
  // read.
  exports: [MembersService, OperatingHoursService],
})
export class RestaurantsModule {}
