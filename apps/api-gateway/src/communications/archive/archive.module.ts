/**
 * The archive module (ADR 0118 D16, decided 2026-09-05).
 *
 * A MODULE OF ITS OWN, AND `RetentionModule` IMPORTS IT — never the reverse.
 * The sweep must ask the archive which replies have a verified copy before it
 * deletes anything, so the edge runs retention -> archive. An edge back would
 * close a ring through `IntegrationsModule`, which already imports
 * `RetentionModule` for the revocation sweep.
 *
 * `IntegrationsOauthService` IS PROVIDED FROM ITS CLASS, NOT BY IMPORTING
 * `IntegrationsModule`. This is the shape `CommunicationsModule` already uses
 * and its header records why the alternative does not boot:
 *
 *   ReferenceError: Cannot access 'AuthModule' before initialization
 *     at organizations.module.js:28
 *
 * `forwardRef` defers NEST's graph, not NODE's module loading, and the ring
 * closes at load time: auth.module -> communications.module ->
 * integrations.module -> organizations.module -> auth.module.
 * `integrations-oauth.service.ts` itself imports only `DatabaseService`,
 * `ConfigService` and `TokenCryptoService`, so requiring the CLASS adds no edge
 * at all. A second instance is the cost and it is not a second door: the service
 * holds no state, so both instances run the same `getAccessToken`, including the
 * ADR-0114 house-revocation check at integrations-oauth.service.ts:977-988.
 * `check_gateway_boots.sh` is what proves this shape.
 *
 * `AuthModule` is here for the same reason `RetentionModule` imports it: the
 * routes are `@UseGuards(JwtAuthGuard, RolesGuard)` and that guard injects
 * `TokenBlacklistService`. It is behind a `forwardRef` because `AuthModule` sits
 * on the existing auth -> communications -> auth ring.
 *
 * `SealModule` imports `DatabaseModule` and nothing else, so it closes no ring.
 */

import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../../auth/auth.module";
import { CryptoModule } from "../../common/crypto/crypto.module";
import { SealModule } from "../../common/seal/seal.module";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { DriveArchiveWriter } from "./drive-archive.writer";
import { HouseMailArchiveService } from "./house-mail-archive.service";
import { HouseMailArchiveController } from "./house-mail-archive.controller";
import { HouseMailArchiveCron } from "./house-mail-archive.cron";
import { HOUSE_MAIL_ARCHIVE } from "./house-mail-archive.port";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CryptoModule,
    SealModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [HouseMailArchiveController],
  providers: [
    DriveArchiveWriter,
    IntegrationsOauthService,
    HouseMailArchiveService,
    HouseMailArchiveCron,
    /**
     * The token the retention sweep injects by. `useExisting` rather than a
     * second instance: it IS this service, reached through a name so that
     * `raw-mail-retention.service.ts` never has to `require` this file. See
     * `house-mail-archive.port.ts` for the boot failure that shape prevents.
     */
    { provide: HOUSE_MAIL_ARCHIVE, useExisting: HouseMailArchiveService },
  ],
  exports: [
    HouseMailArchiveService,
    HouseMailArchiveCron,
    DriveArchiveWriter,
    HOUSE_MAIL_ARCHIVE,
  ],
})
export class ArchiveModule {}
