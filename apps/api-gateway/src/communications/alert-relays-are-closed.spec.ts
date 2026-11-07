/**
 * The two alert relays are closed — at the HTTP seam.
 *
 * Founder, 2026-09-29: fix the verified live hole. Measured before this pass
 * (817-route audit at 5a20d774b, re-verified at c47fd8a01):
 * `POST /communications/alerts/low-stock` and
 * `POST /communications/alerts/daily-summary` let any signed-in member make
 * the platform's Plivo number text any phone and the shared Gmail mailbox mail
 * any address, with body-chosen words (`wineName`, `restaurantName`), no role,
 * no recipient allow-list and no record. Nothing in apps/web, apps/mobile,
 * packages, services, supabase, scripts or apps/web/e2e calls either, so they
 * are closed (ADR 0149 answer 15's posture for uncalled senders), not guarded.
 *
 * The app runs the REAL CommunicationsController behind a global
 * ValidationPipe with main.ts's options. Replaced: JwtAuthGuard (a stub that
 * sets an OWNER's `request.user` — the strongest caller, so a 404 here is not
 * a role refusal) and every provider, by recorders. The server listens on
 * 127.0.0.1 inside this process; nothing leaves it.
 *
 * [REVERT-FAILS] marks a case that fails on c47fd8a01, where both routes
 * answered 200 and handed the body's recipient to the senders.
 */
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { DatabaseService } from "../database/database.service";
import { CommunicationsController } from "./communications.controller";
import { CommunicationsService } from "./communications.service";
import { GmailPushAuthService } from "./gmail-push-auth.service";
import { GmailService } from "./gmail.service";
import { GmailWatchService } from "./gmail-watch.service";
import { SmsService } from "./sms.service";
import * as dto from "./dto/communication.dto";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-000000000001";

const comms = {
  sendLowStockAlert: jest.fn(async () => ({ success: true, timestamp: "t" })),
  sendDailySummary: jest.fn(async () => ({ success: true, channel: "sms" })),
};
const sms = {
  sendLowStockAlert: jest.fn(),
  sendDailySummary: jest.fn(),
  sendSms: jest.fn(),
};
const gmail = {
  sendLowStockAlert: jest.fn(),
  sendEmail: jest.fn(),
  getSenderEmail: () => null,
};

let app: INestApplication;
let base: string;

async function post(path: string, body: unknown): Promise<{ status: number }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await res.text();
  return { status: res.status };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [CommunicationsController],
    providers: [
      { provide: CommunicationsService, useValue: comms },
      { provide: GmailService, useValue: gmail },
      { provide: SmsService, useValue: sms },
      { provide: GmailWatchService, useValue: {} },
      { provide: OrchestratorService, useValue: {} },
      { provide: ConfigService, useValue: { get: () => "" } },
      { provide: DatabaseService, useValue: {} },
      { provide: GmailPushAuthService, useValue: {} },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = {
          userId: OWNER,
          restaurantId: HOUSE,
          role: "owner",
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

describe("the alert relays are not HTTP routes", () => {
  it("[REVERT-FAILS] POST /communications/alerts/low-stock is a 404 and mails and texts nobody", async () => {
    const res = await post("/communications/alerts/low-stock", {
      recipientEmail: "anyone@example.com",
      recipientPhone: "+15555550123",
      wineName: "Your account is locked, call +1 555 0100",
      currentStock: 1,
      threshold: 6,
    });
    expect(res.status).toBe(404);
    expect(comms.sendLowStockAlert).not.toHaveBeenCalled();
    expect(gmail.sendLowStockAlert).not.toHaveBeenCalled();
    expect(sms.sendLowStockAlert).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] POST /communications/alerts/daily-summary is a 404 and texts nobody", async () => {
    const res = await post("/communications/alerts/daily-summary", {
      recipientPhone: "+15555550123",
      restaurantName: "Free text of the caller's choosing, up to an SMS",
      lowStockCount: 0,
      pendingOrders: 0,
    });
    expect(res.status).toBe(404);
    expect(comms.sendDailySummary).not.toHaveBeenCalled();
    expect(sms.sendDailySummary).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] the controller declares neither handler, nor the body-tenant resolver", () => {
    const proto = CommunicationsController.prototype as any;
    expect(proto.sendLowStockAlert).toBeUndefined();
    expect(proto.sendDailySummary).toBeUndefined();
    expect(proto.resolveAlertTenant).toBeUndefined();
  });

  it("[REVERT-FAILS] the daily summary's body DTO went with its route", () => {
    // Its only use was the route; `SendSmsDto` went the same way (ADR 0084).
    expect((dto as any).DailySummaryDto).toBeUndefined();
  });
});

describe("what the product sends is still there, internally", () => {
  it("the scheduled producers' service methods remain", () => {
    // `ScheduledTasksService` sends the daily SMS summary and the low-stock
    // alerts (email, SMS and the in-app websocket notice) through these, with
    // recipients from the house's own register and the tenant's id as room.
    const proto = CommunicationsService.prototype as any;
    expect(typeof proto.sendLowStockAlert).toBe("function");
    expect(typeof proto.sendDailySummary).toBe("function");
  });
});
