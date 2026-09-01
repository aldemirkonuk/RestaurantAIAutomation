import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import {
  CellarAgingController,
  CountFreshnessController,
  PurchaseReasonController,
} from "./dashboard-signals.controller";
import { CellarAgingService } from "./cellar-aging.service";
import { CountFreshnessService } from "./count-freshness.service";
import { PurchaseReasonService } from "./purchase-reason.service";

/**
 * Three signals the rebuilt dashboard needs that nothing produced before
 * (dashboard rebuild spec §3.1, §3.2, §5):
 *
 *   CellarAgingService     what is on a clock, ranked by urgency and not by
 *                          money, from data already held.
 *   PurchaseReasonService  why a purchase was made, captured at ordering, and
 *                          attached to the idle-stock read.
 *   CountFreshnessService  when each figure was last counted and what that
 *                          count actually changed.
 *
 * They live in their own module rather than inside DashboardModule because
 * none of them is an aggregation of existing endpoints — each reads the
 * database directly and each is independently useful to other surfaces
 * (mobile counting, the receiving door, the vendor strip).
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    CellarAgingController,
    PurchaseReasonController,
    CountFreshnessController,
  ],
  providers: [CellarAgingService, PurchaseReasonService, CountFreshnessService],
  exports: [CellarAgingService, PurchaseReasonService, CountFreshnessService],
})
export class DashboardSignalsModule {}
