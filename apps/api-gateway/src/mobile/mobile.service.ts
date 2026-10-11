import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ProcurementService } from "../procurement/procurement.service";
import { ConversationsService } from "../conversations/conversations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { houseMoney, readHouseMoney } from "../common/house-money";
import { houseFrame } from "../common/house-frame";
import { holdsHouseMoney } from "../procurement/documents/document-money-gate";
import {
  localDateIn,
  localMidnight,
  shiftLocalDate,
} from "../notifications/producers/service-day";
import { zonedWallClockToUtc } from "../calendar/zoned-time";
import { houseWallAt } from "../notifications/low-stock-digest-clock";
import { readAll } from "../providers/vendor-menu-supply";
import {
  CHECK_LOOKBACK_MS,
  netSalesByHouseDay,
} from "../dashboard/dashboard.service";
import {
  DecisionKind,
  FeedItem,
  FeedPriority,
  FeedResponse,
  PulseSalesState,
  TodayPulseResponse,
} from "./dto/mobile.dto";

/** One window of the register's takings: net sales and checks, or unknown. */
interface WindowTakings {
  revenue: number | null;
  checks: number;
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
  ) {}

  async getFeed(
    userId: string,
    restaurantId: string,
    role?: string | null,
  ): Promise<FeedResponse> {
    // F-957: an order card's amount is the house's money (ADR 0145, DASH-W22).
    // A role that does not hold it gets the card, its wine, vendor and count,
    // and no figure, in the amount or in the line under the title.
    const withholdMoney = !holdsHouseMoney(role ?? null);
    // F-542: a collector that fails is an unknown, never an empty list. One
    // missing source would otherwise make the feed (and the Today strip's
    // count) read as "nothing needs you" with orders still waiting.
    const failed: string[] = [];
    const collect = <T>(name: string, p: Promise<T[]>): Promise<T[]> =>
      p.catch((e) => {
        this.logger.warn(`feed ${name} collector failed: ${e?.message}`);
        failed.push(name);
        return [] as T[];
      });
    const [orders, conversations, notifications, money] = await Promise.all([
      collect(
        "orders",
        this.procurementService.listPendingOrders(restaurantId),
      ),
      collect(
        "conversations",
        this.conversationsService.getPendingConversations(restaurantId),
      ),
      collect(
        "notifications",
        this.notificationsService.getUnreadNotifications({
          userId,
          restaurantId,
          limit: 40,
        }),
      ),
      // The house's own money for the order amounts (F-341), grouped by its
      // own mark (F-866); null prints the figure with no symbol, never as
      // dollars.
      readHouseMoney(this.databaseService.supabase, restaurantId),
    ]);
    if (failed.length > 0) {
      throw new ServiceUnavailableException(
        `Today's list could not be read in full (${failed.join(", ")}). Try again in a moment.`,
      );
    }

    const providerNames = await this.resolveProviderNames([
      ...orders.map((o: any) => o.providerId),
      ...conversations.map((c: any) => c.provider_id),
    ]);

    const items: FeedItem[] = [];

    for (const order of orders as any[]) {
      const amount = withholdMoney
        ? null
        : (order.totalCost ??
          order.finalPrice ??
          order.negotiatedPrice ??
          order.quotedPrice ??
          null);
      items.push(
        this.makeItem({
          kind: "order_approval",
          entityId: order.id,
          title: order.wineName
            ? `Approve order: ${order.wineName}`
            : `Approve ${order.orderNumber ?? "order"}`,
          subtitle: this.orderSubtitle(
            order,
            providerNames,
            money,
            withholdMoney,
          ),
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

    // F-982 (coordinator call S144): a drafted letter's words name prices. A
    // non-holder keeps them only while they may send to vendors (ADR 0175 D10
    // grantee), since a letter they approve is one they must read. The
    // standing is read only when it matters; one that cannot be read keeps
    // nothing (the readout reports it unreadable, never "may send").
    const withholdWords =
      withholdMoney &&
      conversations.length > 0 &&
      !(await this.procurementService.sendOrAskFor(userId, restaurantId))
        .maySend;

    for (const conv of conversations as any[]) {
      const providerName =
        conv.providers?.name ?? providerNames.get(conv.provider_id) ?? null;
      const draft =
        !withholdWords && typeof conv.content === "string"
          ? conv.content
          : null;
      items.push(
        this.makeItem({
          kind: "draft_approval",
          entityId: conv.id,
          title: providerName
            ? `Reply ready for ${providerName}`
            : "Vendor reply ready",
          subtitle: withholdWords
            ? "A reply is drafted. Its words name prices, so an owner or a manager reads it."
            : draft
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
            ...(withholdWords ? { wordsWithheld: true } : {}),
          },
        }),
      );
    }

    for (const n of notifications as any[]) {
      const meta = n.metadata ?? n.meta ?? {};
      const notifOrderId = meta.orderId ?? null;
      const type = n.type ?? "";

      // F-349. A delivery discrepancy is filed as `invoice_received` too
      // (procurement.service.ts verifyReceipt), but it is news about a check
      // already made, not a delivery to check. As a receipt_verification card
      // its "Counts match" completed the order over its backorder and owed
      // invoice. Only the discrepancy notice carries `matchStatus`, so rows
      // already in the inbox change kind as well as new ones.
      if (type === "invoice_received" && meta.matchStatus != null) {
        items.push(
          this.makeItem({
            kind: "receipt_discrepancy",
            entityId: notifOrderId ?? n.id,
            title: n.title ?? "Delivery discrepancy",
            subtitle:
              n.message ??
              "The delivery did not match the order or the invoice.",
            quantity: meta.backorderQty ?? null,
            priority: "critical",
            createdAt: n.createdAt ?? n.created_at ?? new Date().toISOString(),
            orderId: notifOrderId,
            notificationId: n.id,
            meta,
          }),
        );
        continue;
      }

      // F-372. A notice with no order id has no delivery to verify: its
      // "Counts match" would post to /verify-receipt on an undefined id. It
      // falls through to an informational alert instead.
      if (type === "invoice_received" && notifOrderId) {
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
      ...(withholdMoney ? { amountsWithheld: true as const } : {}),
    };
  }

  /**
   * Sales snapshot for the pulse strip (F-674). It reads the same register
   * rows as the web dashboard — `pos_checks`, not voided, net `subtotal`,
   * filed on the HOUSE's day in its own zone (`netSalesByHouseDay`) — so the
   * phone's "Tonight" and the web's today are one number. The phone's own
   * midnight is no longer used: an owner away in another zone still sees the
   * house's night.
   *
   * `salesState` says why a figure is missing: `no_register` (the house's
   * register has never sent a check), `zone_unset` (no house day to file
   * on), `unread` (the read failed). A failed read is never "connect a POS".
   */
  async getTodayPulse(
    userId: string,
    restaurantId: string,
    now: Date = new Date(),
  ): Promise<TodayPulseResponse> {
    const [sales, feed, house] = await Promise.all([
      this.readTonightSales(restaurantId, now).catch((e) => {
        this.logger.warn(`pulse sales read failed: ${e?.message}`);
        return null;
      }),
      this.getFeed(userId, restaurantId).catch(() => null),
      // The phone prints every money figure in these (F-885); never throws.
      readHouseMoney(this.databaseService.supabase, restaurantId),
    ]);

    const salesState: PulseSalesState = sales?.state ?? "unread";
    const revenueToday = sales?.today?.revenue ?? null;
    const revenueLastWeek = sales?.lastWeek?.revenue ?? null;
    const deltaPct =
      revenueToday != null && revenueLastWeek != null && revenueLastWeek > 0
        ? Math.round(((revenueToday - revenueLastWeek) / revenueLastWeek) * 100)
        : null;

    return {
      salesState,
      revenueToday,
      checksToday: sales?.today ? sales.today.checks : null,
      revenueLastWeek,
      deltaPct,
      // null = the feed could not be read; the strip must not say "All clear".
      pendingDecisions: feed ? feed.counts.total : null,
      criticalCount: feed
        ? feed.items.filter((i) => i.priority === "critical").length
        : null,
      windowStart: sales?.windowStart ?? null,
      windowEnd: now.toISOString(),
      generatedAt: new Date().toISOString(),
      currency: house.currency,
      locale: house.locale,
      timezone: house.zone,
    };
  }

  /**
   * Tonight so far, and the same stretch of the same weekday last week, from
   * the house's register. Throws when a read fails.
   */
  private async readTonightSales(
    restaurantId: string,
    now: Date,
  ): Promise<{
    state: PulseSalesState;
    today: WindowTakings | null;
    lastWeek: WindowTakings | null;
    windowStart: string | null;
  }> {
    const client: any = this.databaseService.supabase;
    const house = await client
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .limit(1);
    if (house.error) {
      throw new Error(`restaurants read failed: ${house.error.message}`);
    }
    const zone = houseFrame(house.data?.[0] ?? null).zone;
    if (!zone) {
      return {
        state: "zone_unset",
        today: null,
        lastWeek: null,
        windowStart: null,
      };
    }

    const today = localDateIn(now, zone);
    const start = localMidnight(today, zone);
    const lastWeekDay = shiftLocalDate(today, -7);
    const lastWeekStart = localMidnight(lastWeekDay, zone);
    // The same wall-clock time on last week's day, not the same elapsed
    // hours: in a clock-change week those differ by an hour (F-1363).
    const { minutes } = houseWallAt(now, zone);
    const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
      minutes % 60,
    ).padStart(2, "0")}`;
    const lastWeekEnd = new Date(
      zonedWallClockToUtc(lastWeekDay, hhmm, zone).getTime() +
        (now.getTime() % 60_000),
    );

    const checksBetween = (what: string, from: Date, to: Date) =>
      readAll(what, (after) => {
        let q = client
          .from("pos_checks")
          .select("id, subtotal, opened_at, closed_at")
          .eq("restaurant_id", restaurantId)
          .eq("voided", false)
          .gte(
            "opened_at",
            new Date(from.getTime() - CHECK_LOOKBACK_MS).toISOString(),
          )
          .lt("opened_at", to.toISOString());
        if (after) q = q.gt("id", after);
        return q;
      });

    const [todayRows, lastWeekRows, first] = await Promise.all([
      checksBetween("Tonight's checks", start, now),
      checksBetween("Last week's checks", lastWeekStart, lastWeekEnd),
      // Has this house's register ever sent a check? Without one, a missing
      // figure means "no register yet", not "a quiet night".
      client
        .from("pos_checks")
        .select("opened_at")
        .eq("restaurant_id", restaurantId)
        .limit(1),
    ]);
    if (first.error) {
      throw new Error(`pos_checks read failed: ${first.error.message}`);
    }
    if (!first.data || first.data.length === 0) {
      return {
        state: "no_register",
        today: null,
        lastWeek: null,
        windowStart: start.toISOString(),
      };
    }

    const takings = (
      rows: ReadonlyArray<Record<string, unknown>>,
      day: string,
      until: Date,
    ): WindowTakings => {
      const inWindow = rows.filter((r) => {
        const at = (r.closed_at || r.opened_at) as string | null;
        return !!at && new Date(at).getTime() <= until.getTime();
      });
      const fold = netSalesByHouseDay(inWindow, zone).get(day);
      // A day with no check is a measured zero: the register is connected.
      return fold
        ? { revenue: fold.net_sales, checks: fold.checks }
        : { revenue: 0, checks: 0 };
    };

    return {
      state: "known",
      today: takings(todayRows, today, now),
      lastWeek: takings(lastWeekRows, lastWeekDay, lastWeekEnd),
      windowStart: start.toISOString(),
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
      case "receipt_discrepancy":
        base = 90;
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
    house: { currency: string | null; locale: string | null },
    withholdMoney = false,
  ): string {
    const parts: string[] = [];
    if (order.quantity) {
      parts.push(
        `${order.quantity} ${order.unitType === "case" ? "cases" : "bottles"}`,
      );
    }
    const provider = providerNames.get(order.providerId);
    if (provider) parts.push(provider);
    const amount = withholdMoney
      ? null
      : (order.totalCost ??
        order.finalPrice ??
        order.negotiatedPrice ??
        order.quotedPrice);
    if (amount != null)
      parts.push(
        houseMoney(amount, order.currency ?? house.currency, {
          locale: house.locale,
        }),
      );
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

}
