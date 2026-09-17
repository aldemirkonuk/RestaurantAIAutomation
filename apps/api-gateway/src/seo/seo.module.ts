import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { VendorPortalModule } from "../vendor-portal/vendor-portal.module";
import { SeoController } from "./seo.controller";
import { SeoService } from "./seo.service";

@Module({
  imports: [DatabaseModule, VendorPortalModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
