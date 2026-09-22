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
const sentryService = require("./sentry.service");
// Destructured separately: keeping the `require` on ONE short line keeps it
// adjacent to its eslint-disable comment. Prettier wraps a longer destructure
// across lines, which moves the `} = require(...)` away from the comment and
// the rule fires again.
const { SentryService, scrubSentryEvent, scrubUrl } = sentryService;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SentryInterceptor } = require("./sentry.interceptor");

function serviceWithDsn() {
  const config = {
    get: (key: string) =>
      key === "SENTRY_DSN" ? "https://key@example.test/1" : "test",
  };
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
        extra: {
          email: "chef@restaurant.example",
          phone: "555-0100",
          orderId: "ord-9",
        },
        request: {
          data: { name: "Ada Chef", password: "hunter2", note: "keep" },
        },
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
        captureExceptionMock.mock.calls[0][1] as {
          extra: Record<string, unknown>;
        }
      ).extra;
      expect(reported).toEqual({
        // `<redacted>`, not `accept`: the /invites/ prefix redacts the segment
        // after it, and this fixture's next segment is the literal word
        // "accept". Deliberate over-redaction — the alternative is an allow-list
        // of "safe" next-segments, which is the same fail-open shape the founder
        // rejected for parameter names. The real route it protects is
        // DELETE /restaurants/:id/invites/:code, which carries the live
        // organization_invites.code (PR #427's correctness audit). Cost: an
        // on-call loses one word of route detail; paramKeys/queryKeys below
        // still name the shape.
        url: "/api/v1/invites/<redacted>",
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

describe("request.url never carries a credential (founder ruling 2026-09-21)", () => {
  it.each([
    [
      "https://mudavym.com/reset-password?token=abc",
      "https://mudavym.com/reset-password",
    ],
    [
      "https://mudavym.com/verify-email?token=abc",
      "https://mudavym.com/verify-email",
    ],
    ["https://mudavym.com/x?a=1&token=abc&b=2", "https://mudavym.com/x"],
    [
      "https://mudavym.com/reset-password#token=abc",
      "https://mudavym.com/reset-password",
    ],
    [
      "https://mudavym.com/invite/SECRET",
      "https://mudavym.com/invite/<redacted>",
    ],
    [
      "https://mudavym.com/studio/invite/S",
      "https://mudavym.com/studio/invite/<redacted>",
    ],
    // the @Public() iCal feed: a tenant-wide, never-expiring bearer. PR #427's
    // own security audit BLOCKED the first version of this fix for missing it.
    ["/api/v1/calendar/feed/9f3c1a.ics", "/api/v1/calendar/feed/<redacted>"],
    [
      "/api/v1/recommendations/digest/unsubscribe/TOK",
      "/api/v1/recommendations/digest/unsubscribe/<redacted>",
    ],
    // only ONE segment goes, so the route stays legible to an on-call
    [
      "/api/v1/auth/invite/CODE/accept",
      "/api/v1/auth/invite/<redacted>/accept",
    ],
    // the invite-REVOKE route: /invites/ is NOT /invite/, same code column.
    [
      "/api/v1/restaurants/1111/invites/XK7Q2M",
      "/api/v1/restaurants/1111/invites/<redacted>",
    ],
    [
      "/api/v1/mobile/devices/ExponentPushToken",
      "/api/v1/mobile/devices/<redacted>",
    ],
    // first match wins — pins indexOf against lastIndexOf
    ["/invite/AAA/invite/BBB", "/invite/<redacted>/invite/BBB"],
    ["/invite/SECRET?x=1", "/invite/<redacted>"],
    ["https://mudavym.com/orders", "https://mudavym.com/orders"],
    ["/", "/"],
    ["", ""],
  ])("%s -> %s", (raw: string, want: string) => {
    expect(scrubUrl(raw)).toBe(want);
  });

  it("scrubSentryEvent applies it to a real event", () => {
    const event: any = scrubSentryEvent({
      request: { url: "https://mudavym.com/reset-password?token=SECRET" },
    });
    expect(event.request.url).toBe("https://mudavym.com/reset-password");
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });

  it("drops request.query_string — INBOUND_WEBHOOK_SECRET arrives as a query param", () => {
    const event: any = scrubSentryEvent({
      request: { url: "/api/v1/inbound-email", query_string: "secret=SECRET" },
    });
    expect(event.request.query_string).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });

  it("scrubs the interceptor's extra.url, which scrubPiiKeys never reached", () => {
    const event: any = scrubSentryEvent({
      extra: { url: "/api/v1/calendar/feed/SECRETTOKEN.ics", method: "GET" },
    });
    expect(event.extra.url).toBe("/api/v1/calendar/feed/<redacted>");
    expect(JSON.stringify(event)).not.toContain("SECRETTOKEN");
  });

  it("does not throw on a malformed URL, because it runs on an error path", () => {
    expect(() => scrubUrl("http://[::1")).not.toThrow();
    expect(() => scrubUrl("%%%")).not.toThrow();
  });

  it("leaves a non-string url untouched rather than coercing it", () => {
    const event: any = scrubSentryEvent({ request: { url: 42 } });
    expect(event.request.url).toBe(42);
  });
});

// PR #427's round-2 audit found request.url/query_string being clean was not
// enough: OpenTelemetry keeps its OWN copy of the URL in `contexts.trace.data`
// and each `event.spans[].data`, and the transaction NAME is the raw path too
// -- none of it reached by scrubPiiKeys's key-name pass over `contexts`. These
// shapes are not guessed: `data`/`http.url`/`http.target`/`http.query` and
// `event.transaction`/`event.spans` are read straight from @sentry/core's own
// type declarations (types-hoist/{event,context,span}.d.ts) for the exact
// @sentry/node version this gateway has installed, not a hand-picked literal.
describe("OpenTelemetry's own copy of the URL (PR #427 round 2)", () => {
  it("scrubs contexts.trace.data — the calendar feed token survives request.url being clean", () => {
    const event: any = scrubSentryEvent({
      request: { url: "/api/v1/calendar/feed/<redacted>" }, // already fixed
      transaction: "GET /api/v1/calendar/feed/SECRETTOKEN.ics",
      contexts: {
        trace: {
          span_id: "abc123",
          trace_id: "def456",
          data: {
            url: "http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics",
            "http.url": "http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics",
            "http.target": "/api/v1/calendar/feed/SECRETTOKEN.ics",
            "sentry.source": "url",
          },
        },
      },
    });
    expect(event.transaction).toBe("GET /api/v1/calendar/feed/<redacted>");
    expect(event.contexts.trace.data.url).toBe(
      "http://mudavym.com/api/v1/calendar/feed/<redacted>",
    );
    expect(event.contexts.trace.data["http.url"]).toBe(
      "http://mudavym.com/api/v1/calendar/feed/<redacted>",
    );
    expect(event.contexts.trace.data["http.target"]).toBe(
      "/api/v1/calendar/feed/<redacted>",
    );
    expect(JSON.stringify(event)).not.toContain("SECRETTOKEN");
  });

  it("deletes contexts.trace.data['http.query'] — INBOUND_WEBHOOK_SECRET arrives as a query param", () => {
    const event: any = scrubSentryEvent({
      request: { url: "/api/v1/inbound-email" }, // already fixed
      contexts: {
        trace: {
          span_id: "abc123",
          trace_id: "def456",
          data: {
            "http.url": "http://mudavym.com/api/v1/inbound-email?secret=SECRET",
            "http.target": "/api/v1/inbound-email?secret=SECRET",
            "http.query": "secret=SECRET",
          },
        },
      },
    });
    expect(event.contexts.trace.data["http.query"]).toBeUndefined();
    expect(event.contexts.trace.data["http.url"]).toBe(
      "http://mudavym.com/api/v1/inbound-email",
    );
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });

  it("scrubs every span's own data, not just contexts.trace", () => {
    const event: any = scrubSentryEvent({
      spans: [
        {
          span_id: "s1",
          trace_id: "t1",
          start_timestamp: 0,
          data: { "http.url": "https://mudavym.com/invite/SECRETCODE" },
        },
        {
          span_id: "s2",
          trace_id: "t1",
          start_timestamp: 0,
          data: { "http.query": "secret=SECRET" },
        },
      ],
    });
    expect(event.spans[0].data["http.url"]).toBe(
      "https://mudavym.com/invite/<redacted>",
    );
    expect(event.spans[1].data["http.query"]).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });

  it("does not touch contexts.trace.data when there is no trace context", () => {
    const event: any = scrubSentryEvent({ request: { url: "/orders" } });
    expect(event.contexts).toBeUndefined();
  });
});
