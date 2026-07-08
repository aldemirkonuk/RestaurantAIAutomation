import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { AuthModule } from "../auth/auth.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";

@Module({
  imports: [AuthModule, OrchestratorModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
