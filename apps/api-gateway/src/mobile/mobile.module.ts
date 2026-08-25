import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ToastModule } from "../toast/toast.module";
import { PushModule } from "../push/push.module";
import { IdempotencyInterceptor } from "../common/idempotency/idempotency.interceptor";
import { MobileController } from "./mobile.controller";
import { MobileService } from "./mobile.service";

@Module({
  imports: [
    // MobileController guards routes with JwtAuthGuard, which depends on
    // TokenBlacklistService. AuthModule isn't @Global(), so every module using
    // the guard must import it directly (see ProcurementModule for the same pattern).
    AuthModule,
    DatabaseModule,
    ProcurementModule,
    ConversationsModule,
    NotificationsModule,
    ToastModule,
    PushModule,
  ],
  controllers: [MobileController],
  providers: [
    MobileService,
    // Global on purpose: only requests carrying an Idempotency-Key header
    // (the mobile outbox) pay the dedupe lookup; everything else passes by.
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class MobileModule {}
