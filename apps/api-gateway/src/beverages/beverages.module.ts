import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { BeveragesController } from "./beverages.controller";
import { BeveragesService } from "./beverages.service";

@Module({
  imports: [DatabaseModule, AuthModule, OrganizationsModule],
  controllers: [BeveragesController],
  providers: [BeveragesService],
  exports: [BeveragesService],
})
export class BeveragesModule {}
