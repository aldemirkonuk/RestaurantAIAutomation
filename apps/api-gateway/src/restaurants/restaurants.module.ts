import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";
import { OperatingHoursController } from "./operating-hours.controller";
import { OperatingHoursService } from "./operating-hours.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MembersController, OperatingHoursController],
  providers: [MembersService, OperatingHoursService],
  // OperatingHoursService is exported so the ADR 0093 verifier can ask a
  // scenario run's venue whether it was open, without a second copy of the
  // read.
  exports: [MembersService, OperatingHoursService],
})
export class RestaurantsModule {}
