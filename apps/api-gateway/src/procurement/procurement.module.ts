import { Module } from "@nestjs/common";
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";
import { RecurringOrdersService } from "./recurring-orders.service";
import { RecurringOrdersController } from "./recurring-orders.controller";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "../events/events.module";
import { InventoryLedgerModule } from "../inventory-ledger/inventory-ledger.module";
import { OrchestratorModule } from "../common/orchestrator/orchestrator.module";
import { CommunicationsModule } from "../communications/communications.module";
import { WebsocketModule } from "../websocket/websocket.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    EventsModule,
    InventoryLedgerModule,
    OrchestratorModule,
    CommunicationsModule,
    WebsocketModule,
  ],
  controllers: [ProcurementController, RecurringOrdersController],
  providers: [ProcurementService, RecurringOrdersService],
  exports: [ProcurementService, RecurringOrdersService],
})
export class ProcurementModule {}
