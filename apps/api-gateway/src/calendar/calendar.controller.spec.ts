import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  CalendarEventType,
  CalendarEventStatus,
  CalendarEventSource,
  EventTypeResponseDto,
  CreateEventTypeDto,
  UpdateEventTypeDto,
  UpdateEventStatusDto,
  CalendarEventResponseDto,
} from "./dto/calendar.dto";

describe("CalendarController", () => {
  let controller: CalendarController;
  let calendarService: CalendarService;

  const mockUser = {
    userId: "user-123",
    restaurantId: "restaurant-456",
  };

  const mockCalendarService = {
    getEventTypes: jest.fn(),
    createEventType: jest.fn(),
    updateEventType: jest.fn(),
    deleteEventType: jest.fn(),
    updateEventStatus: jest.fn(),
    getRecurringInstances: jest.fn(),
    deleteRecurringSeries: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        {
          provide: CalendarService,
          useValue: mockCalendarService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CalendarController>(CalendarController);
    calendarService = module.get<CalendarService>(CalendarService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("GET /calendar/event-types/:restaurantId", () => {
    const restaurantId = "restaurant-123";

    it("should return event types list", async () => {
      const expectedResponse: EventTypeResponseDto[] = [
        {
          id: "type-1",
          name: "Wine Tasting",
          color: "#FF5733",
          icon: "wine",
          isDefault: false,
        },
        {
          id: "type-2",
          name: "Delivery",
          color: "#33FF57",
          icon: "truck",
          isDefault: true,
        },
      ];

      mockCalendarService.getEventTypes.mockResolvedValue(expectedResponse);

      const result = await controller.getEventTypes(restaurantId);

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("color");
      expect(mockCalendarService.getEventTypes).toHaveBeenCalledWith(
        restaurantId,
      );
    });

    it("should return empty array when no event types", async () => {
      mockCalendarService.getEventTypes.mockResolvedValue([]);

      const result = await controller.getEventTypes(restaurantId);

      expect(result).toEqual([]);
    });
  });

  describe("POST /calendar/event-types", () => {
    const createDto: CreateEventTypeDto = {
      restaurantId: "restaurant-123",
      name: "Custom Event",
      color: "#FF0000",
      icon: "star",
    };

    it("should create event type", async () => {
      const expectedResponse: EventTypeResponseDto = {
        id: "type-new",
        name: createDto.name,
        color: createDto.color,
        icon: createDto.icon,
        isDefault: false,
      };

      mockCalendarService.createEventType.mockResolvedValue(expectedResponse);

      const result = await controller.createEventType(createDto, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(result.id).toBe("type-new");
      expect(result.name).toBe(createDto.name);
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockCalendarService.createEventType.mockRejectedValue(
        new Error("Validation error"),
      );

      await expect(
        controller.createEventType(createDto, mockUser),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("PATCH /calendar/event-types/:id", () => {
    const eventTypeId = "type-123";
    const updateDto: UpdateEventTypeDto = {
      name: "Updated Event Type",
      color: "#00FF00",
    };

    it("should update event type", async () => {
      const expectedResponse: EventTypeResponseDto = {
        id: eventTypeId,
        // The DTO's fields are optional (it is a PATCH shape); this fixture
        // always supplies them, so the response type's required fields hold.
        name: updateDto.name!,
        color: updateDto.color!,
        icon: "star",
        isDefault: false,
      };

      mockCalendarService.updateEventType.mockResolvedValue(expectedResponse);

      const result = await controller.updateEventType(
        eventTypeId,
        updateDto,
        mockUser,
      );

      expect(result).toEqual(expectedResponse);
      expect(result.name).toBe(updateDto.name);
    });

    it("should throw NotFoundException when event type not found", async () => {
      mockCalendarService.updateEventType.mockRejectedValue(
        new NotFoundException("Event type not found"),
      );

      await expect(
        controller.updateEventType(eventTypeId, updateDto, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw INTERNAL_SERVER_ERROR on other errors", async () => {
      mockCalendarService.updateEventType.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(
        controller.updateEventType(eventTypeId, updateDto, mockUser),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("DELETE /calendar/event-types/:id", () => {
    const eventTypeId = "type-123";

    it("should delete event type", async () => {
      mockCalendarService.deleteEventType.mockResolvedValue({ success: true });

      const result = await controller.deleteEventType(eventTypeId, mockUser);

      expect(result).toEqual({ success: true });
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockCalendarService.deleteEventType.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(
        controller.deleteEventType(eventTypeId, mockUser),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("PATCH /calendar/events/:id/status", () => {
    const eventId = "event-123";
    const statusDto: UpdateEventStatusDto = {
      status: CalendarEventStatus.APPROVED,
    };

    it("should update event status", async () => {
      const expectedResponse: CalendarEventResponseDto = {
        id: eventId,
        restaurantId: mockUser.restaurantId,
        title: "Test Event",
        eventType: CalendarEventType.DELIVERY,
        eventDate: "2024-02-15",
        allDay: true,
        source: CalendarEventSource.MANUAL,
        status: CalendarEventStatus.APPROVED,
        reminderEnabled: true,
        reminderDaysBefore: 1,
        isRecurring: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockCalendarService.updateEventStatus.mockResolvedValue(expectedResponse);

      const result = await controller.updateEventStatus(
        eventId,
        statusDto,
        mockUser,
      );

      expect(result).toEqual(expectedResponse);
      expect(result.status).toBe(CalendarEventStatus.APPROVED);
      expect(mockCalendarService.updateEventStatus).toHaveBeenCalledWith(
        mockUser.restaurantId,
        mockUser.userId,
        eventId,
        statusDto.status,
      );
    });

    it("should throw NotFoundException when event not found", async () => {
      mockCalendarService.updateEventStatus.mockRejectedValue(
        new NotFoundException("Event not found"),
      );

      await expect(
        controller.updateEventStatus(eventId, statusDto, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("GET /calendar/events/:id/recurring", () => {
    const eventId = "event-123";

    it("should return recurring instances", async () => {
      const expectedResponse: CalendarEventResponseDto[] = [
        {
          id: "instance-1",
          restaurantId: mockUser.restaurantId,
          title: "Recurring Event",
          eventType: CalendarEventType.DELIVERY,
          eventDate: "2024-02-15",
          allDay: true,
          source: CalendarEventSource.MANUAL,
          status: CalendarEventStatus.PENDING,
          reminderEnabled: true,
          reminderDaysBefore: 1,
          isRecurring: true,
          parentEventId: eventId,
          occurrenceDate: "2024-02-15",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "instance-2",
          restaurantId: mockUser.restaurantId,
          title: "Recurring Event",
          eventType: CalendarEventType.DELIVERY,
          eventDate: "2024-02-22",
          allDay: true,
          source: CalendarEventSource.MANUAL,
          status: CalendarEventStatus.PENDING,
          reminderEnabled: true,
          reminderDaysBefore: 1,
          isRecurring: true,
          parentEventId: eventId,
          occurrenceDate: "2024-02-22",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockCalendarService.getRecurringInstances.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getRecurringInstances(
        eventId,
        undefined,
        undefined,
        mockUser,
      );

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("parentEventId");
      expect(result[0].parentEventId).toBe(eventId);
      expect(mockCalendarService.getRecurringInstances).toHaveBeenCalledWith(
        mockUser.restaurantId,
        eventId,
        undefined,
        undefined,
      );
    });

    it("should filter by date range", async () => {
      const startDate = "2024-02-01";
      const endDate = "2024-02-28";

      mockCalendarService.getRecurringInstances.mockResolvedValue([]);

      await controller.getRecurringInstances(
        eventId,
        startDate,
        endDate,
        mockUser,
      );

      expect(mockCalendarService.getRecurringInstances).toHaveBeenCalledWith(
        mockUser.restaurantId,
        eventId,
        startDate,
        endDate,
      );
    });
  });

  describe("DELETE /calendar/events/:id/recurring", () => {
    const eventId = "event-123";

    it("should delete recurring series", async () => {
      mockCalendarService.deleteRecurringSeries.mockResolvedValue({
        success: true,
        deletedCount: 5,
      });

      const result = await controller.deleteRecurringSeries(
        eventId,
        undefined,
        mockUser,
      );

      expect(result).toEqual({ success: true, deletedCount: 5 });
      expect(mockCalendarService.deleteRecurringSeries).toHaveBeenCalledWith(
        mockUser.restaurantId,
        mockUser.userId,
        eventId,
        undefined,
      );
    });

    it("should delete from specific date", async () => {
      const fromDate = "2024-03-01";

      mockCalendarService.deleteRecurringSeries.mockResolvedValue({
        success: true,
        deletedCount: 3,
      });

      const result = await controller.deleteRecurringSeries(
        eventId,
        fromDate,
        mockUser,
      );

      expect(result).toEqual({ success: true, deletedCount: 3 });
      expect(mockCalendarService.deleteRecurringSeries).toHaveBeenCalledWith(
        mockUser.restaurantId,
        mockUser.userId,
        eventId,
        fromDate,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockCalendarService.deleteRecurringSeries.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(
        controller.deleteRecurringSeries(eventId, undefined, mockUser),
      ).rejects.toThrow(HttpException);
    });
  });
});
