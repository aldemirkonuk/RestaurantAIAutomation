import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { RabbitMqBridgeService } from "../../common/orchestrator/rabbitmq-bridge.service";
import {
  MAX_FORWARDED_BYTES,
  MAX_FORWARDED_DOCUMENTS,
  MemberForward,
  MemberForwardResult,
} from "../../common/orchestrator/inbound-member-forward";
import { runWithNewCorrelationId } from "../../common/model-client/correlation";
import { DocumentIntakeService, isDocumentLike } from "./document-intake.service";

/**
 * Receives the documents a house's own owner or manager forwarded to the
 * house's inbound address and hands each to intake, so it lands on Receipts
 * (onboarding-r110-g1). The bridge decides WHO counts as a member; this
 * decides WHAT counts as a document.
 *
 * It registers itself with the bridge in its constructor, not in
 * `onModuleInit`: Nest builds every provider before it runs any lifecycle
 * hook, so the sink is in place before the bridge's `onModuleInit` starts
 * consuming mail. Registration runs this way round because ProcurementModule
 * imports OrchestratorModule, and the bridge injecting intake would be a cycle.
 */
@Injectable()
export class MemberForwardIntakeService {
  private readonly logger = new Logger(MemberForwardIntakeService.name);

  constructor(
    bridge: RabbitMqBridgeService,
    private readonly intake: DocumentIntakeService,
  ) {
    bridge.registerMemberForwardSink((forward) => this.take(forward));
  }

  async take(forward: MemberForward): Promise<MemberForwardResult> {
    let taken = 0;
    let skipped = 0;
    for (const a of forward.attachments ?? []) {
      if (
        taken >= MAX_FORWARDED_DOCUMENTS ||
        typeof a?.data !== "string" ||
        !isDocumentLike(a.mime_type, a.filename) ||
        // Base64 runs 4 characters to 3 bytes: refuse before decoding.
        Math.floor((a.data.length * 3) / 4) > MAX_FORWARDED_BYTES + 3
      ) {
        skipped++;
        continue;
      }
      const buffer = Buffer.from(a.data, "base64");
      if (!buffer.length || buffer.length > MAX_FORWARDED_BYTES) {
        skipped++;
        continue;
      }
      const sha16 = createHash("sha256")
        .update(buffer)
        .digest("hex")
        .slice(0, 16);
      const result = await runWithNewCorrelationId(() =>
        this.intake.ingest({
          restaurantId: forward.restaurantId,
          source: "email",
          buffer,
          filename: a.filename || null,
          mimeType: a.mime_type || null,
          sourceRef: `inbound:${forward.messageId}:${sha16}`,
        }),
      );
      if (result.documentId) taken++;
      else {
        skipped++;
        this.logger.warn(
          `a forwarded document did not land: ${result.error ?? "unknown"}`,
        );
      }
    }
    return { taken, skipped };
  }
}
