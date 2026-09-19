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
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import type { ReminderStatus } from "./calendar-reminders.service";
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
  ICalTokenResponseDto,
} from "./dto/calendar.dto";
import { WeatherService } from "../weather/weather.service";
import type { WeatherWindow } from "../weather/weather.service";
import { GetWeatherQueryDto } from "../weather/dto/weather.dto";
import { DayRecordService } from "./day-record.service";
import type { DayRecordWindow } from "./day-record.service";

@ApiTags("calendar")
@Controller("calendar")
@UseGuards(JwtAuthGuard)
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(
    private readonly calendarService: CalendarService,
    private readonly reminders: CalendarRemindersService,
    private readonly weather: WeatherService,
    private readonly dayRecord: DayRecordService,
  ) {}

  // ==========================================================================
  // EVENTS CRUD
  // ==========================================================================

  @Post("events")
  @ApiOperation({ summary: "Create a new calendar event" })
  @ApiResponse({
    status: 201,
    description: "Event created",
    type: CalendarEventResponseDto,
  })
  async createEvent(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto> {
    try {
      const userIdIsUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          user.userId,
        );
      const restaurantIdIsUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          user.restaurantId,
        );
      return await this.calendarService.createEvent(
        user.restaurantId,
        user.userId,
        dto,
      );
    } catch (error) {
      this.logger.error({
        message: "Create calendar event failed",
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to create calendar event",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("events")
  @ApiOperation({ summary: "List calendar events with filters" })
  @ApiResponse({
    status: 200,
    description: "Returns events list",
    type: CalendarEventsListResponseDto,
  })
  async listEvents(
    @Query() query: GetCalendarEventsQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventsListResponseDto> {
    try {
      return await this.calendarService.listEvents(user.restaurantId, query);
    } catch (error) {
      this.logger.error({
        message: "List calendar events failed",
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to list calendar events",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("events/:eventId")
  @ApiOperation({ summary: "Get a specific calendar event" })
  @ApiParam({ name: "eventId", description: "Event ID" })
  @ApiResponse({
    status: 200,
    description: "Returns the event",
    type: CalendarEventResponseDto,
  })
  @ApiResponse({ status: 404, description: "Event not found" })
  async getEvent(
    @Param("eventId") eventId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventResponseDto> {
    try {
      return await this.calendarService.getEvent(user.restaurantId, eventId);
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      this.logger.error({
        message: "Get calendar event failed",
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to get calendar event",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch("events/:eventId")
  @ApiOperation({ summary: "Update a calendar event" })
  @ApiParam({ name: "eventId", description: "Event ID" })
  @ApiResponse({
    status: 200,
    description: "Event updated",
    type: CalendarEventResponseDto,
  })
  @ApiResponse({ status: 404, description: "Event not found" })
  async updateEvent(
    @Param("eventId") eventId: string,
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
        message: "Update calendar event failed",
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to update calendar event",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete("events/:eventId")
  @ApiOperation({ summary: "Delete a calendar event" })
  @ApiParam({ name: "eventId", description: "Event ID" })
  @ApiQuery({
    name: "scope",
    required: false,
    enum: ["this", "this_and_future", "all"],
  })
  @ApiResponse({ status: 200, description: "Event deleted" })
  @ApiResponse({ status: 404, description: "Event not found" })
  async deleteEvent(
    @Param("eventId") eventId: string,
    @Query("scope") scope: "this" | "this_and_future" | "all" | undefined,
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
        message: "Delete calendar event failed",
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to delete calendar event",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // RECURRENCE
  // ==========================================================================

  @Post("recurrence/:ruleId/generate")
  @ApiOperation({ summary: "Generate occurrences for a recurring event" })
  @ApiParam({ name: "ruleId", description: "Recurrence rule ID" })
  @ApiQuery({
    name: "horizonDate",
    required: false,
    description: "Generate up to this date (YYYY-MM-DD)",
  })
  @ApiResponse({
    status: 200,
    description: "Occurrences generated",
    type: GenerateOccurrencesResponseDto,
  })
  async generateOccurrences(
    @Param("ruleId") ruleId: string,
    @Query("horizonDate") horizonDate: string | undefined,
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
        message: "Generate occurrences failed",
        ruleId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to generate occurrences",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("recurrence/:ruleId")
  @ApiOperation({ summary: "Get a recurrence rule" })
  @ApiParam({ name: "ruleId", description: "Recurrence rule ID" })
  @ApiResponse({
    status: 200,
    description: "Returns the recurrence rule",
    type: RecurrenceRuleResponseDto,
  })
  @ApiResponse({ status: 404, description: "Rule not found" })
  async getRecurrenceRule(
    @Param("ruleId") ruleId: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<RecurrenceRuleResponseDto> {
    try {
      return await this.calendarService.getRecurrenceRule(
        user.restaurantId,
        ruleId,
      );
    } catch (error) {
      if (error.status === 404) {
        throw error;
      }
      this.logger.error({
        message: "Get recurrence rule failed",
        ruleId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to get recurrence rule",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // EVENT TYPES
  // ==========================================================================

  @Get("event-types/:restaurantId")
  @ApiOperation({ summary: "List event types for a restaurant" })
  @ApiParam({ name: "restaurantId", description: "Restaurant UUID" })
  @ApiResponse({
    status: 200,
    description: "Event types list",
    type: [EventTypeResponseDto],
  })
  async getEventTypes(
    @Param("restaurantId") restaurantId: string,
  ): Promise<EventTypeResponseDto[]> {
    try {
      return await this.calendarService.getEventTypes(restaurantId);
    } catch (error) {
      this.logger.error({
        message: "Get event types failed",
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to get event types",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("event-types")
  @ApiOperation({ summary: "Create a custom event type" })
  @ApiResponse({
    status: 201,
    description: "Event type created",
    type: EventTypeResponseDto,
  })
  async createEventType(
    @Body() dto: CreateEventTypeDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<EventTypeResponseDto> {
    try {
      // restaurantId must come from the authenticated JWT, not the request body
      return await this.calendarService.createEventType({
        ...dto,
        restaurantId: user.restaurantId,
      });
    } catch (error) {
      this.logger.error({
        message: "Create event type failed",
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to create event type",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch("event-types/:id")
  @ApiOperation({ summary: "Update a custom event type" })
  @ApiParam({ name: "id", description: "Event type ID" })
  @ApiResponse({
    status: 200,
    description: "Event type updated",
    type: EventTypeResponseDto,
  })
  async updateEventType(
    @Param("id") id: string,
    @Body() dto: UpdateEventTypeDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<EventTypeResponseDto> {
    try {
      return await this.calendarService.updateEventType(
        id,
        user.restaurantId,
        dto,
      );
    } catch (error) {
      if (error.status === 404) throw error;
      this.logger.error({
        message: "Update event type failed",
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to update event type",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete("event-types/:id")
  @ApiOperation({ summary: "Delete a custom event type" })
  @ApiParam({ name: "id", description: "Event type ID" })
  @ApiResponse({ status: 200, description: "Event type deleted" })
  async deleteEventType(
    @Param("id") id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      return await this.calendarService.deleteEventType(id, user.restaurantId);
    } catch (error) {
      this.logger.error({
        message: "Delete event type failed",
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to delete event type",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // EVENT STATUS
  // ==========================================================================

  @Patch("events/:eventId/status")
  @ApiOperation({ summary: "Update event status" })
  @ApiParam({ name: "eventId", description: "Event ID" })
  @ApiResponse({
    status: 200,
    description: "Event status updated",
    type: CalendarEventResponseDto,
  })
  @ApiResponse({ status: 404, description: "Event not found" })
  async updateEventStatus(
    @Param("eventId") eventId: string,
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
      this.logger.error({
        message: "Update event status failed",
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to update event status",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // RECURRING INSTANCES
  // ==========================================================================

  @Get("events/:eventId/recurring")
  @ApiOperation({ summary: "Get instances of a recurring event" })
  @ApiParam({ name: "eventId", description: "Parent event ID" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date filter (YYYY-MM-DD)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date filter (YYYY-MM-DD)",
  })
  @ApiResponse({
    status: 200,
    description: "Recurring instances",
    type: [CalendarEventResponseDto],
  })
  async getRecurringInstances(
    @Param("eventId") eventId: string,
    @Query("startDate") startDate: string | undefined,
    @Query("endDate") endDate: string | undefined,
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
      this.logger.error({
        message: "Get recurring instances failed",
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to get recurring instances",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete("events/:eventId/recurring")
  @ApiOperation({ summary: "Delete a recurring event series" })
  @ApiParam({ name: "eventId", description: "Parent event ID" })
  @ApiQuery({
    name: "fromDate",
    required: false,
    description: "Delete from this date onwards (YYYY-MM-DD)",
  })
  @ApiResponse({ status: 200, description: "Series deleted" })
  async deleteRecurringSeries(
    @Param("eventId") eventId: string,
    @Query("fromDate") fromDate: string | undefined,
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
      this.logger.error({
        message: "Delete recurring series failed",
        eventId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to delete recurring series",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // CONVENIENCE ENDPOINTS
  // ==========================================================================

  @Get("upcoming")
  @ApiOperation({ summary: "Get upcoming events (next 30 days)" })
  @ApiResponse({
    status: 200,
    description: "Returns upcoming events",
    type: CalendarEventsListResponseDto,
  })
  async getUpcomingEvents(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventsListResponseDto> {
    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    return this.calendarService.listEvents(user.restaurantId, {
      startDate: today,
      endDate: thirtyDaysLater,
      includeRecurring: true,
      limit: 100,
    });
  }

  @Get("today")
  @ApiOperation({ summary: "Get today's events" })
  @ApiResponse({
    status: 200,
    description: "Returns today's events",
    type: CalendarEventsListResponseDto,
  })
  async getTodayEvents(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<CalendarEventsListResponseDto> {
    const today = new Date().toISOString().split("T")[0];

    return this.calendarService.listEvents(user.restaurantId, {
      startDate: today,
      endDate: today,
      includeRecurring: true,
      limit: 50,
    });
  }

  // ==========================================================================
  // SERVER-SIDE REMINDERS — what the job did, and whether it serves this house
  // ==========================================================================

  /**
   * The reminder job's own account of itself, for one restaurant and one reader.
   *
   * It exists because the page is not allowed to say "reminders are handled".
   * The cron only serves restaurants the scheduler enumerates (ADR 0022), only
   * runs while the gateway process is alive, and defers a member who is inside
   * their quiet window — so the honest sentence needs the last actual run, the
   * next scheduled tick, whether this house is served at all, and the reader's
   * own quiet hours. All four come from here; none is computed in the browser.
   *
   * Tenant scope is the signed token's `restaurantId`, never a query parameter.
   */
  @Get("reminders/status")
  @ApiOperation({
    summary:
      "Server-side calendar reminder job: last run, next scheduled run, and whether this restaurant is served",
  })
  @ApiResponse({ status: 200, description: "Reminder job status" })
  async getReminderStatus(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<ReminderStatus> {
    try {
      return await this.reminders.statusFor(user.restaurantId, user.userId);
    } catch (error) {
      this.logger.error({
        message: "Reminder status read failed",
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to read reminder status",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // THE WEATHER OVERLAY (ADR 0111 slice 2)
  // ==========================================================================

  /**
   * The published forecast for this house's own coordinate, day by day.
   *
   * It lives on the calendar controller because the calendar is its only
   * consumer and the tenant scope is the same signed token — a separate
   * top-level module would have to be registered in `app.module.ts`, which this
   * build does not own.
   *
   * The response NEVER answers an empty list to mean a failure. `refusal`
   * carries the sentence the page prints when the whole overlay is dark (no
   * coordinate, outside the issuer's coverage, issuer down), and `staleReason`
   * carries the one it prints beside readings that are real but old. Both are
   * words, because a weather column that is silently blank is indistinguishable
   * from a week of clear skies.
   */
  @Get("weather")
  @ApiOperation({
    summary:
      "Published weather readings for this restaurant's coordinate, each with its issuer and issue time",
  })
  @ApiResponse({ status: 200, description: "Readings, or a refusal in words" })
  async getWeather(
    @Query() query: GetWeatherQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<WeatherWindow> {
    const today = new Date().toISOString().slice(0, 10);
    const from = query.from?.slice(0, 10) || today;
    const to = query.to?.slice(0, 10) || from;
    try {
      return await this.weather.windowFor(user.restaurantId, from, to);
    } catch (error) {
      this.logger.error({
        message: "Weather read failed",
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to read the weather register",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * What each passed day in the window actually held — ADR 0111 slice 3.
   *
   * The ledger's own record beside the forecast that stood before the day
   * began. Two registers, two separate refusals: `recordedRefusal` and
   * `weatherRefusal` never merge, because "no POS is connected" and "the
   * forecast could not be read" are different sentences and the cell prints a
   * different one for each.
   */
  @Get("day-record")
  @ApiOperation({
    summary:
      "Passed days: what the ledger recorded, beside the forecast that stood before the day",
  })
  @ApiResponse({ status: 200, description: "Reconciled days" })
  async getDayRecord(
    @Query() query: GetWeatherQueryDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<DayRecordWindow> {
    const today = new Date().toISOString().slice(0, 10);
    const from = query.from?.slice(0, 10) || today;
    const to = query.to?.slice(0, 10) || from;
    try {
      return await this.dayRecord.windowFor(user.restaurantId, from, to);
    } catch (error) {
      this.logger.error({
        message: "Day record read failed",
        userId: user.userId,
        restaurantId: user.restaurantId,
        error: error.message,
      });
      throw new HttpException(
        error.message || "Failed to read the day record",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==========================================================================
  // iCAL SUBSCRIPTION FEED (D-07, D-08, D-09)
  // ==========================================================================

  @Get("feed/:token.ics")
  @Public()
  @ApiOperation({
    summary: "Public iCal feed — subscribe with Outlook/Apple/Google Calendar",
  })
  @ApiParam({
    name: "token",
    description: "Restaurant iCal token (64-char hex)",
  })
  async getICalFeed(
    @Param("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    const icalString = await this.calendarService.getICalFeed(token);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    // `attachment` told every client to SAVE A FILE. A saved .ics is a one-time
    // import: the events land once and never move again, which is exactly the
    // symptom behind "the feed has never been seen to subscribe"
    // (v3.0-TECH-DEBT.md:243-245, ADR 0111 §5). `inline` lets the client treat
    // the URL as a living subscription.
    res.setHeader(
      "Content-Disposition",
      'inline; filename="mudavym-calendar.ics"',
    );
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(icalString);
  }

  /**
   * The origin a subscriber should use, and where it came from.
   *
   * Two honest sources, in order: `API_PUBLIC_URL` (the same variable the OAuth
   * callbacks use — integrations-oauth.service.ts:82), then the request's own
   * `Host` (with `X-Forwarded-Proto` where a proxy set one), which is a fact
   * about how this caller reached the gateway rather than a guess. If neither
   * exists the answer is `none` and the URL fields are null: a fabricated
   * origin would produce a subscription URL that silently never resolves.
   */
  private feedOrigin(req: Request): {
    origin: string | null;
    source: "config" | "request" | "none";
  } {
    const configured = process.env.API_PUBLIC_URL;
    if (configured && configured.trim()) {
      return { origin: configured.trim().replace(/\/+$/, ""), source: "config" };
    }

    const host = req?.headers?.host;
    if (typeof host === "string" && host.trim()) {
      const forwarded = req.headers["x-forwarded-proto"];
      const proto =
        (Array.isArray(forwarded) ? forwarded[0] : forwarded)
          ?.split(",")[0]
          ?.trim() ||
        (req as unknown as { protocol?: string }).protocol ||
        "http";
      return { origin: `${proto}://${host.trim()}`, source: "request" };
    }

    return { origin: null, source: "none" };
  }

  /** Build the three URL fields of `ICalTokenResponseDto` from one token. */
  private icalTokenResponse(
    token: string,
    req: Request,
  ): ICalTokenResponseDto {
    const path = `/api/v1/calendar/feed/${token}.ics`;
    const { origin, source } = this.feedOrigin(req);
    const absolute = origin ? `${origin}${path}` : null;
    return {
      token,
      feedUrl: path,
      absoluteFeedUrl: absolute,
      // `webcal://` is not an IANA scheme, it is the de-facto handler
      // registration Apple Calendar and Outlook bind to. Clicking an https://
      // .ics link opens a browser download; clicking the webcal:// form opens
      // the calendar app's subscribe dialog.
      webcalUrl: absolute
        ? absolute.replace(/^https?:\/\//, "webcal://")
        : null,
      originSource: source,
    };
  }

  @Get("ical-token")
  @ApiOperation({
    summary: "Get or generate iCal subscription token for current restaurant",
  })
  @ApiResponse({ status: 200, type: ICalTokenResponseDto })
  async getICalToken(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Req() req: Request,
  ): Promise<ICalTokenResponseDto> {
    const token = await this.calendarService.getOrGenerateICalToken(
      user.restaurantId,
    );
    return this.icalTokenResponse(token, req);
  }

  @Post("ical-token/regenerate")
  @ApiOperation({
    summary: "Regenerate iCal token — invalidates all existing subscriptions",
  })
  @ApiResponse({ status: 201, type: ICalTokenResponseDto })
  async regenerateICalToken(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Req() req: Request,
  ): Promise<ICalTokenResponseDto> {
    const token = await this.calendarService.regenerateICalToken(
      user.restaurantId,
    );
    return this.icalTokenResponse(token, req);
  }
}
