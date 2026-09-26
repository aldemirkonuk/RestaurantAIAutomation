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
  UseGuards,
  Optional,
  Inject,
  forwardRef,
  Req,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
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
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { NotificationProducersService } from "./producers/notification-producers.service";

/**
 * The tenant a notification read is scoped to — from the VERIFIED JWT, never
 * from the query string (Antalya night).
 *
 * Measured on main: a brand-new tenant owning exactly one notification rendered
 * "20 unread", including a CRITICAL card naming seven wines from a different
 * restaurant. The SPA never sent a restaurant and the service filtered only
 * when asked, so the read was scoped to the USER — and one owner with two
 * venues is the ordinary case here, not an edge case.
 *
 * A client-supplied `restaurantId` is deliberately IGNORED rather than merged.
 * It is not a security boundary: a client can send any uuid, and if the query
 * string could widen or redirect the scope then this fix would be decoration.
 * Switching venue re-issues the token (`switchRestaurant`), which is what makes
 * the token the right source.
 *
 * No restaurant on the token means the read is REFUSED. Falling back to "no
 * filter" is precisely how the bug renders: every notification the user has
 * ever received, across every tenant, presented as this venue's inbox.
 */
function scopeRestaurantId(req: {
  user?: { restaurantId?: string | null };
}): string {
  const id = req?.user?.restaurantId;
  if (!id || String(id).trim() === "") {
    throw new HttpException(
      "No active restaurant on this session — notifications cannot be scoped, and an unscoped read would show other restaurants' notifications.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return String(id);
}

/**
 * The user whose notification preferences a request may read or change: the
 * one on the VERIFIED token (`JwtStrategy.validate` returns `userId`).
 *
 * Found 2026-09-12: GET and PATCH /notifications/preferences took the id from
 * `?userId=` or the body and read or upserted `notification_preferences` by
 * it, so any signed-in user could read another user's channels or switch their
 * low-stock alerts off by naming a uuid.
 *
 * A client-supplied id is still ACCEPTED when it names the caller, because the
 * web client sends its own id in both places
 * (apps/web/src/services/api/notifications.ts:230,243-246). One that names
 * anybody else is refused, not silently replaced, so a client bug that sends
 * the wrong id is a visible 403 rather than a write to the wrong row going
 * unnoticed. No user on the token is a 401, never a fallback to the client's id.
 */
/** A request after JwtAuthGuard: `JwtStrategy.validate` put both ids on it. */
type ScopedRequest = Request & {
  user?: { userId?: string | null; restaurantId?: string | null };
};

/**
 * Refuse a client-supplied restaurant id that is not the token's. Returns the
 * token's id. Same rule as scopeOwnUserId: a mismatch is a visible 403, never
 * a silent replacement.
 */
function scopeOwnRestaurant(
  req: ScopedRequest,
  ...named: Array<string | null | undefined>
): string {
  const own = scopeRestaurantId(req);
  if (
    named.some(
      (v) =>
        typeof v === "string" &&
        v.length > 0 &&
        v.toLowerCase() !== own.toLowerCase(),
    )
  ) {
    throw new ForbiddenException(
      "Notifications can only be read or changed in the caller's own restaurant.",
    );
  }
  return own;
}

/** A refusal chosen above stays itself; anything else is a 500. */
function rethrow(error: any): never {
  if (error instanceof HttpException) throw error;
  throw new HttpException(
    error?.message ?? "Notification request failed",
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function scopeOwnUserId(
  req: { user?: { userId?: string | null } } | undefined,
  ...named: Array<string | null | undefined>
): string {
  const own = req?.user?.userId;
  if (!own || String(own).trim() === "") {
    throw new UnauthorizedException(
      "No user on this session; notification preferences cannot be scoped.",
    );
  }
  const ownId = String(own);
  const mismatched = named.some(
    (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.toLowerCase() !== ownId.toLowerCase(),
  );
  if (mismatched) {
    throw new ForbiddenException(
      "A notification, its preferences or its push subscription can only be read or changed by its own user.",
    );
  }
  return ownId;
}

/**
 * OD-20 — guarded at class level 2026-08-25.
 *
 * This controller had no guard and no @Public(). It was not protected by
 * TenantGuard either: that guard fails OPEN by design —
 * "If no authenticated user, allow through — JwtAuthGuard should enforce where
 * required" (tenant.guard.ts) — and nothing here required it.
 *
 * Verified live before the fix: GET /api/v1/dashboard/stats/<uuid> returned 200
 * with JSON to an unauthenticated caller.
 *
 * Routes that are genuinely public must now say so with @Public(), so intent is
 * recorded rather than inferred from an absent decorator.
 */
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly producers: NotificationProducersService,
    @Optional()
    @Inject(forwardRef(() => LowStockAlertsService))
    private readonly lowStockAlerts?: LowStockAlertsService,
  ) {}

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
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: this wrote a row for any user id and any restaurant id
    // the body named. The web caller (lib/reminder-scheduler.ts:193-195) sends
    // its own user and active restaurant, which both still pass.
    const userId = scopeOwnUserId(req, body?.userId);
    const restaurantId = scopeOwnRestaurant(req, body?.restaurantId);
    try {
      return await this.notificationsService.createNotification({
        ...body,
        userId,
        restaurantId,
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${error.message}`);
      rethrow(error);
    }
  }

  @Get()
  async getNotifications(
    @Query() query: GetNotificationsQueryDto,
    @Req() req: ScopedRequest,
  ) {
    const restaurantId = scopeRestaurantId(req);
    const userId = scopeOwnUserId(req, query?.userId);
    try {
      return await this.notificationsService.getNotifications({
        userId,
        restaurantId,
        type: query.type,
        status: query.status,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        page: query.page,
        limit: query.limit,
      });
    } catch (error) {
      this.logger.error(`Failed to get notifications: ${error.message}`);
      rethrow(error);
    }
  }

  @Get("unread")
  async getUnreadNotifications(
    @Query() query: GetUnreadQueryDto,
    @Req() req: ScopedRequest,
  ) {
    const restaurantId = scopeRestaurantId(req);
    const userId = scopeOwnUserId(req, query?.userId);
    try {
      return await this.notificationsService.getUnreadNotifications({
        userId,
        restaurantId,
        limit: query.limit,
      });
    } catch (error) {
      this.logger.error(`Failed to get unread notifications: ${error.message}`);
      rethrow(error);
    }
  }

  @Get("unread/count")
  async getUnreadCount(
    @Query() query: GetUnreadCountQueryDto,
    @Req() req: ScopedRequest,
  ) {
    const restaurantId = scopeRestaurantId(req);
    const userId = scopeOwnUserId(req, query?.userId);
    try {
      const count = await this.notificationsService.getUnreadCount({
        userId,
        restaurantId,
      });
      return { count };
    } catch (error) {
      this.logger.error(`Failed to get unread count: ${error.message}`);
      rethrow(error);
    }
  }

  @Get("low-stock/held/:restaurantId")
  @ApiOperation({
    summary: "Low-stock crossings detected but not yet sent to anyone",
    description:
      'Wines that crossed below par and were deliberately held — by the 15-minute instant cooldown, or by the restaurant\'s own notification preferences — with the reason and when, plus when the digest will tell them (`digest`, null when the preferences could not be read). A wine back above par, or one the digest already covered, is not listed. Before this existed, a held crossing and a crossing that never happened looked identical in `inventory_alert_state`, so "tonight\'s digest will cover it" and "nothing is wrong" rendered the same (POS lens, absence-as-health 8). A failed read is an error, never an empty list (ADR 0067).',
  })
  async getHeldLowStock(
    @Param("restaurantId") restaurantId: string,
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: the path named any restaurant and this read it.
    // The read then uses the TOKEN's id, not the path's (2026-09-26): the
    // guard compares case-insensitively, so the path's spelling of the same
    // id must not be what reaches the query or the echoed `restaurant_id`.
    const own = scopeOwnRestaurant(req, restaurantId);
    if (!this.lowStockAlerts) {
      throw new HttpException(
        "Low-stock alerts are not available on this deployment",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      return await this.lowStockAlerts.listHeldCrossings(own);
    } catch (error) {
      this.logger.error(
        `Failed to read held low-stock crossings: ${error.message}`,
      );
      rethrow(error);
    }
  }

  @Get("history")
  async getNotificationHistory(
    @Query() query: GetHistoryQueryDto,
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: this read any user's history by `?userId=`, across
    // every restaurant.
    const userId = scopeOwnUserId(req, query?.userId);
    const restaurantId = scopeRestaurantId(req);
    try {
      return await this.notificationsService.getNotificationHistory(
        userId,
        query.days,
        restaurantId,
      );
    } catch (error) {
      this.logger.error(`Failed to get notification history: ${error.message}`);
      rethrow(error);
    }
  }

  /**
   * Preferences are per person PER HOUSE (ADR 0149 row 39, 2026-09-18): the
   * house comes from the same verified token as the user, never from a
   * query or body field, exactly like every other route in this controller.
   */
  @Get("preferences")
  async getPreferences(
    @Query() query: GetPreferencesQueryDto,
    @Req() req: ScopedRequest,
  ) {
    // Outside the try: the catch below turns every error into a 500, and a
    // refused scope must stay a 401/403.
    const userId = scopeOwnUserId(req, query?.userId);
    const restaurantId = scopeRestaurantId(req);
    try {
      return await this.notificationsService.getPreferences(
        userId,
        restaurantId,
      );
    } catch (error) {
      this.logger.error(`Failed to get preferences: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch("preferences")
  async updatePreferences(
    @Query() query: GetPreferencesQueryDto,
    @Body() body: UpdatePreferencesDto,
    @Req() req: ScopedRequest,
  ) {
    // Both places are compared: `body.userId || query.userId` used to let the
    // body win and ignore a query naming someone else.
    const userId = scopeOwnUserId(req, body?.userId, query?.userId);
    const restaurantId = scopeRestaurantId(req);
    try {
      return await this.notificationsService.updatePreferences({
        userId,
        restaurantId,
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
  async markBulkAsRead(@Body() body: BulkIdsDto, @Req() req: ScopedRequest) {
    const userId = scopeOwnUserId(req);
    try {
      const count = await this.notificationsService.markBulkAsRead(
        body.ids,
        userId,
      );
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to bulk mark as read: ${error.message}`);
      rethrow(error);
    }
  }

  @Patch("read/all")
  async markAllAsRead(
    @Query() query: MarkAllReadQueryDto,
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: both ids came from the query string.
    const userId = scopeOwnUserId(req, query?.userId);
    const restaurantId = scopeOwnRestaurant(req, query?.restaurantId);
    try {
      const count = await this.notificationsService.markAllAsRead({
        userId,
        restaurantId,
      });
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to mark all as read: ${error.message}`);
      rethrow(error);
    }
  }

  @Patch(":id/read")
  async markAsRead(@Param("id") id: string, @Req() req: ScopedRequest) {
    const userId = scopeOwnUserId(req);
    try {
      const notification = await this.notificationsService.markAsRead(
        id,
        userId,
      );
      return notification;
    } catch (error) {
      this.logger.error(
        `Failed to mark notification as read: ${error.message}`,
      );
      rethrow(error);
    }
  }

  @Patch(":id/unread")
  async markAsUnread(@Param("id") id: string, @Req() req: ScopedRequest) {
    const userId = scopeOwnUserId(req);
    try {
      const notification = await this.notificationsService.markAsUnread(
        id,
        userId,
      );
      return notification;
    } catch (error) {
      this.logger.error(
        `Failed to mark notification as unread: ${error.message}`,
      );
      rethrow(error);
    }
  }

  @Patch(":id/archive")
  async archiveNotification(
    @Param("id") id: string,
    @Req() req: ScopedRequest,
  ) {
    const userId = scopeOwnUserId(req);
    try {
      const notification = await this.notificationsService.archiveNotification(
        id,
        userId,
      );
      return notification;
    } catch (error) {
      this.logger.error(`Failed to archive notification: ${error.message}`);
      rethrow(error);
    }
  }

  @Delete("bulk")
  async deleteBulk(@Body() body: BulkIdsDto, @Req() req: ScopedRequest) {
    const userId = scopeOwnUserId(req);
    try {
      const count = await this.notificationsService.deleteBulk(
        body.ids,
        userId,
      );
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to bulk delete: ${error.message}`);
      rethrow(error);
    }
  }

  @Delete("read/all")
  async deleteAllRead(
    @Query() query: DeleteAllReadQueryDto,
    @Req() req: ScopedRequest,
  ) {
    const userId = scopeOwnUserId(req, query?.userId);
    try {
      const count = await this.notificationsService.deleteAllRead(userId);
      return { success: true, count };
    } catch (error) {
      this.logger.error(`Failed to delete all read: ${error.message}`);
      rethrow(error);
    }
  }

  @Delete(":id")
  async deleteNotification(@Param("id") id: string, @Req() req: ScopedRequest) {
    const userId = scopeOwnUserId(req);
    try {
      await this.notificationsService.deleteNotification(id, userId);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete notification: ${error.message}`);
      rethrow(error);
    }
  }

  // =========================================================================
  // PUSH NOTIFICATION SUBSCRIPTION ENDPOINTS
  // =========================================================================

  @Post("push/subscribe")
  async subscribeToPush(
    @Body() body: PushSubscribeDto,
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: this upserted any user's push subscription, so a
    // caller could point a victim's alerts at their own browser.
    const userId = scopeOwnUserId(req, body?.userId);
    try {
      return await this.notificationsService.registerPushSubscription(
        userId,
        body.subscription as any,
      );
    } catch (error) {
      this.logger.error(`Failed to subscribe to push: ${error.message}`);
      rethrow(error);
    }
  }

  @Post("push/unsubscribe")
  async unsubscribeFromPush(
    @Body() body: PushUnsubscribeDto,
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: this switched off any user's push alerts.
    const userId = scopeOwnUserId(req, body?.userId);
    try {
      return await this.notificationsService.unregisterPushSubscription(userId);
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from push: ${error.message}`);
      rethrow(error);
    }
  }

  // =========================================================================
  // THE TEST SEND — to the caller only
  // =========================================================================

  @Post("test")
  async sendTestNotification(
    @Body() body: { userId?: string },
    @Req() req: ScopedRequest,
  ) {
    // Scoped 2026-09-12: a test goes to the caller only; it sent to any id.
    const userId = scopeOwnUserId(req, body?.userId);
    this.logger.log(`Sending test notification to user ${userId}`);

    await this.notificationsService.sendToUser(userId, {
      type: "system_alert",
      title: "Mudavym test",
      body: "Notifications are working! You'll receive alerts here.",
      requireInteraction: false,
    });

    return { success: true, message: "Test notification sent" };
  }

  // =========================================================================
  // WHO MAY NOTIFY WHOM (ADR 0149 answer 15, 2026-09-16; ADR 0147)
  // =========================================================================
  //
  // CLOSED 2026-09-16: POST /notifications/order-approval, /low-stock,
  // /delivery, /price-negotiation and /system-alert. Each sent to whatever user
  // id, restaurant id or wording its body named, for any signed-in caller, and
  // none had a caller: `git grep` over apps/web/src, apps/mobile and services/
  // found no request to any of the five (the orchestrator included, so none
  // needed an internal service-key door instead). Their service methods stay on
  // NotificationsService for internal producers; they are no longer reachable
  // over HTTP. `notification-senders-are-closed.spec.ts` pins the absence.

  /**
   * Closed 2026-09-20. This route used to take `to`/`cc`/`bcc` and `body_html`
   * from the client and hand them to Gmail, so any signed-in user could send
   * arbitrary HTML from the house's domain (ADR 0147 named gap). ADR 0149
   * row 15 asked for owner/manager plus house recipients — a constrained
   * open send is still an open send of client HTML, which ADR 0170 refuses
   * for vendor mail. Gmail is never called. A 200 `{success:false}` would
   * look like a failed send; this is a refusal. The house's own send is
   * `POST /communications/letters` (the Communications composer). The three
   * web callers this route had (QuickGmailModal, email-scheduler,
   * RecurringOrders, none reachable from a Mudavym page) were retired in the
   * same PR, and `no-client-send-email.test.ts` keeps a fourth from appearing.
   */
  @Post("send-email")
  async sendEmail(): Promise<never> {
    throw new ForbiddenException(
      "This route does not send mail. A client cannot supply HTML or recipients here.",
    );
  }

  // =========================================================================
  // THE PRODUCERS — what the house's own signals say about themselves
  // =========================================================================

  /**
   * The five producers' own account of themselves: armed or not, served by the
   * scheduler or not, and the last actual run beside the next scheduled tick.
   *
   * A page that said "the house is being watched" while this process had been
   * down for a day is the exact fault ADR 0020 names, so every one of those four
   * facts is separately available and none is inferred from another.
   */
  @Get("producers/status")
  async getProducerStatus(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    try {
      return await this.producers.statusFor(user.restaurantId);
    } catch (error) {
      this.logger.error(
        `Producer status read failed for ${user.restaurantId}: ${error.message}`,
      );
      throw new HttpException(
        error.message || "Failed to read producer status",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
