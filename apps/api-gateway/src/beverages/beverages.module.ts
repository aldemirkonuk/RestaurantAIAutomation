import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { BeveragesController } from "./beverages.controller";
import { BeveragesService } from "./beverages.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [BeveragesController],
  providers: [BeveragesService],
  exports: [BeveragesService],
})
export class BeveragesModule {}
