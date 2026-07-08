import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { EventsController } from "../events/events.controller";
import { EventsService } from "../events/events.service";
import { EventType, SourcePage } from "../events/dto/event.dto";

describe("EventsController", () => {
  let controller: EventsController;
  let eventsService: EventsService;

  const mockEventsService = {
    createEvent: jest.fn(),
    listEvents: jest.fn(),
    getMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    eventsService = module.get<EventsService>(EventsService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("createEvent", () => {
    const mockUser = {
      userId: "user-123",
      restaurantId: "restaurant-456",
    };

    const createEventDto = {
      eventType: EventType.INVENTORY_CHANGE,
      sourcePage: SourcePage.INVENTORY,
      payload: { wineId: "wine-1", quantity: 5 },
    };

    it("should create event successfully", async () => {
      const expectedResponse = {
        id: "event-123",
        restaurantId: mockUser.restaurantId,
        userId: mockUser.userId,
        eventType: createEventDto.eventType,
        sourcePage: createEventDto.sourcePage,
        payload: createEventDto.payload,
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        deduped: false,
      };

      mockEventsService.createEvent.mockResolvedValue(expectedResponse);

      const result = await controller.createEvent(createEventDto, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(mockEventsService.createEvent).toHaveBeenCalledWith(
        mockUser.restaurantId,
        mockUser.userId,
        createEventDto,
      );
    });

    it("should return deduped response for duplicate idempotency key", async () => {
      const dtoWithIdempotency = {
        ...createEventDto,
        idempotencyKey: "unique-key",
      };

      const dedupedResponse = {
        id: "existing-event",
        restaurantId: mockUser.restaurantId,
        userId: mockUser.userId,
        eventType: createEventDto.eventType,
        sourcePage: createEventDto.sourcePage,
        payload: createEventDto.payload,
        schemaVersion: 1,
        idempotencyKey: "unique-key",
        createdAt: new Date().toISOString(),
        deduped: true,
      };

      mockEventsService.createEvent.mockResolvedValue(dedupedResponse);

      const result = await controller.createEvent(dtoWithIdempotency, mockUser);

      expect(result.deduped).toBe(true);
      expect(result.id).toBe("existing-event");
    });

    it("should throw CONFLICT for duplicate key constraint violation", async () => {
      mockEventsService.createEvent.mockRejectedValue({
        code: "23505",
        message: "duplicate key",
      });

      await expect(
        controller.createEvent(createEventDto, mockUser),
      ).rejects.toThrow(
        new HttpException("Duplicate event detected", HttpStatus.CONFLICT),
      );
    });

    it("should throw INTERNAL_SERVER_ERROR for other errors", async () => {
      mockEventsService.createEvent.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        controller.createEvent(createEventDto, mockUser),
      ).rejects.toThrow(
        new HttpException(
          "Database connection failed",
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe("listEvents", () => {
    const mockUser = {
      userId: "user-123",
      restaurantId: "restaurant-456",
    };

    it("should return paginated events list", async () => {
      const query = { page: 1, limit: 10 };
      const expectedResponse = {
        events: [
          {
            id: "event-1",
            restaurantId: mockUser.restaurantId,
            eventType: EventType.INVENTORY_CHANGE,
            sourcePage: SourcePage.INVENTORY,
            payload: {},
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        hasMore: false,
      };

      mockEventsService.listEvents.mockResolvedValue(expectedResponse);

      const result = await controller.listEvents(query, mockUser);

      expect(result).toEqual(expectedResponse);
      expect(mockEventsService.listEvents).toHaveBeenCalledWith(
        mockUser.restaurantId,
        query,
      );
    });

    it("should pass filters to service", async () => {
      const query = {
        eventType: EventType.ORDER_CHANGE,
        sourcePage: SourcePage.ORDERS,
        page: 2,
        limit: 25,
        after: "2024-01-01T00:00:00Z",
        before: "2024-01-31T23:59:59Z",
      };

      mockEventsService.listEvents.mockResolvedValue({
        events: [],
        total: 0,
        page: 2,
        limit: 25,
        hasMore: false,
      });

      await controller.listEvents(query, mockUser);

      expect(mockEventsService.listEvents).toHaveBeenCalledWith(
        mockUser.restaurantId,
        query,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockEventsService.listEvents.mockRejectedValue(
        new Error("Query timeout"),
      );

      await expect(controller.listEvents({}, mockUser)).rejects.toThrow(
        new HttpException("Query timeout", HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe("getMetrics", () => {
    it("should return metrics with status ok", async () => {
      const mockMetrics = {
        totalIngested: 100,
        totalDeduped: 5,
        byType: {
          inventory_change: 40,
          order_change: 30,
          calendar_event: 30,
        },
        bySource: {
          inventory: 40,
          orders: 30,
          calendar: 30,
        },
        errors: 2,
        lastReset: new Date(),
      };

      mockEventsService.getMetrics.mockReturnValue(mockMetrics);

      const result = (await controller.getMetrics()) as any;

      expect(result.status).toBe("ok");
      expect(result.timestamp).toBeDefined();
      expect(result.metrics.totalIngested).toBe(100);
      expect(result.metrics.totalDeduped).toBe(5);
      expect(result.metrics.dedupeRate).toBe("5.00%");
      expect(result.metrics.errors).toBe(2);
    });

    it("should handle zero events gracefully", async () => {
      const mockMetrics = {
        totalIngested: 0,
        totalDeduped: 0,
        byType: {},
        bySource: {},
        errors: 0,
        lastReset: new Date(),
      };

      mockEventsService.getMetrics.mockReturnValue(mockMetrics);

      const result = (await controller.getMetrics()) as any;

      expect(result.metrics.dedupeRate).toBe("0%");
    });
  });
});
