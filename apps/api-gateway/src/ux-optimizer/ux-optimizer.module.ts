import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { UxOptimizerController } from "./ux-optimizer.controller";
import { UxOptimizerService } from "./ux-optimizer.service";
import { DatabaseModule } from "../database/database.module";

/**
 * UX Optimizer Module — the in-product, self-learning UX agent.
 *
 * Observes friction telemetry, proposes SOTA-aligned interface improvements,
 * serves human-approved + rollout-gated overrides to the web, and records the
 * measured outcome back to a learnings ledger. Ships DARK by default
 * (UX_OPTIMIZER_ENABLED=false) — nothing reaches users until turned on and a
 * human approves each change.
 */
@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [UxOptimizerController],
  providers: [UxOptimizerService],
  exports: [UxOptimizerService],
})
export class UxOptimizerModule {}
