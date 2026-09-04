import { Module, forwardRef } from "@nestjs/common";
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
import { NotificationsModule } from "../notifications/notifications.module";
import { DocumentsController } from "./documents/documents.controller";
import { DocumentIntakeService } from "./documents/document-intake.service";
import { DocumentExtractorService } from "./documents/document-extractor.service";
import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";
import { CreditsController } from "./documents/credits.controller";
import { SettingsModule } from "../settings/settings.module";
import { OrganizationsModule } from "../organizations/organizations.module";

/**
 * `SettingsModule` and `OrganizationsModule` are the approval gate's two halves
 * (ADR 0116). `ApprovalThresholdsService` supplies the house's rules and
 * `OrganizationsService.resolveRestaurantRole` supplies the actor's rank, and
 * `ProcurementService.approveOrder` refuses the seal when the two disagree.
 *
 * Neither import is circular: `SettingsModule` imports Database, Auth,
 * SettingsAudit and VendorTerms; `OrganizationsModule` imports Database and
 * Auth. Nothing in either graph imports procurement, so no `forwardRef` is
 * needed and Nest resolves both at build time rather than injecting `undefined`
 * at runtime — which is the failure mode a `forwardRef` on a real cycle would
 * have produced, and which a gate must never suffer silently.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    EventsModule,
    InventoryLedgerModule,
    OrchestratorModule,
    CommunicationsModule,
    WebsocketModule,
    SettingsModule,
    OrganizationsModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    ProcurementController,
    RecurringOrdersController,
    DocumentsController,
    ReceivingController,
    CreditsController,
  ],
  providers: [
    ProcurementService,
    RecurringOrdersService,
    DocumentIntakeService,
    DocumentExtractorService,
    ReceivingService,
  ],
  // Exported for callers that already depend on procurement. The inbound-email
  // path deliberately does NOT call it directly — ProcurementModule imports
  // OrchestratorModule, so that would need a circular forwardRef, and Nest fails
  // those by injecting undefined at runtime rather than erroring at build time.
  // The email channel runs as a sweep inside DocumentIntakeService instead.
  exports: [ProcurementService, RecurringOrdersService, DocumentIntakeService],
})
export class ProcurementModule {}
