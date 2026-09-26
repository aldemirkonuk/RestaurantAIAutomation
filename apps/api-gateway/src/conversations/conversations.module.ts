import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { SealModule } from "../common/seal/seal.module";
import { VendorSendAuthorityModule } from "../organizations/vendor-send-authority.module";

@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects.
  // SealModule and VendorSendAuthorityModule are the approve route's two gates
  // (ADR 0175 D9/D10, 2026-09-21); each imports DatabaseModule and nothing else,
  // so neither adds a cycle.
  imports: [DatabaseModule, AuthModule, SealModule, VendorSendAuthorityModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
