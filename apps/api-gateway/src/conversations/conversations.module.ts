import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";
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
  // MailController/MailService: the read model behind the /communications
  // Mail tab (founder /goal 2026-11-07). Read-only; DatabaseModule is all it needs.
  controllers: [ConversationsController, MailController],
  providers: [ConversationsService, MailService],
  // MailService is exported for the house counter's "Vendor replies waiting"
  // register, which counts by Mail's own rule (r36 mail gap 7).
  exports: [ConversationsService, MailService],
})
export class ConversationsModule {}
