import { Test, TestingModule } from '@nestjs/testing';
import { ProcurementService } from './procurement.service';
import { DatabaseService } from '../database/database.service';
import { EventsService } from '../events/events.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { OrchestratorService } from '../common/orchestrator/orchestrator.service';

/**
 * Regression tests for Bug 2: AI draft trigger fallback behavior.
 *
 * createOrder must:
 *  (a) fall back to triggerDraftHttp when publishEvent (RabbitMQ) throws
 *  (b) not throw an unhandled error when AGENT_ORCHESTRATOR_URL is unconfigured
 *  (c) log a clear error message when both paths fail so it is visible in Railway logs
 */
describe('ProcurementService — draft trigger fallback (regression: Bug 2)', () => {
  let service: ProcurementService;
  let orchestratorService: jest.Mocked<OrchestratorService>;
  let loggerErrorSpy: jest.SpyInstance;

  const mockSingle = jest.fn();
  const mockChain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: mockSingle,
  };

  // Minimal order row returned by the INSERT
  const insertedOrderRow = {
    id: 'order-uuid-1',
    order_number: 'ORD-001',
    restaurant_id: 'rest-1',
    inventory_id: 'inv-1',
    provider_id: 'prov-1',
    quantity: 6,
    unit_type: 'bottles',
    bottles_total: 6,
    quoted_price: 25.0,
    negotiated_price: null,
    final_price: 25.0,
    total_cost: 150.0,
    status: 'PENDING',
    requested_at: new Date().toISOString(),
    is_emergency: false,
    priority_level: 5,
    manager_notes: null,
    expected_delivery_date: null,
    inventory: { wine_name: 'Malbec Reserve' },
    wine_name: 'Malbec Reserve',
  };

  const createOrderDto = {
    inventoryId: 'inv-1',
    providerId: 'prov-1',
    quantity: 6,
    quotedPrice: 25.0,
  };

  const mockDatabaseService = {
    supabase: {
      ...mockChain,
      // provider count check returns 1
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: mockSingle,
    },
    getClient: jest.fn(() => mockChain),
  };

  const mockEventsService = {
    createEvent: jest.fn().mockResolvedValue({}),
  };

  const mockInventoryLedgerService = {
    recordTransaction: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Rebuild the chain mock after clearAllMocks
    Object.assign(mockDatabaseService.supabase, {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      single: mockSingle,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcurementService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: InventoryLedgerService, useValue: mockInventoryLedgerService },
        {
          provide: OrchestratorService,
          useValue: {
            publishEvent: jest.fn(),
            triggerDraftHttp: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProcurementService>(ProcurementService);
    orchestratorService = module.get(OrchestratorService);

    // Spy on the service logger to verify error messages
    loggerErrorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

    // Default DB call sequence:
    // 1. provider count check → 1 provider
    // 2. INSERT procurement_order → insertedOrderRow
    // 3. provider name lookup (non-critical)
    mockSingle
      .mockResolvedValueOnce({ count: 1, error: null })           // provider count
      .mockResolvedValueOnce({ data: insertedOrderRow, error: null }) // order INSERT
      .mockResolvedValueOnce({ data: { name: 'Test Provider' }, error: null }); // provider name

    // Also wire the mock supabase .from chain for count queries that use head:true
    mockDatabaseService.supabase.select.mockReturnThis();
    Object.defineProperty(mockDatabaseService.supabase, 'count', {
      value: 1,
      writable: true,
      configurable: true,
    });
  });

  it('calls triggerDraftHttp when publishEvent (RabbitMQ) throws', async () => {
    (orchestratorService.publishEvent as jest.Mock).mockRejectedValue(
      new Error('AMQP connection refused'),
    );
    (orchestratorService.triggerDraftHttp as jest.Mock).mockResolvedValue(undefined);

    // createOrder should still resolve (not throw)
    await expect(
      service.createOrder('rest-1', 'user-1', createOrderDto as any),
    ).resolves.toBeDefined();

    expect(orchestratorService.publishEvent).toHaveBeenCalledTimes(1);
    expect(orchestratorService.triggerDraftHttp).toHaveBeenCalledTimes(1);
    // HTTP fallback must be called with a payload that contains the order ID
    const httpPayload = (orchestratorService.triggerDraftHttp as jest.Mock).mock.calls[0][0];
    expect(httpPayload).toMatchObject({ order_id: insertedOrderRow.id });
  });

  it('does not throw when both publishEvent and triggerDraftHttp fail', async () => {
    (orchestratorService.publishEvent as jest.Mock).mockRejectedValue(
      new Error('AMQP unreachable'),
    );
    (orchestratorService.triggerDraftHttp as jest.Mock).mockRejectedValue(
      new Error('AGENT_ORCHESTRATOR_URL not configured — HTTP draft trigger skipped'),
    );

    // createOrder MUST resolve — a failing orchestrator must never bubble up to the caller
    await expect(
      service.createOrder('rest-1', 'user-1', createOrderDto as any),
    ).resolves.toBeDefined();
  });

  it('logs an error message containing the order ID when both paths fail', async () => {
    (orchestratorService.publishEvent as jest.Mock).mockRejectedValue(new Error('MQ down'));
    (orchestratorService.triggerDraftHttp as jest.Mock).mockRejectedValue(new Error('HTTP 503'));

    await service.createOrder('rest-1', 'user-1', createOrderDto as any);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(insertedOrderRow.id),
    );
  });
});
