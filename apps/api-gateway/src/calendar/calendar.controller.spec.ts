import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { WeatherService } from "../weather/weather.service";
import { DayRecordService } from "./day-record.service";
import { CalendarDayNotesService } from "./calendar-day-notes.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { CalendarLinksService } from "./calendar-links.service";
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
    endSeriesFrom: jest.fn(),
    listEvents: jest.fn(),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
    getEvent: jest.fn(),
    getRecurrenceRule: jest.fn(),
  };

  // The house's today (F-086): the controller's default day comes from here.
  const mockDayRecord = {
    windowFor: jest.fn(),
    houseToday: jest.fn(),
  };
  const mockWeather = { windowFor: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        {
          provide: CalendarService,
          useValue: mockCalendarService,
        },
        {
          // The reminder job is a constructor dependency of the controller now
          // (GET /calendar/reminders/status). Its own behaviour is specified in
          // calendar-reminders.service.spec.ts; here it only has to resolve.
          provide: CalendarRemindersService,
          useValue: { statusFor: jest.fn() },
        },
        {
          // The weather overlay is a constructor dependency of the controller
          // now (GET /calendar/weather). Its behaviour is specified in
          // weather/weather.service.spec.ts; here it only has to resolve.
          provide: WeatherService,
          useValue: mockWeather,
        },
        {
          // Slice 3's reconciliation (GET /calendar/day-record). Specified in
          // calendar/day-record.spec.ts; here it only has to resolve.
          provide: DayRecordService,
          useValue: mockDayRecord,
        },
        {
          // Day notes (POST/GET /calendar/day-notes), built 2026-09-21.
          // Specified in calendar-day-notes.service.spec.ts; here it only
          // has to resolve.
          provide: CalendarDayNotesService,
          useValue: { create: jest.fn(), listForDay: jest.fn() },
        },
        {
          // Personal calendar links (ADR 0111, 2026-09-21). Specified in
          // calendar-links.service.spec.ts and calendar-links.gate.spec.ts;
          // here it only has to resolve, since none of this file's cases
          // exercise those routes.
          provide: CalendarLinksService,
          useValue: {},
        },
        {
          // The owner/manager gate on someone else's link. Who may pass it is
          // `calendar-links.gate.spec.ts`'s job.
          provide: OrganizationsService,
          useValue: {
            assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
          },
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
      );
    });

    it("ends the series from a date rather than deleting only stored dates (F-607)", async () => {
      const fromDate = "2024-03-01";

      mockCalendarService.endSeriesFrom.mockResolvedValue({
        success: true,
        deletedCount: 3,
      });

      const result = await controller.deleteRecurringSeries(
        eventId,
        fromDate,
        mockUser,
      );

      expect(result).toEqual({ success: true, deletedCount: 3 });
      expect(mockCalendarService.endSeriesFrom).toHaveBeenCalledWith(
        mockUser.restaurantId,
        mockUser.userId,
        eventId,
        fromDate,
      );
      expect(mockCalendarService.deleteRecurringSeries).not.toHaveBeenCalled();
    });

    it("passes a refusal through as itself, not as a server error", async () => {
      mockCalendarService.endSeriesFrom.mockRejectedValue(
        new BadRequestException("Delete the series instead."),
      );

      await expect(
        controller.deleteRecurringSeries(eventId, "2024-03-01", mockUser),
      ).rejects.toBeInstanceOf(BadRequestException);
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

  describe("the default day is the house's, not UTC's (F-086)", () => {
    const user = { userId: "user-123", restaurantId: "restaurant-456" };

    beforeEach(() => {
      // A day that is not the UTC date whenever the suite runs, so only the
      // house's answer can produce it.
      mockDayRecord.houseToday.mockResolvedValue("2001-01-15");
    });

    it("GET /calendar/today lists the house's today", async () => {
      await controller.getTodayEvents(user);
      expect(mockDayRecord.houseToday).toHaveBeenCalledWith("restaurant-456");
      expect(mockCalendarService.listEvents).toHaveBeenCalledWith(
        "restaurant-456",
        expect.objectContaining({
          startDate: "2001-01-15",
          endDate: "2001-01-15",
        }),
      );
    });

    it("GET /calendar/upcoming runs thirty house days from the house's today", async () => {
      await controller.getUpcomingEvents(user);
      expect(mockCalendarService.listEvents).toHaveBeenCalledWith(
        "restaurant-456",
        expect.objectContaining({
          startDate: "2001-01-15",
          endDate: "2001-02-14",
        }),
      );
    });

    it("GET /calendar/weather and /day-record default to the house's today", async () => {
      await controller.getWeather({} as any, user);
      expect(mockWeather.windowFor).toHaveBeenCalledWith(
        "restaurant-456",
        "2001-01-15",
        "2001-01-15",
      );
      await controller.getDayRecord({} as any, { ...user, role: "owner" });
      expect(mockDayRecord.windowFor).toHaveBeenCalledWith(
        "restaurant-456",
        "2001-01-15",
        "2001-01-15",
        { seesHouseMoney: true },
      );
    });

    it("a day the page names is used as given, with no zone read", async () => {
      await controller.getWeather({ from: "2026-10-01" } as any, user);
      expect(mockWeather.windowFor).toHaveBeenCalledWith(
        "restaurant-456",
        "2026-10-01",
        "2026-10-01",
      );
      expect(mockDayRecord.houseToday).not.toHaveBeenCalled();
    });
  });

  describe("entry writes pass a worded refusal through (F-1112)", () => {
    const refusal = () =>
      new BadRequestException("The end comes before the start.");
    const dto = {} as never;

    it("create answers a 400 as a 400, not a 500", async () => {
      mockCalendarService.createEvent.mockRejectedValue(refusal());
      const err = await controller
        .createEvent(dto, mockUser)
        .catch((e: HttpException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it("create keeps the rollback's own words", async () => {
      const rollback = new InternalServerErrorException(
        "The repeat could not be saved, so nothing was saved. Try again.",
      );
      mockCalendarService.createEvent.mockRejectedValue(rollback);
      await expect(controller.createEvent(dto, mockUser)).rejects.toBe(
        rollback,
      );
    });

    it("edit answers a 400 as a 400", async () => {
      mockCalendarService.updateEvent.mockRejectedValue(refusal());
      await expect(
        controller.updateEvent("e1", dto, mockUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("delete answers a 400 as a 400", async () => {
      mockCalendarService.deleteEvent.mockRejectedValue(refusal());
      await expect(
        controller.deleteEvent("e1", undefined, mockUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("an unexpected failure is still a 500", async () => {
      mockCalendarService.updateEvent.mockRejectedValue(new Error("boom"));
      const err = await controller
        .updateEvent("e1", dto, mockUser)
        .catch((e: HttpException) => e);
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });
  });

  describe("the other handlers pass a worded refusal through (F-1147)", () => {
    const refusal = () => new BadRequestException("That is not a date.");

    it("reading an entry answers a 400 as a 400", async () => {
      mockCalendarService.getEvent.mockRejectedValue(refusal());
      await expect(controller.getEvent("e1", mockUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("reading a repeat answers a 400 as a 400", async () => {
      mockCalendarService.getRecurrenceRule.mockRejectedValue(refusal());
      await expect(
        controller.getRecurrenceRule("r1", mockUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("editing a type answers a 409 as a 409", async () => {
      const taken = new HttpException(
        "That name is taken.",
        HttpStatus.CONFLICT,
      );
      mockCalendarService.updateEventType.mockRejectedValue(taken);
      await expect(
        controller.updateEventType("t1", {} as never, mockUser),
      ).rejects.toBe(taken);
    });

    it("a status change answers a 400 as a 400", async () => {
      mockCalendarService.updateEventStatus.mockRejectedValue(refusal());
      await expect(
        controller.updateEventStatus(
          "e1",
          { status: "done" } as never,
          mockUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("an unexpected failure is still a 500", async () => {
      mockCalendarService.updateEventStatus.mockRejectedValue(
        new Error("boom"),
      );
      const err = await controller
        .updateEventStatus("e1", { status: "done" } as never, mockUser)
        .catch((e: HttpException) => e);
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });
  });
});
