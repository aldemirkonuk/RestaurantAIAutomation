import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { CellarController } from "./cellar.controller";
import { CellarRegistersService } from "./cellar-registers.service";
import { CellarSettingsService } from "./cellar-settings.service";
import { ZonesService } from "./zones.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CellarController],
  providers: [CellarRegistersService, ZonesService, CellarSettingsService],
  exports: [CellarRegistersService, ZonesService, CellarSettingsService],
})
export class CellarModule {}
