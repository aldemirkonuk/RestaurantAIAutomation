import { Module } from "@nestjs/common";
import { DistributorDiscoveryController } from "./distributor-discovery.controller";
import { DistributorDiscoveryService } from "./distributor-discovery.service";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DistributorDiscoveryController],
  providers: [DistributorDiscoveryService],
  exports: [DistributorDiscoveryService],
})
export class DistributorDiscoveryModule {}
