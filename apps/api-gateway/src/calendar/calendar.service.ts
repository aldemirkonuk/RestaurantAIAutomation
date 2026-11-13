import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { EventType, SourcePage } from "../events/dto/event.dto";
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
  GetCalendarEventsQueryDto,
  CalendarEventResponseDto,
  CalendarEventsListResponseDto,
  CalendarLinkedOrderDto,
  RecurrenceRuleResponseDto,
  GenerateOccurrencesResponseDto,
  EventTypeResponseDto,
  CreateEventTypeDto,
  UpdateEventTypeDto,
  RecurrenceFrequency,
  RecurrenceEndType,
  CalendarEventStatus,
} from "./dto/calendar.dto";

// ============================================================================
// DATABASE ROW INTERFACES
// ============================================================================

interface CalendarEventRow {
  id: string;
  restaurant_id: string;
  provider_id: string | null;
  order_id: string | null;
  title: string;
  description: string | null;
  event_type: string;
  start_date: string;
  end_date: string | null;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  color: string | null;
  source: string;
  status: string;
  reminder_enabled: boolean;
  reminder_days_before: number;
  reminder_sent: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  occurrence_date: string | null;
  recurrence_rule_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RecurrenceRuleRow {
  id: string;
  restaurant_id: string;
  calendar_event_id: string;
  frequency: string;
  interval_value: number;
  days_of_week: number[] | null;
  day_of_month: number | null;
  week_of_month: number | null;
  month_of_year: number | null;
  end_type: string;
  end_after_count: number | null;
  end_on_date: string | null;
  last_generated_date: string | null;
  next_generation_date: string | null;
  generation_horizon_days: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  async createEvent(
    restaurantId: string,
    userId: string,
    dto: CreateCalendarEventDto,
  ): Promise<CalendarEventResponseDto> {
    const startTime = Date.now();

    this.logger.log({
      message: "Creating calendar event",
      restaurantId,
      userId,
      eventType: dto.eventType,
      eventDate: dto.eventDate,
      isRecurring: !!dto.recurrence,
    });

    // An entry cannot end on a day before it starts. The window expander
    // reads such a row as unreadable and drops it, so it would be saved and
    // never drawn (QA round 4 B9).
    if (dto.eventDateEnd && dto.eventDateEnd.slice(0, 10) < dto.eventDate.slice(0, 10)) {
      throw new BadRequestException("An entry cannot end before the day it starts.");
    }
    await this.assertLinksInHouse(restaurantId, dto.providerId, dto.orderId);

    // Insert the calendar event
    const insertPayload = {
      restaurant_id: restaurantId,
      title: dto.title,
      description: dto.description || null,
      event_type: dto.eventType,
      start_date: dto.eventDate,
      end_date: dto.eventDateEnd || null,
      all_day: dto.allDay ?? true,
      start_time: dto.eventTime || null,
      end_time: dto.eventTimeEnd || null,
      color: dto.color || null,
      provider_id: dto.providerId || null,
      order_id: dto.orderId || null,
      source: dto.source || "manual",
      status: dto.status || "pending",
      reminder_enabled: dto.reminderEnabled ?? true,
      reminder_days_before: dto.reminderDaysBefore ?? 1,
      is_recurring: !!dto.recurrence,
      created_by: userId,
    };

    const { data: eventData, error: eventError } =
      await this.databaseService.supabase
        .from("calendar_events")
        .insert(insertPayload)
        .select("*")
        .single();

    if (eventError) {
      this.logger.error({
        message: "Failed to create calendar event",
        restaurantId,
        error: eventError.message,
        durationMs: Date.now() - startTime,
      });
      throw eventError;
    }

    let recurrenceRule: RecurrenceRuleResponseDto | undefined;

    // Create recurrence rule if provided
    if (dto.recurrence) {
      const rulePayload = {
        restaurant_id: restaurantId,
        calendar_event_id: eventData.id,
        frequency: dto.recurrence.frequency,
        interval_value: dto.recurrence.interval ?? 1,
        days_of_week: dto.recurrence.daysOfWeek || null,
        day_of_month: dto.recurrence.dayOfMonth || null,
        week_of_month: dto.recurrence.weekOfMonth || null,
        month_of_year: dto.recurrence.monthOfYear || null,
        end_type: dto.recurrence.endType,
        end_after_count: dto.recurrence.endAfterCount || null,
        end_on_date: dto.recurrence.endOnDate || null,
      };

      const { data: ruleData, error: ruleError } =
        await this.databaseService.supabase
          .from("calendar_recurrence_rules")
          .insert(rulePayload)
          .select("*")
          .single();

      // A repeat that could not be saved must not leave a one-off behind
      // that the house believes repeats (QA round 4 B6): the entry is taken
      // back out and the request fails with a sentence that says so.
      const linked = ruleError
        ? null
        : await this.databaseService.supabase
            .from("calendar_events")
            .update({ recurrence_rule_id: ruleData.id })
            .eq("id", eventData.id)
            .eq("restaurant_id", restaurantId);
      if (ruleError || linked?.error) {
        this.logger.error({
          message: "Failed to save the repeat for a calendar event",
          eventId: eventData.id,
          error: (ruleError ?? linked?.error)?.message,
        });
        const undone = await this.undoCreate(restaurantId, eventData.id, ruleData?.id ?? null);
        throw new InternalServerErrorException(
          undone
            ? "The repeat could not be saved, so the entry was not created. Nothing was written; try again."
            : "The repeat could not be saved, and the entry may be on the calendar once, without repeating. Check that day before adding it again.",
        );
      } else {
        recurrenceRule = this.mapRecurrenceRule(ruleData);

        // Generate initial occurrences
        await this.generateOccurrences(restaurantId, ruleData.id);
      }
    }

    // A DELIVERY LINKED TO AN ORDER FOLLOWS THE ORDER (ADR 0284). The table's
    // AFTER INSERT trigger (`delivery_event_is_born_matching_its_order`)
    // closes an entry whose order has already arrived, on the day it arrived,
    // or cancels one whose order will not come. That is the right date: the
    // entry is the arrival, and the arrival is a fact. But it runs AFTER the
    // insert, so the row this insert RETURNED is the one the user typed, and
    // the answer said "saved for 16 Nov, pending" over a row stored for
    // 15 Oct, completed (r29 walk, finding 3). Read the stored row back and
    // say what the order did to it.
    let stored: CalendarEventRow = eventData as CalendarEventRow;
    let notice: string | undefined;
    if (eventData.event_type === "delivery" && eventData.order_id) {
      const { data: after, error: afterError } = await this.databaseService.supabase
        .from("calendar_events")
        .select("*")
        .eq("id", eventData.id)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (afterError || !after) {
        this.logger.warn({
          message: "A linked delivery entry could not be read back after it was saved",
          eventId: eventData.id,
          error: afterError?.message ?? "no row",
        });
        notice =
          "The entry was saved, but it could not be read back. If its order has already " +
          "arrived, it is on the day the order arrived and ruled off; open that day to check.";
      } else {
        stored = after as CalendarEventRow;
        notice = linkedOrderMovedEntry(eventData as CalendarEventRow, stored) ?? undefined;
      }
    }

    // Emit event to event ingestion system
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.CALENDAR_EVENT,
        sourcePage: SourcePage.CALENDAR,
        payload: {
          eventId: eventData.id,
          title: dto.title,
          eventType: dto.eventType,
          action: "created",
          date: dto.eventDate,
          startTime: dto.eventTime,
          allDay: dto.allDay,
          isRecurring: !!dto.recurrence,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit calendar event to event system", e);
    }

    this.logger.log({
      message: "Calendar event created",
      restaurantId,
      eventId: eventData.id,
      isRecurring: !!dto.recurrence,
      durationMs: Date.now() - startTime,
    });

    return {
      ...this.mapCalendarEvent(stored),
      recurrenceRule,
      ...(notice ? { notice } : {}),
    };
  }

  /**
   * A vendor or order linked on create must be this house's. The foreign key
   * alone accepts any house's row, and its error text told a caller whether
   * an id existed elsewhere (QA round 4 IMPROVE 6).
   */
  private async assertLinksInHouse(
    restaurantId: string,
    providerId: string | undefined,
    orderId: string | undefined,
  ): Promise<void> {
    const checks: Array<[string, string, string]> = [];
    if (providerId) checks.push(["providers", providerId, "That vendor is not in this house's vendor book."]);
    if (orderId) checks.push(["procurement_orders", orderId, "That order is not in this house's orders book."]);
    for (const [table, id, refusal] of checks) {
      const { data, error } = await this.databaseService.supabase
        .from(table)
        .select("id")
        .eq("id", id)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) {
        this.logger.error({
          message: "Failed to check a calendar link",
          restaurantId,
          table,
          error: error.message,
        });
        throw new InternalServerErrorException(
          "The link could not be checked, so the entry was not created. Nothing was written; try again.",
        );
      }
      if (!data) throw new BadRequestException(refusal);
    }
  }

  /**
   * Take back a half-made entry: its rule (if one was written), then the row.
   * True only when the row is gone, so the refusal never claims "nothing was
   * written" over a row that stayed.
   */
  private async undoCreate(
    restaurantId: string,
    eventId: string,
    ruleId: string | null,
  ): Promise<boolean> {
    if (ruleId) {
      const { error } = await this.databaseService.supabase
        .from("calendar_recurrence_rules")
        .delete()
        .eq("id", ruleId)
        .eq("restaurant_id", restaurantId);
      if (error) {
        this.logger.error({ message: "Failed to remove a half-made repeat", ruleId, error: error.message });
      }
    }
    const { error } = await this.databaseService.supabase
      .from("calendar_events")
      .delete()
      .eq("id", eventId)
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.error({ message: "Failed to remove a half-made calendar entry", eventId, error: error.message });
      return false;
    }
    return true;
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async getEvent(
    restaurantId: string,
    eventId: string,
  ): Promise<CalendarEventResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("calendar_events")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", eventId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Calendar event not found: ${eventId}`);
    }

    let recurrenceRule: RecurrenceRuleResponseDto | undefined;

    if (data.recurrence_rule_id) {
      const { data: ruleData } = await this.databaseService.supabase
        .from("calendar_recurrence_rules")
        .select("*")
        .eq("id", data.recurrence_rule_id)
        .single();

      if (ruleData) {
        recurrenceRule = this.mapRecurrenceRule(ruleData);
      }
    }

    return {
      ...this.mapCalendarEvent(data),
      recurrenceRule,
    };
  }

  async listEvents(
    restaurantId: string,
    query: GetCalendarEventsQueryDto,
  ): Promise<CalendarEventsListResponseDto> {
    const startTime = Date.now();
    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    this.logger.debug({
      message: "Listing calendar events",
      restaurantId,
      query,
    });

    let supabaseQuery = this.databaseService.supabase
      .from("calendar_events")
      .select("*", { count: "exact" })
      .eq("restaurant_id", restaurantId);

    // Date range filter. A repeating series that began before the window still
    // has occurrences inside it, so a caller that expands rules itself can ask
    // for the lower bound to spare repeating rows (sweep 2026-09-28 row 16).
    // The value is quoted for PostgREST's `or` grammar; `@IsDateString`
    // already refuses commas.
    //
    // An entry that began before the window and is still running inside it
    // (a closure from the 28th to the 3rd, read as the new month) belongs to
    // the window too, so the lower bound is met by the start OR the end date
    // (QA round 4 B5). A row with no end date is a one-day entry; its
    // `end_date.gte` term is null and only its start date decides.
    if (query.startDate && query.includeEarlierSeries) {
      supabaseQuery = supabaseQuery.or(
        `start_date.gte."${query.startDate}",end_date.gte."${query.startDate}",is_recurring.eq.true`,
      );
    } else if (query.startDate) {
      supabaseQuery = supabaseQuery.or(
        `start_date.gte."${query.startDate}",end_date.gte."${query.startDate}"`,
      );
    }
    if (query.endDate) {
      supabaseQuery = supabaseQuery.lte("start_date", query.endDate);
    }

    // Type filter
    if (query.eventType) {
      supabaseQuery = supabaseQuery.eq("event_type", query.eventType);
    }

    // Status filter
    if (query.status) {
      supabaseQuery = supabaseQuery.eq("status", query.status);
    }

    // Provider filter
    if (query.providerId) {
      supabaseQuery = supabaseQuery.eq("provider_id", query.providerId);
    }

    // Exclude generated occurrences if not requested
    if (!query.includeRecurring) {
      supabaseQuery = supabaseQuery.is("parent_event_id", null);
    }

    // `id` breaks ties so a window read page by page never repeats or skips
    // a row that shares its start date with the page boundary.
    const { data, error, count } = await supabaseQuery
      .order("start_date", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error({
        message: "Failed to list calendar events",
        restaurantId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    const rows: CalendarEventRow[] = data || [];
    const rules = await this.readRulesFor(restaurantId, rows);
    const events = rows.map((row) => ({
      ...this.mapCalendarEvent(row),
      recurrenceRule: row.recurrence_rule_id
        ? rules.get(row.recurrence_rule_id)
        : undefined,
    }));
    const total = count ?? events.length;

    this.logger.debug({
      message: "Calendar events listed",
      restaurantId,
      resultCount: events.length,
      total,
      durationMs: Date.now() - startTime,
    });

    const linked = query.withOrders
      ? await this.readLinkedOrders(restaurantId, rows)
      : null;

    return {
      events,
      total,
      page,
      limit,
      hasMore: fromIndex + events.length < total,
      ...(linked
        ? { linkedOrders: linked.orders, linkedOrdersReadable: linked.readable }
        : {}),
    };
  }

  /**
   * The orders a page of rows links to, read from this house's book only, a
   * chunk of ids at a time. A failed read does NOT fail the calendar: the
   * events are still true, and `readable: false` tells the page it cannot say
   * whether those orders have arrived.
   */
  private async readLinkedOrders(
    restaurantId: string,
    rows: CalendarEventRow[],
  ): Promise<{ orders: CalendarLinkedOrderDto[]; readable: boolean }> {
    const ids = [
      ...new Set(
        rows.map((r) => r.order_id).filter((id): id is string => !!id),
      ),
    ];
    const orders: CalendarLinkedOrderDto[] = [];
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("id, order_number, status")
        .eq("restaurant_id", restaurantId)
        .in("id", ids.slice(i, i + CHUNK));
      if (error) {
        this.logger.error({
          message: "Failed to read linked orders for calendar list",
          restaurantId,
          error: error.message,
        });
        return { orders: [], readable: false };
      }
      for (const o of (data || []) as Array<{
        id: string;
        order_number: string | null;
        status: string | null;
      }>) {
        orders.push({
          id: o.id,
          orderNumber: o.order_number || null,
          status: o.status ?? "",
        });
      }
    }
    return { orders, readable: true };
  }

  /**
   * The repeat rules named by a page of rows, read in one pass per chunk and
   * scoped to this house. A failed read throws: returning the rows without
   * their rules would draw every series on its first date only, which is the
   * defect this exists to fix (sweep 2026-09-28 row 16).
   */
  private async readRulesFor(
    restaurantId: string,
    rows: CalendarEventRow[],
  ): Promise<Map<string, RecurrenceRuleResponseDto>> {
    const ids = [
      ...new Set(
        rows
          .map((r) => r.recurrence_rule_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const out = new Map<string, RecurrenceRuleResponseDto>();
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await this.databaseService.supabase
        .from("calendar_recurrence_rules")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("id", ids.slice(i, i + CHUNK));
      if (error) {
        this.logger.error({
          message: "Failed to read recurrence rules for calendar list",
          restaurantId,
          error: error.message,
        });
        throw error;
      }
      for (const rule of (data || []) as RecurrenceRuleRow[]) {
        out.set(rule.id, this.mapRecurrenceRule(rule));
      }
    }
    return out;
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  async updateEvent(
    restaurantId: string,
    userId: string,
    eventId: string,
    dto: UpdateCalendarEventDto,
  ): Promise<CalendarEventResponseDto> {
    const startTime = Date.now();

    // Get existing event
    const existing = await this.getEvent(restaurantId, eventId);

    this.logger.log({
      message: "Updating calendar event",
      restaurantId,
      eventId,
      updateScope: dto.updateScope,
    });

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.title !== undefined) updatePayload.title = dto.title;
    if (dto.description !== undefined)
      updatePayload.description = dto.description;
    if (dto.eventType !== undefined) updatePayload.event_type = dto.eventType;
    if (dto.eventDate !== undefined) updatePayload.start_date = dto.eventDate;
    // Both copies of the end date are written. The date-sync trigger copies
    // `event_date_end` back into a NULL `end_date`, so clearing only
    // `end_date` would leave the old end standing.
    if (dto.eventDateEnd !== undefined) {
      updatePayload.end_date = dto.eventDateEnd;
      updatePayload.event_date_end = dto.eventDateEnd;
    }
    if (dto.allDay !== undefined) updatePayload.all_day = dto.allDay;
    if (dto.eventTime !== undefined) updatePayload.start_time = dto.eventTime;
    if (dto.eventTimeEnd !== undefined)
      updatePayload.end_time = dto.eventTimeEnd;
    if (dto.color !== undefined) updatePayload.color = dto.color;
    if (dto.status !== undefined) updatePayload.status = dto.status;
    if (dto.reminderEnabled !== undefined)
      updatePayload.reminder_enabled = dto.reminderEnabled;
    if (dto.reminderDaysBefore !== undefined)
      updatePayload.reminder_days_before = dto.reminderDaysBefore;

    // The entry as it will stand: a new start against the stored end, or a
    // new end against the stored start, is the same impossible entry the
    // create path refuses (QA round 4 B9), and the window expander would drop
    // it unseen.
    const nextStart = String(dto.eventDate ?? existing.eventDate ?? "").slice(0, 10);
    const nextEnd =
      dto.eventDateEnd !== undefined ? dto.eventDateEnd : existing.eventDateEnd;
    if (nextEnd && nextStart && String(nextEnd).slice(0, 10) < nextStart) {
      throw new BadRequestException(
        "An entry cannot end before the day it starts.",
      );
    }

    // Handle recurring event updates
    if (existing.isRecurring && existing.parentEventId && dto.updateScope) {
      if (dto.updateScope === "this") {
        // Create an exception for this occurrence
        await this.createRecurrenceException(
          existing.recurrenceRule?.id || "",
          existing.occurrenceDate || existing.eventDate,
          "modified",
          eventId,
        );
      } else if (dto.updateScope === "this_and_future") {
        // Split the recurring series at the occurrence date:
        // 1. Truncate the existing rule: set end_on_date to one day before occurrence
        // 2. Create a new parent event starting at occurrence_date with updated fields
        // 3. Create a new recurrence rule for the new parent, starting from occurrence_date

        const occurrenceDate = existing.occurrenceDate || existing.eventDate;
        if (!occurrenceDate) {
          throw new Error(
            "occurrence_date required for this_and_future update scope",
          );
        }

        // Step 1: Truncate the existing recurrence rule at occurrence_date - 1 day
        if (existing.recurrenceRule?.id) {
          const splitDate = new Date(occurrenceDate);
          splitDate.setDate(splitDate.getDate() - 1);
          const truncateEndDate = splitDate.toISOString().split("T")[0];

          const { error: ruleUpdateError } = await this.databaseService.supabase
            .from("calendar_recurrence_rules")
            .update({ end_on_date: truncateEndDate, end_type: "on_date" })
            .eq("id", existing.recurrenceRule.id);

          if (ruleUpdateError) {
            this.logger.error(
              "Failed to truncate existing recurrence rule",
              ruleUpdateError,
            );
          }
        }

        // Step 2: Build the new parent event payload (same shape as insertPayload in createEvent)
        const newParentPayload: Record<string, any> = {
          restaurant_id: restaurantId,
          title: dto.title ?? existing.title,
          description:
            dto.description !== undefined
              ? dto.description
              : existing.description,
          event_type: dto.eventType ?? existing.eventType,
          start_date: occurrenceDate,
          end_date:
            dto.eventDateEnd !== undefined
              ? dto.eventDateEnd
              : (existing.eventDateEnd ?? null),
          all_day: dto.allDay !== undefined ? dto.allDay : existing.allDay,
          start_time: dto.eventTime ?? existing.eventTime ?? null,
          end_time: dto.eventTimeEnd ?? existing.eventTimeEnd ?? null,
          color: dto.color !== undefined ? dto.color : (existing.color ?? null),
          source: existing.source || "manual",
          status: dto.status ?? existing.status ?? "pending",
          reminder_enabled:
            dto.reminderEnabled !== undefined
              ? dto.reminderEnabled
              : existing.reminderEnabled,
          reminder_days_before:
            dto.reminderDaysBefore ?? existing.reminderDaysBefore ?? 1,
          is_recurring: true,
          created_by: userId,
        };

        const { data: newParentData, error: newParentError } =
          await this.databaseService.supabase
            .from("calendar_events")
            .insert(newParentPayload)
            .select("*")
            .single();

        if (newParentError || !newParentData) {
          throw new Error(
            `Failed to create new parent event: ${newParentError?.message}`,
          );
        }

        // Step 3: Create new recurrence rule for the new parent, cloning the existing rule
        if (existing.recurrenceRule && newParentData) {
          const newRulePayload: Record<string, any> = {
            restaurant_id: restaurantId,
            calendar_event_id: newParentData.id,
            frequency: existing.recurrenceRule.frequency,
            interval_value: existing.recurrenceRule.interval ?? 1,
            days_of_week: existing.recurrenceRule.daysOfWeek ?? null,
            day_of_month: existing.recurrenceRule.dayOfMonth ?? null,
            week_of_month: existing.recurrenceRule.weekOfMonth ?? null,
            month_of_year: existing.recurrenceRule.monthOfYear ?? null,
            end_type: existing.recurrenceRule.endType ?? "never",
            end_after_count: existing.recurrenceRule.endAfterCount ?? null,
            end_on_date: existing.recurrenceRule.endOnDate ?? null,
            generation_horizon_days: 90,
          };

          const { data: newRuleData, error: newRuleError } =
            await this.databaseService.supabase
              .from("calendar_recurrence_rules")
              .insert(newRulePayload)
              .select("id")
              .single();

          if (newRuleError) {
            this.logger.error(
              "Failed to create new recurrence rule",
              newRuleError,
            );
          } else if (newRuleData) {
            // Trigger occurrence generation for the new rule (stub returns 0 in Phase 30)
            await this.generateOccurrences(restaurantId, newRuleData.id);
          }
        }

        // Return the new parent event (not the individual occurrence)
        return this.mapCalendarEvent(newParentData);
      } else if (dto.updateScope === "all") {
        // Update the parent event and regenerate occurrences
        if (existing.parentEventId) {
          await this.databaseService.supabase
            .from("calendar_events")
            .update(updatePayload)
            .eq("id", existing.parentEventId);
        }
      }
    }

    // Update the event
    const { data, error } = await this.databaseService.supabase
      .from("calendar_events")
      .update(updatePayload)
      .eq("id", eventId)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single();

    if (error) {
      this.logger.error({
        message: "Failed to update calendar event",
        restaurantId,
        eventId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    // Emit event to event ingestion system
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.CALENDAR_EVENT,
        sourcePage: SourcePage.CALENDAR,
        payload: {
          eventId,
          title: data.title,
          eventType: data.event_type,
          action: "updated",
          date: data.start_date,
          changes: dto,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit calendar event update", e);
    }

    this.logger.log({
      message: "Calendar event updated",
      restaurantId,
      eventId,
      durationMs: Date.now() - startTime,
    });

    return this.mapCalendarEvent(data);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  async deleteEvent(
    restaurantId: string,
    userId: string,
    eventId: string,
    deleteScope?: "this" | "this_and_future" | "all",
  ): Promise<{ deleted: boolean; message: string }> {
    const startTime = Date.now();

    // Get existing event
    const existing = await this.getEvent(restaurantId, eventId);

    this.logger.log({
      message: "Deleting calendar event",
      restaurantId,
      eventId,
      deleteScope,
      isRecurring: existing.isRecurring,
    });

    // Handle recurring event deletion
    if (existing.parentEventId && deleteScope === "this") {
      // Create a deletion exception instead of actually deleting
      await this.createRecurrenceException(
        existing.recurrenceRule?.id || "",
        existing.occurrenceDate || existing.eventDate,
        "deleted",
      );

      // Mark as cancelled instead of deleting
      await this.databaseService.supabase
        .from("calendar_events")
        .update({ status: "cancelled" })
        .eq("id", eventId);

      return { deleted: true, message: "Occurrence cancelled" };
    }

    if (deleteScope === "all") {
      // Delete the entire recurring series (parent + all occurrences)
      const parentId = existing.parentEventId || eventId;
      const result = await this.deleteRecurringSeries(
        restaurantId,
        userId,
        parentId,
      );
      return {
        deleted: result.success,
        message: `Deleted ${result.deletedCount} occurrence(s) and series`,
      };
    }

    if (deleteScope === "this_and_future" && existing.parentEventId) {
      // Truncate the recurrence rule so it ends the day before this occurrence,
      // then delete this and all future occurrences from the parent series.
      const occurrenceDate = existing.occurrenceDate || existing.eventDate;
      if (existing.recurrenceRule?.id) {
        const cutDate = new Date(occurrenceDate);
        cutDate.setDate(cutDate.getDate() - 1);
        const endOnDate = cutDate.toISOString().split("T")[0];
        await this.databaseService.supabase
          .from("calendar_recurrence_rules")
          .update({ end_on_date: endOnDate, end_type: "on_date" })
          .eq("id", existing.recurrenceRule.id);
      }
      const result = await this.deleteRecurringSeries(
        restaurantId,
        userId,
        existing.parentEventId,
        occurrenceDate,
      );
      return {
        deleted: true,
        message: `Deleted ${result.deletedCount} future occurrence(s)`,
      };
    }

    // Delete the event (and cascade to occurrences if parent)
    const { error } = await this.databaseService.supabase
      .from("calendar_events")
      .delete()
      .eq("id", eventId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error({
        message: "Failed to delete calendar event",
        restaurantId,
        eventId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    // Emit event to event ingestion system
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.CALENDAR_EVENT,
        sourcePage: SourcePage.CALENDAR,
        payload: {
          eventId,
          title: existing.title,
          eventType: existing.eventType,
          action: "deleted",
          date: existing.eventDate,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit calendar event deletion", e);
    }

    this.logger.log({
      message: "Calendar event deleted",
      restaurantId,
      eventId,
      durationMs: Date.now() - startTime,
    });

    return { deleted: true, message: "Event deleted" };
  }

  // ==========================================================================
  // RECURRENCE
  // ==========================================================================

  async generateOccurrences(
    restaurantId: string,
    ruleId: string,
    horizonDate?: string,
  ): Promise<GenerateOccurrencesResponseDto> {
    this.logger.log({
      message: "Generating recurring event occurrences",
      restaurantId,
      ruleId,
      horizonDate,
    });

    // Call the database function
    const { data, error } = await this.databaseService.supabase.rpc(
      "generate_recurring_events",
      {
        p_rule_id: ruleId,
        p_horizon_date: horizonDate || null,
      },
    );

    if (error) {
      this.logger.error({
        message: "Failed to generate occurrences",
        ruleId,
        error: error.message,
      });
      throw error;
    }

    const generatedCount = data || 0;

    this.logger.log({
      message: "Occurrences generated",
      ruleId,
      generatedCount,
    });

    return {
      ruleId,
      generatedCount,
      message: `Generated ${generatedCount} occurrence(s)`,
    };
  }

  async getRecurrenceRule(
    restaurantId: string,
    ruleId: string,
  ): Promise<RecurrenceRuleResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("calendar_recurrence_rules")
      .select("*")
      .eq("id", ruleId)
      .eq("restaurant_id", restaurantId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Recurrence rule not found: ${ruleId}`);
    }

    return this.mapRecurrenceRule(data);
  }

  private async createRecurrenceException(
    ruleId: string,
    originalDate: string,
    exceptionType: "deleted" | "modified",
    replacementEventId?: string,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("calendar_recurrence_exceptions")
      .upsert({
        recurrence_rule_id: ruleId,
        original_date: originalDate,
        exception_type: exceptionType,
        replacement_event_id: replacementEventId || null,
      });

    if (error) {
      this.logger.error({
        message: "Failed to create recurrence exception",
        ruleId,
        originalDate,
        error: error.message,
      });
    }
  }

  // ==========================================================================
  // EVENT TYPES
  // ==========================================================================

  private static readonly DEFAULT_EVENT_TYPES: EventTypeResponseDto[] = [
    {
      id: "default-delivery",
      name: "Delivery",
      color: "#3b82f6",
      icon: "truck",
      isDefault: true,
    },
    {
      id: "default-order",
      name: "Order",
      color: "#10b981",
      icon: "shopping-cart",
      isDefault: true,
    },
    {
      id: "default-meeting",
      name: "Meeting",
      color: "#8b5cf6",
      icon: "users",
      isDefault: true,
    },
    {
      id: "default-inventory",
      name: "Inventory Count",
      color: "#f59e0b",
      icon: "clipboard-list",
      isDefault: true,
    },
    {
      id: "default-tasting",
      name: "Tasting",
      color: "#ef4444",
      icon: "wine",
      isDefault: true,
    },
    {
      id: "default-reminder",
      name: "Reminder",
      color: "#6b7280",
      icon: "bell",
      isDefault: true,
    },
    {
      id: "default-holiday",
      name: "Holiday",
      color: "#ec4899",
      icon: "calendar",
      isDefault: true,
    },
    {
      id: "default-custom",
      name: "Custom",
      color: "#14b8a6",
      icon: "tag",
      isDefault: true,
    },
  ];

  async getEventTypes(restaurantId: string): Promise<EventTypeResponseDto[]> {
    try {
      const { data, error } = await this.databaseService.supabase
        .from("calendar_event_types")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true });

      if (error) {
        this.logger.warn(
          `calendar_event_types query failed (table may not exist): ${error.message}`,
        );
        return CalendarService.DEFAULT_EVENT_TYPES;
      }

      const custom: EventTypeResponseDto[] = (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon || undefined,
        isDefault: false,
      }));

      return [...CalendarService.DEFAULT_EVENT_TYPES, ...custom];
    } catch {
      return CalendarService.DEFAULT_EVENT_TYPES;
    }
  }

  async createEventType(
    dto: CreateEventTypeDto,
  ): Promise<EventTypeResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("calendar_event_types")
      .insert({
        restaurant_id: dto.restaurantId,
        name: dto.name,
        color: dto.color,
        icon: dto.icon || null,
      })
      .select("*")
      .single();

    if (error) {
      this.logger.error(`Failed to create event type: ${error.message}`);
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      color: data.color,
      icon: data.icon || undefined,
      isDefault: false,
    };
  }

  async updateEventType(
    id: string,
    restaurantId: string,
    dto: UpdateEventTypeDto,
  ): Promise<EventTypeResponseDto> {
    const updatePayload: Record<string, unknown> = {};
    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.color !== undefined) updatePayload.color = dto.color;
    if (dto.icon !== undefined) updatePayload.icon = dto.icon;

    const { data, error } = await this.databaseService.supabase
      .from("calendar_event_types")
      .update(updatePayload)
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single();

    if (error || !data) {
      throw new NotFoundException(`Event type not found: ${id}`);
    }

    return {
      id: data.id,
      name: data.name,
      color: data.color,
      icon: data.icon || undefined,
      isDefault: false,
    };
  }

  async deleteEventType(
    id: string,
    restaurantId: string,
  ): Promise<{ success: boolean }> {
    const { error } = await this.databaseService.supabase
      .from("calendar_event_types")
      .delete()
      .eq("id", id)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`Failed to delete event type: ${error.message}`);
      throw error;
    }

    return { success: true };
  }

  // ==========================================================================
  // EVENT STATUS
  // ==========================================================================

  async updateEventStatus(
    restaurantId: string,
    userId: string,
    eventId: string,
    status: CalendarEventStatus,
  ): Promise<CalendarEventResponseDto> {
    const existing = await this.getEvent(restaurantId, eventId);

    const { data, error } = await this.databaseService.supabase
      .from("calendar_events")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", eventId)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single();

    if (error || !data) {
      throw new NotFoundException(`Calendar event not found: ${eventId}`);
    }

    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.CALENDAR_EVENT,
        sourcePage: SourcePage.CALENDAR,
        payload: {
          eventId,
          title: data.title,
          action: "status_changed",
          oldStatus: existing.status,
          newStatus: status,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit status change event", e);
    }

    return this.mapCalendarEvent(data);
  }

  // ==========================================================================
  // RECURRING INSTANCES
  // ==========================================================================

  async getRecurringInstances(
    restaurantId: string,
    eventId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<CalendarEventResponseDto[]> {
    let query = this.databaseService.supabase
      .from("calendar_events")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("parent_event_id", eventId);

    if (startDate) {
      query = query.gte("start_date", startDate);
    }
    if (endDate) {
      query = query.lte("start_date", endDate);
    }

    const { data, error } = await query.order("start_date", {
      ascending: true,
    });

    if (error) {
      this.logger.error(`Failed to get recurring instances: ${error.message}`);
      throw error;
    }

    return (data || []).map((row: CalendarEventRow) =>
      this.mapCalendarEvent(row),
    );
  }

  async deleteRecurringSeries(
    restaurantId: string,
    userId: string,
    eventId: string,
    fromDate?: string,
  ): Promise<{ success: boolean; deletedCount: number }> {
    let query = this.databaseService.supabase
      .from("calendar_events")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("parent_event_id", eventId);

    if (fromDate) {
      query = query.gte("start_date", fromDate);
    }

    const { data, error } = await query.select("id");

    if (error) {
      this.logger.error(`Failed to delete recurring series: ${error.message}`);
      throw error;
    }

    const deletedCount = data?.length || 0;

    if (!fromDate) {
      await this.databaseService.supabase
        .from("calendar_events")
        .delete()
        .eq("id", eventId)
        .eq("restaurant_id", restaurantId);
    }

    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.CALENDAR_EVENT,
        sourcePage: SourcePage.CALENDAR,
        payload: {
          eventId,
          action: "recurring_series_deleted",
          fromDate: fromDate || "all",
          deletedCount,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit recurring series deletion event", e);
    }

    return { success: true, deletedCount };
  }

  // ==========================================================================
  // MAPPERS
  // ==========================================================================

  private mapCalendarEvent(row: CalendarEventRow): CalendarEventResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      title: row.title,
      description: row.description || undefined,
      eventType: row.event_type as CalendarEventResponseDto["eventType"],
      eventDate: row.start_date,
      eventDateEnd: row.end_date || undefined,
      allDay: row.all_day,
      eventTime: row.start_time || undefined,
      eventTimeEnd: row.end_time || undefined,
      color: row.color || undefined,
      providerId: row.provider_id || undefined,
      orderId: row.order_id || undefined,
      source: row.source as CalendarEventResponseDto["source"],
      status: row.status as CalendarEventResponseDto["status"],
      reminderEnabled: row.reminder_enabled,
      reminderDaysBefore: row.reminder_days_before,
      reminderSent: row.reminder_sent,
      isRecurring: row.is_recurring,
      parentEventId: row.parent_event_id || undefined,
      occurrenceDate: row.occurrence_date || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRecurrenceRule(row: RecurrenceRuleRow): RecurrenceRuleResponseDto {
    return {
      id: row.id,
      frequency: row.frequency as RecurrenceFrequency,
      interval: row.interval_value,
      daysOfWeek: row.days_of_week || undefined,
      dayOfMonth: row.day_of_month || undefined,
      weekOfMonth: row.week_of_month || undefined,
      monthOfYear: row.month_of_year || undefined,
      endType: row.end_type as RecurrenceEndType,
      endAfterCount: row.end_after_count || undefined,
      endOnDate: row.end_on_date || undefined,
      lastGeneratedDate: row.last_generated_date || undefined,
      nextGenerationDate: row.next_generation_date || undefined,
    };
  }

  // The iCal feed and its links moved to `calendar-links.service.ts` (personal
  // links, ADR 0111 review trail 2026-09-21) and `ical-render.ts`.
}

/**
 * What the order did to a delivery entry linked to it at birth (ADR 0284's
 * insert trigger), in words, or null when the stored row is what was sent.
 * Exported for the spec.
 */
export function linkedOrderMovedEntry(
  sent: { status: string; start_date: string | null },
  stored: { status: string; start_date: string | null },
): string | null {
  if (stored.status === sent.status && stored.start_date === sent.start_date) return null;
  if (stored.status === "completed") {
    return stored.start_date && stored.start_date !== sent.start_date
      ? `Its order has already arrived, so this delivery is on ${stored.start_date}, the day it arrived, not ${sent.start_date}, and it is ruled off.`
      : "Its order has already arrived, so this delivery is ruled off.";
  }
  if (stored.status === "cancelled") {
    return "Its order was cancelled, rejected or failed, so this delivery is not coming and is marked cancelled.";
  }
  return `The entry was saved, and the order changed it: it is on ${stored.start_date}, ${stored.status}.`;
}
