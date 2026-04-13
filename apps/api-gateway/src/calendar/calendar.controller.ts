import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
  GetCalendarEventsQueryDto,
  CalendarEventResponseDto,
  CalendarEventsListResponseDto,
  GenerateOccurrencesResponseDto,
  RecurrenceRuleResponseDto,
  EventTypeResponseDto,
  CreateEventTypeDto,
  UpdateEventTypeDto,
  UpdateEventStatusDto,
} from './dto/calendar.dto';

@ApiTags('calendar')
@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(private readonly calendarService: CalendarService) {}

  // ==========================================================================
  // EVENTS CRUD
  // ==========================================================================

  @Post('events')
  @ApiOperation({ summary: 'Create a new calendar event' })
  @ApiResponse({ status: 201, description: 'Event created', type: CalendarEventResponseDto })
  async createEvent(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto> {
    try {
      const userIdIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        user.userId,
      );
      const restaurantIdIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        user.restaurantId,
      );
      return await this.calendarService.createEvent(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      this.logger.error({
        message: 'Create calendar event failed',
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to create calendar event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('events')
  @ApiOperation({ summary: 'List calendar events with filters' })
  @ApiResponse({ status: 200, description: 'Returns events list', type: CalendarEventsListResponseDto })
  async listEvents(
    @Query() query: GetCalendarEventsQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventsListResponseDto> {
    try {
      return await this.calendarService.listEvents(user.restaurantId, query);
    } catch (error) {
      this.logger.error({
        message: 'List calendar events failed',
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to list calendar events',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('events/:eventId')
  @ApiOperation({ summary: 'Get a specific calendar event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({ status: 200, description: 'Returns the event', type: CalendarEventResponseDto })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async getEvent(
    @Param('eventId') eventId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto> {
    try {
      return await this.calendarService.getEvent(user.restaurantId, eventId);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      this.logger.error({
        message: 'Get calendar event failed',
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to get calendar event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('events/:eventId')
  @ApiOperation({ summary: 'Update a calendar event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({ status: 200, description: 'Event updated', type: CalendarEventResponseDto })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async updateEvent(
    @Param('eventId') eventId: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto> {
    try {
      return await this.calendarService.updateEvent(
        user.restaurantId,
        user.userId,
        eventId,
        dto,
      );
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      this.logger.error({
        message: 'Update calendar event failed',
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to update calendar event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('events/:eventId')
  @ApiOperation({ summary: 'Delete a calendar event' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiQuery({ name: 'scope', required: false, enum: ['this', 'this_and_future', 'all'] })
  @ApiResponse({ status: 200, description: 'Event deleted' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async deleteEvent(
    @Param('eventId') eventId: string,
    @Query('scope') scope: 'this' | 'this_and_future' | 'all' | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ deleted: boolean; message: string }> {
    try {
      return await this.calendarService.deleteEvent(
        user.restaurantId,
        user.userId,
        eventId,
        scope,
      );
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      this.logger.error({
        message: 'Delete calendar event failed',
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to delete calendar event',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // RECURRENCE
  // ==========================================================================

  @Post('recurrence/:ruleId/generate')
  @ApiOperation({ summary: 'Generate occurrences for a recurring event' })
  @ApiParam({ name: 'ruleId', description: 'Recurrence rule ID' })
  @ApiQuery({ name: 'horizonDate', required: false, description: 'Generate up to this date (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Occurrences generated', type: GenerateOccurrencesResponseDto })
  async generateOccurrences(
    @Param('ruleId') ruleId: string,
    @Query('horizonDate') horizonDate: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<GenerateOccurrencesResponseDto> {
    try {
      return await this.calendarService.generateOccurrences(
        user.restaurantId,
        ruleId,
        horizonDate,
      );
    } catch (error) {
      this.logger.error({
        message: 'Generate occurrences failed',
        ruleId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to generate occurrences',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('recurrence/:ruleId')
  @ApiOperation({ summary: 'Get a recurrence rule' })
  @ApiParam({ name: 'ruleId', description: 'Recurrence rule ID' })
  @ApiResponse({ status: 200, description: 'Returns the recurrence rule', type: RecurrenceRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async getRecurrenceRule(
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<RecurrenceRuleResponseDto> {
    try {
      return await this.calendarService.getRecurrenceRule(user.restaurantId, ruleId);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      this.logger.error({
        message: 'Get recurrence rule failed',
        ruleId,
        error: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to get recurrence rule',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // EVENT TYPES
  // ==========================================================================

  @Get('event-types/:restaurantId')
  @ApiOperation({ summary: 'List event types for a restaurant' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant UUID' })
  @ApiResponse({ status: 200, description: 'Event types list', type: [EventTypeResponseDto] })
  async getEventTypes(
    @Param('restaurantId') restaurantId: string,
  ): Promise<EventTypeResponseDto[]> {
    try {
      return await this.calendarService.getEventTypes(restaurantId);
    } catch (error) {
      this.logger.error({ message: 'Get event types failed', error: error.message });
      throw new HttpException(
        error.message || 'Failed to get event types',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('event-types')
  @ApiOperation({ summary: 'Create a custom event type' })
  @ApiResponse({ status: 201, description: 'Event type created', type: EventTypeResponseDto })
  async createEventType(
    @Body() dto: CreateEventTypeDto,
  ): Promise<EventTypeResponseDto> {
    try {
      return await this.calendarService.createEventType(dto);
    } catch (error) {
      this.logger.error({ message: 'Create event type failed', error: error.message });
      throw new HttpException(
        error.message || 'Failed to create event type',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('event-types/:id')
  @ApiOperation({ summary: 'Update a custom event type' })
  @ApiParam({ name: 'id', description: 'Event type ID' })
  @ApiResponse({ status: 200, description: 'Event type updated', type: EventTypeResponseDto })
  async updateEventType(
    @Param('id') id: string,
    @Body() dto: UpdateEventTypeDto,
  ): Promise<EventTypeResponseDto> {
    try {
      return await this.calendarService.updateEventType(id, dto);
    } catch (error) {
      if (error.status === 404) throw error;
      this.logger.error({ message: 'Update event type failed', error: error.message });
      throw new HttpException(
        error.message || 'Failed to update event type',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('event-types/:id')
  @ApiOperation({ summary: 'Delete a custom event type' })
  @ApiParam({ name: 'id', description: 'Event type ID' })
  @ApiResponse({ status: 200, description: 'Event type deleted' })
  async deleteEventType(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    try {
      return await this.calendarService.deleteEventType(id);
    } catch (error) {
      this.logger.error({ message: 'Delete event type failed', error: error.message });
      throw new HttpException(
        error.message || 'Failed to delete event type',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // EVENT STATUS
  // ==========================================================================

  @Patch('events/:eventId/status')
  @ApiOperation({ summary: 'Update event status' })
  @ApiParam({ name: 'eventId', description: 'Event ID' })
  @ApiResponse({ status: 200, description: 'Event status updated', type: CalendarEventResponseDto })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async updateEventStatus(
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventStatusDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto> {
    try {
      return await this.calendarService.updateEventStatus(
        user.restaurantId,
        user.userId,
        eventId,
        dto.status,
      );
    } catch (error) {
      if (error.status === 404) throw error;
      this.logger.error({ message: 'Update event status failed', eventId, error: error.message });
      throw new HttpException(
        error.message || 'Failed to update event status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // RECURRING INSTANCES
  // ==========================================================================

  @Get('events/:eventId/recurring')
  @ApiOperation({ summary: 'Get instances of a recurring event' })
  @ApiParam({ name: 'eventId', description: 'Parent event ID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Recurring instances', type: [CalendarEventResponseDto] })
  async getRecurringInstances(
    @Param('eventId') eventId: string,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto[]> {
    try {
      return await this.calendarService.getRecurringInstances(
        user.restaurantId,
        eventId,
        startDate,
        endDate,
      );
    } catch (error) {
      this.logger.error({ message: 'Get recurring instances failed', eventId, error: error.message });
      throw new HttpException(
        error.message || 'Failed to get recurring instances',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('events/:eventId/recurring')
  @ApiOperation({ summary: 'Delete a recurring event series' })
  @ApiParam({ name: 'eventId', description: 'Parent event ID' })
  @ApiQuery({ name: 'fromDate', required: false, description: 'Delete from this date onwards (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Series deleted' })
  async deleteRecurringSeries(
    @Param('eventId') eventId: string,
    @Query('fromDate') fromDate: string | undefined,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean; deletedCount: number }> {
    try {
      return await this.calendarService.deleteRecurringSeries(
        user.restaurantId,
        user.userId,
        eventId,
        fromDate,
      );
    } catch (error) {
      this.logger.error({ message: 'Delete recurring series failed', eventId, error: error.message });
      throw new HttpException(
        error.message || 'Failed to delete recurring series',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // CONVENIENCE ENDPOINTS
  // ==========================================================================

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming events (next 30 days)' })
  @ApiResponse({ status: 200, description: 'Returns upcoming events', type: CalendarEventsListResponseDto })
  async getUpcomingEvents(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventsListResponseDto> {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    return this.calendarService.listEvents(user.restaurantId, {
      startDate: today,
      endDate: thirtyDaysLater,
      includeRecurring: true,
      limit: 100,
    });
  }

  @Get('today')
  @ApiOperation({ summary: 'Get today\'s events' })
  @ApiResponse({ status: 200, description: 'Returns today\'s events', type: CalendarEventsListResponseDto })
  async getTodayEvents(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventsListResponseDto> {
    const today = new Date().toISOString().split('T')[0];

    return this.calendarService.listEvents(user.restaurantId, {
      startDate: today,
      endDate: today,
      includeRecurring: true,
      limit: 50,
    });
  }
}
