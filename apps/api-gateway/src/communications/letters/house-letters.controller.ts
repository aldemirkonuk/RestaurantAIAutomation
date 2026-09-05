/**
 * `/communications/letters` — the one route a browser may use to send a letter
 * from this house (ADR 0118).
 *
 * Every route here is JWT-guarded at the class level and tenant-scoped from the
 * SIGNED token (`@CurrentUser()`), never from a body field or a path parameter.
 * That is the difference between this and `POST /communications/email`, which is
 * a service-key route carrying no tenant at all and writing no conversation row
 * (communications.controller.ts:207-228).
 *
 * There is no auto-send anywhere in this controller and no route that sends
 * immediately: `POST /letters` queues, the dispatcher sends, and
 * `POST /letters/:id/cancel` stops it in between.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import {
  HouseLettersService,
  LETTER_CATEGORIES,
} from "./house-letters.service";
import { HouseSenderService } from "./house-sender.service";
import { HouseLettersCron } from "./house-letters.cron";
import { HouseInboxCron } from "../inbox/house-inbox.cron";
import { HouseInboxService } from "../inbox/house-inbox.service";
import { QueueLetterDto, UpsertLetterTemplateDto } from "./house-letters.dto";

interface Actor {
  id: string;
  restaurantId: string;
}

@ApiTags("Communications")
@UseGuards(JwtAuthGuard)
@Controller("communications/letters")
export class HouseLettersController {
  constructor(
    private readonly letters: HouseLettersService,
    private readonly sender: HouseSenderService,
    private readonly cron: HouseLettersCron,
    private readonly inboxCron: HouseInboxCron,
    private readonly inbox: HouseInboxService,
  ) {}

  @Get("sender")
  @ApiOperation({
    summary:
      "Where this house's conversation with a vendor lives — which address letters leave from, and whether replies come back to the same mailbox",
  })
  @ApiResponse({
    status: 200,
    description:
      "`kind: none` means no letter may be sent and says why; `kind: unknown` means the read failed and is NOT the same answer. `conversation.where` states the whole thing in four words: `whole_conversation_here`, `letters_leave_only`, `replies_arrive_only`, `shared_mailbox` (plus `unknown` for a failed read), and `conversation.words` says it in a sentence.",
  })
  async senderIdentity(@CurrentUser() user: Actor) {
    const identity = await this.sender.resolve(user.restaurantId, user.id);
    return {
      ...identity,
      dispatcher: this.cron.lastRun(),
      // The receive half's own report. `dispatcher` says whether letters can
      // still leave; this says whether replies are still arriving, and from
      // when. Both are null until their cron has run once — never a fabricated
      // "nothing to do".
      reader: {
        lastRun: this.inboxCron.lastRun(),
        ...(await this.inbox.statusFor(user.restaurantId)),
      },
      categories: LETTER_CATEGORIES,
    };
  }

  @Get("book")
  @ApiOperation({
    summary: "Every address this house may write to, and whose it is",
  })
  async book(@CurrentUser() user: Actor) {
    return { entries: await this.letters.book(user.restaurantId) };
  }

  @Get("queued")
  @ApiOperation({ summary: "Letters still inside their undo window" })
  async queued(@CurrentUser() user: Actor) {
    return { queued: await this.letters.queued(user.restaurantId) };
  }

  @Get("templates")
  @ApiOperation({ summary: "The house's letter templates" })
  async templates(@CurrentUser() user: Actor) {
    return {
      categories: LETTER_CATEGORIES,
      templates: await this.letters.listTemplates(user.restaurantId),
    };
  }

  @Post("templates")
  @ApiOperation({ summary: "Create or edit a house letter template" })
  async upsertTemplate(
    @CurrentUser() user: Actor,
    @Body() dto: UpsertLetterTemplateDto,
  ) {
    return this.letters.upsertTemplate({
      restaurantId: user.restaurantId,
      userId: user.id,
      dto,
    });
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Queue one letter from this house. Never sends immediately.",
  })
  @ApiResponse({
    status: 202,
    description: "Queued. 202, not 200 — nothing has been sent yet.",
  })
  @ApiResponse({
    status: 422,
    description:
      "The recipient is not in the book, or the draft trips a guardrail. The body carries the sentence.",
  })
  @ApiResponse({
    status: 409,
    description: "This house has no sending identity, so nothing was queued.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The house has stopped using the grant this identity rests on (ADR 0114).",
  })
  async queue(@CurrentUser() user: Actor, @Body() dto: QueueLetterDto) {
    return this.letters.queue({
      restaurantId: user.restaurantId,
      userId: user.id,
      dto,
    });
  }

  @Post(":id/cancel")
  @ApiOperation({ summary: "Pull a queued letter back before it leaves" })
  async cancel(
    @CurrentUser() user: Actor,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.letters.cancel({ restaurantId: user.restaurantId, id });
  }
}
