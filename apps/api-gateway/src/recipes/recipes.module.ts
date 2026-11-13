import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { RecipesController } from "./recipes.controller";
import { RecipesService } from "./recipes.service";
import { DishesController } from "./dishes.controller";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecipesController, DishesController],
  providers: [RecipesService],
})
export class RecipesModule {}
