import { Module } from "@nestjs/common";
import { WinesController } from "./wines.controller";
import { WinesService } from "./wines.service";
import { WineSubmissionsService } from "./wine-submissions.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WinesController],
  providers: [WinesService, WineSubmissionsService],
  exports: [WinesService, WineSubmissionsService],
})
export class WinesModule {}
