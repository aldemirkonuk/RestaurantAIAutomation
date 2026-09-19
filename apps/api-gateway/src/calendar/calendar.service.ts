import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import ical from "ical-generator";
import * as crypto from "crypto";
import { EventType, SourcePage } from "../events/dto/event.dto";
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
  GetCalendarEventsQueryDto,
  CalendarEventResponseDto,
  CalendarEventsListResponseDto,
  RecurrenceRuleResponseDto,
  GenerateOccurrencesResponseDto,
  EventTypeResponseDto,
  CreateEventTypeDto,
  UpdateEventTypeDto,
  RecurrenceFrequency,
  RecurrenceEndType,
  CalendarEventStatus,
} from "./dto/calendar.dto";
import {
  calendarDateToUtcMidnight,
  resolveZone,
  zonedWallClockToUtc,
} from "./zoned-time";
import type { PushVerb } from "./push/calendar-push.service";
import { CalendarPushService } from "./push/calendar-push.service";

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
    private readonly push: CalendarPushService,
  ) {}

  /**
   * THE ONE PLACE A MUTATION BECOMES A PUSH (ADR 0111 §5, direction 1).
   *
   * Every path in this class that changes `calendar_events` calls THIS and
   * nothing else calls `CalendarPushService.push`. That is deliberate and it is
   * the reason the method exists at all: there is no single SQL write path here
   * to hook — there are eleven statements across five public methods (create,
   * update including its this_and_future branch which inserts a whole new
   * parent, delete including its cancel-an-occurrence branch, updateEventStatus,
   * and deleteRecurringSeries) — and hooking a subset of them is precisely how a
   * copy silently stops happening for one kind of edit. `push-write-paths.spec.ts`
   * counts the mutation statements in this file and fails when the number
   * changes, so a future eighth path cannot be added without deciding whether
   * it pushes.
   *
   * NEVER AWAITS INTO A FAILURE. The entry is the house's record and is already
   * saved; the copy in Google is a copy. `push()` itself never throws, and this
   * wrapper catches anyway so that a change to that promise cannot turn a saved
   * edit into a 500 for the person who made it.
   */
  private async copyToGoogle(
    restaurantId: string,
    eventId: string,
    verb: PushVerb,
  ): Promise<void> {
    try {
      const result = await this.push.push(restaurantId, eventId, verb);
      if (result.outcome !== "delivered") {
        this.logger.log({
          message: "Calendar entry was not copied to Google",
          restaurantId,
          eventId,
          verb,
          outcome: result.outcome,
          detail: result.detail,
        });
      }
    } catch (error) {
      this.logger.error({
        message: "Calendar push threw and was contained",
        restaurantId,
        eventId,
        verb,
        error: (error as Error).message,
      });
    }
  }

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

      if (ruleError) {
        this.logger.error({
          message: "Failed to create recurrence rule",
          eventId: eventData.id,
          error: ruleError.message,
        });
        // Revert is_recurring to false to avoid leaving the event in an orphan
        // state (is_recurring=true with no associated recurrence rule).
        await this.databaseService.supabase
          .from("calendar_events")
          .update({ is_recurring: false })
          .eq("id", eventData.id);
      } else {
        recurrenceRule = this.mapRecurrenceRule(ruleData);

        // Update event with recurrence rule ID
        await this.databaseService.supabase
          .from("calendar_events")
          .update({ recurrence_rule_id: ruleData.id })
          .eq("id", eventData.id);

        // Generate initial occurrences
        await this.generateOccurrences(restaurantId, ruleData.id);
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

    // Push site 1 of 8 — a new entry.
    await this.copyToGoogle(restaurantId, eventData.id, "create");

    this.logger.log({
      message: "Calendar event created",
      restaurantId,
      eventId: eventData.id,
      isRecurring: !!dto.recurrence,
      durationMs: Date.now() - startTime,
    });

    return {
      ...this.mapCalendarEvent(eventData),
      recurrenceRule,
    };
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

    // Date range filter
    if (query.startDate) {
      supabaseQuery = supabaseQuery.gte("start_date", query.startDate);
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

    const { data, error, count } = await supabaseQuery
      .order("start_date", { ascending: true })
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

    const events = (data || []).map((row: CalendarEventRow) =>
      this.mapCalendarEvent(row),
    );
    const total = count ?? events.length;

    this.logger.debug({
      message: "Calendar events listed",
      restaurantId,
      resultCount: events.length,
      total,
      durationMs: Date.now() - startTime,
    });

    return {
      events,
      total,
      page,
      limit,
      hasMore: fromIndex + events.length < total,
    };
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
    if (dto.eventDateEnd !== undefined)
      updatePayload.end_date = dto.eventDateEnd;
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
          end_date: dto.eventDateEnd ?? existing.eventDateEnd ?? null,
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

        // Push site 2 of 8 — the split created a whole new parent entry, and
        // this branch RETURNS before the shared update below. It was the
        // easiest site in the file to miss, which is why they are numbered.
        await this.copyToGoogle(restaurantId, newParentData.id, "create");

        // Return the new parent event (not the individual occurrence)
        return this.mapCalendarEvent(newParentData);
      } else if (dto.updateScope === "all") {
        // Update the parent event and regenerate occurrences
        if (existing.parentEventId) {
          await this.databaseService.supabase
            .from("calendar_events")
            .update(updatePayload)
            .eq("id", existing.parentEventId);

          // Push site 8 of 8 — found by counting, not by reading. The parent
          // of a series changes here and then this method goes on to update
          // and push the OCCURRENCE, so before this line the parent's copy in
          // Google kept the old title and time for ever, silently, on the one
          // scope a person picks when they mean "change all of them".
          await this.copyToGoogle(
            restaurantId,
            existing.parentEventId,
            "update",
          );
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

    // Push site 3 of 8 — the entry changed. The copy is addressed by the
    // provider's own event id held on the mapping, never by searching Google
    // for something that looks like this entry.
    await this.copyToGoogle(restaurantId, eventId, "update");

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

      // Push site 4 of 8 — an UPDATE, not a delete: the row is still here and
      // Google's own `status: "cancelled"` is what a cancelled occurrence
      // looks like there. Pushing a delete would remove the copy of a row the
      // house still holds.
      await this.copyToGoogle(restaurantId, eventId, "update");

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

    // Push site 5 of 8 — AFTER the local delete, on purpose. The mapping row
    // carries no foreign key to `calendar_events` precisely so it survives this
    // statement: the copy in Google can only be removed by something that still
    // remembers its provider event id.

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

    await this.copyToGoogle(restaurantId, eventId, "delete");

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

    // Push site 6 of 8 — a status change is a change to the entry, and a
    // cancellation in particular has to reach the copy: an entry cancelled here
    // and still drawn as confirmed in somebody's Google calendar is the worst
    // shape this direction can produce.
    await this.copyToGoogle(restaurantId, eventId, "update");

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

    // Push site 7 of 8 — a whole series. Each deleted occurrence AND the parent
    // gets its own delete, one write per removed entry, because each one has
    // its own copy in Google under its own provider event id. Serially rather
    // than in parallel: this is the one path that can produce ninety writes at
    // once, and a burst is what a rate limit is for.
    for (const row of (data ?? []) as Array<{ id: string }>) {
      await this.copyToGoogle(restaurantId, String(row.id), "delete");
    }
    if (!fromDate) {
      await this.copyToGoogle(restaurantId, eventId, "delete");
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

  // ==========================================================================
  // iCAL SUBSCRIPTION FEED (D-07, D-08, D-09)
  // ==========================================================================

  async getOrGenerateICalToken(restaurantId: string): Promise<string> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .select("calendar_ical_token")
      .eq("id", restaurantId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch iCal token: ${error.message}`);
    }

    if (data?.calendar_ical_token) {
      return data.calendar_ical_token;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const { error: updateError } = await this.databaseService.supabase
      .from("restaurants")
      .update({ calendar_ical_token: token })
      .eq("id", restaurantId);

    if (updateError) {
      throw new Error(`Failed to store iCal token: ${updateError.message}`);
    }

    return token;
  }

  async regenerateICalToken(restaurantId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex");
    const { error } = await this.databaseService.supabase
      .from("restaurants")
      .update({ calendar_ical_token: token })
      .eq("id", restaurantId);

    if (error) {
      throw new Error(`Failed to regenerate iCal token: ${error.message}`);
    }

    return token;
  }

  /**
   * How often a subscriber should come back, in seconds.
   *
   * Emitted as both `REFRESH-INTERVAL` (RFC 7986 §5.7) and the pre-standard
   * `X-PUBLISHED-TTL` that Outlook and Apple actually read. Without either,
   * every client picks its own interval — Google's has been observed at up to
   * 24 hours — and a delivery moved this morning shows up tomorrow. One hour is
   * the shortest value the major clients honour; asking for less does not make
   * them poll faster.
   */
  private static readonly ICAL_TTL_SECONDS = 3600;

  async getICalFeed(token: string): Promise<string> {
    const { data: restaurant, error: restError } =
      await this.databaseService.supabase
        .from("restaurants")
        // `timezone` is what turns a stored wall clock into an instant. Without
        // it every event was built on the SERVER's clock — see zoned-time.ts.
        .select("id, name, timezone")
        .eq("calendar_ical_token", token)
        .single();

    if (restError || !restaurant) {
      // Return empty calendar (not 404) to avoid exposing token validity (T-30-09)
      const emptyCal = ical({
        name: "WineOps Calendar",
        // No leading dash: ical-generator prepends the "-" that RFC 5545's FPI
        // convention requires, so "-//…" here emitted "PRODID:--//WineOps//…".
        prodId: "//WineOps//Restaurant Calendar//EN",
        // The refresh hint belongs on every answer, including this one: a
        // subscriber that first hits a bad token must still be told when to
        // come back rather than choosing its own day-long interval.
        ttl: CalendarService.ICAL_TTL_SECONDS,
      });
      return emptyCal.toString();
    }

    const { data: events, error: eventsError } =
      await this.databaseService.supabase
        .from("calendar_events")
        .select(
          "id, title, description, start_date, start_time, end_date, end_time, all_day, status, is_recurring, parent_event_id",
        )
        .eq("restaurant_id", restaurant.id)
        .is("parent_event_id", null)
        .order("start_date", { ascending: true });

    if (eventsError || !events) {
      const emptyCal = ical({
        name: "WineOps Calendar",
        // No leading dash: ical-generator prepends the "-" that RFC 5545's FPI
        // convention requires, so "-//…" here emitted "PRODID:--//WineOps//…".
        prodId: "//WineOps//Restaurant Calendar//EN",
        // The refresh hint belongs on every answer, including this one: a
        // subscriber that first hits a bad token must still be told when to
        // come back rather than choosing its own day-long interval.
        ttl: CalendarService.ICAL_TTL_SECONDS,
      });
      return emptyCal.toString();
    }

    const recurringEventIds = events
      .filter((e) => e.is_recurring)
      .map((e) => e.id);
    const recurrenceRules: Record<string, any> = {};
    if (recurringEventIds.length > 0) {
      const { data: rules } = await this.databaseService.supabase
        .from("calendar_recurrence_rules")
        .select(
          "calendar_event_id, frequency, interval_value, end_on_date, end_after_count, days_of_week",
        )
        .in("calendar_event_id", recurringEventIds);
      if (rules) {
        for (const rule of rules) {
          recurrenceRules[rule.calendar_event_id] = rule;
        }
      }
    }

    const calendar = ical({
      name: `${restaurant.name || "WineOps"} Calendar`,
      // No leading dash: ical-generator prepends the "-" that RFC 5545's FPI
      // convention requires, so "-//…" here emitted "PRODID:--//WineOps//…".
      prodId: "//WineOps//Restaurant Calendar//EN",
      // REFRESH-INTERVAL + X-PUBLISHED-TTL. See ICAL_TTL_SECONDS.
      ttl: CalendarService.ICAL_TTL_SECONDS,
    });

    /**
     * The zone the stored wall clocks are written in.
     *
     * null when the restaurant carries no `timezone`, or one this Node build
     * cannot resolve. In that case each timed event is published **floating**
     * (RFC 5545 §3.3.5 form one: no `Z`, no `TZID`) — "09:00 wherever you are",
     * which is the honest reading of a wall clock with no zone. Publishing it as
     * UTC would assert an offset nobody recorded.
     */
    const zone = resolveZone((restaurant as { timezone?: string }).timezone);

    const freqMap: Record<string, string> = {
      daily: "DAILY",
      weekly: "WEEKLY",
      monthly: "MONTHLY",
      yearly: "YEARLY",
    };

    // RFC 5545 day codes indexed by JS day number (0=Sunday … 6=Saturday)
    const icalDayCodes: Record<number, string> = {
      0: "SU",
      1: "MO",
      2: "TU",
      3: "WE",
      4: "TH",
      5: "FR",
      6: "SA",
    };

    for (const event of events) {
      const icalStatus =
        event.status === "cancelled" || event.status === "dismissed"
          ? "CANCELLED"
          : event.status === "pending"
            ? "TENTATIVE"
            : "CONFIRMED";

      const startDateStr = event.start_date;
      const endDateStr = event.end_date || event.start_date;

      let startDate: Date;
      let endDate: Date;

      if (event.all_day) {
        // A calendar date has no zone. ical-generator renders VALUE=DATE from
        // the Date's UTC fields, so UTC midnight is the only carrier that
        // round-trips the stored date unchanged on any server.
        startDate = calendarDateToUtcMidnight(startDateStr);
        endDate = calendarDateToUtcMidnight(endDateStr);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
      } else if (zone) {
        const startTime = event.start_time || "00:00";
        const endTime = event.end_time || "23:59";
        startDate = zonedWallClockToUtc(startDateStr, startTime, zone);
        endDate = zonedWallClockToUtc(endDateStr, endTime, zone);
      } else {
        // No zone on the restaurant: keep the wall clock and publish it
        // floating (below). These Date objects are only carriers for the
        // year/month/day/hour/minute fields ical-generator reads in UTC.
        const startTime = event.start_time || "00:00";
        const endTime = event.end_time || "23:59";
        startDate = new Date(`${startDateStr}T${startTime}:00.000Z`);
        endDate = new Date(`${endDateStr}T${endTime}:00.000Z`);
      }

      const calEvent = calendar.createEvent({
        id: `${event.id}@wineops.app`,
        start: startDate,
        end: endDate,
        summary: event.title,
        description: event.description || undefined,
        allDay: event.all_day,
        // Floating only where the zone is genuinely unknown; an all-day event
        // is already zone-free and must not be marked floating as well.
        floating: !event.all_day && !zone,
        status: icalStatus as any,
      });

      const rule = recurrenceRules[event.id];
      if (rule && freqMap[rule.frequency]) {
        let rrule = `FREQ=${freqMap[rule.frequency]}`;
        if (rule.interval_value && rule.interval_value > 1)
          rrule += `;INTERVAL=${rule.interval_value}`;
        if (rule.end_on_date)
          rrule += `;UNTIL=${rule.end_on_date.replace(/-/g, "")}T000000Z`;
        if (rule.end_after_count) rrule += `;COUNT=${rule.end_after_count}`;
        if (rule.days_of_week?.length > 0) {
          const dayCodes = (rule.days_of_week as number[])
            .map((d) => icalDayCodes[d])
            .filter(Boolean);
          if (dayCodes.length > 0) rrule += `;BYDAY=${dayCodes.join(",")}`;
        }
        (calEvent as any).repeating(rrule);
      }
    }

    return calendar.toString();
  }
}
