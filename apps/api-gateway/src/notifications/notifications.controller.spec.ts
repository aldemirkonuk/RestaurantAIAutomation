import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  NotificationType,
  NotificationStatus,
  GetNotificationsQueryDto,
  GetUnreadQueryDto,
  GetUnreadCountQueryDto,
  GetPreferencesQueryDto,
  BulkIdsDto,
  UpdatePreferencesDto,
} from './dto/notifications.dto';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let notificationsService: NotificationsService;

  const mockNotificationsService = {
    getNotifications: jest.fn(),
    getUnreadNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    getNotificationHistory: jest.fn(),
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    markAsRead: jest.fn(),
    markBulkAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    archiveNotification: jest.fn(),
    deleteNotification: jest.fn(),
    deleteBulk: jest.fn(),
    deleteAllRead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    notificationsService = module.get<NotificationsService>(NotificationsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /notifications', () => {
    const mockQuery: GetNotificationsQueryDto = {
      userId: 'user-123',
      restaurantId: 'restaurant-456',
      page: 1,
      limit: 20,
    };

    it('should return paginated notifications list', async () => {
      const expectedResponse = {
        notifications: [
          {
            id: 'notif-1',
            userId: mockQuery.userId,
            restaurantId: mockQuery.restaurantId,
            type: NotificationType.INVENTORY_LOW_STOCK,
            status: NotificationStatus.UNREAD,
            title: 'Low Stock Alert',
            body: 'Wine X is running low',
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
      };

      mockNotificationsService.getNotifications.mockResolvedValue(expectedResponse);

      const result = await controller.getNotifications(mockQuery);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
        type: undefined,
        status: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        page: mockQuery.page,
        limit: mockQuery.limit,
      });
    });

    it('should filter by type and status', async () => {
      const queryWithFilters = {
        ...mockQuery,
        type: NotificationType.ORDER_PENDING,
        status: NotificationStatus.UNREAD,
      };

      mockNotificationsService.getNotifications.mockResolvedValue({
        notifications: [],
        total: 0,
        page: 1,
        limit: 20,
        hasMore: false,
      });

      await controller.getNotifications(queryWithFilters);

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.ORDER_PENDING,
          status: NotificationStatus.UNREAD,
        }),
      );
    });

    it('should throw INTERNAL_SERVER_ERROR on service failure', async () => {
      mockNotificationsService.getNotifications.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(controller.getNotifications(mockQuery)).rejects.toThrow(
        new HttpException('Database error', HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe('GET /notifications/unread', () => {
    const mockQuery: GetUnreadQueryDto = {
      userId: 'user-123',
      restaurantId: 'restaurant-456',
      limit: 50,
    };

    it('should return unread notifications', async () => {
      const expectedResponse = [
        {
          id: 'notif-1',
          userId: mockQuery.userId,
          type: NotificationType.INVENTORY_LOW_STOCK,
          status: NotificationStatus.UNREAD,
          title: 'Low Stock',
          body: 'Wine X is low',
          createdAt: new Date().toISOString(),
        },
      ];

      mockNotificationsService.getUnreadNotifications.mockResolvedValue(expectedResponse);

      const result = await controller.getUnreadNotifications(mockQuery);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.getUnreadNotifications).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
        limit: mockQuery.limit,
      });
    });

    it('should throw INTERNAL_SERVER_ERROR on service failure', async () => {
      mockNotificationsService.getUnreadNotifications.mockRejectedValue(
        new Error('Service error'),
      );

      await expect(controller.getUnreadNotifications(mockQuery)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('GET /notifications/unread/count', () => {
    const mockQuery: GetUnreadCountQueryDto = {
      userId: 'user-123',
      restaurantId: 'restaurant-456',
    };

    it('should return unread count', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(5);

      const result = await controller.getUnreadCount(mockQuery);

      expect(result).toEqual({ count: 5 });
      expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
      });
    });

    it('should return zero when no unread notifications', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(0);

      const result = await controller.getUnreadCount(mockQuery);

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    const notificationId = 'notif-123';

    it('should mark notification as read', async () => {
      const expectedResponse = {
        id: notificationId,
        userId: 'user-123',
        status: NotificationStatus.READ,
        readAt: new Date().toISOString(),
      };

      mockNotificationsService.markAsRead.mockResolvedValue(expectedResponse);

      const result = await controller.markAsRead(notificationId);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(notificationId);
    });

    it('should throw INTERNAL_SERVER_ERROR on service failure', async () => {
      mockNotificationsService.markAsRead.mockRejectedValue(new Error('Not found'));

      await expect(controller.markAsRead(notificationId)).rejects.toThrow(HttpException);
    });
  });

  describe('PATCH /notifications/read/bulk', () => {
    const bulkDto: BulkIdsDto = {
      ids: ['notif-1', 'notif-2', 'notif-3'],
    };

    it('should mark multiple notifications as read', async () => {
      mockNotificationsService.markBulkAsRead.mockResolvedValue(3);

      const result = await controller.markBulkAsRead(bulkDto);

      expect(result).toEqual({ success: true, count: 3 });
      expect(mockNotificationsService.markBulkAsRead).toHaveBeenCalledWith(bulkDto.ids);
    });

    it('should return zero count when no notifications updated', async () => {
      mockNotificationsService.markBulkAsRead.mockResolvedValue(0);

      const result = await controller.markBulkAsRead(bulkDto);

      expect(result).toEqual({ success: true, count: 0 });
    });
  });

  describe('PATCH /notifications/read/all', () => {
    const mockQuery = {
      userId: 'user-123',
      restaurantId: 'restaurant-456',
    };

    it('should mark all notifications as read', async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue(10);

      const result = await controller.markAllAsRead(mockQuery);

      expect(result).toEqual({ success: true, count: 10 });
      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
      });
    });
  });

  describe('PATCH /notifications/:id/archive', () => {
    const notificationId = 'notif-123';

    it('should archive notification', async () => {
      const expectedResponse = {
        id: notificationId,
        status: NotificationStatus.ARCHIVED,
        archivedAt: new Date().toISOString(),
      };

      mockNotificationsService.archiveNotification.mockResolvedValue(expectedResponse);

      const result = await controller.archiveNotification(notificationId);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.archiveNotification).toHaveBeenCalledWith(notificationId);
    });
  });

  describe('DELETE /notifications/:id', () => {
    const notificationId = 'notif-123';

    it('should delete notification', async () => {
      mockNotificationsService.deleteNotification.mockResolvedValue(undefined);

      const result = await controller.deleteNotification(notificationId);

      expect(result).toEqual({ success: true });
      expect(mockNotificationsService.deleteNotification).toHaveBeenCalledWith(notificationId);
    });

    it('should throw INTERNAL_SERVER_ERROR on service failure', async () => {
      mockNotificationsService.deleteNotification.mockRejectedValue(new Error('Not found'));

      await expect(controller.deleteNotification(notificationId)).rejects.toThrow(HttpException);
    });
  });

  describe('DELETE /notifications/bulk', () => {
    const bulkDto: BulkIdsDto = {
      ids: ['notif-1', 'notif-2'],
    };

    it('should delete multiple notifications', async () => {
      mockNotificationsService.deleteBulk.mockResolvedValue(2);

      const result = await controller.deleteBulk(bulkDto);

      expect(result).toEqual({ success: true, count: 2 });
      expect(mockNotificationsService.deleteBulk).toHaveBeenCalledWith(bulkDto.ids);
    });
  });

  describe('GET /notifications/preferences', () => {
    const mockQuery: GetPreferencesQueryDto = {
      userId: 'user-123',
    };

    it('should return user preferences', async () => {
      const expectedResponse = {
        userId: mockQuery.userId,
        email: true,
        push: true,
        sms: false,
        categories: {
          inventory: true,
          orders: true,
          calendar: false,
        },
        quietHours: {
          enabled: true,
          startTime: '22:00',
          endTime: '08:00',
        },
      };

      mockNotificationsService.getPreferences.mockResolvedValue(expectedResponse);

      const result = await controller.getPreferences(mockQuery);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.getPreferences).toHaveBeenCalledWith(mockQuery.userId);
    });
  });

  describe('PATCH /notifications/preferences', () => {
    const mockQuery: GetPreferencesQueryDto = {
      userId: 'user-123',
    };

    const updateDto: UpdatePreferencesDto = {
      userId: 'user-123',
      email: false,
      push: true,
      categories: {
        inventory: true,
        orders: false,
      },
    };

    it('should update user preferences', async () => {
      const expectedResponse = {
        userId: mockQuery.userId,
        ...updateDto,
        updatedAt: new Date().toISOString(),
      };

      mockNotificationsService.updatePreferences.mockResolvedValue(expectedResponse);

      const result = await controller.updatePreferences(mockQuery, updateDto);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.updatePreferences).toHaveBeenCalledWith({
        userId: updateDto.userId,
        email: updateDto.email,
        push: updateDto.push,
        sms: updateDto.sms,
        categories: updateDto.categories as Record<string, boolean>,
        quietHours: updateDto.quietHours,
      });
    });

    it('should use userId from query if not in body', async () => {
      const updateDtoWithoutUserId = {
        email: true,
      } as UpdatePreferencesDto;

      mockNotificationsService.updatePreferences.mockResolvedValue({});

      await controller.updatePreferences(mockQuery, updateDtoWithoutUserId);

      expect(mockNotificationsService.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockQuery.userId,
        }),
      );
    });
  });
});
