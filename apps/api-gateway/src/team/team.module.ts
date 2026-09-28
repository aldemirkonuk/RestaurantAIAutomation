import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PushModule } from "../push/push.module";
import { CommunicationsModule } from "../communications/communications.module";
// The crew text (ADR 0121). A module of its own rather than a provider inside
// `CommunicationsModule`, so this edge adds nothing to the
// `auth -> communications -> auth` ring — see `text-senders.module.ts`.
import { TextSendersModule } from "../communications/text/text-senders.module";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";
import { NotesService } from "./notes.service";
import { ScheduleService } from "./schedule.service";
import { PerformanceService } from "./performance.service";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    NotificationsModule,
    PushModule,
    CommunicationsModule,
    TextSendersModule,
  ],
  controllers: [TeamController],
  providers: [NotesService, TeamService, ScheduleService, PerformanceService],
  exports: [TeamService, ScheduleService],
})
export class TeamModule {}
