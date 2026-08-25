import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { UxOptimizerService } from "./ux-optimizer.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  IngestSignalDto,
  ReviewProposalDto,
  RollbackProposalDto,
} from "./dto/ux-optimizer.dto";

type AuthedUser = { userId: string; restaurantId: string };

/**
 * UX Optimizer API — the self-learning UX agent's surface.
 *
 *   POST /ux/signals            ingest friction telemetry (fire-and-forget)
 *   GET  /ux/overrides          gated runtime overrides the web applies
 *   GET  /ux/summary/:page      aggregated friction for a page
 *   POST /ux/proposals/:page    have the agent PROPOSE improvements (no apply)
 *   GET  /ux/proposals          review queue
 *   POST /ux/proposals/:id/review   human approve/reject (approve = gated ship)
 *   POST /ux/proposals/:id/rollback revert a live change
 *   GET  /ux/learnings          the append-only self-learning ledger
 *
 * AUTHENTICATION — every route on this controller requires a valid JWT.
 * This is load-bearing, not defensive style: the globally-registered TenantGuard
 * deliberately returns true for unauthenticated requests (see its own comment,
 * "JwtAuthGuard should enforce where required"), so a controller without this
 * decorator is reachable by anyone on the internet. Before it was added, any
 * host could approve a proposal into the live UI via POST /ux/proposals/:id/review
 * and name whoever they liked as the reviewer.
 *
 * TENANCY — restaurantId is ALWAYS taken from the authenticated principal and
 * never from a query parameter or request body. Callers cannot ask about, or
 * write signals against, a restaurant that is not their own.
 */
@ApiTags("ux-optimizer")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("ux")
export class UxOptimizerController {
  constructor(private readonly ux: UxOptimizerService) {}

  @Post("signals")
  @ApiOperation({
    summary: "Ingest a UX friction signal",
    description:
      "Authenticated. restaurant_id is derived from the token, so a client cannot attribute friction to another tenant.",
  })
  async ingest(@Body() body: IngestSignalDto, @CurrentUser() user: AuthedUser) {
    try {
      return await this.ux.ingestSignal({
        ...body,
        restaurantId: user.restaurantId,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to ingest signal",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("overrides")
  @ApiOperation({
    summary: "Active (gated) runtime UX overrides for a page",
    description:
      "Returns [] unless UX_OPTIMIZER_ENABLED=true. Overrides are rollout-bucketed by a stable per-user key so a change reaches only its approved percentage of users — and the same human sees the same UI in every tab.",
  })
  @ApiQuery({ name: "page", required: true })
  async overrides(
    @Query("page") page: string,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.ux.getActiveOverrides(
        page,
        user.restaurantId,
        user.userId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load overrides",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("summary/:page")
  @ApiOperation({ summary: "Aggregated friction summary for a page" })
  @ApiQuery({ name: "sinceHours", required: false })
  async summary(
    @Param("page") page: string,
    @CurrentUser() user: AuthedUser,
    @Query("sinceHours") sinceHours?: string,
  ) {
    try {
      return await this.ux.summarize(
        page,
        user.restaurantId,
        sinceHours ? parseInt(sinceHours, 10) : undefined,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to summarize",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("proposals/:page")
  @ApiOperation({
    summary:
      "Agent proposes SOTA UX improvements for a page (never auto-applied)",
  })
  async propose(@Param("page") page: string, @CurrentUser() user: AuthedUser) {
    try {
      return await this.ux.generateProposals(page, user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to generate proposals",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("proposals")
  @ApiOperation({ summary: "Review queue of proposed UX changes" })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "page", required: false })
  async listProposals(
    @CurrentUser() user: AuthedUser,
    @Query("status") status?: string,
    @Query("page") page?: string,
  ) {
    try {
      return {
        items: await this.ux.listProposals(user.restaurantId, status, page),
      };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to list proposals",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("proposals/:id/review")
  @ApiOperation({
    summary: "Human review of a proposal — approve (gated ship) or reject",
    description:
      "The reviewer is the authenticated user. It is deliberately NOT a body field: an audit trail the caller writes about itself is not an audit trail.",
  })
  async review(
    @Param("id") id: string,
    @Body() body: ReviewProposalDto,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.ux.reviewProposal(
        id,
        body.decision,
        user.userId,
        user.restaurantId,
        body.rolloutPct,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to review proposal",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("proposals/:id/rollback")
  @ApiOperation({ summary: "Roll back a live UX change" })
  async rollback(
    @Param("id") id: string,
    @Body() body: RollbackProposalDto,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.ux.rollback(id, user.restaurantId, body?.reason);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to roll back",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("learnings")
  @ApiOperation({ summary: "Append-only self-learning ledger" })
  @ApiQuery({ name: "page", required: false })
  async learnings(
    @CurrentUser() user: AuthedUser,
    @Query("page") page?: string,
  ) {
    try {
      return {
        items: await this.ux.listLearnings(user.restaurantId, page),
      };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load learnings",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
