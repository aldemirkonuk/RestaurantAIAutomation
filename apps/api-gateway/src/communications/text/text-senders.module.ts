/**
 * The text-sender module (ADR 0121, the parts the founder decided 2026-09-05).
 *
 * A MODULE OF ITS OWN, NOT A PROVIDER INSIDE `CommunicationsModule`, for the
 * same reason `RetentionModule` is one: `TeamModule` needs the send path for
 * the crew text, and `CommunicationsModule` sits on the
 * `auth -> communications -> auth` ring that Node closes at require time and no
 * `forwardRef` can open (the ReferenceError is recorded in
 * `communications.module.ts`'s own header). This module imports
 * `DatabaseModule`, `OrganizationsModule` and a `forwardRef` to `AuthModule`,
 * and nothing else.
 *
 * WHY `OrganizationsModule`. `assertCanManageRestaurant` is the one
 * implementation of "who may act for this house" (ADR 0114 closed G19 by making
 * the read posture and the write posture agree on it), and `IntegrationsModule`
 * already imports it for exactly this. A second copy of the role rule in this
 * module would be a second answer to the same question.
 *
 * WHY `AuthModule`. The routes are `@UseGuards(JwtAuthGuard)` and that guard
 * injects `TokenBlacklistService`. Behind a `forwardRef` because `AuthModule`
 * is on the existing ring; `check_gateway_boots.sh` is what proves the injector
 * resolves, since tsc and jest cannot see a Nest graph.
 *
 * `SmsService` is deliberately NOT imported. The deployment's shared Plivo
 * number must not be reachable from the house send path — see the header of
 * `text-sender.service.ts`.
 */

import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuthModule } from "../../auth/auth.module";
import { OrganizationsModule } from "../../organizations/organizations.module";
import { TextSenderService } from "./text-sender.service";
import { TextSendersController } from "./text-senders.controller";

@Module({
  imports: [DatabaseModule, forwardRef(() => AuthModule), OrganizationsModule],
  controllers: [TextSendersController],
  providers: [TextSenderService],
  exports: [TextSenderService],
})
export class TextSendersModule {}
