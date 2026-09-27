import { Module } from "@nestjs/common";
import { PromotionsController } from "./promotions.controller";
import { PromotionsService } from "./promotions.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { MenusModule } from "../menus/menus.module";

@Module({
  // MenusModule: the current menu(s) and their paged lines for the
  // house-first "On my menu" rung (MenusService.readCurrentMenus).
  imports: [DatabaseModule, AuthModule, MenusModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
})
export class PromotionsModule {}
