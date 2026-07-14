import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import {
  GetNotificationsQueryDto,
  GetUnreadQueryDto,
  GetUnreadCountQueryDto,
  GetPreferencesQueryDto,
  GetHistoryQueryDto,
  MarkAllReadQueryDto,
  DeleteAllReadQueryDto,
  BulkIdsDto,
  UpdatePreferencesDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
} from "./dto/notifications.dto";

@Controller("notifications")
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  // =========================================================================
  // NOTIFICATION CRUD ENDPOINTS
  // =========================================================================

  /**
   * Create a notification row in the DB.
   * Called by the frontend reminder-scheduler (POST /notifications) so
   * calendar reminders appear in the in-app notification center.
   */
  @Post()
  async createNotification(
    @Body()
    body: {
      userId: string;
      restaurantId: string;
      type: string;
      title: string;
      message: string;
      priority?: "low" | "medium" | "high" | "critical";
      actionUrl?: string;
      actionLabel?: string;
      metadata?: Record<string, any>;
    },
  ) {
    try {
      return await this.notificationsService.createNotification(body);
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  async getNotifications(@Query() query: GetNotificationsQueryDto) {
    try {
      return await this.notificationsService.getNotifications({
        userId: query.userId,
        restaurantId: query.restaurantId,
        type: query.type,
        status: query.status,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        page: query.page,
        limit: query.limit,
      });
    } catch (error) {
      this.logger.error(`Failed to get notifications: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get("unread")
  async getUnreadNotifications(@Query() query: GetUnreadQueryDto) {
    try {
      return await this.notificationsService.getUnreadNotifications({
        userId: query.userId,
        restaurantId: query.restaurantId,
        limit: query.limit,
      });
    } catch (error) {
      this.logger.error(`Failed to get unread notifications: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get("unread/count")
  async getUnreadCount(@Query() query: GetUnreadCountQueryDto) {
    try {
      const count = await this.notificationsService.getUnreadCount({
        userId: query.userId,
        restaurantId: query.restaurantId,
      });
      return { count };
    } catch (error) {
      this.logger.error(`Failed to get unread count: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get("history")
  async getNotificationHistory(@Query() query: GetHistoryQueryDto) {
    try {
      return await this.notificationsService.getNotificationHistory(
        query.userId,
        query.days,
      );
    } catch (error) {
      this.logger.error(`Failed to get notification history: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get("preferences")
  async getPreferences(@Query() query: GetPreferencesQueryDto) {
    try {
      return await this.notificationsService.getPreferences(query.userId);
    } catch (error) {
      this.logger.error(`Failed to get preferences: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch("preferences")
  async updatePreferences(
    @Query() query: GetPreferencesQueryDto,
    @Body() body: UpdatePreferencesDto,
  ) {
    try {
      const userId = body.userId || query.userId;
      return await this.notificationsService.updatePreferences({
        userId,
        email: body.email,
        push: body.push,
        sms: body.sms,
        categories: body.categories as Record<string, boolean>,
        quietHours: body.quietHours,
        lowStock: body.lowStock,
        ordersMode: body.ordersMode,
        reportsMode: body.reportsMode,
      });
    } catch (error) {
      this.logger.error(`Failed to update preferences: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch("read/bulk")
  async markBulkAsRead(@Body() body: BulkIdsDto) {
    try {
      const count = await this.notificationsService.markBulkAsRead(body.ids);
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to bulk mark as read: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch("read/all")
  async markAllAsRead(@Query() query: MarkAllReadQueryDto) {
    try {
      const count = await this.notificationsService.markAllAsRead({
        userId: query.userId,
        restaurantId: query.restaurantId,
      });
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to mark all as read: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch(":id/read")
  async markAsRead(@Param("id") id: string) {
    try {
      const notification = await this.notificationsService.markAsRead(id);
      return notification;
    } catch (error) {
      this.logger.error(
        `Failed to mark notification as read: ${error.message}`,
      );
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch(":id/archive")
  async archiveNotification(@Param("id") id: string) {
    try {
      const notification =
        await this.notificationsService.archiveNotification(id);
      return notification;
    } catch (error) {
      this.logger.error(`Failed to archive notification: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete("bulk")
  async deleteBulk(@Body() body: BulkIdsDto) {
    try {
      const count = await this.notificationsService.deleteBulk(body.ids);
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to bulk delete: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete("read/all")
  async deleteAllRead(@Query() query: DeleteAllReadQueryDto) {
    try {
      const count = await this.notificationsService.deleteAllRead(query.userId);
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to delete all read: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(":id")
  async deleteNotification(@Param("id") id: string) {
    try {
      await this.notificationsService.deleteNotification(id);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete notification: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // =========================================================================
  // PUSH NOTIFICATION SUBSCRIPTION ENDPOINTS
  // =========================================================================

  @Post("push/subscribe")
  async subscribeToPush(@Body() body: PushSubscribeDto) {
    try {
      return await this.notificationsService.registerPushSubscription(
        body.userId,
        body.subscription as any,
      );
    } catch (error) {
      this.logger.error(`Failed to subscribe to push: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post("push/unsubscribe")
  async unsubscribeFromPush(@Body() body: PushUnsubscribeDto) {
    try {
      return await this.notificationsService.unregisterPushSubscription(
        body.userId,
      );
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from push: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // =========================================================================
  // EXISTING SENDING ENDPOINTS (preserved from original)
  // =========================================================================

  @Post("test")
  async sendTestNotification(@Body() body: { userId: string }) {
    this.logger.log(`Sending test notification to user ${body.userId}`);

    await this.notificationsService.sendToUser(body.userId, {
      type: "system_alert",
      title: "🍷 WineOps AI Test",
      body: "Notifications are working! You'll receive alerts here.",
      requireInteraction: false,
    });

    return { success: true, message: "Test notification sent" };
  }

  @Post("order-approval")
  async notifyOrderApproval(
    @Body()
    body: {
      userId: string;
      orderId: string;
      wineName: string;
      quantity: number;
      providerName: string;
      price?: number;
    },
  ) {
    await this.notificationsService.sendOrderApprovalNotification(body);
    return { success: true };
  }

  @Post("low-stock")
  async notifyLowStock(
    @Body()
    body: {
      restaurantId: string;
      wineId: string;
      wineName: string;
      currentStock: number;
      threshold: number;
    },
  ) {
    await this.notificationsService.sendLowStockAlert(body);
    return { success: true };
  }

  @Post("delivery")
  async notifyDelivery(
    @Body()
    body: {
      restaurantId: string;
      orderId: string;
      wineName: string;
      quantity: number;
      providerName: string;
    },
  ) {
    await this.notificationsService.sendDeliveryNotification(body);
    return { success: true };
  }

  @Post("price-negotiation")
  async notifyPriceNegotiation(
    @Body()
    body: {
      userId: string;
      orderId: string;
      wineName: string;
      currentPrice: number;
      proposedPrice: number;
      providerName: string;
    },
  ) {
    await this.notificationsService.sendPriceNegotiationNotification(body);
    return { success: true };
  }

  @Post("system-alert")
  async sendSystemAlert(
    @Body()
    body: {
      restaurantId: string;
      title: string;
      message: string;
      severity: "info" | "warning" | "error";
    },
  ) {
    await this.notificationsService.sendSystemAlert(body);
    return { success: true };
  }

  @Post("send-email")
  async sendEmail(
    @Body()
    body: {
      to: string[];
      subject: string;
      template_id?: string;
      body_html: string;
      body_text?: string;
      cc?: string[];
      bcc?: string[];
    },
  ) {
    this.logger.log(`Sending email to ${body.to.join(", ")}`);

    try {
      const result = await this.notificationsService.sendEmail({
        to: body.to,
        subject: body.subject,
        bodyHtml: body.body_html,
        bodyText: body.body_text,
        cc: body.cc,
        bcc: body.bcc,
      });

      return {
        success: true,
        message_id: result.messageId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
