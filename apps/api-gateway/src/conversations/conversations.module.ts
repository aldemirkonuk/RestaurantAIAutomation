import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects.
  imports: [DatabaseModule, AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
