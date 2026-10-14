import { Module } from "@nestjs/common";
import { InventoryLedgerController } from "./inventory-ledger.controller";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { AuthModule } from "../auth/auth.module";
// F-1695: the shelve-by-hand act is owner/manager (`assertCanManageRestaurant`).
// OrganizationsModule imports only Database, Auth and SettingsAudit: no cycle.
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [DatabaseModule, EventsModule, AuthModule, OrganizationsModule],
  controllers: [InventoryLedgerController],
  providers: [InventoryLedgerService],
  exports: [InventoryLedgerService],
})
export class InventoryLedgerModule {}
