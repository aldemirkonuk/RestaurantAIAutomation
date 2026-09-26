import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { AreaRoutingModule } from "./area-routing.module";
// ADR 0218, round 2: ending someone's Away releases what waited for them.
// TeamModule imports nothing from areas but the routing module, so this edge
// adds no ring (`scripts/check_gateway_boots.sh` proves it).
import { TeamModule } from "../team/team.module";
import { HouseAreasController } from "./house-areas.controller";
import { HouseAreasService } from "./house-areas.service";

/** Areas, memberships, lead marks and Away (ADR 0218): the routes and their writes. */
@Module({
  imports: [DatabaseModule, AuthModule, AreaRoutingModule, TeamModule],
  controllers: [HouseAreasController],
  providers: [HouseAreasService],
  exports: [HouseAreasService, AreaRoutingModule],
})
export class HouseAreasModule {}
