import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { ProcurementModule } from "../procurement/procurement.module";
import { AskAiController } from "./ask-ai.controller";
import { AskAiService } from "./ask-ai.service";

/**
 * AuthModule is required, not optional: AskAiController is guarded by
 * JwtAuthGuard, and a guard resolves in the context of the module declaring the
 * controller. Omitting it aborts application startup — the failure LogsModule
 * and one-tap-actions both hit earlier in this milestone, and the one
 * `scripts/check_gateway_boots.sh` exists to catch.
 *
 * ProcurementModule supplies the executors. Ask AI depends on procurement and
 * procurement knows nothing about Ask AI, which keeps the dependency acyclic —
 * Nest fails circular forwardRefs by injecting undefined at runtime rather than
 * erroring at build time.
 *
 * ModelClientModule is @Global, so ModelClientService and NfVerdictService need
 * no import line.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule, ProcurementModule],
  controllers: [AskAiController],
  providers: [AskAiService],
  exports: [AskAiService],
})
export class AskAiModule {}
