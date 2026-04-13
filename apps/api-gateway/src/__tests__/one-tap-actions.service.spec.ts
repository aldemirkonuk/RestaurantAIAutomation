import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OneTapActionsService } from '../one-tap-actions/one-tap-actions.service';
import { DatabaseService } from '../database/database.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import {
  OneTapActionType,
  OneTapActionStatus,
  OneTapPriority,
} from '../one-tap-actions/dto/one-tap-action.dto';

describe('OneTapActionsService', () => {
  let service: OneTapActionsService;
  let databaseService: DatabaseService;
  let websocketGateway: WebsocketGateway;

  const mockSupabaseClient = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn(),
  };

  const mockDatabaseService = {
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  const mockWebsocketGateway = {
    server: {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OneTapActionsService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
        {
          provide: WebsocketGateway,
          useValue: mockWebsocketGateway,
        },
      ],
    }).compile();

    service = module.get<OneTapActionsService>(OneTapActionsService);
    databaseService = module.get<DatabaseService>(DatabaseService);
    websocketGateway = module.get<WebsocketGateway>(WebsocketGateway);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActions', () => {
    const restaurantId = 'test-restaurant-id';

    it('should return actions list', async () => {
      const mockActions = [
        {
          id: '1',
          restaurant_id: restaurantId,
          title: 'Test Action',
          status: 'pending',
          action_type: 'custom',
          priority: 'medium',
          color: 'wine',
          icon: 'Zap',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockSupabaseClient.select.mockReturnThis();
      mockSupabaseClient.eq.mockReturnThis();
      mockSupabaseClient.is.mockReturnThis();
      mockSupabaseClient.order.mockResolvedValue({ data: mockActions, error: null });

      const result = await service.getActions(restaurantId);

      expect(result.actions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.pending).toBe(1);
    });

    it('should filter by status when provided', async () => {
      mockSupabaseClient.order.mockResolvedValue({ data: [], error: null });

      await service.getActions(restaurantId, OneTapActionStatus.COMPLETED);

      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('status', 'completed');
    });
  });

  describe('createAction', () => {
    const restaurantId = 'test-restaurant-id';
    const userId = 'test-user-id';

    it('should create a new action', async () => {
      const createDto = {
        title: 'Test Action',
        description: 'Test description',
        actionType: OneTapActionType.CUSTOM,
        priority: OneTapPriority.HIGH,
      };

      const mockCreatedAction = {
        id: 'new-action-id',
        restaurant_id: restaurantId,
        user_id: userId,
        title: createDto.title,
        description: createDto.description,
        action_type: createDto.actionType,
        priority: createDto.priority,
        status: 'pending',
        color: 'wine',
        icon: 'Zap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedAction,
        error: null,
      });

      const result = await service.createAction(restaurantId, userId, createDto);

      expect(result.id).toBe('new-action-id');
      expect(result.title).toBe(createDto.title);
      expect(result.status).toBe(OneTapActionStatus.PENDING);
    });

    it('should broadcast action created event', async () => {
      const createDto = {
        title: 'Test Action',
      };

      const mockCreatedAction = {
        id: 'new-action-id',
        restaurant_id: restaurantId,
        user_id: userId,
        title: createDto.title,
        action_type: 'custom',
        priority: 'medium',
        status: 'pending',
        color: 'wine',
        icon: 'Zap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedAction,
        error: null,
      });

      await service.createAction(restaurantId, userId, createDto);

      expect(mockWebsocketGateway.server.to).toHaveBeenCalledWith(
        `restaurant:${restaurantId}`,
      );
    });
  });

  describe('getAction', () => {
    it('should return action when found', async () => {
      const actionId = 'test-action-id';
      const mockAction = {
        id: actionId,
        restaurant_id: 'test-restaurant',
        title: 'Test Action',
        action_type: 'custom',
        priority: 'medium',
        status: 'pending',
        color: 'wine',
        icon: 'Zap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockAction,
        error: null,
      });

      const result = await service.getAction(actionId);

      expect(result.id).toBe(actionId);
    });

    it('should throw NotFoundException when action not found', async () => {
      const actionId = 'non-existent-id';

      mockSupabaseClient.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(service.getAction(actionId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('executeAction', () => {
    it('should mark action as completed', async () => {
      const actionId = 'test-action-id';
      const userId = 'test-user-id';
      const restaurantId = 'test-restaurant';

      // Mock getAction
      const mockExistingAction = {
        id: actionId,
        restaurant_id: restaurantId,
        title: 'Test Action',
        action_type: 'custom',
        priority: 'medium',
        status: 'pending',
        color: 'wine',
        icon: 'Zap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockUpdatedAction = {
        ...mockExistingAction,
        status: 'completed',
        executed_at: new Date().toISOString(),
        executed_by: userId,
      };

      // First call for getAction
      mockSupabaseClient.single
        .mockResolvedValueOnce({ data: mockExistingAction, error: null })
        // Second call for update
        .mockResolvedValueOnce({ data: mockUpdatedAction, error: null });

      const result = await service.executeAction(actionId, userId, {});

      expect(result.status).toBe(OneTapActionStatus.COMPLETED);
    });
  });

  describe('createSystemAction', () => {
    it('should create system-generated action with correct defaults', async () => {
      const restaurantId = 'test-restaurant';
      const actionType = OneTapActionType.LOW_STOCK;
      const title = 'Low Stock Alert';
      const description = 'Wine X is running low';

      const mockCreatedAction = {
        id: 'system-action-id',
        restaurant_id: restaurantId,
        title,
        description,
        action_type: actionType,
        priority: 'medium',
        status: 'pending',
        color: 'rose', // Default for LOW_STOCK
        icon: 'AlertTriangle', // Default for LOW_STOCK
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabaseClient.single.mockResolvedValue({
        data: mockCreatedAction,
        error: null,
      });

      const result = await service.createSystemAction(
        restaurantId,
        actionType,
        title,
        description,
      );

      expect(result.actionType).toBe(actionType);
      expect(result.title).toBe(title);
    });
  });
});
