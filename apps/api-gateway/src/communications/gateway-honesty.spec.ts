import "reflect-metadata";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { CommunicationsController } from "./communications.controller";
import { SmsService } from "./sms.service";
import * as dto from "./dto/communication.dto";

/**
 * ADR 0084 — the communications gateway says what it did.
 *
 * C1 the open SMS relay is gone
 * C2 an SMS nobody sent does not report success
 * C3 the alert's broadcast tenant comes from the token, not the body
 * C5 the SMS carries no unmeasured figure and no promise nothing can keep
 */

/**
 * Source with comments removed.
 *
 * The fix's own comments quote the strings they removed — "Reply REORDER",
 * `mock_sms_` — because a removal nobody can see is a removal the next reader
 * undoes. A source assertion that cannot tell code from prose would fail on
 * the explanation of the fix, so it is taught the difference rather than the
 * comments being thinned to keep it quiet.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const SMS_SOURCE = readFileSync(join(__dirname, "sms.service.ts"), "utf8");
const SMS_CODE = stripComments(SMS_SOURCE);

/** A service with no Plivo credentials — the state every environment without
 *  PLIVO_AUTH_ID is in, including, for all we know, production. */
function unconfiguredSms(): SmsService {
  const service = new SmsService({ get: () => undefined } as any);
  // Silence the developer-facing log lines; their CONTENT is asserted
  // separately below, because keeping them was a requirement of the fix.
  jest.spyOn((service as any).logger, "log").mockImplementation(() => {});
  jest.spyOn((service as any).logger, "warn").mockImplementation(() => {});
  return service;
}

// ─────────────────────────────────────────────────────────────────────────────
// C1 — the raw SMS relay
// ─────────────────────────────────────────────────────────────────────────────

describe("C1 — POST /communications/sms is gone", () => {
  it("has no handler on the controller", () => {
    expect((CommunicationsController.prototype as any).sendSms).toBeUndefined();
  });

  it("has no route registered at 'sms'", () => {
    const paths = Object.getOwnPropertyNames(CommunicationsController.prototype)
      .map((name) =>
        Reflect.getMetadata(
          PATH_METADATA,
          (CommunicationsController.prototype as any)[name] ?? {},
        ),
      )
      .filter(Boolean);
    expect(paths).not.toContain("sms");
  });

  it("no longer exports the DTO that was its only validation", () => {
    expect((dto as any).SendSmsDto).toBeUndefined();
  });

  it("keeps POST /communications/email, which has a caller", () => {
    // Not an oversight: `email_composer_service.py:354` POSTs to it on the
    // approved-vendor-email path. Pinned so a later sweep does not remove it
    // without reading why.
    //
    // ADR 0099 CORRECTION to this test's original wording ("a LIVE caller"):
    // that caller had been refused with a 401 since `fdaa7fa0` (2026-08-25),
    // and production shows zero rows ever written by its success path. It is
    // authenticated now (ServiceKeyGuard, see vendor-email-gateway-auth.spec),
    // which is what makes "keep it" a defensible answer rather than a
    // restatement of the assumption.
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        (CommunicationsController.prototype as any).sendEmail,
      ),
    ).toBe("email");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — an unsent SMS
// ─────────────────────────────────────────────────────────────────────────────

describe("C2 — an SMS nobody sent reports failure", () => {
  it("returns success:false with a reason when Plivo is not configured", async () => {
    const result = await unconfiguredSms().sendSms({
      to: "+14155551234",
      message: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("SMS not configured");
  });

  it("fabricates no message id", async () => {
    // A `mock_sms_...` id is worse than none: it is exactly the string a human
    // would later hand the carrier when asking why the manager never got it.
    const result = await unconfiguredSms().sendSms({
      to: "+14155551234",
      message: "hello",
    });

    expect(result.messageId).toBeUndefined();
    expect(SMS_CODE).not.toContain("mock_sms_");
  });

  it("still prints the message for the developer", async () => {
    const service = new SmsService({ get: () => undefined } as any);
    const lines: string[] = [];
    jest
      .spyOn((service as any).logger, "log")
      .mockImplementation((m: any) => void lines.push(String(m)));

    await service.sendSms({ to: "+14155551234", message: "the body" });

    expect(lines.join("\n")).toContain("the body");
    expect(lines.join("\n")).toContain("SMS NOT SENT");
  });

  it("carries the failure through every typed sender", async () => {
    // The daily summary, the low-stock alert and the order-approval request
    // all reported a delivered SMS. `MultiChannelResultDto.success` stayed
    // true and the per-tenant cron counted the tenant succeeded.
    const service = unconfiguredSms();

    const summary = await service.sendDailySummary({
      to: "+14155551234",
      restaurantName: "Meyhouse",
      lowStockCount: 2,
      pendingOrders: 1,
    });
    const alert = await service.sendLowStockAlert({
      to: "+14155551234",
      wineName: "Malbec",
      currentStock: 1,
      threshold: 6,
    });
    const approval = await service.sendOrderApprovalRequest({
      to: "+14155551234",
      wineName: "Malbec",
      quantity: 6,
      totalPrice: 120,
      orderId: "abcdef01-2345",
    });

    for (const r of [summary, alert, approval]) {
      expect(r.success).toBe(false);
      expect(r.error).toBe("SMS not configured");
    }
  });

  it("reports a real send as a success when Plivo IS configured", async () => {
    // The fix must not turn every SMS into a failure — that would be the same
    // fault pointed the other way.
    const service = new SmsService({
      get: (k: string) =>
        ({
          PLIVO_AUTH_ID: "id",
          PLIVO_AUTH_TOKEN: "token",
          PLIVO_PHONE_NUMBER: "+15550000000",
        })[k],
    } as any);
    jest.spyOn((service as any).logger, "log").mockImplementation(() => {});
    (service as any).isConfigured = true;
    (service as any).plivoClient = {
      messages: { create: async () => ({ messageUuid: "real-uuid" }) },
    };

    const result = await service.sendSms({ to: "+1", message: "x" });
    expect(result).toEqual({ success: true, messageId: "real-uuid" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 — the broadcast tenant
// ─────────────────────────────────────────────────────────────────────────────

describe("C3 — the alert is broadcast into the caller's own tenant", () => {
  function controllerWith(captured: any[]) {
    return new CommunicationsController(
      {
        sendLowStockAlert: async (payload: any) => {
          captured.push(payload);
          return { success: true, timestamp: "t" };
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: () => "" } as any,
      {} as any,
      {} as any,
    );
  }

  const body = {
    recipientEmail: "ops@example.com",
    wineName: "Malbec",
    currentStock: 1,
    threshold: 6,
  } as any;

  it("uses the JWT's restaurant as the websocket room, ignoring the body", async () => {
    const captured: any[] = [];
    await controllerWith(captured).sendLowStockAlert(body, {
      userId: "u1",
      restaurantId: "rest-A",
    });

    expect(captured[0].restaurantId).toBe("rest-A");
  });

  it("refuses a body that names a different restaurant", async () => {
    const captured: any[] = [];
    await expect(
      controllerWith(captured).sendLowStockAlert(
        { ...body, restaurantId: "rest-B" },
        { userId: "u1", restaurantId: "rest-A" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Refused, not silently rewritten: a caller addressing someone else should
    // hear about it rather than have its message quietly redirected.
    expect(captured).toHaveLength(0);
  });

  it("accepts a body that agrees with the token", async () => {
    const captured: any[] = [];
    await controllerWith(captured).sendLowStockAlert(
      { ...body, restaurantId: "rest-A" },
      { userId: "u1", restaurantId: "rest-A" },
    );
    expect(captured[0].restaurantId).toBe("rest-A");
  });

  it("gives a tenantless session no room at all", async () => {
    const captured: any[] = [];
    await controllerWith(captured).sendLowStockAlert(body, { userId: "u1" });
    // undefined means `communications.service.ts` skips the emit entirely.
    expect(captured[0].restaurantId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C5 — what the SMS says
// ─────────────────────────────────────────────────────────────────────────────

describe("C5 — the SMS promises nothing it cannot do", () => {
  const capture = () => {
    const service = unconfiguredSms();
    const sent: string[] = [];
    jest.spyOn(service, "sendSms").mockImplementation(async (o: any) => {
      sent.push(o.message);
      return { success: false, error: "SMS not configured" };
    });
    return { service, sent };
  };

  it("does not tell a manager to reply REORDER — nothing receives an SMS", async () => {
    const { service, sent } = capture();
    await service.sendLowStockAlert({
      to: "+1",
      wineName: "Malbec",
      currentStock: 1,
      threshold: 6,
    });

    expect(sent[0]).not.toMatch(/reply\s+reorder/i);
    expect(SMS_CODE).not.toMatch(/Reply REORDER/);
  });

  it("does not tell a manager to reply YES to approve a purchase", async () => {
    const { service, sent } = capture();
    await service.sendOrderApprovalRequest({
      to: "+1",
      wineName: "Malbec",
      quantity: 6,
      totalPrice: 120,
      orderId: "abcdef01-2345",
    });

    expect(sent[0]).not.toMatch(/reply\s+yes/i);
    expect(SMS_CODE).not.toMatch(/Reply YES to approve/);
  });

  it("there is genuinely no inbound SMS handler to justify either prompt", () => {
    // The claim both removals rest on, checked rather than asserted — and the
    // check is written so it CAN fail: it looks for a route registration, so
    // adding one turns this test red and the prompts become defensible again.
    //
    // Comment lines are excluded on both sides. The comments above quote the
    // removed prompts and name the missing webhook, and a search that counted
    // its own explanation would report a handler that does not exist — the
    // shape of fault this whole change is about.
    const repo = join(__dirname, "..", "..", "..", "..");

    let raw = "";
    try {
      raw = execFileSync(
        "grep",
        [
          "-rnE",
          "--include=*.ts",
          "--include=*.py",
          "--exclude=*.spec.ts",
          "--exclude=*test*",
          "--exclude-dir=node_modules",
          "--exclude-dir=.git",
          // A Nest route or a FastAPI/Flask route whose path is an inbound
          // SMS webhook. This is what receiving a reply would look like.
          "(@(Post|Get|All)\\(|@(app|router)\\.(post|get))[^\\n]*(plivo|sms)[^\\n]*(webhook|inbound|reply|message)",
          join(repo, "apps"),
          join(repo, "services"),
        ],
        { encoding: "utf8" },
      );
    } catch (err: any) {
      // grep exits 1 on no match, which is the expected outcome.
      if (err.status !== 1) throw err;
      raw = err.stdout ?? "";
    }

    const hits = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .filter((l) => !/:\s*(\/\/|#|\*)/.test(l));

    expect(hits).toEqual([]);
  });

  it("prints no deliveries figure, because none is measured", async () => {
    const { service, sent } = capture();
    await service.sendDailySummary({
      to: "+1",
      restaurantName: "Meyhouse",
      lowStockCount: 2,
      pendingOrders: 1,
    });

    expect(sent[0]).not.toMatch(/deliveries/i);
    // The two figures that ARE read from the database stay.
    expect(sent[0]).toContain("Low stock: 2");
    expect(sent[0]).toContain("Pending orders: 1");
  });

  it("no longer accepts a deliveries count anywhere on the SMS path", () => {
    expect(SMS_CODE).not.toContain("deliveriesToday");
    expect(
      (dto.DailySummaryDto.prototype as any).deliveriesToday,
    ).toBeUndefined();
  });
});
