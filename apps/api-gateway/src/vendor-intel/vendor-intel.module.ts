import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { VendorComparisonService } from "./vendor-comparison.service";
import { VendorIntelController } from "./vendor-intel.controller";
import { VendorPageExtractorService } from "./vendor-page-extractor.service";

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
  providers: [VendorComparisonService, VendorPageExtractorService],
  exports: [VendorComparisonService, VendorPageExtractorService],
})
export class VendorIntelModule {}
