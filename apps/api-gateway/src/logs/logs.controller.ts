import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MembersService } from "../restaurants/members.service";
import { LogsTimelineService } from "./logs-timeline.service";

/**
 * THE PATH NAMES THE HOUSE; THE CALLER MUST BELONG TO IT (2026-09-11)
 *
 * `restaurantId` comes from the URL, as it always has (the page doc's §13.6
 * asked whether it should come from the JWT instead). It stays in the path —
 * a timeline is an address a person pastes — but until this change the only
 * gate was `JwtAuthGuard`, so ANY signed-in account could read ANY house's
 * six registers by editing the id. Now the caller's membership of that exact
 * house is asserted through the one membership check this gateway has
 * (`restaurants/members.service.ts` `assertMembership`, reused rather than
 * re-derived — two membership checks is how a gate ends up on one route and
 * not the next). A non-member is refused with 403, and the refusal reaches
 * the caller AS a 403: the catch below re-throws any HttpException untouched
 * instead of folding it into the 500 that used to swallow everything.
 */
@ApiTags("logs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("logs")
export class LogsController {
  constructor(
    private readonly timeline: LogsTimelineService,
    private readonly members: MembersService,
  ) {}

  @Get("timeline/:restaurantId")
  @ApiOperation({
    summary: "Correlated read-only logs timeline",
    description:
      "Merges pos_checks, decision_log, inventory_transactions, procurement_documents, system_audit_log, and (when a correlation_id is given) event_store into one chronological feed. Pass correlationId to follow a single business event across tables. The response marks its window (`window`, `hasMore`) and carries `nextCursor`; pass it back as `before` to read the next page. The caller must be a member of the restaurant.",
  })
  @ApiQuery({ name: "correlationId", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({
    name: "before",
    required: false,
    description:
      "ISO-8601 cursor — the `nextCursor` of the previous page. Inclusive; de-duplicate on source:id.",
  })
  async getTimeline(
    @CurrentUser() user: { userId: string },
    @Param("restaurantId") restaurantId: string,
    @Query("correlationId") correlationId?: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    try {
      await this.members.assertMembership(user.userId, restaurantId);
      return await this.timeline.getTimeline(restaurantId, {
        correlationId,
        limit: limit ? parseInt(limit, 10) : undefined,
        before,
      });
    } catch (error) {
      // A refusal (403) or a malformed cursor (400) is already the right
      // answer — passing it through a 500 would tell the page "the timeline
      // is down" about a request that was understood and declined.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error?.message || "Timeline failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
