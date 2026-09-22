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
// ADR 0218, round 2: a message to a person who is Away waits for them. The
// routing module depends on the database alone, so it adds no ring.
import { AreaRoutingModule } from "../areas/area-routing.module";
import { AwayHoldService } from "./away-hold.service";
import { AwayReleaseService } from "./away-release.service";
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
    AreaRoutingModule,
  ],
  controllers: [TeamController],
  providers: [
    NotesService,
    TeamService,
    ScheduleService,
    PerformanceService,
    AwayHoldService,
    AwayReleaseService,
  ],
  // AwayReleaseService: an "End Away now" on /house/away releases what waited.
  exports: [TeamService, ScheduleService, AwayReleaseService],
})
export class TeamModule {}
