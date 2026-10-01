/**
 * The phone's Today screen serves the house's money only to owners and
 * managers (ADR 0253, "Answered 2026-10-01 (round 2)").
 *
 * The founder, verbatim, to "On the web, staff never see prices. The phone's
 * Today feed shows staff order amounts, approve cards and today's revenue.
 * Close that?": *"Close it to staff (Recommended)"*.
 *
 * Until this fix `GET /mobile/feed` and `GET /mobile/today-pulse` had no role
 * logic at all: every member of the house got the order-approval cards (with
 * the amount in `amount` and again in the subtitle) and tonight's revenue.
 *
 * WHY THROUGH THE CONTROLLER
 * --------------------------
 * The role is the caller's role IN THIS HOUSE, which `JwtStrategy.validate`
 * re-reads from `user_restaurant_access` on every request and puts on
 * `req.user.role` (ADR 0162). A service-only test would stay green if the
 * controller stopped handing that role over, so every case here enters at the
 * controller with the same `user` object the guard produces.
 *
 * WHAT IS NOT A MONEY ROLE
 * ------------------------
 * `owner` and `manager` see money; anything else does not. That includes a
 * role that is null (no role), absent, empty, or a string nobody has heard
 * of — the staff view is the direction a doubt fails to. A staff member
 * holding a live `vendor_send` grant is still staff here: the grant is read by
 * the send gate, not by this feed.
 */

import { MobileController } from "./mobile.controller";
import { MobileService } from "./mobile.service";

const HOUSE = "house-1";

const PENDING_ORDER = {
  id: "order-1",
  orderNumber: "PO-1001",
  wineName: "Barolo 2019",
  providerId: "vendor-1",
  totalCost: 1234,
  quantity: 6,
  unitType: "bottle",
  isEmergency: false,
  requestedAt: "2026-10-01T09:00:00.000Z",
  status: "pending",
};

const PENDING_DRAFT = {
  id: "conv-1",
  provider_id: "vendor-1",
  content: "Thank you, we confirm the delivery window for Thursday.",
  created_at: "2026-10-01T09:30:00.000Z",
  procurement_orders: { id: "order-0", order_number: "PO-1000" },
  manager_approval_status: "pending",
};

const VERIFY_DELIVERY = {
  id: "notif-1",
  type: "invoice_received",
  title: "Verify delivery: Chablis",
  message: "6 bottles stocked in.",
  priority: "critical",
  metadata: { orderId: "order-9", wineName: "Chablis", quantity: 6 },
  createdAt: "2026-10-01T08:00:00.000Z",
};

function build() {
  const procurementService = {
    listPendingOrders: jest.fn().mockResolvedValue([PENDING_ORDER]),
  };
  const conversationsService = {
    getPendingConversations: jest.fn().mockResolvedValue([PENDING_DRAFT]),
  };
  const notificationsService = {
    getUnreadNotifications: jest.fn().mockResolvedValue([VERIFY_DELIVERY]),
  };
  const toastService = {
    getSalesData: jest
      .fn()
      .mockResolvedValueOnce({ totalRevenue: 4210, total: 62 })
      .mockResolvedValueOnce({ totalRevenue: 3900, total: 58 }),
  };
  const databaseService = {
    supabase: {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [{ id: "vendor-1", name: "Cave Vendor" }],
            error: null,
          }),
        }),
      }),
    },
  };
  const service = new MobileService(
    databaseService as never,
    procurementService as never,
    conversationsService as never,
    notificationsService as never,
    toastService as never,
  );
  const controller = new MobileController(service, {} as never);
  return { controller, toastService };
}

const caller = (role: unknown) =>
  ({ userId: "user-1", restaurantId: HOUSE, role }) as never;

/** Every way a role can fail to be a money role. */
const NOT_MONEY_ROLES: Array<[string, unknown]> = [
  ["staff", "staff"],
  ["no role (null)", null],
  ["role absent (undefined)", undefined],
  ["an empty role", ""],
  ["a role nobody has heard of", "admin"],
  ["a mis-cased owner", "OWNER"],
];

describe("GET /mobile/feed — money only for owners and managers (ADR 0253 round 2)", () => {
  describe.each(["owner", "manager"])("a %s", (role) => {
    it("gets the order approve card with its amount, unchanged", async () => {
      const { controller } = build();
      const feed = await controller.getFeed(caller(role));

      const order = feed.items.find((i) => i.kind === "order_approval");
      expect(order).toBeDefined();
      expect(order!.amount).toBe(1234);
      expect(order!.subtitle).toContain("$1,234");
      expect(feed.counts.orderApprovals).toBe(1);
      expect(feed.counts.total).toBe(3);
    });
  });

  describe.each(NOT_MONEY_ROLES)("%s", (_label, role) => {
    it("gets no approve card, no amount and no order-approval count", async () => {
      const { controller } = build();
      const feed = await controller.getFeed(caller(role));

      expect(feed.items.some((i) => i.kind === "order_approval")).toBe(false);
      for (const item of feed.items) {
        // Absent, not null and not 0: an unknown is never a zero (ADR 0016,
        // ADR 0020), and a withheld figure is not "no amount".
        expect(Object.prototype.hasOwnProperty.call(item, "amount")).toBe(
          false,
        );
      }
      expect(
        Object.prototype.hasOwnProperty.call(feed.counts, "orderApprovals"),
      ).toBe(false);

      // Belt and braces: the figure appears nowhere in what goes on the wire.
      const wire = JSON.stringify(feed);
      expect(wire).not.toContain("1234");
      expect(wire).not.toContain("1,234");
    });

    it("still gets the cards that carry no money (vendor reply, delivery check)", async () => {
      const { controller } = build();
      const feed = await controller.getFeed(caller(role));

      expect(feed.items.map((i) => i.kind).sort()).toEqual([
        "draft_approval",
        "receipt_verification",
      ]);
      expect(feed.counts.total).toBe(2);
    });
  });
});

describe("GET /mobile/today-pulse — revenue only for owners and managers (ADR 0253 round 2)", () => {
  describe.each(["owner", "manager"])("a %s", (role) => {
    it("gets tonight's revenue, checks and the week-on-week delta, unchanged", async () => {
      const { controller } = build();
      const pulse = await controller.getTodayPulse(
        caller(role),
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T20:00:00.000Z",
      );

      expect(pulse.revenueToday).toBe(4210);
      expect(pulse.checksToday).toBe(62);
      expect(pulse.revenueLastWeek).toBe(3900);
      expect(pulse.deltaPct).toBe(8);
      expect(pulse.pendingDecisions).toBe(3);
    });
  });

  describe.each(NOT_MONEY_ROLES)("%s", (_label, role) => {
    it("gets no sales figures at all, and the sales read is never made", async () => {
      const { controller, toastService } = build();
      const pulse = await controller.getTodayPulse(
        caller(role),
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T20:00:00.000Z",
      );

      for (const key of [
        "revenueToday",
        "revenueLastWeek",
        "deltaPct",
        "checksToday",
      ]) {
        expect(Object.prototype.hasOwnProperty.call(pulse, key)).toBe(false);
      }
      expect(toastService.getSalesData).not.toHaveBeenCalled();
      const wire = JSON.stringify(pulse);
      expect(wire).not.toContain("4210");
      expect(wire).not.toContain("3900");
      // The decisions count is the caller's own cards, without the approve card.
      expect(pulse.pendingDecisions).toBe(2);
      expect(pulse.criticalCount).toBe(1);
    });
  });
});
