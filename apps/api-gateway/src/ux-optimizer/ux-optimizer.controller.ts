import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { UxOptimizerService } from "./ux-optimizer.service";

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
 */
@ApiTags("ux-optimizer")
@Controller("ux")
export class UxOptimizerController {
  constructor(private readonly ux: UxOptimizerService) {}

  @Post("signals")
  @ApiOperation({ summary: "Ingest a UX friction signal" })
  async ingest(
    @Body()
    body: {
      restaurantId?: string;
      page: string;
      event: string;
      targetKey?: string;
      value?: number;
      sessionId?: string;
      meta?: Record<string, unknown>;
    },
  ) {
    try {
      return await this.ux.ingestSignal(body);
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
      "Returns [] unless UX_OPTIMIZER_ENABLED=true. Overrides are rollout-bucketed by sessionId so a change reaches only its approved percentage of sessions.",
  })
  @ApiQuery({ name: "page", required: true })
  @ApiQuery({ name: "restaurantId", required: false })
  @ApiQuery({ name: "sessionId", required: false })
  async overrides(
    @Query("page") page: string,
    @Query("restaurantId") restaurantId?: string,
    @Query("sessionId") sessionId?: string,
  ) {
    try {
      return await this.ux.getActiveOverrides(page, restaurantId, sessionId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load overrides",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("summary/:page")
  @ApiOperation({ summary: "Aggregated friction summary for a page" })
  @ApiQuery({ name: "restaurantId", required: false })
  @ApiQuery({ name: "sinceHours", required: false })
  async summary(
    @Param("page") page: string,
    @Query("restaurantId") restaurantId?: string,
    @Query("sinceHours") sinceHours?: string,
  ) {
    try {
      return await this.ux.summarize(
        page,
        restaurantId,
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
  @ApiQuery({ name: "restaurantId", required: false })
  async propose(
    @Param("page") page: string,
    @Query("restaurantId") restaurantId?: string,
  ) {
    try {
      return await this.ux.generateProposals(page, restaurantId);
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
    @Query("status") status?: string,
    @Query("page") page?: string,
  ) {
    try {
      return { items: await this.ux.listProposals(status, page) };
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
      "Body: { decision: 'approve'|'reject', reviewedBy?, rolloutPct? }.",
  })
  async review(
    @Param("id") id: string,
    @Body()
    body: {
      decision?: "approve" | "reject";
      reviewedBy?: string;
      rolloutPct?: number;
    },
  ) {
    try {
      if (body?.decision !== "approve" && body?.decision !== "reject")
        throw new Error("decision must be 'approve' or 'reject'");
      return await this.ux.reviewProposal(
        id,
        body.decision,
        body.reviewedBy,
        body.rolloutPct,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to review proposal",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post("proposals/:id/rollback")
  @ApiOperation({ summary: "Roll back a live UX change" })
  async rollback(@Param("id") id: string, @Body() body: { reason?: string }) {
    try {
      return await this.ux.rollback(id, body?.reason);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to roll back",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get("learnings")
  @ApiOperation({ summary: "Append-only self-learning ledger" })
  @ApiQuery({ name: "page", required: false })
  async learnings(@Query("page") page?: string) {
    try {
      return { items: await this.ux.listLearnings(page) };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to load learnings",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
