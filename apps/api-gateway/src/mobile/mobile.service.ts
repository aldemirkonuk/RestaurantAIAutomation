import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ConversationsService } from "../conversations/conversations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ToastService } from "../toast/toast.service";
import { roleSatisfies } from "../procurement/order-approval-gate";
import { OWN_WAGE_ACTION } from "../team/own-wage-notice";
import {
  DecisionKind,
  FeedItem,
  FeedPriority,
  FeedResponse,
  TodayPulseResponse,
} from "./dto/mobile.dto";

/**
 * Does this caller see the house's money on the phone?
 *
 * The founder, 2026-10-01 (ADR 0253, "Answered 2026-10-01 (round 2)"), to "On
 * the web, staff never see prices. The phone's Today feed shows staff order
 * amounts, approve cards and today's revenue. Close that?": *"Close it to
 * staff (Recommended)"*.
 *
 * Owners and managers only. `role` is the caller's role IN THIS HOUSE
 * (`req.user.role`, re-read from `user_restaurant_access` on every request,
 * ADR 0162). The rank rule is `roleSatisfies`, the one the order-approval gate
 * already uses, so `null`, an absent role, `"staff"` and any string nobody has
 * heard of all rank below manager: a role that cannot be established gets the
 * staff view, never the money view.
 *
 * A staff member holding a live `vendor_send` grant is still not a money role
 * here. The grant is read by the send gate at the act; this feed does not read
 * it, so it cannot widen what the feed shows.
 */
export function seesHouseMoney(role: string | null | undefined): boolean {
  return roleSatisfies(role, "manager");
}

/**
 * Notification types whose `message` is money-free from EVERY writer of the
 * type (enumerated 2026-10-01; the writers are listed in
 * `.planning/tech-debt.d/2026-10-01-fix-phone-feed-no-money-for-staff.md`).
 *
 * For a caller who does not see money, a notification card's subtitle is the
 * row's `message` only when its type is on this list. Every other type falls
 * back to the card's neutral line, and that includes a type nobody has written
 * yet, so a new writer that puts money in its sentence cannot reach staff by
 * default. The text is never scrubbed: a pattern that misses one way of
 * writing an amount leaks it. Adding a type here means reading every writer of
 * it first.
 *
 * Left off on purpose, because at least one writer puts money or another
 * person's free text in the sentence: `service_closed`, `invoice_received`,
 * `goal_reached`, `price_change`, `price_index_upload`, `promo_digest`,
 * `delivery_proposal`, `authority_grant_issued`, `authority_grant_reapproved`
 * (said to the grantee alone, `isOwnGrantNotice`),
 * `team_member_own_wage_set` (a manager's own wage, owners only),
 * `system_alert`, `deal`, `order_verification`, `vendor_reply`,
 * `vendor_deal_declined` and `vendor_letter_declined`.
 *
 * `system` is on the list since the own-wage notice moved to its own type
 * (the founder, 2026-10-01: "Give wages its own type (Recommended)"). Every
 * writer of `system` was re-read that day and none puts money in the
 * sentence; a row stored as `system` before the move is still kept quiet by
 * `isOwnWageNotice`.
 */
export const MONEY_FREE_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  // Deliveries and stock.
  "order_delivered",
  "delivery_differs",
  "delivery_clock",
  "delivery_lapsed",
  "delivery_item_to_name",
  "delivery_scheduled",
  "order_pending",
  "inventory_low_stock",
  "report",
  // Asking an owner or a manager to send, and what came of it.
  "vendor_send_requested",
  "vendor_send_released",
  "vendor_deal_requested",
  "vendor_letter_requested",
  "vendor_deal_released",
  "vendor_letter_released",
  "vendor_deal_withdrawn",
  "vendor_letter_withdrawn",
  "vendor_letter_rewaiting",
  "vendor_letter_send_failed",
  "authority_grant_revoked",
  "authority_grant_deleted",
  "authority_grant_hidden",
  "authority_grant_shown",
  "authority_grant_suspended",
  // Vendor mail and the drafting agent.
  "unknown_sender",
  "draft_ready",
  "constraint_triggered",
  "rate_limit_reached",
  "off_app_invoice",
  "scarcity_hold_not_sent",
  "conversation_reapproval_needed",
  "mail_retention_deleted",
  "security_alert",
  "prospect",
  // Connections.
  "grant_suspended",
  "mcp_tool_added",
  "mail_grant_absent",
  // A person's own reminders.
  "calendar_reminder",
  "custom_reminder",
  // Team and account notices: a published schedule, a call-out, a team
  // message or note in its author's words, Away dates, a change to one's own
  // access or role, a passkey added or removed.
  "system",
]);

/**
 * Is this notification a manager's own-wage notice? Its metadata names the
 * action whatever its type, so a row written as `system` before the notice
 * had its own type (team/own-wage-notice.ts) is still recognised. Such a row
 * reaches a caller who does not see money only as an owner later demoted in
 * the same house, and its sentence holds two wages.
 */
export function isOwnWageNotice(meta: unknown): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return (meta as { action?: unknown }).action === OWN_WAGE_ACTION;
}

/**
 * The grant notices whose sentence names the grant's money limit
 * (`organizations/authority-grants.service.ts`, `tell()`). Each copy goes to
 * every owner and to the grantee, so a reader who does not see money holds
 * one either as the grantee or as an owner later demoted in the same house.
 */
export const OWN_LIMIT_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "authority_grant_issued",
  "authority_grant_reapproved",
]);

/**
 * Is this a grant notice about the reader's own grant? A grantee sees their
 * own limit (the founder, 2026-10-01: "Show their own limit (Recommended)",
 * then "Record the grantee (Recommended)"). The writer records the grantee
 * as `granteeUserId`. A row without it (written before the grantee was
 * recorded) or naming anyone else is not the reader's own, and stays quiet.
 */
export function isOwnGrantNotice(
  type: string,
  meta: unknown,
  userId: string,
): boolean {
  if (!OWN_LIMIT_NOTIFICATION_TYPES.has(type)) return false;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const grantee = (meta as { granteeUserId?: unknown }).granteeUserId;
  return typeof grantee === "string" && grantee !== "" && grantee === userId;
}

/**
 * The only notification `metadata` keys a caller who does not see money gets
 * on a card's `meta`: identifiers and the two labels the card already lifts
 * (`wineName`, `quantity`). Every other key, including one a writer adds
 * later, is left out. The phone reads no `meta` key today (apps/mobile), so
 * nothing it draws depends on the rest.
 */
export const NON_MONEY_META_KEYS: ReadonlySet<string> = new Set([
  "orderId",
  "orderNumber",
  "wineName",
  "quantity",
]);

/** `meta` cut down to `NON_MONEY_META_KEYS`. */
export function nonMoneyMeta(meta: unknown): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return kept;
  for (const [key, value] of Object.entries(meta)) {
    if (NON_MONEY_META_KEYS.has(key)) kept[key] = value;
  }
  return kept;
}

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

  /**
   * `role` is required, not defaulted, so a new caller cannot forget it; a
   * caller that passes `null` gets the staff view (`seesHouseMoney`).
   */
  async getFeed(
    userId: string,
    restaurantId: string,
    role: string | null,
  ): Promise<FeedResponse> {
    const money = seesHouseMoney(role);
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

    // Approve cards carry the order's money (in `amount` and the subtitle), so
    // they are built only for a caller who sees money (ADR 0253 round 2). The
    // orders are still read for anyone: `pendingOrderIds` below keeps the
    // "approval needed" notification echo out of everyone's feed.
    for (const order of (money ? orders : []) as any[]) {
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

      // A notification's own words and metadata reach a caller who does not
      // see money only through two allowlists: the message only for a type
      // every writer keeps money-free, and the metadata only under a non-money
      // key. Anything else, including a type or key added later, falls back to
      // the card's neutral line and is left out (ADR 0253 round 2). A wage
      // notice stays quiet under any type. A grant notice names a limit, so
      // it is said only to the grantee, `userId` being the caller's own id.
      const sayMessage =
        money ||
        (MONEY_FREE_NOTIFICATION_TYPES.has(type) && !isOwnWageNotice(meta)) ||
        isOwnGrantNotice(type, meta, userId);
      const cardMeta = money ? meta : nonMoneyMeta(meta);

      if (type === "invoice_received") {
        items.push(
          this.makeItem({
            kind: "receipt_verification",
            entityId: notifOrderId ?? n.id,
            title: n.title ?? "Verify delivery",
            subtitle:
              (sayMessage ? n.message : null) ??
              "Confirm the physical count against the invoice.",
            wineName: meta.wineName ?? null,
            quantity: meta.quantity ?? null,
            priority: "critical",
            createdAt: n.createdAt ?? n.created_at ?? new Date().toISOString(),
            orderId: notifOrderId,
            notificationId: n.id,
            meta: cardMeta,
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
          subtitle: (sayMessage ? n.message : null) ?? "",
          priority: this.normalizePriority(n.priority),
          createdAt: n.createdAt ?? n.created_at ?? new Date().toISOString(),
          notificationId: n.id,
          orderId: notifOrderId,
          meta: cardMeta,
        }),
      );
    }

    items.sort((a, b) => b.score - a.score);

    // For a caller who does not see money, `amount` is taken off every card
    // and the order-approval count is left out: absent, never `null` or `0`,
    // because a withheld figure is not "no amount" and not "none pending"
    // (ADR 0016, ADR 0020).
    const served: FeedItem[] = money
      ? items
      : items.map(({ amount: _withheld, ...card }) => card);

    return {
      items: served,
      counts: {
        total: served.length,
        ...(money
          ? {
              orderApprovals: served.filter((i) => i.kind === "order_approval")
                .length,
            }
          : {}),
        draftApprovals: served.filter((i) => i.kind === "draft_approval")
          .length,
        receiptVerifications: served.filter(
          (i) => i.kind === "receipt_verification",
        ).length,
        alerts: served.filter((i) => i.kind === "alert").length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Sales snapshot for the pulse strip. The client sends its local midnight
   * as `start` so "today" is defined by the phone in the manager's pocket,
   * not a server timezone guess.
   *
   * The sales figures go to owners and managers only (ADR 0253 round 2). For
   * anyone else the sales are not read at all and the four figures are left
   * out of the response; the decision counts are the caller's own feed.
   * `checksToday` goes with revenue: it is the same sales read and the phone
   * has only ever shown it beside the revenue figure.
   */
  async getTodayPulse(
    userId: string,
    restaurantId: string,
    role: string | null,
    startIso?: string,
    endIso?: string,
  ): Promise<TodayPulseResponse> {
    const money = seesHouseMoney(role);
    const end = this.parseDate(endIso) ?? new Date();
    const start = this.parseDate(startIso) ?? this.utcMidnight(end);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const lastWeekStart = new Date(start.getTime() - weekMs);
    const lastWeekEnd = new Date(end.getTime() - weekMs);

    const [today, lastWeek, feed] = await Promise.all([
      money
        ? this.toastService
            .getSalesData(restaurantId, start, end)
            .catch(() => null)
        : null,
      money
        ? this.toastService
            .getSalesData(restaurantId, lastWeekStart, lastWeekEnd)
            .catch(() => null)
        : null,
      this.getFeed(userId, restaurantId, role).catch(() => null),
    ]);

    const revenueToday = today?.totalRevenue ?? null;
    const revenueLastWeek = lastWeek?.totalRevenue ?? null;
    const deltaPct =
      revenueToday != null && revenueLastWeek != null && revenueLastWeek > 0
        ? Math.round(((revenueToday - revenueLastWeek) / revenueLastWeek) * 100)
        : null;

    return {
      ...(money
        ? {
            revenueToday,
            checksToday: today?.total ?? null,
            revenueLastWeek,
            deltaPct,
          }
        : {}),
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
