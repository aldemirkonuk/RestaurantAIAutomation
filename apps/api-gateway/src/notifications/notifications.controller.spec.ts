import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import {
  NotificationType,
  NotificationStatus,
  GetNotificationsQueryDto,
  GetUnreadQueryDto,
  GetUnreadCountQueryDto,
  GetPreferencesQueryDto,
  BulkIdsDto,
  UpdatePreferencesDto,
} from "./dto/notifications.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { NotificationProducersService } from "./producers/notification-producers.service";

/**
 * Notification reads are scoped to the restaurant on the VERIFIED token, not to
 * a query parameter (Antalya night). Every read below therefore takes a request
 * — a call without one is a call that could not be scoped, and the controller
 * refuses it rather than returning every tenant's notifications.
 */
// Same tenant these fixtures already used, so these tests keep asserting that
// the value reaches the service. That the TOKEN wins over a contradicting
// query parameter is asserted in notifications-are-tenant-scoped.spec.ts.
const REQ = {
  user: { userId: "user-123", restaurantId: "restaurant-456" },
} as any;

describe("NotificationsController", () => {
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

  // The producers' own account of themselves — `GET /notifications/producers/
  // status`. Stubbed here rather than wired: a unit spec for the handlers should
  // not have to construct the cron graph, and `check_gateway_boots.sh` is what
  // proves the real provider resolves.
  const mockProducersService = {
    statusFor: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
        {
          provide: NotificationProducersService,
          useValue: mockProducersService,
        },
      ],
    })
      // OD-20 guarded this controller at class level. A unit spec should not
      // have to construct the auth graph to test a handler — stub the guard
      // and let the boot guard prove the real one resolves.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
    notificationsService =
      module.get<NotificationsService>(NotificationsService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("GET /notifications", () => {
    const mockQuery: GetNotificationsQueryDto = {
      userId: "user-123",
      restaurantId: "restaurant-456",
      page: 1,
      limit: 20,
    };

    it("should return paginated notifications list", async () => {
      const expectedResponse = {
        notifications: [
          {
            id: "notif-1",
            userId: mockQuery.userId,
            restaurantId: mockQuery.restaurantId,
            type: NotificationType.INVENTORY_LOW_STOCK,
            status: NotificationStatus.UNREAD,
            title: "Low Stock Alert",
            body: "Wine X is running low",
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
      };

      mockNotificationsService.getNotifications.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getNotifications(mockQuery, REQ);

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

    it("should filter by type and status", async () => {
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

      await controller.getNotifications(queryWithFilters, REQ);

      expect(mockNotificationsService.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.ORDER_PENDING,
          status: NotificationStatus.UNREAD,
        }),
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockNotificationsService.getNotifications.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(controller.getNotifications(mockQuery, REQ)).rejects.toThrow(
        new HttpException("Database error", HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe("GET /notifications/unread", () => {
    const mockQuery: GetUnreadQueryDto = {
      userId: "user-123",
      restaurantId: "restaurant-456",
      limit: 50,
    };

    it("should return unread notifications", async () => {
      const expectedResponse = [
        {
          id: "notif-1",
          userId: mockQuery.userId,
          type: NotificationType.INVENTORY_LOW_STOCK,
          status: NotificationStatus.UNREAD,
          title: "Low Stock",
          body: "Wine X is low",
          createdAt: new Date().toISOString(),
        },
      ];

      mockNotificationsService.getUnreadNotifications.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getUnreadNotifications(mockQuery, REQ);

      expect(result).toEqual(expectedResponse);
      expect(
        mockNotificationsService.getUnreadNotifications,
      ).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
        limit: mockQuery.limit,
      });
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockNotificationsService.getUnreadNotifications.mockRejectedValue(
        new Error("Service error"),
      );

      await expect(
        controller.getUnreadNotifications(mockQuery, REQ),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("GET /notifications/unread/count", () => {
    const mockQuery: GetUnreadCountQueryDto = {
      userId: "user-123",
      restaurantId: "restaurant-456",
    };

    it("should return unread count", async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(5);

      const result = await controller.getUnreadCount(mockQuery, REQ);

      expect(result).toEqual({ count: 5 });
      expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
      });
    });

    it("should return zero when no unread notifications", async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(0);

      const result = await controller.getUnreadCount(mockQuery, REQ);

      expect(result).toEqual({ count: 0 });
    });
  });

  describe("PATCH /notifications/:id/read", () => {
    const notificationId = "notif-123";

    it("should mark notification as read", async () => {
      const expectedResponse = {
        id: notificationId,
        userId: "user-123",
        status: NotificationStatus.READ,
        readAt: new Date().toISOString(),
      };

      mockNotificationsService.markAsRead.mockResolvedValue(expectedResponse);

      const result = await controller.markAsRead(notificationId);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(
        notificationId,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockNotificationsService.markAsRead.mockRejectedValue(
        new Error("Not found"),
      );

      await expect(controller.markAsRead(notificationId)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe("PATCH /notifications/read/bulk", () => {
    const bulkDto: BulkIdsDto = {
      ids: ["notif-1", "notif-2", "notif-3"],
    };

    it("should mark multiple notifications as read", async () => {
      mockNotificationsService.markBulkAsRead.mockResolvedValue(3);

      const result = await controller.markBulkAsRead(bulkDto);

      expect(result).toEqual({ success: true, count: 3 });
      expect(mockNotificationsService.markBulkAsRead).toHaveBeenCalledWith(
        bulkDto.ids,
      );
    });

    it("should return zero count when no notifications updated", async () => {
      mockNotificationsService.markBulkAsRead.mockResolvedValue(0);

      const result = await controller.markBulkAsRead(bulkDto);

      expect(result).toEqual({ success: true, count: 0 });
    });
  });

  describe("PATCH /notifications/read/all", () => {
    const mockQuery = {
      userId: "user-123",
      restaurantId: "restaurant-456",
    };

    it("should mark all notifications as read", async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue(10);

      const result = await controller.markAllAsRead(mockQuery);

      expect(result).toEqual({ success: true, count: 10 });
      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith({
        userId: mockQuery.userId,
        restaurantId: mockQuery.restaurantId,
      });
    });
  });

  describe("PATCH /notifications/:id/archive", () => {
    const notificationId = "notif-123";

    it("should archive notification", async () => {
      const expectedResponse = {
        id: notificationId,
        status: NotificationStatus.ARCHIVED,
        archivedAt: new Date().toISOString(),
      };

      mockNotificationsService.archiveNotification.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.archiveNotification(notificationId);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.archiveNotification).toHaveBeenCalledWith(
        notificationId,
      );
    });
  });

  describe("DELETE /notifications/:id", () => {
    const notificationId = "notif-123";

    it("should delete notification", async () => {
      mockNotificationsService.deleteNotification.mockResolvedValue(undefined);

      const result = await controller.deleteNotification(notificationId);

      expect(result).toEqual({ success: true });
      expect(mockNotificationsService.deleteNotification).toHaveBeenCalledWith(
        notificationId,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockNotificationsService.deleteNotification.mockRejectedValue(
        new Error("Not found"),
      );

      await expect(
        controller.deleteNotification(notificationId),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("DELETE /notifications/bulk", () => {
    const bulkDto: BulkIdsDto = {
      ids: ["notif-1", "notif-2"],
    };

    it("should delete multiple notifications", async () => {
      mockNotificationsService.deleteBulk.mockResolvedValue(2);

      const result = await controller.deleteBulk(bulkDto);

      expect(result).toEqual({ success: true, count: 2 });
      expect(mockNotificationsService.deleteBulk).toHaveBeenCalledWith(
        bulkDto.ids,
      );
    });
  });

  describe("GET /notifications/preferences", () => {
    const mockQuery: GetPreferencesQueryDto = {
      userId: "user-123",
    };

    it("should return user preferences", async () => {
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
          startTime: "22:00",
          endTime: "08:00",
        },
      };

      mockNotificationsService.getPreferences.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getPreferences(mockQuery);

      expect(result).toEqual(expectedResponse);
      expect(mockNotificationsService.getPreferences).toHaveBeenCalledWith(
        mockQuery.userId,
      );
    });
  });

  describe("PATCH /notifications/preferences", () => {
    const mockQuery: GetPreferencesQueryDto = {
      userId: "user-123",
    };

    const updateDto: UpdatePreferencesDto = {
      userId: "user-123",
      email: false,
      push: true,
      categories: {
        inventory: true,
        orders: false,
      },
    };

    it("should update user preferences", async () => {
      // `updateDto` already carries `userId`, so the spread overwrote the
      // explicit key — it was dead. Both happen to be "user-123" today, so the
      // assertion is right by coincidence; change either fixture and this test
      // would keep passing against an expectation nobody wrote. Surfaced by
      // strictNullChecks (TS2783).
      const expectedResponse = {
        ...updateDto,
        updatedAt: new Date().toISOString(),
      };

      mockNotificationsService.updatePreferences.mockResolvedValue(
        expectedResponse,
      );

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

    it("should use userId from query if not in body", async () => {
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

  describe("GET /notifications/producers/status", () => {
    const USER = { userId: "user-123", restaurantId: "restaurant-456" };

    it("takes the tenant from the token, never from the request", async () => {
      mockProducersService.statusFor.mockResolvedValue({ armed: false });
      await controller.getProducerStatus(USER);
      expect(mockProducersService.statusFor).toHaveBeenCalledWith(
        "restaurant-456",
      );
    });

    it("[REVERT-FAILS] a failed read is a 500 with the reason, never an empty status", async () => {
      mockProducersService.statusFor.mockRejectedValue(
        new Error("statement timeout"),
      );
      await expect(controller.getProducerStatus(USER)).rejects.toThrow(
        HttpException,
      );
      await expect(controller.getProducerStatus(USER)).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });
  });
});
