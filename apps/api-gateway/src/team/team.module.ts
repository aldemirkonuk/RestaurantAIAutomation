import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PushModule } from "../push/push.module";
import { CommunicationsModule } from "../communications/communications.module";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";
import { ScheduleService } from "./schedule.service";
import { PerformanceService } from "./performance.service";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    NotificationsModule,
    PushModule,
    CommunicationsModule,
  ],
  controllers: [TeamController],
  providers: [TeamService, ScheduleService, PerformanceService],
  exports: [TeamService, ScheduleService],
})
export class TeamModule {}
