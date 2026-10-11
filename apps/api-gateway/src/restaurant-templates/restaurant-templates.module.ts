import { Module } from "@nestjs/common";
import { RestaurantTemplatesController } from "./restaurant-templates.controller";
import { RestaurantTemplatesService } from "./restaurant-templates.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { VendorSendAuthorityModule } from "../organizations/vendor-send-authority.module";

@Module({
  imports: [DatabaseModule, AuthModule, VendorSendAuthorityModule],
  controllers: [RestaurantTemplatesController],
  providers: [RestaurantTemplatesService],
  exports: [RestaurantTemplatesService],
})
export class RestaurantTemplatesModule {}
