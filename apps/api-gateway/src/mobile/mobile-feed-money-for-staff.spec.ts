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

import { Logger } from "@nestjs/common";
import { MobileController } from "./mobile.controller";
import {
  MobileService,
  MONEY_FREE_NOTIFICATION_TYPES,
  NON_MONEY_META_KEYS,
} from "./mobile.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OWN_WAGE_ACTION, recordOwnWageChange } from "../team/own-wage-notice";

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

function build(notifications: unknown[] = [VERIFY_DELIVERY]) {
  const procurementService = {
    listPendingOrders: jest.fn().mockResolvedValue([PENDING_ORDER]),
  };
  const conversationsService = {
    getPendingConversations: jest.fn().mockResolvedValue([PENDING_DRAFT]),
  };
  const notificationsService = {
    getUnreadNotifications: jest.fn().mockResolvedValue(notifications),
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

/**
 * What goes on the wire, less the two values the clock writes: `score` (an
 * age nudge with a long fractional part) and `generatedAt`. Left in,
 * a figure search would fail at random whenever the clock's digits spelled one.
 */
function wire(body: object): string {
  return JSON.stringify(body, (key, value) =>
    key === "score" || key === "generatedAt" ? undefined : value,
  );
}

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
      const onTheWire = wire(feed);
      expect(onTheWire).not.toContain("1234");
      expect(onTheWire).not.toContain("1,234");
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

/**
 * NOTIFICATION CARDS
 * ------------------
 * The feed also turns the caller's unread notifications into cards, and those
 * rows are written by many writers, several of them to every member of the
 * house (`NotificationsService.persistForRestaurant`, and the producers'
 * whole-house audience). Before this round a card's subtitle was the row's
 * `message` and its `meta` was the row's whole `metadata`, so a staff member
 * read "62 checks, $6,123.45." off a sale record. Each fixture below has the
 * shape its writer produces (cited), with figures picked so a leak is findable
 * on the wire.
 */

/** `sale-record.producer.ts:162-195` — to every member of the house. */
const SERVICE_CLOSED = {
  id: "notif-sale",
  type: "service_closed",
  title: "Service record for 2026-09-30",
  message:
    "62 checks, $6,123.45. 140 covers. Best seller by revenue: Sancerre 2022, 12 sold for $871.50.",
  priority: "low",
  metadata: {
    serviceDate: "2026-09-30",
    checks: 62,
    revenue: 6123.45,
    currency: "USD",
    covers: 140,
    checksWithoutCovers: 0,
    topItem: { name: "Sancerre 2022", qty: 12, revenue: 871.5 },
    revenueBasis: "sum of pos_checks.total where voided = false",
    timeZone: "America/New_York",
  },
  createdAt: "2026-10-01T04:00:00.000Z",
};

/** `invoice-confirmed.producer.ts:149-185` — to every member of the house. */
const INVOICE_CERTIFIED = {
  id: "notif-invoice",
  type: "invoice_received",
  title: "Invoice INV-77 certified — Cave Vendor",
  message:
    "$2,981.25 from Cave Vendor. The lines do not tie out: $35.75 apart from the stated total.",
  priority: "medium",
  metadata: {
    documentId: "doc-77",
    docType: "invoice",
    docNumber: "INV-77",
    providerId: "vendor-1",
    vendorName: "Cave Vendor",
    total: 2981.25,
    currency: "USD",
    tiesOut: false,
    tieOutDelta: 35.75,
  },
  createdAt: "2026-10-01T05:00:00.000Z",
};

/** `procurement.service.ts:6866-6886` — to every member of the house. */
const DELIVERY_DISCREPANCY = {
  id: "notif-discrepancy",
  type: "invoice_received",
  title: "Delivery discrepancy: Chablis",
  message: "Billed $31.25 against an agreed $28.00.",
  priority: "critical",
  metadata: {
    orderId: "order-9",
    inventoryId: "inv-9",
    matchStatus: "price_mismatch",
    backorderQty: 0,
    creditDue: 191.5,
    effectiveUnitCost: 31.25,
    providerId: "vendor-1",
  },
  createdAt: "2026-10-01T06:00:00.000Z",
};

/** `goal-reached.producer.ts:178-215`, a currency goal — to every member. */
const GOAL_REACHED = {
  id: "notif-goal",
  type: "goal_reached",
  title: "September revenue reached its target",
  message: "Revenue stands at $52,517.00 against a target of $50,013.00.",
  priority: "medium",
  metadata: {
    goalId: "goal-1",
    metricKey: "revenue",
    unit: "currency",
    target: 50013,
    current: 52517,
  },
  createdAt: "2026-10-01T07:00:00.000Z",
};

/**
 * `market-price.producer.ts:232-282`. Written to owners and managers only, but
 * a row written before a demotion stays in the demoted member's unread list.
 */
const PRICE_CHANGE = {
  id: "notif-price",
  type: "price_change",
  title: "Barolo 2019 is 19% below its 30-day average",
  message:
    "Cave Vendor is quoting $41.37 for Barolo 2019, against a 30-day average of $50.83 across 4 earlier sightings.",
  priority: "low",
  metadata: {
    productKey: "barolo-2019",
    productName: "Barolo 2019",
    currency: "USD",
    latestPrice: 41.37,
    averagePrice: 50.83,
    absoluteBelow: 9.46,
    fractionBelow: 0.186,
  },
  createdAt: "2026-10-01T07:30:00.000Z",
};

/**
 * `own-wage-notice.ts` `recordOwnWageChange`, owners only. Since 2026-10-01 it
 * has its own type (the founder: "Give wages its own type (Recommended)"); the
 * writer test below checks this fixture against what the writer really writes.
 */
const OWN_WAGE = {
  id: "notif-wage",
  type: "team_member_own_wage_set",
  title: "Dana set their own wage",
  message:
    "Dana changed their own hourly wage on Team from 18.35 USD to 21.65 USD. A manager you allowed to see pay may do this; every wage change is kept with who made it.",
  priority: "high",
  metadata: {
    action: "team_member_own_wage_set",
    member_id: "member-1",
    hourly_wage: { from: 18.35, to: 21.65 },
    currency: "USD",
  },
  createdAt: "2026-10-01T08:00:00.000Z",
};

/**
 * The same notice as written before 2026-10-01, under the shared `system`
 * type. It reaches a non-money role as an owner later demoted in the house;
 * `system` is money-free now, so only its metadata keeps it quiet.
 */
const OWN_WAGE_STORED_AS_SYSTEM = {
  id: "notif-wage-old",
  type: "system",
  title: "Lee set their own wage",
  message:
    "Lee changed their own hourly wage on Team from 17.15 USD to 20.45 USD. A manager you allowed to see pay may do this; every wage change is kept with who made it.",
  priority: "high",
  metadata: {
    action: "team_member_own_wage_set",
    member_id: "member-2",
    hourly_wage: { from: 17.15, to: 20.45 },
    currency: "USD",
  },
  createdAt: "2026-09-29T08:00:00.000Z",
};

/**
 * `authority-grants.service.ts` `tell()`: every owner and the grantee get the
 * same sentence with the grant's limit, and the row carries no grantee id
 * (`metadata: { grantId, change }`). Kept quiet for every non-money role
 * until the grantee can be told apart from someone else reading it.
 */
const GRANT_ISSUED = {
  id: "notif-grant",
  type: "authority_grant_issued",
  title: "Sam may now send to vendors",
  message:
    "Ava named Sam to send to vendors with one hold (up to 4321.5 USD, until revoked). A security change: every owner is told.",
  priority: "low",
  metadata: { grantId: "grant-1", change: "issued" },
  createdAt: "2026-10-01T08:20:00.000Z",
};

/** `promotion-extractor.service.ts:242-277` — owners and managers. */
const PROMO_DIGEST = {
  id: "notif-promo",
  type: "promo_digest",
  title: "2 vendor deals today",
  message: "Cave Vendor — $45.50 off",
  priority: "low",
  metadata: { count: 2 },
  createdAt: "2026-10-01T08:10:00.000Z",
};

/** A type no writer uses yet: a new writer's money must not pass by default. */
const FUTURE_TYPE = {
  id: "notif-future",
  type: "spend_forecast",
  title: "Next week's spend",
  message: "Expect $7,777.00 of spend next week.",
  priority: "medium",
  metadata: { orderId: "order-7", spend: 7777, budgetLeft: 1313 },
  createdAt: "2026-10-01T08:30:00.000Z",
};

/**
 * Money-free from both of its writers: `notifications.service.ts:418-431` and
 * `delivery-recorded.producer.ts:154-190`.
 */
const DELIVERY_ARRIVED = {
  id: "notif-arrived",
  type: "order_delivered",
  title: "Delivery arrived: Chablis",
  message: "6 bottles of Chablis from Cave Vendor",
  priority: "medium",
  metadata: {
    orderId: "order-8",
    wineName: "Chablis",
    quantity: 6,
    provider: "Cave Vendor",
  },
  createdAt: "2026-10-01T09:15:00.000Z",
};

/**
 * `system` rows, money-free from every writer (re-read 2026-10-01):
 * `schedule.service.ts:549-558`, `team.controller.ts:619-628` (a team message
 * in its author's words) and `access-audit.ts:122-138` from
 * `members.service.ts:299-311`.
 */
const SCHEDULE_PUBLISHED = {
  id: "notif-schedule",
  type: "system",
  title: "Schedule published",
  message: "The week of 2026-10-05 is live. Open it to see your shifts.",
  priority: "high",
  metadata: { scheduleId: "schedule-1", weekStart: "2026-10-05" },
  createdAt: "2026-10-01T09:20:00.000Z",
};
const TEAM_MESSAGE = {
  id: "notif-broadcast",
  type: "system",
  title: "Team broadcast",
  message: "Inventory count moves to Thursday afternoon.",
  priority: "high",
  metadata: {},
  createdAt: "2026-10-01T09:25:00.000Z",
};
const ROLE_CHANGED = {
  id: "notif-role",
  type: "system",
  title: "Your role in this restaurant changed",
  message:
    "An owner changed your role to staff. What you can see and do here has changed with it.",
  priority: "high",
  metadata: {
    action: "member_role_changed",
    changes: { role: { from: "manager", to: "staff" } },
  },
  createdAt: "2026-10-01T09:28:00.000Z",
};
const SYSTEM_NOTICES = [SCHEDULE_PUBLISHED, TEAM_MESSAGE, ROLE_CHANGED];

const MONEY_NOTIFICATIONS = [
  SERVICE_CLOSED,
  INVOICE_CERTIFIED,
  DELIVERY_DISCREPANCY,
  GOAL_REACHED,
  PRICE_CHANGE,
  OWN_WAGE,
  OWN_WAGE_STORED_AS_SYSTEM,
  GRANT_ISSUED,
  PROMO_DIGEST,
  FUTURE_TYPE,
];
const ALL_NOTIFICATIONS = [
  ...MONEY_NOTIFICATIONS,
  DELIVERY_ARRIVED,
  ...SYSTEM_NOTICES,
];

/** Every figure above, as it could appear on the wire. */
const MONEY_ON_THE_WIRE = [
  "6123",
  "6,123",
  "871.5",
  "2981",
  "2,981",
  "35.75",
  "31.25",
  "28.00",
  "191.5",
  "52517",
  "52,517",
  "50013",
  "50,013",
  "41.37",
  "50.83",
  "9.46",
  "7777",
  "7,777",
  "1313",
  "18.35",
  "21.65",
  "17.15",
  "20.45",
  "4321",
  "45.50",
  "$",
];

/** Every money key the fixtures carry. */
const MONEY_KEYS = [
  "revenue",
  "topItem",
  "revenueBasis",
  "total",
  "tieOutDelta",
  "currency",
  "creditDue",
  "effectiveUnitCost",
  "target",
  "current",
  "latestPrice",
  "averagePrice",
  "absoluteBelow",
  "fractionBelow",
  "spend",
  "budgetLeft",
  "hourly_wage",
];

describe("GET /mobile/feed — notification cards carry no money to staff (ADR 0253 round 2)", () => {
  it("keeps every type a writer fills with money or someone else's words off the money-free list", () => {
    for (const type of [
      "service_closed",
      "invoice_received",
      "goal_reached",
      "price_change",
      "price_index_upload",
      "promo_digest",
      "delivery_proposal",
      "authority_grant_issued",
      "authority_grant_reapproved",
      "team_member_own_wage_set",
      "system_alert",
      "deal",
      "order_verification",
      "vendor_reply",
      "vendor_deal_declined",
      "vendor_letter_declined",
    ]) {
      expect(MONEY_FREE_NOTIFICATION_TYPES.has(type)).toBe(false);
    }
  });

  it("has `system` on the money-free list, now that the wage notice has its own type", () => {
    expect(MONEY_FREE_NOTIFICATION_TYPES.has("system")).toBe(true);
    expect(OWN_WAGE_ACTION).toBe("team_member_own_wage_set");
    expect(MONEY_FREE_NOTIFICATION_TYPES.has(OWN_WAGE_ACTION)).toBe(false);
  });

  it("the own-wage writer files its notice under its own type, with the action the feed recognises", async () => {
    const inserted: Array<{ table: string; row: any }> = [];
    const sb = {
      from: (table: string) => ({
        insert: async (row: any) => {
          inserted.push({ table, row });
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => ({ data: [{ user_id: "owner-1" }], error: null }),
            }),
          }),
        }),
      }),
    };
    const receipt = await recordOwnWageChange(sb, new Logger("spec"), {
      restaurantId: HOUSE,
      actorUserId: "user-manager",
      memberId: "member-1",
      displayName: "Dana",
      before: 18.35,
      after: 21.65,
      currency: "USD",
    });
    expect(receipt.ownersNotified).toBe(1);
    const notices = inserted.filter((i) => i.table === "notifications");
    expect(notices).toHaveLength(1);
    const row = notices[0].row;
    expect(row.type).toBe("team_member_own_wage_set");
    expect(row.notification_type).toBe("team_member_own_wage_set");
    // The fixture above is what the writer writes, not a guess at it.
    expect(row.title).toBe(OWN_WAGE.title);
    expect(row.message).toBe(OWN_WAGE.message);
    expect(row.metadata).toEqual(OWN_WAGE.metadata);
  });

  it("the system-alert sender files its caller's words as `system_alert`, never `system`", async () => {
    const service = Object.create(NotificationsService.prototype) as any;
    service.sendToRestaurant = jest.fn().mockResolvedValue(undefined);
    service.persistForRestaurant = jest
      .fn()
      .mockResolvedValue({ inserted: 1, ids: ["n-1"] });
    await service.sendSystemAlert({
      restaurantId: HOUSE,
      title: "Payroll export",
      message: "Payroll this week is $9,999.",
      severity: "info",
    });
    expect(service.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(service.persistForRestaurant.mock.calls[0][1].type).toBe(
      "system_alert",
    );
  });

  describe.each(["owner", "manager"])("a %s", (role) => {
    it("gets every notification's own message and whole metadata, unchanged", async () => {
      const { controller } = build(ALL_NOTIFICATIONS);
      const feed = await controller.getFeed(caller(role));

      for (const n of ALL_NOTIFICATIONS) {
        const card = feed.items.find((i) => i.notificationId === n.id);
        expect(card).toBeDefined();
        expect(card!.title).toBe(n.title);
        expect(card!.subtitle).toBe(n.message);
        // The very object the row carried, not a copy and not a cut.
        expect(card!.meta).toBe(n.metadata);
      }
    });
  });

  describe.each(NOT_MONEY_ROLES)("%s", (_label, role) => {
    it("gets no notification's money, in the subtitle, in meta or anywhere on the wire", async () => {
      const { controller } = build(ALL_NOTIFICATIONS);
      const feed = await controller.getFeed(caller(role));

      const cards = feed.items.filter((i) => i.notificationId !== null);
      expect(cards).toHaveLength(ALL_NOTIFICATIONS.length);
      for (const card of cards) {
        for (const key of Object.keys(card.meta)) {
          expect(NON_MONEY_META_KEYS.has(key)).toBe(true);
        }
        for (const key of MONEY_KEYS) {
          expect(Object.prototype.hasOwnProperty.call(card.meta, key)).toBe(
            false,
          );
        }
      }
      const onTheWire = wire(feed);
      for (const figure of MONEY_ON_THE_WIRE) {
        expect(onTheWire).not.toContain(figure);
      }
    });

    it("gets the neutral line, not the message, for every type not known to be money-free", async () => {
      const { controller } = build(MONEY_NOTIFICATIONS);
      const feed = await controller.getFeed(caller(role));

      const subtitle = (id: string) =>
        feed.items.find((i) => i.notificationId === id)!.subtitle;
      expect(subtitle(SERVICE_CLOSED.id)).toBe("");
      expect(subtitle(GOAL_REACHED.id)).toBe("");
      expect(subtitle(PRICE_CHANGE.id)).toBe("");
      expect(subtitle(FUTURE_TYPE.id)).toBe("");
      expect(subtitle(OWN_WAGE.id)).toBe("");
      expect(subtitle(OWN_WAGE_STORED_AS_SYSTEM.id)).toBe("");
      expect(subtitle(GRANT_ISSUED.id)).toBe("");
      expect(subtitle(PROMO_DIGEST.id)).toBe("");
      expect(subtitle(INVOICE_CERTIFIED.id)).toBe(
        "Confirm the physical count against the invoice.",
      );
      expect(subtitle(DELIVERY_DISCREPANCY.id)).toBe(
        "Confirm the physical count against the invoice.",
      );
    });

    it("keeps a money-free type's message and the non-money keys", async () => {
      const { controller } = build([DELIVERY_ARRIVED, DELIVERY_DISCREPANCY]);
      const feed = await controller.getFeed(caller(role));

      const arrived = feed.items.find(
        (i) => i.notificationId === DELIVERY_ARRIVED.id,
      )!;
      expect(arrived.subtitle).toBe("6 bottles of Chablis from Cave Vendor");
      expect(arrived.meta).toEqual({
        orderId: "order-8",
        wineName: "Chablis",
        quantity: 6,
      });
      const discrepancy = feed.items.find(
        (i) => i.notificationId === DELIVERY_DISCREPANCY.id,
      )!;
      expect(discrepancy.meta).toEqual({ orderId: "order-9" });
      expect(discrepancy.orderId).toBe("order-9");
    });

    it("gets a `system` notice's own sentence, and none of its metadata", async () => {
      const { controller } = build(SYSTEM_NOTICES);
      const feed = await controller.getFeed(caller(role));

      for (const n of SYSTEM_NOTICES) {
        const card = feed.items.find((i) => i.notificationId === n.id)!;
        expect(card.title).toBe(n.title);
        expect(card.subtitle).toBe(n.message);
        expect(card.meta).toEqual({});
      }
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
      const onTheWire = wire(pulse);
      expect(onTheWire).not.toContain("4210");
      expect(onTheWire).not.toContain("3900");
      // The decisions count is the caller's own cards, without the approve card.
      expect(pulse.pendingDecisions).toBe(2);
      expect(pulse.criticalCount).toBe(1);
    });
  });
});
