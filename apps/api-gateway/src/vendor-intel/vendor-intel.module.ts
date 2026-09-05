import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { VendorComparisonService } from "./vendor-comparison.service";
import { VendorIntelController } from "./vendor-intel.controller";
import { VendorPageExtractorService } from "./vendor-page-extractor.service";
import { VendorSiteSweepService } from "./vendor-site-sweep.service";
import { OutlierRejudgeService } from "./outlier-rejudge.service";
import { ShopReferenceSweepService } from "./shop-reference-sweep.service";

/**
 * AuthModule is required, not optional: VendorIntelController is guarded by
 * JwtAuthGuard and RolesGuard, and a guard resolves in the context of the
 * module declaring the controller. Omitting it aborts application startup,
 * not just this route — the failure mode LogsModule and one-tap-actions both
 * hit earlier in this milestone.
 */
@Module({
  imports: [DatabaseModule, ConfigModule, AuthModule],
  controllers: [VendorIntelController],
  providers: [
    VendorComparisonService,
    VendorPageExtractorService,
    VendorSiteSweepService,
    OutlierRejudgeService,
    ShopReferenceSweepService,
  ],
  exports: [
    VendorComparisonService,
    VendorPageExtractorService,
    VendorSiteSweepService,
    OutlierRejudgeService,
    ShopReferenceSweepService,
  ],
})
export class VendorIntelModule {}
