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
import { CryptoModule } from "../common/crypto/crypto.module";
// The SERVICE file, not `integrations.module`. See the note beside the
// provider below; `communications.module.ts:66-89` records what happens when
// the module is imported instead.
import { IntegrationsOauthService } from "../integrations/integrations-oauth.service";
import { CalendarPushService } from "./push/calendar-push.service";
import { CalendarPushReconcileService } from "./push/calendar-push-reconcile.service";
import {
  GoogleCalendarClient,
  HttpGoogleCalendarClient,
} from "./push/google-calendar.client";

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
    // For `TokenCryptoService`, which `IntegrationsOauthService` needs when it
    // is provided from its class below.
    CryptoModule,
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
    /**
     * ADR 0111 §5 direction 1 — the day-book pushed to Google.
     *
     * `IntegrationsOauthService` is PROVIDED FROM ITS CLASS rather than by
     * importing `IntegrationsModule`, exactly as `CommunicationsModule` does
     * and for the reason recorded there (`communications.module.ts:66-89`):
     * `integrations.module` imports `OrganizationsModule`, which imports
     * `AuthModule`, and `forwardRef` defers NEST's graph without deferring
     * NODE's module loading. The service itself imports only DatabaseService,
     * ConfigService and TokenCryptoService (plus an `@Optional`
     * RawMailRetentionService this module does not supply and this direction
     * never reaches — it is only used by `disconnect` on a MIRRORING grant,
     * and `google_calendar` mirrors nothing), so requiring it directly adds no
     * module edge at all.
     *
     * The cost is a second INSTANCE, and it is not a second door: the service
     * holds no state, so this instance runs the same `getAccessToken` — with
     * the same ADR 0114 house-revocation check — as the one behind
     * `/integrations/oauth`. `scripts/check_gateway_boots.sh` is what proves
     * the shape resolves.
     */
    IntegrationsOauthService,
    { provide: GoogleCalendarClient, useClass: HttpGoogleCalendarClient },
    CalendarPushService,
    CalendarPushReconcileService,
  ],
  exports: [
    CalendarService,
    CalendarRemindersService,
    WeatherService,
    CalendarPushService,
  ],
})
export class CalendarModule {}
