import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { SimposController } from "./simpos.controller";
import { SimposService } from "./simpos.service";

/**
 * SimPOS module — the fake POS terminal's backend (SimPOS testbed plan,
 * decisions C23-C31). Intentionally has no dependency on PosHubModule; the
 * two only ever talk over the signed webhook (decision C25).
 */
@Module({
  // AuthModule supplies TokenBlacklistService, which JwtAuthGuard injects. The
  // guard resolves in THIS module's context, so without this import the whole
  // app fails to boot — not just these routes. AuthModule is not @Global().
  // This is the exact defect that crash-looped production on 2026-08-24
  // (PosHubModule, AnalyticsModule); scripts/check_gateway_boots.sh now catches
  // it in CI, and does for this module too.
  imports: [AuthModule, DatabaseModule],
  controllers: [SimposController],
  providers: [SimposService],
  exports: [SimposService],
})
export class SimposModule {}
