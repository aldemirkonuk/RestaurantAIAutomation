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
import { WeatherService } from "../weather/weather.service";
import { NwsWeatherProvider } from "../weather/nws.provider";
import { WeatherPrefetchService } from "../weather/weather-prefetch.service";
import { RecordedDaysService } from "./recorded-days.service";
import { DayRecordService } from "./day-record.service";

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
  // The weather overlay's provider and service live here rather than in their
  // own Nest module: a top-level module would have to be registered in
  // `app.module.ts`, which this build does not own, and the calendar is the
  // only consumer. `apps/api-gateway/src/weather/` stays a directory of its
  // own so a second issuer (Open-Meteo, for the first non-US house) is a class
  // beside `NwsWeatherProvider` and not a change here.
  providers: [
    CalendarService,
    CalendarRemindersService,
    NwsWeatherProvider,
    WeatherService,
    WeatherPrefetchService,
    RecordedDaysService,
    DayRecordService,
  ],
  exports: [CalendarService, CalendarRemindersService, WeatherService],
})
export class CalendarModule {}
