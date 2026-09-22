import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { VendorIntelModule } from "../vendor-intel/vendor-intel.module";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { AskAiModule } from "../ask-ai/ask-ai.module";
import { CalendarModule } from "../calendar/calendar.module";
import { HouseCounterController } from "./house-counter.controller";
import { HouseCounterService } from "./house-counter.service";
import { HouseDayController } from "./house-day.controller";
import { HouseDayService } from "./house-day.service";

/**
 * The house shell's reads (sketch 119 direction D).
 *
 * AuthModule is required: the controller is guarded by JwtAuthGuard, and a
 * guard resolves in the module that declares the controller
 * (`scripts/check_gateway_boots.sh` exists for the time that was forgotten).
 *
 * Not circular: every module imported here is a leaf with respect to this one —
 * none of them imports `HouseModule`. The counter READS through each owning
 * service, so its counts are the pages' counts, never a second query that can
 * learn to disagree.
 *
 * `CalendarModule` added for `GET /house/day` (sketch 119 §E, the day line):
 * `HouseDayService` reads `CalendarService.listEvents` for the calendar and
 * reminders registers, `ReceivingService.arrivedToday` — a sibling of
 * `listUnverified`, the counter's own source for its `deliveries` register,
 * scoped to today's door events instead of the still-open ones — for
 * deliveries that arrived, and `OperatingHoursService`
 * (already available via `RestaurantsModule`, exported for the ADR 0093
 * verifier) for the band. `CalendarModule` forward-refs `NotificationsModule`
 * and `CommunicationsModule` for its OWN reasons (its module doc explains);
 * neither of those imports `HouseModule`, so this stays a leaf import too —
 * `scripts/check_gateway_boots.sh` is what proves the graph still resolves.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ProcurementModule,
    ConversationsModule,
    VendorIntelModule,
    RestaurantsModule,
    AskAiModule,
    CalendarModule,
  ],
  controllers: [HouseCounterController, HouseDayController],
  providers: [HouseCounterService, HouseDayService],
})
export class HouseModule {}
