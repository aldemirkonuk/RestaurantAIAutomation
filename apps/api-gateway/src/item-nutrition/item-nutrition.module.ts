import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { ItemNutritionController } from "./item-nutrition.controller";
import { ItemNutritionService } from "./item-nutrition.service";
import { NutritionLookupService } from "./nutrition-lookup.service";

/**
 * What a good is made of (founder /goal 2026-11-07). Its own module, not a
 * part of InventoryModule, so the drawer stack (#896-#900) and this lane do
 * not edit the same file. DatabaseModule is global.
 */
@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ItemNutritionController],
  providers: [ItemNutritionService, NutritionLookupService],
})
export class ItemNutritionModule {}
