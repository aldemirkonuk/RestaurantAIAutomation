/**
 * ADR 0019 D2 + D3 — security regression tests for CommunicationsController.
 *
 * D2: `test/*` and `test/e2e/step*` were @Public() and unguarded — anyone on
 *     the internet could approve a real order or send a real vendor email.
 * D3: POST /webhooks/gmail was @Public() with no Pub/Sub token check.
 *
 * Every assertion below fails against the pre-fix controller.
 */
import "reflect-metadata";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { CommunicationsController } from "./communications.controller";
import { NonProductionGuard } from "./guards/non-production.guard";
import { GmailPushAuthService } from "./gmail-push-auth.service";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const handlerOf = (name: keyof CommunicationsController) =>
  (CommunicationsController.prototype as any)[name];

const isPublic = (name: keyof CommunicationsController) =>
  Reflect.getMetadata(IS_PUBLIC_KEY, handlerOf(name));

const routeGuards = (name: keyof CommunicationsController): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, handlerOf(name)) || [];

const execContext = (req: any = { method: "POST", url: "/x" }) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as any;

/** Every route that is developer scaffolding over live data. */
const TEST_ROUTE_HANDLERS = [
  "testLowStockAlert",
  "testEmail",
  "sendTemplateEmail",
  "testMessagingScenario",
  "e2eStep1TriggerThreshold",
  "e2eStep2ApproveReorder",
  "e2eStep3SendVendorEmail",
  "e2eStep4CheckInbound",
  "e2eStep5ApproveConfirmation",
  "e2eStep6CheckStatus",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// D2 — test scaffolding is unreachable in production
// ─────────────────────────────────────────────────────────────────────────────

describe("NonProductionGuard (ADR 0019 D2)", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("allows the request outside production", () => {
    process.env.NODE_ENV = "development";
    expect(new NonProductionGuard().canActivate(execContext())).toBe(true);
  });

  it("allows the request when NODE_ENV is unset", () => {
    delete process.env.NODE_ENV;
    expect(new NonProductionGuard().canActivate(execContext())).toBe(true);
  });

  it("throws 404 (not 403) in production, hiding the route's existence", () => {
    process.env.NODE_ENV = "production";
    const guard = new NonProductionGuard();
    expect(() => guard.canActivate(execContext())).toThrow(NotFoundException);
    try {
      guard.canActivate(execContext());
    } catch (err: any) {
      expect(err.getStatus()).toBe(404);
      expect(err.getResponse()).toMatchObject({ message: "Not Found" });
    }
  });

  it("reads NODE_ENV per call rather than caching it at construction", () => {
    process.env.NODE_ENV = "development";
    const guard = new NonProductionGuard();
    expect(guard.canActivate(execContext())).toBe(true);
    process.env.NODE_ENV = "production";
    expect(() => guard.canActivate(execContext())).toThrow(NotFoundException);
  });
});

describe("CommunicationsController test routes (ADR 0019 D2)", () => {
  it.each(TEST_ROUTE_HANDLERS)("%s is not @Public()", (name) => {
    expect(isPublic(name as any)).toBeUndefined();
  });

  it.each(TEST_ROUTE_HANDLERS)(
    "%s is gated by NonProductionGuard",
    (name) => {
      expect(routeGuards(name as any)).toContain(NonProductionGuard);
    },
  );

  it("leaves no @Public() test route on the controller at all", () => {
    const stillPublic = Object.getOwnPropertyNames(
      CommunicationsController.prototype,
    ).filter((n) => n !== "constructor" && isPublic(n as any) === true);
    // The Gmail push webhook is the only intentional exception: it is
    // authenticated by a Google-signed OIDC token instead of a JWT (D3).
    expect(stillPublic).toEqual(["handleGmailWebhook"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D3 — Gmail push webhook verification
// ─────────────────────────────────────────────────────────────────────────────

describe("GmailPushAuthService (ADR 0019 D3)", () => {
  const AUD = "https://api.example.com/api/v1/communications/webhooks/gmail";
  const SA = "gmail-push@wineops.iam.gserviceaccount.com";

  const makeService = (
    config: Record<string, string | undefined>,
    verifyIdToken?: jest.Mock,
  ) => {
    const configService = {
      get: (key: string) => config[key],
    } as any;
    const service = new GmailPushAuthService(configService);
    if (verifyIdToken) {
      (service as any).oauthClient = { verifyIdToken };
    }
    return service;
  };

  const ticketWith = (payload: any) => ({ getPayload: () => payload });

  const validConfig = {
    GMAIL_PUBSUB_AUDIENCE: AUD,
    GMAIL_PUBSUB_SERVICE_ACCOUNT: SA,
  };

  // ── Staged rollout ────────────────────────────────────────────────────────
  // Production runs a live Gmail watch while these two vars are unset (they
  // did not exist before this verification). Rejecting on unset config would
  // not hold a door shut — it would close one that is open and carrying
  // traffic. So unconfigured ACCEPTS, loudly and countably, until either the
  // real values or the explicit REQUIRE flag are set.

  it("accepts but counts an unverified push when config is unset", async () => {
    const verifyIdToken = jest.fn();
    const service = makeService({}, verifyIdToken);
    await expect(service.verifyPushRequest("Bearer anything")).resolves.toBe(
      true,
    );
    // Never contacts Google — there is nothing to verify against.
    expect(verifyIdToken).not.toHaveBeenCalled();
    // The gap must be visible, not silent.
    expect(service.unverifiedPushes).toBe(1);
  });

  it("fails closed when unset AND GMAIL_PUBSUB_REQUIRE_AUTH=true", async () => {
    const service = makeService(
      { GMAIL_PUBSUB_REQUIRE_AUTH: "true" },
      jest.fn(),
    );
    await expect(service.verifyPushRequest("Bearer anything")).resolves.toBe(
      false,
    );
    expect(service.unverifiedPushes).toBe(0);
  });

  it("treats a half-configured pair as unconfigured, not as trusted", async () => {
    // Audience alone proves nothing about WHO sent the token.
    const audienceOnly = makeService({ GMAIL_PUBSUB_AUDIENCE: AUD }, jest.fn());
    await expect(
      audienceOnly.verifyPushRequest("Bearer anything"),
    ).resolves.toBe(true);
    expect(audienceOnly.unverifiedPushes).toBe(1);

    const saOnly = makeService({ GMAIL_PUBSUB_SERVICE_ACCOUNT: SA }, jest.fn());
    await expect(saOnly.verifyPushRequest("Bearer anything")).resolves.toBe(
      true,
    );

    // ...and REQUIRE still closes it.
    const required = makeService(
      { GMAIL_PUBSUB_AUDIENCE: AUD, GMAIL_PUBSUB_REQUIRE_AUTH: "true" },
      jest.fn(),
    );
    await expect(required.verifyPushRequest("Bearer anything")).resolves.toBe(
      false,
    );
  });

  it("treats blank/whitespace config as unset", async () => {
    const service = makeService(
      {
        GMAIL_PUBSUB_AUDIENCE: "   ",
        GMAIL_PUBSUB_SERVICE_ACCOUNT: SA,
        GMAIL_PUBSUB_REQUIRE_AUTH: "true",
      },
      jest.fn(),
    );
    await expect(service.verifyPushRequest("Bearer anything")).resolves.toBe(
      false,
    );
  });

  it("rejects a missing Authorization header", async () => {
    const service = makeService(validConfig, jest.fn());
    await expect(service.verifyPushRequest(undefined)).resolves.toBe(false);
  });

  it("rejects a non-Bearer or empty Authorization header", async () => {
    const service = makeService(validConfig, jest.fn());
    await expect(service.verifyPushRequest("Basic abc")).resolves.toBe(false);
    await expect(service.verifyPushRequest("Bearer ")).resolves.toBe(false);
  });

  it("rejects a token whose signature/issuer/expiry Google refuses", async () => {
    const verifyIdToken = jest
      .fn()
      .mockRejectedValue(new Error("Invalid token signature"));
    const service = makeService(validConfig, verifyIdToken);
    await expect(service.verifyPushRequest("Bearer forged")).resolves.toBe(
      false,
    );
  });

  it("passes the configured audience to verifyIdToken", async () => {
    const verifyIdToken = jest
      .fn()
      .mockResolvedValue(
        ticketWith({ email: SA, email_verified: true }),
      );
    const service = makeService(validConfig, verifyIdToken);
    await service.verifyPushRequest("Bearer good-token");
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "good-token",
      audience: AUD,
    });
  });

  it("rejects a valid Google token issued to a different service account", async () => {
    const verifyIdToken = jest.fn().mockResolvedValue(
      ticketWith({
        email: "someone-elses-sa@attacker.iam.gserviceaccount.com",
        email_verified: true,
      }),
    );
    const service = makeService(validConfig, verifyIdToken);
    await expect(service.verifyPushRequest("Bearer other-sa")).resolves.toBe(
      false,
    );
  });

  it("rejects a token whose email claim is unverified", async () => {
    const verifyIdToken = jest
      .fn()
      .mockResolvedValue(ticketWith({ email: SA, email_verified: false }));
    const service = makeService(validConfig, verifyIdToken);
    await expect(service.verifyPushRequest("Bearer unverified")).resolves.toBe(
      false,
    );
  });

  it("rejects a token with no payload", async () => {
    const verifyIdToken = jest.fn().mockResolvedValue(ticketWith(undefined));
    const service = makeService(validConfig, verifyIdToken);
    await expect(service.verifyPushRequest("Bearer empty")).resolves.toBe(
      false,
    );
  });

  it("accepts the configured push service account (case-insensitive)", async () => {
    const verifyIdToken = jest
      .fn()
      .mockResolvedValue(
        ticketWith({ email: SA.toUpperCase(), email_verified: true }),
      );
    const service = makeService(validConfig, verifyIdToken);
    await expect(service.verifyPushRequest(`Bearer good`)).resolves.toBe(true);
  });
});

describe("CommunicationsController.handleGmailWebhook (ADR 0019 D3)", () => {
  const makeController = (verified: boolean) => {
    const gmailWatchService = {
      isReady: jest.fn().mockReturnValue(true),
      getLastHistoryId: jest.fn().mockResolvedValue("1"),
      fetchNewMessages: jest.fn().mockResolvedValue([]),
      updateHistoryId: jest.fn(),
    };
    const orchestratorService = { publishEvent: jest.fn() };
    const gmailPushAuthService = {
      verifyPushRequest: jest.fn().mockResolvedValue(verified),
    };
    const controller = new CommunicationsController(
      {} as any,
      { getSenderEmail: () => "wineops.ai@gmail.com" } as any,
      {} as any,
      gmailWatchService as any,
      orchestratorService as any,
      { get: () => "" } as any,
      {} as any,
      gmailPushAuthService as any,
    );
    return {
      controller,
      gmailWatchService,
      orchestratorService,
      gmailPushAuthService,
    };
  };

  const pushBody = {
    message: {
      data: Buffer.from(
        JSON.stringify({ emailAddress: "wineops.ai@gmail.com", historyId: 42 }),
      ).toString("base64"),
    },
  };

  it("rejects an unverified push with 401 and does no work", async () => {
    const { controller, gmailWatchService, orchestratorService } =
      makeController(false);

    await expect(
      controller.handleGmailWebhook(pushBody, undefined),
    ).rejects.toThrow(UnauthorizedException);

    // The whole point: no inbox fetch, no republish onto email.events.
    expect(gmailWatchService.isReady).not.toHaveBeenCalled();
    expect(gmailWatchService.fetchNewMessages).not.toHaveBeenCalled();
    expect(orchestratorService.publishEvent).not.toHaveBeenCalled();
  });

  it("forwards the Authorization header to the verifier", async () => {
    const { controller, gmailPushAuthService } = makeController(false);
    await expect(
      controller.handleGmailWebhook(pushBody, "Bearer some-token"),
    ).rejects.toThrow(UnauthorizedException);
    expect(gmailPushAuthService.verifyPushRequest).toHaveBeenCalledWith(
      "Bearer some-token",
    );
  });

  it("still processes a verified push (legitimate inbound path intact)", async () => {
    const { controller, gmailWatchService } = makeController(true);

    const result = await controller.handleGmailWebhook(
      pushBody,
      "Bearer good-token",
    );

    expect(result).toEqual({ status: "processed", messages: 0 });
    expect(gmailWatchService.fetchNewMessages).toHaveBeenCalledWith("1");
  });
});

describe("CommunicationsController.forceGmailFetch (ADR 0019 D3)", () => {
  it("is no longer @Public() — it falls under the class-level JwtAuthGuard", () => {
    expect(isPublic("forceGmailFetch")).toBeUndefined();
  });

  it("is not production-gated: operators need it to recover missed replies", () => {
    expect(routeGuards("forceGmailFetch")).not.toContain(NonProductionGuard);
  });
});
