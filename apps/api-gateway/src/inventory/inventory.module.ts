import { Module, forwardRef } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { PhotoCountService } from "./photo-count.service";
import { AuthModule } from "../auth/auth.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";
import { NotificationsModule } from "../notifications/notifications.module";
// WinesModule exports WineSubmissionsService, which the bulk receive path uses to
// resolve-or-create library wines. WinesModule does not import InventoryModule, so
// this is a plain import rather than a forwardRef.
import { WinesModule } from "../wines/wines.module";

@Module({
  imports: [
    AuthModule,
    OrchestratorModule,
    forwardRef(() => NotificationsModule),
    WinesModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService, PhotoCountService],
  exports: [InventoryService],
})
export class InventoryModule {}
