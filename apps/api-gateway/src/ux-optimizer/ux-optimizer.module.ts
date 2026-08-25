import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { UxOptimizerController } from "./ux-optimizer.controller";
import { UxOptimizerService } from "./ux-optimizer.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";

/**
 * UX Optimizer Module — the in-product, self-learning UX agent.
 *
 * Observes friction telemetry, proposes SOTA-aligned interface improvements,
 * serves human-approved + rollout-gated overrides to the web, and records the
 * measured outcome back to a learnings ledger. Ships DARK by default
 * (UX_OPTIMIZER_ENABLED=false) — nothing reaches users until turned on and a
 * human approves each change.
 *
 * AuthModule is imported because the controller is guarded by JwtAuthGuard,
 * which injects TokenBlacklistService. A guard is resolved in the context of the
 * module that declares the controller, so adding @UseGuards without this import
 * makes the whole application fail to boot — not just this route. It is not
 * optional and it is not a convenience import.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [UxOptimizerController],
  providers: [UxOptimizerService],
  exports: [UxOptimizerService],
})
export class UxOptimizerModule {}
