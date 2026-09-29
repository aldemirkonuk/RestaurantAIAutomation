import { Logger } from "@nestjs/common";
import { WebsocketGateway, memberRoom } from "./websocket.gateway";
import { PromotionExtractorService } from "../common/orchestrator/promotion-extractor.service";
import { InboundResponderService } from "../common/orchestrator/inbound-responder.service";
import {
  NOTIFICATION_AUDIENCE_BY_KEY,
  RabbitMqBridgeService,
} from "../common/orchestrator/rabbitmq-bridge.service";
import { NotificationsService } from "../notifications/notifications.service";
import { safeActionPath } from "../notifications/safe-action-path";

/**
 * Owner/manager-only content never reaches a staff socket
 * (fix/websocket-role-gate, 2026-09-28; ADR 0090 security review of PR #493).
 *
 * Before this fix, every verified member's socket joined `restaurant:<id>`,
 * and the promotions toast, the daily promotions digest and the orchestrator's
 * `notification.promo_alert` were all broadcast there. So staff received the
 * vendor names and discounts that GET /promotions refuses them
 * (`promotions.controller.ts`, ADR 0124:357-362). The web renders the toast
 * with no role check, and filtering on the client would not help anyway,
 * because the payload has already arrived (web `lib/websocket.tsx` logs it).
 *
 * These cases drive the real gateway (`handleConnection`, the real room
 * joins), the real `PromotionExtractorService`, the real bridge handler and
 * the real `persistManagerNotification`, over a fake socket.io Namespace that
 * delivers by room membership, the way socket.io does. What a socket
 * "received" is exactly what the Namespace delivered to its rooms.
 */

const HOUSE = "house-A";
const OTHER_HOUSE = "house-B";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";

type Row = Record<string, any>;

/** An in-memory store with the operators these paths call. */
function makeStore(tables: Record<string, Row[]>) {
  const failures: Record<string, string> = {};
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let limitTo: number | null = null;
    let insertRows: Row[] | null = null;
    const run = () => {
      if (failures[table]) {
        return { data: null, error: { message: failures[table] } };
      }
      if (insertRows) {
        const rows = insertRows.map((r, i) => ({
          id: `${table}-${(tables[table]?.length ?? 0) + i + 1}`,
          ...r,
        }));
        (tables[table] ??= []).push(...rows);
        return { data: rows, error: null };
      }
      let rows = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (limitTo !== null) rows = rows.slice(0, limitTo);
      return { data: rows, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (rows: Row | Row[]) => {
        insertRows = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      eq: (c: string, v: any) => {
        filters.push((r) => r[c] === v);
        return b;
      },
      ilike: (c: string, v: string) => {
        filters.push(
          (r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase(),
        );
        return b;
      },
      in: (c: string, vs: any[]) => {
        filters.push((r) => vs.includes(r[c]));
        return b;
      },
      gte: (c: string, v: any) => {
        filters.push((r) => r[c] >= v);
        return b;
      },
      contains: (c: string, obj: Row) => {
        filters.push((r) =>
          Object.entries(obj).every(([k, v]) => r[c]?.[k] === v),
        );
        return b;
      },
      limit: (n: number) => {
        limitTo = n;
        return b;
      },
      single: async () => {
        const res = run();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      maybeSingle: async () => {
        const res = run();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  };
  return { supabase: { from }, tables, failures };
}

interface FakeSocket {
  id: string;
  userId: string;
  rooms: Set<string>;
  received: Array<{ event: string; payload: any }>;
  handshake: any;
  join: (room: string) => void;
  leave: (room: string) => void;
  emit: jest.Mock;
  disconnect: jest.Mock;
}

/**
 * A socket.io Namespace, reduced to delivery by room. `to(rooms)` delivers
 * once to every socket in ANY of the rooms, and `in(room).socketsLeave(r)`
 * takes every socket in `room` out of `r`, as socket.io 4 does.
 */
class FakeNamespace {
  sockets = new Map<string, FakeSocket>();
  roomsAddressed: string[][] = [];

  to(rooms: string | string[]) {
    const list = Array.isArray(rooms) ? rooms : [rooms];
    this.roomsAddressed.push(list);
    return {
      emit: (event: string, payload: any) => {
        for (const s of this.sockets.values()) {
          if (list.some((r) => s.rooms.has(r))) {
            s.received.push({ event, payload });
          }
        }
        return true;
      },
    };
  }

  in(room: string) {
    return {
      socketsLeave: (leave: string) => {
        for (const s of this.sockets.values()) {
          if (s.rooms.has(room)) s.rooms.delete(leave);
        }
      },
    };
  }
}

function membership(userId: string, role: string, restaurantId = HOUSE): Row {
  return {
    id: `ura-${userId}-${restaurantId}`,
    user_id: userId,
    restaurant_id: restaurantId,
    role,
    is_active: true,
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: null,
  };
}

function world() {
  const store = makeStore({
    users: [OWNER, MANAGER, STAFF].map((u) => ({
      user_id: u,
      session_version: 0,
    })),
    user_restaurant_access: [
      membership(OWNER, "owner"),
      membership(MANAGER, "manager"),
      membership(STAFF, "staff"),
    ],
    notifications: [],
    provider_promotions: [],
    restaurant_inventory: [],
    providers: [],
  });
  const jwtService = {
    verify: jest.fn((token: string) => {
      const [sub, restaurantId] = token.split("@");
      return { sub, restaurantId };
    }),
  } as any;
  const configService = { get: jest.fn(() => "test-secret") } as any;
  const databaseService = { supabase: store.supabase } as any;
  const gateway = new WebsocketGateway(
    jwtService,
    configService,
    databaseService,
  );
  const ns = new FakeNamespace();
  (gateway as any).server = ns;

  const connect = async (userId: string, restaurantId = HOUSE) => {
    const s: FakeSocket = {
      id: `sock-${userId}-${ns.sockets.size + 1}`,
      userId,
      rooms: new Set(),
      received: [],
      handshake: {
        auth: { token: `${userId}@${restaurantId}` },
        headers: {},
        query: {},
      },
      join(room: string) {
        this.rooms.add(room);
      },
      leave(room: string) {
        this.rooms.delete(room);
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    ns.sockets.set(s.id, s);
    await gateway.handleConnection(s as any);
    return s;
  };

  const responder = Object.create(
    InboundResponderService.prototype,
  ) as InboundResponderService;
  (responder as any).databaseService = databaseService;
  (responder as any).logger = new Logger("InboundResponderService(spec)");

  return { store, gateway, ns, connect, databaseService, responder };
}

function notificationsTo(s: FakeSocket) {
  return s.received.filter((r) => r.event === "notification:new");
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

describe("owner/manager-only notices reach no staff socket", () => {
  it("the daily promotions digest reaches the owner and the manager, and neither the staff socket nor a staff inbox row", async () => {
    const w = world();
    const owner = await w.connect(OWNER);
    const manager = await w.connect(MANAGER);
    const staff = await w.connect(STAFF);
    w.store.tables.provider_promotions.push({
      restaurant_id: HOUSE,
      promo_type: "volume_discount",
      discount_value: { percent: 15 },
      providers: { name: "Vintner Select" },
      created_at: new Date().toISOString(),
      is_active: true,
      conditions: { priority: "digest" },
    });

    const extractor = new PromotionExtractorService(
      w.databaseService,
      w.gateway,
      w.responder,
    );
    await extractor.sendDailyDigests();
    await settle();

    for (const s of [owner, manager]) {
      const got = notificationsTo(s);
      expect(got).toHaveLength(1);
      expect(got[0].payload.data.message).toContain("Vintner Select — 15% off");
    }
    expect(notificationsTo(staff)).toHaveLength(0);

    const rowsFor = w.store.tables.notifications
      .filter((r) => r.type === "promo_digest")
      .map((r) => r.user_id)
      .sort();
    expect(rowsFor).toEqual([MANAGER, OWNER].sort());
  });

  it("a promotion toast from an inbound vendor email reaches the owner and the manager only, and links to /promotions", async () => {
    const w = world();
    const owner = await w.connect(OWNER);
    const manager = await w.connect(MANAGER);
    const staff = await w.connect(STAFF);
    w.store.tables.restaurant_inventory.push({
      restaurant_id: HOUSE,
      wine_name: "Sancerre",
    });

    const extractor = new PromotionExtractorService(
      w.databaseService,
      w.gateway,
      w.responder,
    );
    const outcome = await extractor.extractAndStore({
      conversationId: "conv-1",
      restaurantId: HOUSE,
      providerId: "prov-1",
      providerName: "Vintner Select",
      subject: "20% off Sancerre this week",
      body: "Save 20% off our Sancerre when you buy 6 or more bottles. Use code SPRING20.",
      transport: { bulk: true } as any,
    });
    await settle();

    expect(outcome).toEqual({ stored: true });
    for (const s of [owner, manager]) {
      const got = notificationsTo(s);
      expect(got).toHaveLength(1);
      expect(got[0].payload.data.title).toBe(
        "Vintner Select promo on wines you buy",
      );
      expect(got[0].payload.data.action_url).toBe("/promotions");
    }
    expect(notificationsTo(staff)).toHaveLength(0);
  });

  it("the orchestrator's notification.promo_alert reaches the owner and the manager only, while a house-wide key still reaches staff", async () => {
    const w = world();
    const owner = await w.connect(OWNER);
    const manager = await w.connect(MANAGER);
    const staff = await w.connect(STAFF);
    const bridge = new RabbitMqBridgeService(
      { get: () => undefined } as any,
      w.gateway,
      w.databaseService,
      w.responder,
      {} as any,
      {} as any,
    );

    (bridge as any).handleNotificationEvent(
      {
        event_type: "PromoExpiringAlert",
        payload: {
          restaurant_id: HOUSE,
          title: "Promo expiring: Spring Rioja",
          message: "Ends 2026-10-01. Use it or lose it!",
          urgency: "high",
        },
      },
      "notification.promo_alert",
    );
    (bridge as any).handleNotificationEvent(
      {
        payload: {
          restaurant_id: HOUSE,
          title: "Count off by 2",
          message: "Two bottles of Sancerre are missing from the count.",
          urgency: "medium",
        },
      },
      "notification.inventory_discrepancy",
    );
    await settle();

    // The role-addressed emit waits for its role read, so it lands after the
    // house-wide one; the order is not what is under test.
    for (const s of [owner, manager]) {
      expect(
        notificationsTo(s)
          .map((r) => r.payload.data.title)
          .sort(),
      ).toEqual(["Count off by 2", "Promo expiring: Spring Rioja"]);
    }
    expect(notificationsTo(staff).map((r) => r.payload.data.title)).toEqual([
      "Count off by 2",
    ]);
    expect(NOTIFICATION_AUDIENCE_BY_KEY["notification.promo_alert"]).toBe(
      "owner_manager",
    );
  });

  it("the bridge's consumer hands the handler the key a message was published with, not the binding pattern", async () => {
    // Drives the real setupSubscriptions over a fake AMQP channel, so the
    // routing key reaches the audience table the way RabbitMQ delivers it:
    // bound as `notification.#`, delivered as `notification.promo_alert`.
    const w = world();
    const owner = await w.connect(OWNER);
    const staff = await w.connect(STAFF);
    const consumers = new Map<string, (msg: any) => void>();
    const bound = new Map<string, string>();
    const channel = {
      assertExchange: async () => ({}),
      assertQueue: async (queue: string) => ({ queue }),
      bindQueue: async (queue: string, _exchange: string, key: string) => {
        bound.set(key, queue);
      },
      consume: async (queue: string, cb: (msg: any) => void) => {
        consumers.set(queue, cb);
      },
      ack: () => undefined,
    };
    const bridge = new RabbitMqBridgeService(
      { get: () => undefined } as any,
      w.gateway,
      w.databaseService,
      w.responder,
      {} as any,
      {} as any,
    );
    (bridge as any).channel = channel;
    await (bridge as any).setupSubscriptions();

    const deliver = consumers.get(bound.get("notification.#")!)!;
    deliver({
      content: Buffer.from(
        JSON.stringify({
          event_type: "NewPromoAlert",
          payload: {
            restaurant_id: HOUSE,
            title: "New promotion from provider",
            message: "Discovered: Spring Rioja (volume_discount)",
            urgency: "medium",
          },
        }),
      ),
      fields: { routingKey: "notification.promo_alert" },
    });
    await settle();

    expect(notificationsTo(owner).map((r) => r.payload.data.title)).toEqual([
      "New promotion from provider",
    ]);
    expect(notificationsTo(staff)).toEqual([]);
  });

  it("the prospect notice links to /communications, where prospects live now (ADR 0160, Open item 3)", async () => {
    const w = world();
    const manager = await w.connect(MANAGER);
    const prospects = {
      domainOf: (email: string) => email.split("@")[1],
      captureFromColdEmail: jest.fn(async () => ({
        captured: true,
        isNew: true,
        isTriage: false,
        restaurantId: HOUSE,
        domain: "newvendor.test",
      })),
    };
    const responder = {
      persistManagerNotification: jest.fn(async () => undefined),
    };
    const bridge = new RabbitMqBridgeService(
      { get: () => undefined } as any,
      w.gateway,
      w.databaseService,
      responder as any,
      {} as any,
      prospects as any,
    );
    (bridge as any).persistProspectAttachments = async () => [];

    await (bridge as any).handleInboundEmail({
      payload: {
        from: "Ana Ruiz <ana@newvendor.test>",
        subject: "Introducing our portfolio",
        body: "Please find our catalogue attached.",
        attachments: [
          { filename: "cat.pdf", mime_type: "application/pdf", data: "" },
        ],
        restaurant_id: HOUSE,
      },
    });
    await settle();

    const got = notificationsTo(manager);
    expect(got).toHaveLength(1);
    expect(got[0].payload.data.action_url).toBe("/communications");
    expect(got[0].payload.data.message).toContain("Communications");
    expect(got[0].payload.data.message).not.toContain("Promotions");
    expect(responder.persistManagerNotification).toHaveBeenCalledWith(
      HOUSE,
      expect.objectContaining({ actionUrl: "/communications" }),
    );
  });
});

describe("the owner/manager audience is decided by the server at send time", () => {
  it("a verified member joins its own member room, outside the restaurant: prefix; no socket joins a manager: room", async () => {
    const w = world();
    const manager = await w.connect(MANAGER);
    const staff = await w.connect(STAFF);

    expect(manager.rooms.has(memberRoom(HOUSE, MANAGER))).toBe(true);
    expect(staff.rooms.has(memberRoom(HOUSE, STAFF))).toBe(true);
    expect(memberRoom(HOUSE, STAFF).startsWith("restaurant:")).toBe(false);
    for (const s of [manager, staff]) {
      expect([...s.rooms].filter((r) => r.startsWith("manager:"))).toEqual([]);
    }
  });

  it("a staff client asking to join a managers room, or another member's room, is refused and joins nothing", async () => {
    const w = world();
    const staff = await w.connect(STAFF);
    const before = new Set(staff.rooms);

    for (const restaurantId of [
      `${HOUSE}:managers`,
      `${HOUSE}:member:${MANAGER}`,
      memberRoom(HOUSE, MANAGER),
      `member:${HOUSE}:${MANAGER}`,
    ]) {
      expect(
        w.gateway.handleSubscribeRestaurant(staff as any, { restaurantId }),
      ).toEqual({
        success: false,
        error: "Unauthorized restaurant subscription",
      });
    }
    expect(staff.rooms).toEqual(before);

    await w.gateway.emitToHouseRoles(HOUSE, ["owner", "manager"], "probe", {
      n: 1,
    });
    expect(staff.received.filter((r) => r.event === "probe")).toEqual([]);
  });

  it("a manager demoted to staff receives nothing at the next emit, and a staff member promoted to manager receives at once", async () => {
    const w = world();
    const manager = await w.connect(MANAGER);
    const staff = await w.connect(STAFF);

    await w.gateway.emitToHouseRoles(HOUSE, ["owner", "manager"], "probe", {
      n: 1,
    });
    expect(manager.received.filter((r) => r.event === "probe")).toHaveLength(1);
    expect(staff.received.filter((r) => r.event === "probe")).toHaveLength(0);

    // The role writer calls no gateway method (members.service.ts
    // updateMemberRole). The next send reads the new roles anyway.
    const rows = w.store.tables.user_restaurant_access;
    rows.find((r) => r.user_id === MANAGER)!.role = "staff";
    rows.find((r) => r.user_id === STAFF)!.role = "manager";

    await w.gateway.emitToHouseRoles(HOUSE, ["owner", "manager"], "probe", {
      n: 2,
    });
    expect(
      manager.received
        .filter((r) => r.event === "probe")
        .map((r) => r.payload.n),
    ).toEqual([1]);
    expect(
      staff.received.filter((r) => r.event === "probe").map((r) => r.payload.n),
    ).toEqual([2]);
  });

  it("a member whose membership ends leaves the member room and receives nothing more", async () => {
    const w = world();
    const manager = await w.connect(MANAGER);

    w.store.tables.user_restaurant_access.find(
      (r) => r.user_id === MANAGER,
    )!.is_active = false;
    w.gateway.evictFromHouse(MANAGER, HOUSE);

    expect(manager.rooms.has(memberRoom(HOUSE, MANAGER))).toBe(false);
    expect(manager.rooms.has(`restaurant:${HOUSE}`)).toBe(false);
    await w.gateway.emitToHouseRoles(HOUSE, ["owner", "manager"], "probe", {});
    expect(manager.received.filter((r) => r.event === "probe")).toEqual([]);
  });

  it("a membership past valid_until no longer counts as a manager", async () => {
    const w = world();
    const manager = await w.connect(MANAGER);
    w.store.tables.user_restaurant_access.find(
      (r) => r.user_id === MANAGER,
    )!.valid_until = "2026-01-02T00:00:00Z";

    expect(
      await w.gateway.emitToHouseRoles(
        HOUSE,
        ["owner", "manager"],
        "probe",
        {},
      ),
    ).toBe(1);
    expect(manager.received.filter((r) => r.event === "probe")).toEqual([]);
  });

  it("a failed role read emits to nobody and writes no row", async () => {
    const w = world();
    const owner = await w.connect(OWNER);
    const manager = await w.connect(MANAGER);
    const staff = await w.connect(STAFF);
    w.store.failures.user_restaurant_access = "connection reset";

    expect(
      await w.gateway.emitRoleNotification(HOUSE, ["owner", "manager"], {
        id: "n1",
        title: "t",
        message: "m",
        type: "info",
      }),
    ).toBe(0);
    await w.responder.persistManagerNotification(
      HOUSE,
      { type: "promo_digest", title: "t", message: "m" },
      { roles: ["owner", "manager"] },
    );

    for (const s of [owner, manager, staff])
      expect(notificationsTo(s)).toEqual([]);
    expect(w.store.tables.notifications).toEqual([]);
  });

  it("another house's manager is never addressed", async () => {
    const w = world();
    w.store.tables.user_restaurant_access.push(
      membership("user-elsewhere", "manager", OTHER_HOUSE),
    );
    w.store.tables.users.push({
      user_id: "user-elsewhere",
      session_version: 0,
    });
    const elsewhere = await w.connect("user-elsewhere", OTHER_HOUSE);

    await w.gateway.emitToHouseRoles(HOUSE, ["owner", "manager"], "probe", {});
    expect(elsewhere.received.filter((r) => r.event === "probe")).toEqual([]);
  });
});

describe("POST /notifications writes one person's row and no house-wide toast", () => {
  function service() {
    const w = world();
    const svc = new NotificationsService(
      w.gateway,
      { get: () => undefined } as any,
      w.databaseService,
    );
    return { ...w, svc };
  }

  it("the live copy goes to the caller's own sessions only, never to restaurant:<id>", async () => {
    const w = service();
    const owner = await w.connect(OWNER);
    const staff = await w.connect(STAFF);

    await w.svc.createNotification({
      userId: STAFF,
      restaurantId: HOUSE,
      type: "calendar_reminder",
      title: "Tasting at 4",
      message: "Tasting at 4 starts at 16:00",
      actionUrl: "/calendar",
    });

    expect(notificationsTo(staff)).toHaveLength(1);
    expect(notificationsTo(owner)).toEqual([]);
    expect(
      w.ns.roomsAddressed.flat().filter((r) => r.startsWith("restaurant:")),
    ).toEqual([]);
  });

  it.each([
    "javascript:alert(document.cookie)",
    "//evil.test/x",
    "/\\evil.test",
    "/\t/evil.test",
    "/.//evil.test",
    "https://evil.test/",
  ])("refuses the link %j and writes nothing", async (actionUrl) => {
    const w = service();
    await expect(
      w.svc.createNotification({
        userId: STAFF,
        restaurantId: HOUSE,
        type: "calendar_reminder",
        title: "t",
        message: "m",
        actionUrl,
      }),
    ).rejects.toThrow(/path inside this app/);
    expect(w.store.tables.notifications).toEqual([]);
  });
});

describe("safeActionPath", () => {
  it("keeps an in-app path and its query, and refuses every off-app form", () => {
    expect(safeActionPath("/promotions")).toBe("/promotions");
    expect(safeActionPath("/orders?order=a%2Fb&deal=1#x")).toBe(
      "/orders?order=a%2Fb&deal=1#x",
    );
    for (const bad of [
      "",
      "promotions",
      " /x",
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "//evil.test",
      "/\\evil.test",
      "/\t/evil.test",
      "/\n/evil.test",
      "/.//evil.test",
      "/a/..//evil.test",
      "https://evil.test/x",
      "/" + "a".repeat(2048),
      42,
      null,
    ]) {
      expect(safeActionPath(bad)).toBeNull();
    }
  });

  it("drops an off-app link from a house-wide emit instead of sending it", async () => {
    const w = world();
    const staff = await w.connect(STAFF);
    w.gateway.emitRestaurantNotification(HOUSE, {
      id: "n",
      title: "t",
      message: "m",
      type: "info",
      action_url: "javascript:alert(1)",
    });
    expect(notificationsTo(staff)[0].payload.data.action_url).toBeUndefined();
  });
});
