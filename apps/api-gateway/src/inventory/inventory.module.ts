import { Module, forwardRef } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { PhotoCountService } from "./photo-count.service";
import { AuctionLotRecordsService } from "./auction-lot-records.service";
import { AuthModule } from "../auth/auth.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";
import { NotificationsModule } from "../notifications/notifications.module";
// WinesModule exports WineSubmissionsService, which the bulk receive path uses to
// resolve-or-create library wines. WinesModule does not import InventoryModule, so
// this is a plain import rather than a forwardRef.
import { WinesModule } from "../wines/wines.module";
// ADR 0193: the PATCH's price fields are an owner/manager act
// (`assertCanManageRestaurant`). OrganizationsModule imports only Database and
// Auth, so this adds no cycle.
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [
    AuthModule,
    OrchestratorModule,
    forwardRef(() => NotificationsModule),
    WinesModule,
    OrganizationsModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService, PhotoCountService, AuctionLotRecordsService],
  exports: [InventoryService],
})
export class InventoryModule {}
