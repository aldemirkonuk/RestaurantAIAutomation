import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ConversationsService } from "../conversations/conversations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ToastService } from "../toast/toast.service";
import {
  DecisionKind,
  FeedItem,
  FeedPriority,
  FeedResponse,
  TodayPulseResponse,
} from "./dto/mobile.dto";

/**
 * Composes the mobile decision feed and today-pulse from existing domain
 * services. One round trip for the app; the ranking lives here so every
 * client (and silent-push cache warms) sees the same order.
 */
@Injectable()
export class MobileService {
  private readonly logger = new Logger(MobileService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly procurementService: ProcurementService,
    private readonly conversationsService: ConversationsService,
    private readonly notificationsService: NotificationsService,
    private readonly toastService: ToastService,
  ) {}

  async getFeed(userId: string, restaurantId: string): Promise<FeedResponse> {
    const [orders, conversations, notifications] = await Promise.all([
      this.procurementService.listPendingOrders(restaurantId).catch((e) => {
        this.logger.warn(`feed orders collector failed: ${e?.message}`);
        return [];
      }),
      this.conversationsService
        .getPendingConversations(restaurantId)
        .catch((e) => {
          this.logger.warn(
            `feed conversations collector failed: ${e?.message}`,
          );
          return [];
        }),
      this.notificationsService
        .getUnreadNotifications({ userId, restaurantId, limit: 40 })
        .catch((e) => {
          this.logger.warn(
            `feed notifications collector failed: ${e?.message}`,
          );
          return [];
        }),
    ]);

    const providerNames = await this.resolveProviderNames([
      ...orders.map((o: any) => o.providerId),
      ...conversations.map((c: any) => c.provider_id),
    ]);

    const items: FeedItem[] = [];

    for (const order of orders as any[]) {
      const amount =
        order.totalCost ??
        order.finalPrice ??
        order.negotiatedPrice ??
        order.quotedPrice ??
        null;
      items.push(
        this.makeItem({
          kind: "order_approval",
          entityId: order.id,
          title: order.wineName
            ? `Approve order: ${order.wineName}`
            : `Approve ${order.orderNumber ?? "order"}`,
          subtitle: this.orderSubtitle(order, providerNames),
          wineName: order.wineName ?? null,
          providerName: providerNames.get(order.providerId) ?? null,
          amount,
          quantity: order.quantity ?? null,
          priority: order.isEmergency ? "critical" : "high",
          createdAt: order.requestedAt ?? new Date().toISOString(),
          orderId: order.id,
          meta: { orderNumber: order.orderNumber, status: order.status },
        }),
      );
    }

    const pendingOrderIds = new Set(orders.map((o: any) => o.id));

    for (const conv of conversations as any[]) {
      const providerName =
        conv.providers?.name ?? providerNames.get(conv.provider_id) ?? null;
      const draft = typeof conv.content === "string" ? conv.content : null;
      items.push(
        this.makeItem({
          kind: "draft_approval",
          entityId: conv.id,
          title: providerName
            ? `Reply ready for ${providerName}`
            : "Vendor reply ready",
          subtitle: draft
            ? this.truncate(draft.replace(/\s+/g, " "), 110)
            : "AI drafted a reply for your review.",
          providerName,
          priority: "high",
          createdAt: conv.created_at ?? new Date().toISOString(),
          conversationId: conv.id,
          orderId: conv.procurement_orders?.id ?? conv.order_id ?? null,
          draftContent: draft,
          meta: {
            orderNumber: conv.procurement_orders?.order_number ?? null,
            approvalStatus: conv.manager_approval_status ?? null,
          },
        }),
      );
    }

    for (const n of notifications as any[]) {
      const meta = n.metadata ?? n.meta ?? {};
      const notifOrderId = meta.orderId ?? null;
      const type = n.type ?? "";

      if (type === "invoice_received") {
        items.push(
          this.makeItem({
            kind: "receipt_verification",
            entityId: notifOrderId ?? n.id,
            title: n.title ?? "Verify delivery",
            subtitle:
              n.message ?? "Confirm the physical count against the invoice.",
            wineName: meta.wineName ?? null,
            quantity: meta.quantity ?? null,
            priority: "critical",
            createdAt: n.createdAt ?? n.created_at ?? new Date().toISOString(),
            orderId: notifOrderId,
            notificationId: n.id,
            meta,
          }),
        );
        continue;
      }

      // An unread "approval needed" style notification duplicates the order
      // card built above; the card is the actionable one, so skip the echo.
      if (notifOrderId && pendingOrderIds.has(notifOrderId)) continue;

      items.push(
        this.makeItem({
          kind: "alert",
          entityId: n.id,
          title: n.title ?? "Notification",
          subtitle: n.message ?? "",
          priority: this.normalizePriority(n.priority),
          createdAt: n.createdAt ?? n.created_at ?? new Date().toISOString(),
          notificationId: n.id,
          orderId: notifOrderId,
          meta,
        }),
      );
    }

    items.sort((a, b) => b.score - a.score);

    return {
      items,
      counts: {
        total: items.length,
        orderApprovals: items.filter((i) => i.kind === "order_approval").length,
        draftApprovals: items.filter((i) => i.kind === "draft_approval").length,
        receiptVerifications: items.filter(
          (i) => i.kind === "receipt_verification",
        ).length,
        alerts: items.filter((i) => i.kind === "alert").length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Sales snapshot for the pulse strip. The client sends its local midnight
   * as `start` so "today" is defined by the phone in the manager's pocket,
   * not a server timezone guess.
   */
  async getTodayPulse(
    userId: string,
    restaurantId: string,
    startIso?: string,
    endIso?: string,
  ): Promise<TodayPulseResponse> {
    const end = this.parseDate(endIso) ?? new Date();
    const start = this.parseDate(startIso) ?? this.utcMidnight(end);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const lastWeekStart = new Date(start.getTime() - weekMs);
    const lastWeekEnd = new Date(end.getTime() - weekMs);

    const [today, lastWeek, feed] = await Promise.all([
      this.toastService
        .getSalesData(restaurantId, start, end)
        .catch(() => null),
      this.toastService
        .getSalesData(restaurantId, lastWeekStart, lastWeekEnd)
        .catch(() => null),
      this.getFeed(userId, restaurantId).catch(() => null),
    ]);

    const revenueToday = today?.totalRevenue ?? null;
    const revenueLastWeek = lastWeek?.totalRevenue ?? null;
    const deltaPct =
      revenueToday != null && revenueLastWeek != null && revenueLastWeek > 0
        ? Math.round(((revenueToday - revenueLastWeek) / revenueLastWeek) * 100)
        : null;

    return {
      revenueToday,
      checksToday: today?.total ?? null,
      revenueLastWeek,
      deltaPct,
      pendingDecisions: feed?.counts.total ?? 0,
      criticalCount:
        feed?.items.filter((i) => i.priority === "critical").length ?? 0,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private makeItem(
    partial: Partial<FeedItem> & {
      kind: DecisionKind;
      entityId: string;
      title: string;
      subtitle: string;
      priority: FeedPriority;
      createdAt: string;
    },
  ): FeedItem {
    return {
      id: `${partial.kind}:${partial.entityId}`,
      wineName: null,
      providerName: null,
      amount: null,
      quantity: null,
      orderId: null,
      conversationId: null,
      notificationId: null,
      draftContent: null,
      meta: {},
      ...partial,
      score: this.score(partial.kind, partial.priority, partial.createdAt),
    };
  }

  /**
   * Rank: what blocks operations first, then money decisions, then drafts,
   * then alerts by their own priority. Age adds a small nudge so nothing
   * rots silently at the bottom.
   */
  private score(
    kind: DecisionKind,
    priority: FeedPriority,
    createdAt: string,
  ): number {
    let base: number;
    switch (kind) {
      case "receipt_verification":
        base = 95;
        break;
      case "order_approval":
        base = priority === "critical" ? 92 : 80;
        break;
      case "draft_approval":
        base = 75;
        break;
      case "alert":
        base = { critical: 90, high: 60, medium: 40, low: 20 }[priority];
        break;
    }
    const ageHours = Math.max(
      0,
      (Date.now() - new Date(createdAt).getTime()) / 3_600_000,
    );
    return base + (Math.min(ageHours, 48) / 48) * 5;
  }

  private orderSubtitle(
    order: any,
    providerNames: Map<string, string>,
  ): string {
    const parts: string[] = [];
    if (order.quantity) {
      parts.push(
        `${order.quantity} ${order.unitType === "case" ? "cases" : "bottles"}`,
      );
    }
    const provider = providerNames.get(order.providerId);
    if (provider) parts.push(provider);
    const amount =
      order.totalCost ??
      order.finalPrice ??
      order.negotiatedPrice ??
      order.quotedPrice;
    if (amount != null) parts.push(this.formatMoney(amount));
    return parts.join(" · ") || "Awaiting your approval";
  }

  private async resolveProviderNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    const map = new Map<string, string>();
    if (!unique.length) return map;
    try {
      const { data } = await this.databaseService.supabase
        .from("providers")
        .select("id, name")
        .in("id", unique);
      (data ?? []).forEach((row: any) => map.set(row.id, row.name));
    } catch (e: any) {
      this.logger.warn(`resolveProviderNames failed: ${e?.message}`);
    }
    return map;
  }

  private normalizePriority(value: any): FeedPriority {
    return ["low", "medium", "high", "critical"].includes(value)
      ? value
      : "medium";
  }

  private truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  }

  private formatMoney(value: number): string {
    return `$${Number(value).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })}`;
  }

  private parseDate(iso?: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  private utcMidnight(ref: Date): Date {
    const d = new Date(ref);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
