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
// The seal on an order (founder, 2026-09-04). Not circular: SealModule imports
// DatabaseModule and nothing else.
import { SealModule } from "../common/seal/seal.module";
import { DeliveriesController } from "./deliveries.controller";
import { CanonicalDocumentService } from "./canonical/canonical-document.service";
import { DeliverySpineService } from "./canonical/delivery-spine.service";

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
    SealModule,
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    ProcurementController,
    RecurringOrdersController,
    DocumentsController,
    ReceivingController,
    CreditsController,
    DeliveriesController,
  ],
  providers: [
    ProcurementService,
    RecurringOrdersService,
    DocumentIntakeService,
    DocumentExtractorService,
    ReceivingService,
    // ADR 0104 D12 slice 2. Slice 1 shipped these unregistered — the class
    // existed and Nest could not construct it, so the first route to inject one
    // would have failed at boot with a DI error CI cannot see.
    CanonicalDocumentService,
    DeliverySpineService,
  ],
  // Exported for callers that already depend on procurement. The inbound-email
  // path deliberately does NOT call it directly — ProcurementModule imports
  // OrchestratorModule, so that would need a circular forwardRef, and Nest fails
  // those by injecting undefined at runtime rather than erroring at build time.
  // The email channel runs as a sweep inside DocumentIntakeService instead.
  exports: [ProcurementService, RecurringOrdersService, DocumentIntakeService],
})
export class ProcurementModule {}
