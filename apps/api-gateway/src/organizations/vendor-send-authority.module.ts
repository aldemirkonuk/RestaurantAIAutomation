import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";
import { VendorSendRequestsService } from "./vendor-send-requests.service";

/**
 * Who may send to a vendor with one hold (ADR 0112 F12; ADR 0175 D10), as one
 * provider every vendor-send module can import.
 *
 * It imports `DatabaseModule` and nothing else, on purpose, so it sits on no
 * module cycle: `ProcurementModule`, `ConversationsModule` and
 * `CommunicationsModule` (the house composer) all import it, and
 * `CommunicationsModule` is already on the `AuthModule` cycle that
 * `OrganizationsModule` would have pulled in. `scripts/check_gateway_boots.sh`
 * is what proves the graph resolves — tsc and jest cannot see a Nest injector.
 */
@Module({
  imports: [DatabaseModule],
  // The requests service (founder answer 3, 2026-09-21: staff ask for a deal
  // or a composer letter) depends on the authority and the database only, so
  // it sits here, below every vendor-send module, on no cycle.
  providers: [VendorSendAuthorityService, VendorSendRequestsService],
  exports: [VendorSendAuthorityService, VendorSendRequestsService],
})
export class VendorSendAuthorityModule {}
