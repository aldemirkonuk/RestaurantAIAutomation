import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SealChallengeService } from "./seal-challenge.service";

/**
 * The seal, as one provider that any module holding a sealed write can import.
 *
 * It is a module rather than a helper function because the redemption needs the
 * database and the refusal needs the audit log, and a helper that reached for a
 * client of its own would be a second opinion about which database this is.
 *
 * Imported by `ProcurementModule` (sealing an order) and
 * `PaymentMethodsModule` (changing how the house pays). NOT by
 * `McpConnectionsModule` — see `seal-challenge.service.ts`'s header for why
 * that path keeps its own redemption in this pass.
 */
@Module({
  imports: [DatabaseModule],
  providers: [SealChallengeService],
  exports: [SealChallengeService],
})
export class SealModule {}
