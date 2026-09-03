import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { CommunicationsModule } from "../communications/communications.module";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsModule,
    AuthModule,
    // The reminder cron writes through `persistForRestaurant` and enumerates
    // its tenants with `ScheduledTenantsService` (ADR 0022). Both are
    // forwardRef'd for the same reason CommunicationsModule forwardRefs
    // AuthModule: AuthModule already imports CommunicationsModule, and
    // NotificationsModule imports CommunicationsModule, so a plain import here
    // closes a cycle through AuthModule and the app dies at load.
    // `scripts/check_gateway_boots.sh` is what proves this resolves.
    forwardRef(() => NotificationsModule),
    forwardRef(() => CommunicationsModule),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarRemindersService],
  exports: [CalendarService, CalendarRemindersService],
})
export class CalendarModule {}
