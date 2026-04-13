import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events/events.service';
import { DatabaseService } from '../database/database.service';
import { EventType, SourcePage } from '../events/dto/event.dto';

describe('EventsService', () => {
  let service: EventsService;
  let databaseService: DatabaseService;

  // Mock Supabase client
  const mockSupabaseClient = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(),
  };

  const mockDatabaseService = {
    supabase: mockSupabaseClient,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    databaseService = module.get<DatabaseService>(DatabaseService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createEvent', () => {
    const restaurantId = 'test-restaurant-id';
    const userId = 'test-user-id';
    const baseDto = {
      eventType: EventType.INVENTORY_CHANGE,
      sourcePage: SourcePage.INVENTORY,
      payload: { wineId: 'wine-123', quantity: 10, changeType: 'add' },
    };

    it('should create a new event successfully', async () => {
      const mockCreatedEvent = {
        id: 'event-123',
        restaurant_id: restaurantId,
        user_id: userId,
        event_type: baseDto.eventType,
        source_page: baseDto.sourcePage,
        payload: baseDto.payload,
        schema_version: 1,
        idempotency_key: null,
        trace_id: null,
        correlation_id: null,
        created_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedEvent,
        error: null,
      });

      const result = await service.createEvent(restaurantId, userId, baseDto);

      expect(result.id).toBe('event-123');
      expect(result.eventType).toBe(EventType.INVENTORY_CHANGE);
      expect(result.sourcePage).toBe(SourcePage.INVENTORY);
      expect(result.deduped).toBe(false);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('events');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurant_id: restaurantId,
          user_id: userId,
          event_type: baseDto.eventType,
          source_page: baseDto.sourcePage,
        }),
      );
    });

    it('should include idempotency key when provided', async () => {
      const dtoWithIdempotency = {
        ...baseDto,
        idempotencyKey: 'unique-key-123',
      };

      const mockCreatedEvent = {
        id: 'event-123',
        restaurant_id: restaurantId,
        user_id: userId,
        event_type: dtoWithIdempotency.eventType,
        source_page: dtoWithIdempotency.sourcePage,
        payload: dtoWithIdempotency.payload,
        schema_version: 1,
        idempotency_key: dtoWithIdempotency.idempotencyKey,
        trace_id: null,
        correlation_id: null,
        created_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedEvent,
        error: null,
      });

      const result = await service.createEvent(restaurantId, userId, dtoWithIdempotency);

      expect(result.idempotencyKey).toBe('unique-key-123');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: 'unique-key-123',
        }),
      );
    });

    it('should handle duplicate events (idempotency)', async () => {
      const dtoWithIdempotency = {
        ...baseDto,
        idempotencyKey: 'duplicate-key',
      };

      const existingEvent = {
        id: 'existing-event-id',
        restaurant_id: restaurantId,
        user_id: userId,
        event_type: dtoWithIdempotency.eventType,
        source_page: dtoWithIdempotency.sourcePage,
        payload: dtoWithIdempotency.payload,
        schema_version: 1,
        idempotency_key: 'duplicate-key',
        trace_id: null,
        correlation_id: null,
        created_at: new Date().toISOString(),
      };

      // First call: insert fails with duplicate
      mockSupabaseClient.single
        .mockResolvedValueOnce({
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        })
        // Second call: find existing event
        .mockResolvedValueOnce({
          data: existingEvent,
          error: null,
        });

      const result = await service.createEvent(restaurantId, userId, dtoWithIdempotency);

      expect(result.id).toBe('existing-event-id');
      expect(result.deduped).toBe(true);
    });

    it('should include trace_id and correlation_id when provided', async () => {
      const dtoWithTracing = {
        ...baseDto,
        traceId: 'trace-abc-123',
        correlationId: 'correlation-xyz-789',
      };

      const mockCreatedEvent = {
        id: 'event-123',
        restaurant_id: restaurantId,
        user_id: userId,
        event_type: dtoWithTracing.eventType,
        source_page: dtoWithTracing.sourcePage,
        payload: dtoWithTracing.payload,
        schema_version: 1,
        idempotency_key: null,
        trace_id: 'trace-abc-123',
        correlation_id: 'correlation-xyz-789',
        created_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedEvent,
        error: null,
      });

      const result = await service.createEvent(restaurantId, userId, dtoWithTracing);

      expect(result.traceId).toBe('trace-abc-123');
      expect(result.correlationId).toBe('correlation-xyz-789');
    });

    it('should throw error on database failure', async () => {
      mockSupabaseClient.single.mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'relation "events" does not exist' },
      });

      await expect(
        service.createEvent(restaurantId, userId, baseDto),
      ).rejects.toMatchObject({
        message: expect.stringContaining('does not exist'),
      });
    });
  });

  describe('listEvents', () => {
    const restaurantId = 'test-restaurant-id';

    it('should return paginated events list', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          restaurant_id: restaurantId,
          user_id: 'user-1',
          event_type: 'inventory_change',
          source_page: 'inventory',
          payload: { wineId: 'wine-1' },
          schema_version: 1,
          idempotency_key: null,
          trace_id: null,
          correlation_id: null,
          created_at: '2024-01-15T10:00:00Z',
        },
        {
          id: 'event-2',
          restaurant_id: restaurantId,
          user_id: 'user-1',
          event_type: 'order_change',
          source_page: 'orders',
          payload: { orderId: 'order-1' },
          schema_version: 1,
          idempotency_key: null,
          trace_id: null,
          correlation_id: null,
          created_at: '2024-01-15T09:00:00Z',
        },
      ];

      mockSupabaseClient.range.mockResolvedValue({
        data: mockEvents,
        error: null,
        count: 2,
      });

      const result = await service.listEvents(restaurantId, { page: 1, limit: 10 });

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by eventType', async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listEvents(restaurantId, {
        eventType: EventType.INVENTORY_CHANGE,
      });

      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('event_type', 'inventory_change');
    });

    it('should filter by sourcePage', async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listEvents(restaurantId, {
        sourcePage: SourcePage.DASHBOARD,
      });

      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('source_page', 'dashboard');
    });

    it('should filter by date range (after/before)', async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listEvents(restaurantId, {
        after: '2024-01-01T00:00:00Z',
        before: '2024-01-31T23:59:59Z',
      });

      expect(mockSupabaseClient.gt).toHaveBeenCalledWith('created_at', '2024-01-01T00:00:00Z');
      expect(mockSupabaseClient.lt).toHaveBeenCalledWith('created_at', '2024-01-31T23:59:59Z');
    });

    it('should handle pagination correctly', async () => {
      const mockEvents = Array(50).fill(null).map((_, i) => ({
        id: `event-${i}`,
        restaurant_id: restaurantId,
        user_id: 'user-1',
        event_type: 'inventory_change',
        source_page: 'inventory',
        payload: {},
        schema_version: 1,
        idempotency_key: null,
        trace_id: null,
        correlation_id: null,
        created_at: new Date().toISOString(),
      }));

      mockSupabaseClient.range.mockResolvedValue({
        data: mockEvents.slice(0, 25),
        error: null,
        count: 50,
      });

      const result = await service.listEvents(restaurantId, { page: 1, limit: 25 });

      expect(result.events).toHaveLength(25);
      expect(result.total).toBe(50);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics snapshot', () => {
      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('totalIngested');
      expect(metrics).toHaveProperty('totalDeduped');
      expect(metrics).toHaveProperty('byType');
      expect(metrics).toHaveProperty('bySource');
      expect(metrics).toHaveProperty('errors');
      expect(metrics).toHaveProperty('lastReset');
    });

    it('should increment metrics after event creation', async () => {
      const restaurantId = 'test-restaurant-id';
      const userId = 'test-user-id';

      const mockCreatedEvent = {
        id: 'event-123',
        restaurant_id: restaurantId,
        user_id: userId,
        event_type: 'inventory_change',
        source_page: 'inventory',
        payload: {},
        schema_version: 1,
        idempotency_key: null,
        trace_id: null,
        correlation_id: null,
        created_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedEvent,
        error: null,
      });

      const initialMetrics = service.getMetrics();
      const initialCount = initialMetrics.totalIngested;

      await service.createEvent(restaurantId, userId, {
        eventType: EventType.INVENTORY_CHANGE,
        sourcePage: SourcePage.INVENTORY,
        payload: {},
      });

      const updatedMetrics = service.getMetrics();
      expect(updatedMetrics.totalIngested).toBe(initialCount + 1);
      expect(updatedMetrics.byType['inventory_change']).toBeGreaterThanOrEqual(1);
      expect(updatedMetrics.bySource['inventory']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('event type validation', () => {
    const restaurantId = 'test-restaurant-id';
    const userId = 'test-user-id';

    const allEventTypes = [
      EventType.INVENTORY_CHANGE,
      EventType.ORDER_CHANGE,
      EventType.CALENDAR_EVENT,
      EventType.DASHBOARD_UPDATE,
      EventType.WINE_UPDATE,
      EventType.REPORT_EVENT,
      EventType.NOTIFICATION_SENT,
      EventType.USER_ACTION,
      EventType.SYSTEM_EVENT,
    ];

    allEventTypes.forEach((eventType) => {
      it(`should handle ${eventType} events`, async () => {
        const mockCreatedEvent = {
          id: 'event-123',
          restaurant_id: restaurantId,
          user_id: userId,
          event_type: eventType,
          source_page: 'system',
          payload: {},
          schema_version: 1,
          idempotency_key: null,
          trace_id: null,
          correlation_id: null,
          created_at: new Date().toISOString(),
        };

        mockSupabaseClient.single.mockResolvedValue({
          data: mockCreatedEvent,
          error: null,
        });

        const result = await service.createEvent(restaurantId, userId, {
          eventType,
          sourcePage: SourcePage.SYSTEM,
          payload: {},
        });

        expect(result.eventType).toBe(eventType);
      });
    });
  });

  describe('source page validation', () => {
    const restaurantId = 'test-restaurant-id';
    const userId = 'test-user-id';

    const allSourcePages = [
      SourcePage.DASHBOARD,
      SourcePage.INVENTORY,
      SourcePage.WINE_LIBRARY,
      SourcePage.ORDERS,
      SourcePage.CALENDAR,
      SourcePage.REPORTS,
      SourcePage.COMMUNICATIONS,
      SourcePage.PROVIDERS,
      SourcePage.DOCUMENTS,
      SourcePage.NOTIFICATIONS,
      SourcePage.SETTINGS,
      SourcePage.SYSTEM,
    ];

    allSourcePages.forEach((sourcePage) => {
      it(`should handle events from ${sourcePage}`, async () => {
        const mockCreatedEvent = {
          id: 'event-123',
          restaurant_id: restaurantId,
          user_id: userId,
          event_type: 'system_event',
          source_page: sourcePage,
          payload: {},
          schema_version: 1,
          idempotency_key: null,
          trace_id: null,
          correlation_id: null,
          created_at: new Date().toISOString(),
        };

        mockSupabaseClient.single.mockResolvedValue({
          data: mockCreatedEvent,
          error: null,
        });

        const result = await service.createEvent(restaurantId, userId, {
          eventType: EventType.SYSTEM_EVENT,
          sourcePage,
          payload: {},
        });

        expect(result.sourcePage).toBe(sourcePage);
      });
    });
  });
});
