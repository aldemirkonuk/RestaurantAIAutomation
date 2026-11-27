import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { RecipesController } from "./recipes.controller";
import { RecipesService } from "./recipes.service";
import { DishesController } from "./dishes.controller";
import { DishesService } from "./dishes.service";
import { LooseLinesController } from "./loose-lines.controller";
import { LooseLinesService } from "./loose-lines.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecipesController, DishesController, LooseLinesController],
  providers: [RecipesService, DishesService, LooseLinesService],
})
export class RecipesModule {}
