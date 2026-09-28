import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { LogsController } from "./logs.controller";
import { LogsTimelineService } from "./logs-timeline.service";

/**
 * AuthModule is load-bearing, not decorative. LogsController is annotated
 * `@UseGuards(JwtAuthGuard)`, and a guard resolves in the context of the module
 * that declares the controller — so without AuthModule here, JwtAuthGuard
 * cannot find TokenBlacklistService and Nest fails to construct it.
 *
 * The failure is not scoped to this route: it aborts the whole application at
 * startup with "Nest can't resolve dependencies of the JwtAuthGuard ... in the
 * LogsModule context". Same cause and same fix as one-tap-actions.module.ts.
 *
 * RestaurantsModule supplies `MembersService`, whose `assertMembership` is the
 * controller's tenancy gate (2026-09-11): the path names a house, and the
 * caller has to belong to it.
 */
@Module({
  imports: [DatabaseModule, AuthModule, RestaurantsModule],
  controllers: [LogsController],
  providers: [LogsTimelineService],
  exports: [LogsTimelineService],
})
export class LogsModule {}
