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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import {
  CreateEventDto,
  CreateEventResponseDto,
  EventListResponseDto,
  GetEventsQueryDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Ingest a new event' })
  @ApiResponse({ status: 201, description: 'Event created', type: CreateEventResponseDto })
  @ApiResponse({ status: 409, description: 'Duplicate event (idempotency key conflict)' })
  async createEvent(
    @Body() dto: CreateEventDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CreateEventResponseDto> {
    try {
      return await this.eventsService.createEvent(user.restaurantId, user.userId, dto);
    } catch (error) {
      this.logger.error({
        message: 'Event creation endpoint error',
        userId: user.userId,
        restaurantId: user.restaurantId,
        eventType: dto.eventType,
        error: error.message,
      });

      // Handle specific error cases
      if (error.code === '23505') {
        throw new HttpException(
          'Duplicate event detected',
          HttpStatus.CONFLICT,
        );
      }

      throw new HttpException(
        error.message || 'Failed to ingest event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List events with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Returns events list', type: EventListResponseDto })
  async listEvents(
    @Query() query: GetEventsQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<EventListResponseDto> {
    try {
      return await this.eventsService.listEvents(user.restaurantId, query);
    } catch (error) {
      this.logger.error({
        message: 'List events endpoint error',
        userId: user.userId,
        restaurantId: user.restaurantId,
        query,
        error: error.message,
      });

      throw new HttpException(
        error.message || 'Failed to fetch events',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('metrics')
  @Public()
  @ApiOperation({ summary: 'Get event ingestion metrics (internal/monitoring)' })
  @ApiResponse({ status: 200, description: 'Returns event metrics' })
  async getMetrics(): Promise<Record<string, unknown>> {
    const metrics = this.eventsService.getMetrics();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: {
        totalIngested: metrics.totalIngested,
        totalDeduped: metrics.totalDeduped,
        dedupeRate: metrics.totalIngested > 0
          ? (metrics.totalDeduped / metrics.totalIngested * 100).toFixed(2) + '%'
          : '0%',
        errors: metrics.errors,
        byType: metrics.byType,
        bySource: metrics.bySource,
        lastReset: metrics.lastReset.toISOString(),
      },
    };
  }
}
