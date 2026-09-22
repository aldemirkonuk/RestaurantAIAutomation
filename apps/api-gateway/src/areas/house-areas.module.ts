import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { AreaRoutingModule } from "./area-routing.module";
import { HouseAreasController } from "./house-areas.controller";
import { HouseAreasService } from "./house-areas.service";

/** Areas, memberships, lead marks and Away (ADR 0218): the routes and their writes. */
@Module({
  imports: [DatabaseModule, AuthModule, AreaRoutingModule],
  controllers: [HouseAreasController],
  providers: [HouseAreasService],
  exports: [HouseAreasService, AreaRoutingModule],
})
export class HouseAreasModule {}
