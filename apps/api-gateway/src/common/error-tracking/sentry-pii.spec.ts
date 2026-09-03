import { HttpException, HttpStatus } from "@nestjs/common";
import { of, throwError, firstValueFrom } from "rxjs";

/**
 * The error tracker must never learn who a person is.
 *
 * Mirrors apps/web/src/__tests__/lib/error-tracking-pii.test.ts. The two
 * runtimes are tested separately on purpose: they hold two copies of one rule
 * with no shared module, and scripts/check_sentry_pii_scope.py fails the build
 * if those copies drift. A single shared test would hide exactly that drift.
 */

const setUserMock = jest.fn();
const initMock = jest.fn();
// Typed to accept the args it is actually called with: the spread below needs a
// rest parameter, and the assertions read `mock.calls[0][1]` (the context arg).
const captureExceptionMock = jest.fn((..._args: unknown[]) => "event-id");

jest.mock("@sentry/node", () => ({
  init: (...args: unknown[]) => initMock(...args),
  setUser: (...args: unknown[]) => setUserMock(...args),
  setContext: jest.fn(),
  setTag: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: jest.fn(() => "event-id"),
  startInactiveSpan: jest.fn(),
  flush: jest.fn(async () => true),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SentryService, scrubSentryEvent } = require("./sentry.service");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SentryInterceptor } = require("./sentry.interceptor");

function serviceWithDsn() {
  const config = { get: (key: string) => (key === "SENTRY_DSN" ? "https://key@example.test/1" : "test") };
  const service = new SentryService(config as never);
  service.initialize();
  return service;
}

describe("sentry — what reaches the error tracker", () => {
  beforeEach(() => {
    setUserMock.mockClear();
    initMock.mockClear();
    captureExceptionMock.mockClear();
  });

  describe("init", () => {
    it("states sendDefaultPii: false and installs a beforeSend scrubber", () => {
      serviceWithDsn();
      const options = initMock.mock.calls[0][0];
      expect(options.sendDefaultPii).toBe(false);
      expect(typeof options.beforeSend).toBe("function");
    });

    it("the installed beforeSend actually scrubs", () => {
      serviceWithDsn();
      const options = initMock.mock.calls[0][0];
      const sent = options.beforeSend({
        user: { id: "user-1", email: "chef@restaurant.example" },
      });
      expect(sent.user).toEqual({ id: "user-1" });
    });
  });

  describe("setUser", () => {
    it("forwards only opaque identifiers", () => {
      serviceWithDsn().setUser({ id: "user-1", restaurantId: "rest-1" });

      expect(setUserMock).toHaveBeenCalledTimes(1);
      expect(setUserMock.mock.calls[0][0]).toEqual({
        id: "user-1",
        restaurant_id: "rest-1",
      });
    });

    it("drops identity fields a caller smuggles past the type", () => {
      // TypeScript rejects this shape; a JS caller or a stale build does not.
      serviceWithDsn().setUser({
        id: "user-1",
        email: "chef@restaurant.example",
        username: "Ada Chef",
      } as never);

      const payload = setUserMock.mock.calls[0][0];
      expect(payload).not.toHaveProperty("email");
      expect(payload).not.toHaveProperty("username");
      expect(JSON.stringify(payload)).not.toContain("chef@restaurant.example");
    });
  });

  describe("scrubSentryEvent", () => {
    it("removes every credential header, in any casing", () => {
      // Node lower-cases inbound header names, but an event can also be
      // assembled by hand; a case-sensitive delete is the classic way a
      // scrubber silently stops scrubbing.
      const event = scrubSentryEvent({
        request: {
          headers: {
            authorization: "Bearer secret",
            Cookie: "session=abc",
            "X-API-Key": "k-1",
            "proxy-authorization": "Basic secret",
            "user-agent": "jest",
          },
        },
      });
      expect(event.request.headers).toEqual({ "user-agent": "jest" });
    });

    it("removes request cookies", () => {
      const event = scrubSentryEvent({
        request: { cookies: { session: "abc" }, url: "/api/v1/orders" },
      });
      expect(event.request).not.toHaveProperty("cookies");
      expect(event.request.url).toBe("/api/v1/orders");
    });

    it("strips identity from the user scope but keeps the opaque ids", () => {
      const event = scrubSentryEvent({
        user: {
          id: "user-1",
          email: "chef@restaurant.example",
          username: "Ada Chef",
          ip_address: "203.0.113.4",
          restaurant_id: "rest-1",
        },
      });
      expect(event.user).toEqual({ id: "user-1", restaurant_id: "rest-1" });
    });

    it("strips identity from free-form extra, request body and contexts", () => {
      const event = scrubSentryEvent({
        extra: { email: "chef@restaurant.example", phone: "555-0100", orderId: "ord-9" },
        request: { data: { name: "Ada Chef", password: "hunter2", note: "keep" } },
        contexts: {
          order: { total: 42 },
          account: { first_name: "Ada", last_name: "Chef", plan: "pro" },
        },
      });
      expect(event.extra).toEqual({ orderId: "ord-9" });
      expect(event.request.data).toEqual({ note: "keep" });
      expect(event.contexts.order).toEqual({ total: 42 });
      expect(event.contexts.account).toEqual({ plan: "pro" });
    });
  });

  describe("SentryInterceptor", () => {
    const contextFor = (request: Record<string, unknown>) =>
      ({
        switchToHttp: () => ({ getRequest: () => request }),
      }) as never;

    it("reports parameter names without their values, and a query-free url", async () => {
      const service = serviceWithDsn();
      const interceptor = new SentryInterceptor(service);
      const error = new Error("boom");

      const request = {
        url: "/api/v1/invites/accept?email=chef%40restaurant.example&token=secret",
        method: "GET",
        params: { inviteId: "inv-1" },
        query: { email: "chef@restaurant.example", token: "secret" },
        user: { id: "user-1", restaurantId: "rest-1" },
      };

      await expect(
        firstValueFrom(
          interceptor.intercept(contextFor(request), {
            handle: () => throwError(() => error),
          } as never),
        ),
      ).rejects.toThrow("boom");

      // captureException wraps the context as `{ extra: ... }` before handing
      // it to Sentry, so the request context sits one level down.
      const reported = (
        captureExceptionMock.mock.calls[0][1] as { extra: Record<string, unknown> }
      ).extra;
      expect(reported).toEqual({
        url: "/api/v1/invites/accept",
        method: "GET",
        paramKeys: ["inviteId"],
        queryKeys: ["email", "token"],
        userId: "user-1",
        restaurantId: "rest-1",
      });
      expect(JSON.stringify(reported)).not.toContain("chef@restaurant.example");
      expect(JSON.stringify(reported)).not.toContain("secret");
    });

    it("does not report client errors at all", async () => {
      const interceptor = new SentryInterceptor(serviceWithDsn());
      const error = new HttpException("nope", HttpStatus.BAD_REQUEST);

      await expect(
        firstValueFrom(
          interceptor.intercept(contextFor({ url: "/x", method: "GET" }), {
            handle: () => throwError(() => error),
          } as never),
        ),
      ).rejects.toThrow("nope");

      expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it("passes a successful response through untouched", async () => {
      const interceptor = new SentryInterceptor(serviceWithDsn());
      const result = await firstValueFrom(
        interceptor.intercept(contextFor({ url: "/x", method: "GET" }), {
          handle: () => of({ ok: true }),
        } as never),
      );
      expect(result).toEqual({ ok: true });
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });
  });
});
