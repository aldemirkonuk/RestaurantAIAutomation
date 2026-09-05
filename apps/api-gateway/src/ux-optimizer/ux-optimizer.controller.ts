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
  RecordExperimentEventDto,
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
 *   GET  /ux/experiments/:key           which arm this HOUSE is on
 *   POST /ux/experiments/:key/events    one exposure or outcome
 *   GET  /ux/experiments/:key/report    this house's counts, never a verdict
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

  // ==========================================================================
  // Experiments — assign, record, report. Nothing here applies anything.
  // ==========================================================================

  @Get("experiments/:key")
  @ApiOperation({
    summary: "Which arm of an experiment this house is on",
    description:
      "Deterministic per house and FROZEN on first read, so a later edit to the ratio constant cannot re-label exposures already recorded. Assigns on first ask. A caller that cannot read this must render the fallback arm and SAY the experiment could not be read — never a guess that looks like an assignment.",
  })
  async experiment(@Param("key") key: string, @CurrentUser() user: AuthedUser) {
    try {
      return await this.ux.assignmentFor(key, user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to read the experiment",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("experiments/:key/events")
  @ApiOperation({
    summary: "Record one exposure or outcome against this house's arm",
    description:
      "The arm is stamped from the stored assignment, never from the body. Written to neural_footprint_event as subject_type 'operator'; outcome is 'success' only on a completion, and NULL — meaning unknown — on everything else.",
  })
  async recordExperimentEvent(
    @Param("key") key: string,
    @Body() body: RecordExperimentEventDto,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.ux.recordExperimentEvent({
        experimentKey: key,
        restaurantId: user.restaurantId,
        userId: user.userId,
        event: body.event,
        actionId: body.actionId ?? null,
        durationMs: body.durationMs ?? null,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to record the event",
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("experiments/:key/report")
  @ApiOperation({
    summary: "Counts for this house's arm — never a verdict",
    description:
      "House-scoped like every read here, and assignment is per house, so this can only ever show the one arm this house is on (`houseScopedOnly`). Reading does not assign. `abandoned` is a floor: a tab closed outright records nothing, equally in both arms.",
  })
  async experimentReport(
    @Param("key") key: string,
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.ux.experimentReport(key, user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to read the experiment report",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
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
