import { Module } from "@nestjs/common";
import { VendorCatalogueController } from "./vendor-catalogue.controller";
import { VendorCatalogueService } from "./vendor-catalogue.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [VendorCatalogueController],
  providers: [VendorCatalogueService],
  exports: [VendorCatalogueService],
})
export class VendorCatalogueModule {}
