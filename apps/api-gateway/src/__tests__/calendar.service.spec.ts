import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { CalendarService } from "../calendar/calendar.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import {
  CalendarEventType,
  CalendarEventSource,
  CalendarEventStatus,
  RecurrenceFrequency,
  RecurrenceEndType,
} from "../calendar/dto/calendar.dto";

describe("CalendarService", () => {
  let service: CalendarService;
  let databaseService: DatabaseService;
  let eventsService: EventsService;

  const mockSupabaseClient = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn(),
    rpc: jest.fn(),
  };

  const mockDatabaseService = {
    supabase: mockSupabaseClient,
  };

  const mockEventsService = {
    createEvent: jest.fn().mockResolvedValue({ id: "event-123" }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: EventsService, useValue: mockEventsService },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
    databaseService = module.get<DatabaseService>(DatabaseService);
    eventsService = module.get<EventsService>(EventsService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createEvent", () => {
    const restaurantId = "restaurant-123";
    const userId = "user-456";

    it("should create a simple calendar event", async () => {
      const dto = {
        title: "Wine Tasting",
        eventType: CalendarEventType.TASTING,
        eventDate: "2024-02-15",
        allDay: true,
      };

      const mockCreatedEvent = {
        id: "event-789",
        restaurant_id: restaurantId,
        title: dto.title,
        event_type: dto.eventType,
        event_date: dto.eventDate,
        all_day: dto.allDay,
        source: "manual",
        status: "pending",
        reminder_enabled: true,
        reminder_days_before: 1,
        is_recurring: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedEvent,
        error: null,
      });

      const result = await service.createEvent(restaurantId, userId, dto);

      expect(result.id).toBe("event-789");
      expect(result.title).toBe(dto.title);
      expect(result.eventType).toBe(dto.eventType);
      expect(result.isRecurring).toBe(false);
      expect(mockEventsService.createEvent).toHaveBeenCalled();
    });

    it("should create a recurring event with recurrence rule", async () => {
      const dto = {
        title: "Weekly Inventory Count",
        eventType: CalendarEventType.INVENTORY_COUNT,
        eventDate: "2024-02-01",
        recurrence: {
          frequency: RecurrenceFrequency.WEEKLY,
          interval: 1,
          daysOfWeek: [1], // Monday
          endType: RecurrenceEndType.NEVER,
        },
      };

      const mockCreatedEvent = {
        id: "event-recurring",
        restaurant_id: restaurantId,
        title: dto.title,
        event_type: dto.eventType,
        event_date: dto.eventDate,
        is_recurring: true,
        source: "manual",
        status: "pending",
        reminder_enabled: true,
        reminder_days_before: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockRecurrenceRule = {
        id: "rule-123",
        restaurant_id: restaurantId,
        calendar_event_id: "event-recurring",
        frequency: "weekly",
        interval_value: 1,
        days_of_week: [1],
        end_type: "never",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single
        .mockResolvedValueOnce({ data: mockCreatedEvent, error: null })
        .mockResolvedValueOnce({ data: mockRecurrenceRule, error: null });

      mockSupabaseClient.rpc.mockResolvedValue({ data: 10, error: null });

      const result = await service.createEvent(restaurantId, userId, dto);

      expect(result.isRecurring).toBe(true);
      expect(result.recurrenceRule).toBeDefined();
      expect(result.recurrenceRule?.frequency).toBe("weekly");
    });
  });

  describe("getEvent", () => {
    const restaurantId = "restaurant-123";

    it("should return event when found", async () => {
      const mockEvent = {
        id: "event-123",
        restaurant_id: restaurantId,
        title: "Test Event",
        event_type: "meeting",
        event_date: "2024-02-15",
        all_day: true,
        source: "manual",
        status: "pending",
        reminder_enabled: true,
        reminder_days_before: 1,
        is_recurring: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockEvent,
        error: null,
      });

      const result = await service.getEvent(restaurantId, "event-123");

      expect(result.id).toBe("event-123");
      expect(result.title).toBe("Test Event");
    });

    it("should throw NotFoundException when event not found", async () => {
      mockSupabaseClient.single.mockResolvedValue({
        data: null,
        error: { message: "Not found" },
      });

      await expect(
        service.getEvent(restaurantId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("listEvents", () => {
    const restaurantId = "restaurant-123";

    it("should return paginated events list", async () => {
      const mockEvents = [
        {
          id: "event-1",
          restaurant_id: restaurantId,
          title: "Event 1",
          event_type: "meeting",
          event_date: "2024-02-15",
          all_day: true,
          source: "manual",
          status: "pending",
          reminder_enabled: true,
          reminder_days_before: 1,
          is_recurring: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "event-2",
          restaurant_id: restaurantId,
          title: "Event 2",
          event_type: "delivery",
          event_date: "2024-02-16",
          all_day: false,
          source: "order",
          status: "approved",
          reminder_enabled: true,
          reminder_days_before: 1,
          is_recurring: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockSupabaseClient.range.mockResolvedValue({
        data: mockEvents,
        error: null,
        count: 2,
      });

      const result = await service.listEvents(restaurantId, {
        page: 1,
        limit: 10,
      });

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should filter by date range", async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listEvents(restaurantId, {
        startDate: "2024-02-01",
        endDate: "2024-02-28",
      });

      expect(mockSupabaseClient.gte).toHaveBeenCalledWith(
        "start_date",
        "2024-02-01",
      );
      expect(mockSupabaseClient.lte).toHaveBeenCalledWith(
        "start_date",
        "2024-02-28",
      );
    });

    it("should filter by event type", async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listEvents(restaurantId, {
        eventType: CalendarEventType.DELIVERY,
      });

      expect(mockSupabaseClient.eq).toHaveBeenCalledWith(
        "event_type",
        "delivery",
      );
    });
  });

  describe("updateEvent", () => {
    const restaurantId = "restaurant-123";
    const userId = "user-456";

    it("should update event fields", async () => {
      const existingEvent = {
        id: "event-123",
        restaurant_id: restaurantId,
        title: "Original Title",
        event_type: "meeting",
        event_date: "2024-02-15",
        all_day: true,
        source: "manual",
        status: "pending",
        reminder_enabled: true,
        reminder_days_before: 1,
        is_recurring: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const updatedEvent = {
        ...existingEvent,
        title: "Updated Title",
        status: "approved",
      };

      mockSupabaseClient.single
        .mockResolvedValueOnce({ data: existingEvent, error: null })
        .mockResolvedValueOnce({ data: updatedEvent, error: null });

      const result = await service.updateEvent(
        restaurantId,
        userId,
        "event-123",
        {
          title: "Updated Title",
          status: CalendarEventStatus.APPROVED,
        },
      );

      expect(result.title).toBe("Updated Title");
      expect(result.status).toBe("approved");
    });
  });

  describe("deleteEvent", () => {
    const restaurantId = "restaurant-123";
    const userId = "user-456";

    it("should delete a simple event", async () => {
      const existingEvent = {
        id: "event-123",
        restaurant_id: restaurantId,
        title: "Test Event",
        event_type: "meeting",
        event_date: "2024-02-15",
        all_day: true,
        source: "manual",
        status: "pending",
        reminder_enabled: true,
        reminder_days_before: 1,
        is_recurring: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: existingEvent,
        error: null,
      });

      // The delete chain: .from().delete().eq().eq() — mockReturnThis() is already
      // the default for all chain methods, so awaiting the chain resolves to
      // mockSupabaseClient which destructures to { error: undefined } — no throw.

      const result = await service.deleteEvent(
        restaurantId,
        userId,
        "event-123",
      );

      expect(result.deleted).toBe(true);
    });
  });

  describe("generateOccurrences", () => {
    const restaurantId = "restaurant-123";

    it("should call database function to generate occurrences", async () => {
      mockSupabaseClient.rpc.mockResolvedValue({ data: 12, error: null });

      const result = await service.generateOccurrences(
        restaurantId,
        "rule-123",
      );

      expect(result.generatedCount).toBe(12);
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        "generate_recurring_events",
        expect.objectContaining({ p_rule_id: "rule-123" }),
      );
    });
  });
});
