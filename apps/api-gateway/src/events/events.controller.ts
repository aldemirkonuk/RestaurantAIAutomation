import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import {
  CreateEventDto,
  CreateEventResponseDto,
  EventListResponseDto,
  GetEventsQueryDto,
} from "./dto/event.dto";
import { EventsService } from "./events.service";

@ApiTags("events")
@Controller("events")
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Ingest a new event" })
  @ApiResponse({
    status: 201,
    description: "Event created",
    type: CreateEventResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: "Duplicate event (idempotency key conflict)",
  })
  async createEvent(
    @Body() dto: CreateEventDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CreateEventResponseDto> {
    // The dev sandbox (/dev-sandbox) stamps every event it sends with
    // `sandbox: true`. Its wines and totals are made up, so in production
    // they must never land in a house's real activity (F-287) — even from a
    // dev build pointed at the live gateway or a stale cached bundle.
    if (
      process.env.NODE_ENV === "production" &&
      dto.payload?.sandbox === true
    ) {
      throw new HttpException(
        "Test actions are not saved on a live restaurant.",
        HttpStatus.FORBIDDEN,
      );
    }

    try {
      return await this.eventsService.createEvent(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      this.logger.error({
        message: "Event creation endpoint error",
        userId: user.userId,
        restaurantId: user.restaurantId,
        eventType: dto.eventType,
        error: error.message,
      });

      // Handle specific error cases
      if (error.code === "23505") {
        throw new HttpException(
          "Duplicate event detected",
          HttpStatus.CONFLICT,
        );
      }

      throw new HttpException(
        error.message || "Failed to ingest event",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List events with filters and pagination" })
  @ApiResponse({
    status: 200,
    description: "Returns events list",
    type: EventListResponseDto,
  })
  async listEvents(
    @Query() query: GetEventsQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<EventListResponseDto> {
    try {
      return await this.eventsService.listEvents(user.restaurantId, query);
    } catch (error) {
      this.logger.error({
        message: "List events endpoint error",
        userId: user.userId,
        restaurantId: user.restaurantId,
        query,
        error: error.message,
      });

      throw new HttpException(
        error.message || "Failed to fetch events",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Platform-wide ingestion counters, for our own monitoring only (F-437).
   * It was `@Public()` alone, so anyone on the internet could read every
   * house's event volume by type and source. Now it takes the service key
   * (`X-Admin-Key`, ADR 0099), the same as the other machine-only routes;
   * `@Public()` stays only so the global TenantGuard lets through a caller
   * that has no user; the key is what decides. No health check, monitor or
   * CI job calls this route (repo-wide grep, 2026-10-09).
   */
  @Get("metrics")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @ApiOperation({
    summary: "Get event ingestion metrics (internal/monitoring; service key)",
  })
  @ApiResponse({ status: 200, description: "Returns event metrics" })
  @ApiResponse({ status: 401, description: "Missing or wrong X-Admin-Key" })
  async getMetrics(): Promise<Record<string, unknown>> {
    const metrics = this.eventsService.getMetrics();
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      metrics: {
        totalIngested: metrics.totalIngested,
        totalDeduped: metrics.totalDeduped,
        dedupeRate:
          metrics.totalIngested > 0
            ? ((metrics.totalDeduped / metrics.totalIngested) * 100).toFixed(
                2,
              ) + "%"
            : "0%",
        errors: metrics.errors,
        byType: metrics.byType,
        bySource: metrics.bySource,
        lastReset: metrics.lastReset.toISOString(),
      },
    };
  }
}
