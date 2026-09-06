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
import { ArchiveModule } from "../archive/archive.module";
import { RawMailRetentionService } from "./raw-mail-retention.service";
import { RawMailRetentionCron } from "./raw-mail-retention.cron";
import { RetentionController } from "./retention.controller";

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => AuthModule),
    forwardRef(() => NotificationsModule),
    /**
     * ADR 0118 D16 — the sweep must ask the archive which replies already have
     * a verified copy in the house's own cloud BEFORE it deletes anything, and
     * a revocation runs one last export before it deletes anyway. The edge runs
     * retention -> archive and never back: `ArchiveModule` imports Database,
     * Config, Crypto, Seal and a forwardRef to Auth, none of which reach this
     * module, so it closes no ring that `IntegrationsModule -> RetentionModule`
     * does not already have.
     */
    ArchiveModule,
  ],
  controllers: [RetentionController],
  providers: [RawMailRetentionService, RawMailRetentionCron],
  exports: [RawMailRetentionService, RawMailRetentionCron],
})
export class RetentionModule {}
