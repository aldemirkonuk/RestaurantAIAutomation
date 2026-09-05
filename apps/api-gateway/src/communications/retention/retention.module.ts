/**
 * The retention module (ADR 0118, retention, decided 2026-09-05).
 *
 * A MODULE OF ITS OWN, NOT A PROVIDER INSIDE `CommunicationsModule`.
 * `IntegrationsModule` needs the sweep — a person disconnecting their grant is
 * the moment the mail goes — and `CommunicationsModule` cannot be imported
 * from there: `integrations.module` imports `AuthModule`, `auth.module`
 * imports `CommunicationsModule`, and Node closes that ring at require time,
 * which is a failure no `forwardRef` can open (the comment on
 * `communications.module.ts` records the ReferenceError this produced the
 * first time somebody tried). This module imports `DatabaseModule` and
 * `NotificationsModule` and nothing else, so importing it from
 * `IntegrationsModule` adds no edge back into `AuthModule`.
 *
 * `NotificationsModule` and `AuthModule` are behind `forwardRef`s because both
 * sit on the existing `auth -> communications -> auth` ring, and
 * `check_gateway_boots.sh` is what proves the injector resolves — tsc and jest
 * cannot see a Nest graph.
 *
 * WHY `AuthModule` AT ALL. The one route here is `@UseGuards(JwtAuthGuard)`,
 * and that guard injects `TokenBlacklistService` from `AuthModule`. Measured
 * before importing it: nothing `AuthModule` requires reaches
 * `IntegrationsModule` or this module (`auth.module.ts` imports Database,
 * Cache, Config, Passport, Jwt and a forwardRef to Communications), and only
 * `app.module` imports `IntegrationsModule`, so this edge closes no new ring.
 */

import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../../auth/auth.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { RawMailRetentionService } from "./raw-mail-retention.service";
import { RawMailRetentionCron } from "./raw-mail-retention.cron";
import { RetentionController } from "./retention.controller";

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => AuthModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [RetentionController],
  providers: [RawMailRetentionService, RawMailRetentionCron],
  exports: [RawMailRetentionService, RawMailRetentionCron],
})
export class RetentionModule {}
