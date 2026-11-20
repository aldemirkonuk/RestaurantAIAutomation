import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { RecipesController } from "./recipes.controller";
import { RecipesService } from "./recipes.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RecipesController],
  providers: [RecipesService],
})
export class RecipesModule {}
