/**
 * Who may notify whom — at the HTTP seam.
 *
 * Founder answer 15 (ADR 0149, 2026-09-16): "Close the five uncalled POST
 * senders (internal only)". ADR 0147 had named them as "Named, not fixed":
 * each sent to whatever user id, restaurant id or address its body named, for
 * any signed-in caller of any role.
 *
 * `POST /notifications/send-email` is NOT this spec's, nor this PR's. The
 * founder closed it outright on 2026-09-25 (round 4 item 14: "close the
 * endpoint"), which PR #410 does and pins in
 * `send-email-refuses-client-html.spec.ts`; the constrained owner/manager send
 * this PR first built (`HouseEmailService`) was dropped for that answer.
 *
 * The app below runs the REAL NotificationsController behind a global
 * ValidationPipe with the options main.ts installs. Replaced: JwtAuthGuard (by
 * a stub that sets the `request.user` shape JwtStrategy.validate returns) and
 * NotificationsService (jest.fns, so nothing is sent or stored). The server
 * listens on 127.0.0.1 inside this process.
 *
 * [REVERT-FAILS] marks a test that fails against origin/main @ 60ed83a7:
 * the five routes answered 201 and called their senders, and the preference
 * DTO stored any string.
 */
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { LowStockAlertsService } from "./low-stock-alerts.service";
import { NotificationProducersService } from "./producers/notification-producers.service";

type Row = Record<string, any>;

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER_HOUSE = "22222222-2222-4222-8222-222222222222";

const OWNER = "a0000000-0000-4000-8000-000000000001";
const STAFF = "a0000000-0000-4000-8000-000000000003";

const service = {
  sendOrderApprovalNotification: jest.fn(),
  sendLowStockAlert: jest.fn(),
  sendDeliveryNotification: jest.fn(),
  sendPriceNegotiationNotification: jest.fn(),
  sendSystemAlert: jest.fn(),
  updatePreferences: jest.fn(async (p: any) => ({ saved: p })),
};

let app: INestApplication;
let base: string;

async function call(
  method: "POST" | "PATCH",
  path: string,
  as: { user?: string | null; house?: string | null; role?: string },
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-user": as.user ?? "",
      "x-test-house": as.house ?? "",
      "x-test-role": as.role ?? "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [NotificationsController],
    providers: [
      { provide: NotificationsService, useValue: service },
      { provide: NotificationProducersService, useValue: {} },
      { provide: LowStockAlertsService, useValue: {} },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: req.headers["x-test-user"] || null,
          restaurantId: req.headers["x-test-house"] || null,
          role: req.headers["x-test-role"] || undefined,
        };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

const OWNER_AT_HOUSE = { user: OWNER, house: HOUSE, role: "owner" };

// ===========================================================================
// 1. The five uncalled senders are not HTTP routes any more
// ===========================================================================

describe("the five uncalled senders are closed", () => {
  const CLOSED: Array<[string, Row, keyof typeof service]> = [
    [
      "/notifications/order-approval",
      {
        userId: STAFF,
        orderId: "o",
        wineName: "w",
        quantity: 1,
        providerName: "p",
      },
      "sendOrderApprovalNotification",
    ],
    [
      "/notifications/low-stock",
      {
        restaurantId: OTHER_HOUSE,
        wineId: "w",
        wineName: "w",
        currentStock: 0,
        threshold: 6,
      },
      "sendLowStockAlert",
    ],
    [
      "/notifications/delivery",
      {
        restaurantId: OTHER_HOUSE,
        orderId: "o",
        wineName: "w",
        quantity: 1,
        providerName: "p",
      },
      "sendDeliveryNotification",
    ],
    [
      "/notifications/price-negotiation",
      {
        userId: STAFF,
        orderId: "o",
        wineName: "w",
        currentPrice: 1,
        proposedPrice: 2,
        providerName: "p",
      },
      "sendPriceNegotiationNotification",
    ],
    [
      "/notifications/system-alert",
      {
        restaurantId: OTHER_HOUSE,
        title: "t",
        message: "m",
        severity: "error",
      },
      "sendSystemAlert",
    ],
  ];

  it.each(CLOSED)(
    "[REVERT-FAILS] POST %s is 404 and sends nothing",
    async (path, body, method) => {
      const res = await call("POST", path, OWNER_AT_HOUSE, body);
      expect(res.status).toBe(404);
      expect(service[method]).not.toHaveBeenCalled();
    },
  );

  it("[REVERT-FAILS] the controller declares none of the five handlers", () => {
    const proto = NotificationsController.prototype as any;
    for (const handler of [
      "notifyOrderApproval",
      "notifyLowStock",
      "notifyDelivery",
      "notifyPriceNegotiation",
      "sendSystemAlert",
    ]) {
      expect(proto[handler]).toBeUndefined();
    }
  });
});

// ===========================================================================
// 2. Preferences: modes are an allowlist, times are HH:mm (ADR 0147)
// ===========================================================================

describe("PATCH /notifications/preferences refuses values no sender reads", () => {
  const patch = (body: Row) =>
    call("PATCH", "/notifications/preferences", OWNER_AT_HOUSE, body);

  it.each([
    ["ordersMode", { ordersMode: "email" }],
    ["reportsMode", { reportsMode: "BOTH" }],
    ["lowStock.digestFrequency", { lowStock: { digestFrequency: "weekly" } }],
    ["lowStock.digestTime 25:00", { lowStock: { digestTime: "25:00" } }],
    ["lowStock.digestTime 8:00", { lowStock: { digestTime: "8:00" } }],
    ["quietHours.startTime noon", { quietHours: { startTime: "noon" } }],
    ["quietHours.endTime 22:00:00", { quietHours: { endTime: "22:00:00" } }],
    ["quietHours.startTime empty", { quietHours: { startTime: "" } }],
  ])(
    "[REVERT-FAILS] %s is a 400 and nothing is stored",
    async (_label, body) => {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(service.updatePreferences).not.toHaveBeenCalled();
    },
  );

  it("every value the settings pages send is accepted and reaches the service", async () => {
    for (const mode of ["both", "in_app", "off"]) {
      const res = await patch({ ordersMode: mode, reportsMode: mode });
      expect(res.status).toBe(200);
    }
    const res = await patch({
      lowStock: { digestFrequency: "off", digestTime: "08:30" },
      quietHours: { enabled: true, startTime: "22:00", endTime: "07:59" },
    });
    expect(res.status).toBe(200);
    expect(service.updatePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: OWNER,
        lowStock: expect.objectContaining({
          digestFrequency: "off",
          digestTime: "08:30",
        }),
        quietHours: expect.objectContaining({
          startTime: "22:00",
          endTime: "07:59",
        }),
      }),
    );
  });
});
