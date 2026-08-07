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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { LogsTimelineService } from "./logs-timeline.service";

@ApiTags("logs")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("logs")
export class LogsController {
  constructor(private readonly timeline: LogsTimelineService) {}

  @Get("timeline/:restaurantId")
  @ApiOperation({
    summary: "Correlated read-only logs timeline",
    description:
      "Merges pos_checks, decision_log, inventory_transactions, procurement_documents, system_audit_log, and (when a correlation_id is given) event_store into one chronological feed. Pass correlationId to follow a single business event across tables.",
  })
  @ApiQuery({ name: "correlationId", required: false })
  @ApiQuery({ name: "limit", required: false })
  async getTimeline(
    @Param("restaurantId") restaurantId: string,
    @Query("correlationId") correlationId?: string,
    @Query("limit") limit?: string,
  ) {
    try {
      return await this.timeline.getTimeline(restaurantId, {
        correlationId,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    } catch (error) {
      throw new HttpException(
        error.message || "Timeline failed",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
