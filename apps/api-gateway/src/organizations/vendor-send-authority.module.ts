import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";

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
  providers: [VendorSendAuthorityService],
  exports: [VendorSendAuthorityService],
})
export class VendorSendAuthorityModule {}
