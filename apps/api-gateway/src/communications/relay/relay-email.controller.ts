/**
 * `POST /communications/email` — the raw mail route, with two locked doors
 * (ADR 0149 #19, 2026-09-16; history in ADR 0084 and ADR 0099).
 *
 * The route stays where its caller points
 * (`services/agent-orchestrator/services/email_composer_service.py`,
 * `send_via_gateway`). What changed is who may use it and what they may send:
 * `RelayDoorGuard` picks the door from the credential, and `RelayEmailService`
 * holds each door's rules and writes the audit rows.
 *
 * `@Public()` here does NOT mean unauthenticated. It makes the class-level
 * `JwtAuthGuard` stand aside so `RelayDoorGuard` alone decides — and that guard
 * runs the full JWT check itself when no service key is presented. A request
 * with neither credential is a 401 (relay-email.doors.spec.ts).
 *
 * `POST /communications/email/:id/cancel` is the person door's own recall —
 * unlike `sendEmail` above it is a plain JWT route (the class-level
 * `JwtAuthGuard`, no `@Public()`/`RelayDoorGuard`), because only a person ever
 * has something queued to pull back; the orchestrator's door never queues.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Public } from "../../auth/decorators/public.decorator";
import { SendEmailDto } from "../dto/communication.dto";
import { houseActor, type TokenUser } from "../letters/house-letters.actor";
import { RelayDoorGuard, type RelayDoor } from "./relay-door.guard";
import { RelayEmailService, type RelayResult } from "./relay-email.service";

@ApiTags("Communications")
@UseGuards(JwtAuthGuard)
@Controller("communications")
export class RelayEmailController {
  constructor(private readonly relay: RelayEmailService) {}

  @Post("email")
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(RelayDoorGuard)
  @ApiOperation({
    summary:
      "Send an email — the orchestrator by service key for a named house, vendor and conversation or order, sent immediately. The person door (owner or manager by JWT) runs its checks and then QUEUES through the house's own connected mailbox (ADR 0118 D2's 2-minute undo window), naming the person as author; a house with none gets a plain refusal and a house_mailbox_not_connected code rather than queuing or a bare 409",
  })
  @ApiHeader({
    name: "X-Admin-Key",
    required: false,
    description:
      "Service door only. When present it is the only credential consulted.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Orchestrator door only: the provider was called immediately. `success` says whether it accepted the mail; `audit` says which rows were written.",
  })
  @ApiResponse({
    status: 202,
    description:
      "Person door: queued, not sent. `queued` carries the row id, when it leaves (`dispatchAt`), the undo window (`undoMs`) and the same sentence GET /communications/letters/sender shows. Cancel it at POST /communications/email/:id/cancel before then.",
  })
  @ApiResponse({ status: 401, description: "No valid credential for either door." })
  @ApiResponse({
    status: 403,
    description:
      "A door refused: the send names no house, another house's conversation or order, a recipient the house has no record of, or the caller is not an owner or manager. The body says which. Nothing was sent or queued.",
  })
  @ApiResponse({
    status: 409,
    description:
      "Person door, after every other check held: this house has no connected sending mailbox (nobody has granted gmail_send, or the grant could not be read). The body carries a plain sentence and code: 'house_mailbox_not_connected'. Nothing was queued.",
  })
  @ApiResponse({
    status: 503,
    description:
      "A check could not be made (a read failed, including the caller's role) or the queue row could not be written. Nothing was sent or queued.",
  })
  async sendEmail(
    @Req() req: { relayDoor?: RelayDoor; user?: unknown },
    @Body() dto: SendEmailDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RelayResult> {
    if (req.relayDoor === "orchestrator") {
      return this.relay.sendAsOrchestrator(dto);
    }
    if (req.relayDoor === "person") {
      const result = await this.relay.sendAsPerson(
        req.user as Parameters<RelayEmailService["sendAsPerson"]>[0],
        dto,
      );
      // Queued, not sent: 202, not 200 — the same distinction
      // `POST /communications/letters` already makes for the same reason.
      if (result.queued) res.status(HttpStatus.ACCEPTED);
      return result;
    }
    // Unreachable through RelayDoorGuard. Refuse rather than guess a door.
    throw new UnauthorizedException(
      "No door admitted this request, so nothing was sent.",
    );
  }

  @Post("email/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Pull a person's queued send back before it leaves (ADR 0118 D2's undo window)",
  })
  @ApiResponse({
    status: 200,
    description: "Cancelled. It was never sent.",
  })
  @ApiResponse({
    status: 403,
    description:
      "This queued send is another member's, not yours (founder, 2026-09-18: cancel is the author's alone).",
  })
  @ApiResponse({
    status: 404,
    description: "No such queued send in this house.",
  })
  @ApiResponse({
    status: 409,
    description:
      "That send is not queued any more (already sending, sent, failed, or already cancelled), so it was not touched.",
  })
  async cancelQueued(
    @CurrentUser() user: TokenUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const { userId, restaurantId } = houseActor(user);
    return this.relay.cancelQueued({ restaurantId, userId, id });
  }
}
