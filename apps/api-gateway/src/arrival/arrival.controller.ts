import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  AuthedRateLimit,
  AuthedRateLimitGuard,
} from "../common/rate-limit/authed-rate-limit.guard";
import { ArrivalService, ArrivalActor } from "./arrival.service";
import {
  MenuEvidenceDto,
  BatchRevisionDto,
  ConfigurationInputDto,
  EvidenceDto,
  ProposeBatchDto,
  SkipFolioDto,
} from "./arrival.dto";

@Controller("arrival")
@UseGuards(JwtAuthGuard, AuthedRateLimitGuard)
export class ArrivalController {
  constructor(private readonly arrival: ArrivalService) {}

  @Get() read(@CurrentUser() user: ArrivalActor) {
    return this.arrival.read(user);
  }
  @Post("skip") skip(
    @CurrentUser() user: ArrivalActor,
    @Body() dto: SkipFolioDto,
  ) {
    return this.arrival.skip(user, dto.folio);
  }
  @Post("typed") typed(
    @CurrentUser() user: ArrivalActor,
    @Body() dto: ConfigurationInputDto,
  ) {
    return this.arrival.typed(user, dto);
  }
  @Post("config/propose_batch")
  @AuthedRateLimit({
    limit: 20,
    windowSeconds: 60,
    scope: "user",
    message: "Give the book a moment before proposing more entries.",
  })
  propose(@CurrentUser() user: ArrivalActor, @Body() dto: ProposeBatchDto) {
    return this.arrival.propose(user, dto);
  }
  @Post("menu-evidence")
  @AuthedRateLimit(
    {
      limit: 5,
      windowSeconds: 60,
      scope: "user",
      message: "Give the menu reader a moment before adding more evidence.",
    },
    {
      limit: 50,
      windowSeconds: 3600,
      scope: "restaurant",
      message: "This house has read many menus this hour. Try again later.",
    },
  )
  menuEvidence(
    @CurrentUser() user: ArrivalActor,
    @Body() dto: MenuEvidenceDto,
  ) {
    return this.arrival.menuEvidence(user, dto);
  }
  @Post("evidence") evidence(
    @CurrentUser() user: ArrivalActor,
    @Body() dto: EvidenceDto,
  ) {
    return this.arrival.evidence(user, dto.documentId, dto.providerId);
  }
  /**
   * Mints the one-time seal `HoldToApprove`'s `onChallenge` carries back to
   * `apply`, at the moment the hold gesture begins (ADR 0113; mirrors
   * `POST orders/:id/seal-challenge`). Same authorization as `apply` itself —
   * a seal issued for a hold that would be refused anyway teaches a manager
   * that the seal is decoration.
   */
  @Post("batches/:id/seal-challenge")
  @AuthedRateLimit({
    limit: 20,
    windowSeconds: 60,
    scope: "user",
    message: "Give the seal a moment before holding again.",
  })
  sealChallenge(
    @CurrentUser() user: ArrivalActor,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.arrival.issueApplySeal(user, id);
  }
  @Post("batches/:id/apply") apply(
    @CurrentUser() user: ArrivalActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: BatchRevisionDto,
    // The seal travels in a header, never in the body (order-seal.ts's own
    // rule): it is not one of the arguments it is a seal OVER.
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    return this.arrival.apply(user, id, dto.revision, challenge);
  }
  @Post("batches/:id/rows/:rowId/discard") discard(
    @CurrentUser() user: ArrivalActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("rowId", ParseUUIDPipe) rowId: string,
    @Body() dto: BatchRevisionDto,
  ) {
    return this.arrival.discard(user, id, rowId, dto.revision);
  }
  @Post("batches/:id/undo") undo(
    @CurrentUser() user: ArrivalActor,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: BatchRevisionDto,
  ) {
    return this.arrival.undo(user, id, dto.revision);
  }
}
