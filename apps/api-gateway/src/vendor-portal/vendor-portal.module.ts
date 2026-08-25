import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { VendorPortalController } from "./vendor-portal.controller";
import { VendorPortalService } from "./vendor-portal.service";

@Module({
  imports: [DatabaseModule],
  controllers: [VendorPortalController],
  providers: [VendorPortalService],
  exports: [VendorPortalService],
})
export class VendorPortalModule {}
