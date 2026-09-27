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

    it("strips identity from free-form extra and contexts, and drops the request body whole", () => {
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
      // Dropped, not key-scrubbed: the SDK sets it as a raw string (below).
      expect(event.request).not.toHaveProperty("data");
      expect(event.contexts.order).toEqual({ total: 42 });
      expect(event.contexts.account).toEqual({ plan: "pro" });
    });

    it("drops a request body the SDK attached as a raw string", () => {
      // @sentry/node-core's httpServerIntegration stores the body as utf-8 text;
      // a key-name scrub returns early on a string. PR #427 round 5.
      const event = scrubSentryEvent({
        request: {
          method: "POST",
          data: '{"token":"3f1c9a52-7d4e-4b8a-9c21-6e0f5a7d2b84","password":"hunter2"}',
        },
      });
      expect(event.request).not.toHaveProperty("data");
      expect(JSON.stringify(event)).not.toContain("3f1c9a52");
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
            "http.url":
              "http://mudavym.com/api/v1/calendar/feed/SECRETTOKEN.ics",
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

/**
 * PR #427 round 3 (2026-09-25): every token-bearing route, in every container
 * an event can carry a URL in. Mirrors the web runtime's table on purpose (two
 * copies of one rule; the guard proves they agree, these prove each one works).
 * The assertion is on the WHOLE serialized event, so a container nobody named
 * still fails the test if it carries the token.
 */
const REAL_TOKENS = {
  reset: "pkce_e1f3a5c7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7",
  verify:
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZXJpZnkifQ.Zk3pQ7rT9vX1bD5fH8jL2nP4sU6wY0aC",
  invite: "k7Qm2VxP9rTzL4nW",
  studio: "3f9c2a7e-5b1d-4e8f-a6c0-9d2b7e4f1a3c",
  feed: "9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c0b2d4f6e8a0c2e4f6a8b0d2f4e6a8c0b",
  unsubscribe: "u5b1e0c8f2a4d6b9e3c7f1a5d8b2e6c0f",
  device: "ExponentPushToken[xk8S2LmQ0pZr7Tn4Yv1WcA]",
  oauth: "4/0AanRRrs8Hq2ZtX9pL4mKw7",
  inbound: "whsec_3JfK8mQ2pL9vX5tR",
};

const API = "https://api.mudavym.com/api/v1";
const TOKEN_ROUTES: Array<[string, string, string]> = [
  [
    "reset-password (query)",
    `https://mudavym.com/reset-password?token=${REAL_TOKENS.reset}&type=recovery`,
    REAL_TOKENS.reset,
  ],
  [
    "verify-email (query)",
    `${API}/auth/verify-email?token=${REAL_TOKENS.verify}`,
    REAL_TOKENS.verify,
  ],
  [
    "invite preview",
    `${API}/auth/invite/${REAL_TOKENS.invite}`,
    REAL_TOKENS.invite,
  ],
  [
    "invite accept",
    `${API}/auth/invite/${REAL_TOKENS.invite}/accept`,
    REAL_TOKENS.invite,
  ],
  [
    "invite revoke",
    `${API}/restaurants/r1/invites/${REAL_TOKENS.invite}`,
    REAL_TOKENS.invite,
  ],
  [
    "studio invite",
    `https://mudavym.com/studio/invite/${REAL_TOKENS.studio}`,
    REAL_TOKENS.studio,
  ],
  [
    "iCal feed bearer",
    `${API}/calendar/feed/${REAL_TOKENS.feed}.ics`,
    REAL_TOKENS.feed,
  ],
  [
    "digest unsubscribe",
    `${API}/analytics/digest/unsubscribe/${REAL_TOKENS.unsubscribe}`,
    REAL_TOKENS.unsubscribe,
  ],
  [
    "push device",
    `${API}/mobile/devices/${REAL_TOKENS.device}`,
    REAL_TOKENS.device,
  ],
  [
    "OAuth callback code",
    `${API}/integrations/oauth/google/callback?code=${REAL_TOKENS.oauth}&state=s1`,
    REAL_TOKENS.oauth,
  ],
  [
    "inbound webhook secret",
    `${API}/inbound-email?secret=${REAL_TOKENS.inbound}`,
    REAL_TOKENS.inbound,
  ],
];

/** One event carrying `url` in every place the SDK (or our code) can put one. */
function eventCarrying(url: string, token: string): any {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const [bare, query = ""] = url.split("?");
  return {
    message: `failed at ${url}`,
    transaction: `GET ${path}`,
    request: {
      url,
      query_string: query,
      headers: { referer: url, "user-agent": "ua" },
    },
    extra: { url },
    breadcrumbs: [
      {
        category: "http",
        type: "http",
        data: {
          status_code: 200,
          url: bare,
          "http.method": "GET",
          "http.query": `?${query}`,
          "http.fragment": `#access_token=${token}`,
        },
      },
      {
        category: "console",
        message: `request to ${url} failed`,
        data: {
          arguments: [`request to ${url} failed`, 42],
          logger: "console",
        },
      },
    ],
    logentry: {
      message: "lookup failed for %s",
      params: [url],
      formatted: `lookup failed for ${url}`,
    },
    exception: {
      values: [
        {
          type: "Error",
          value: `Request failed for url '${url}'`,
          stacktrace: { frames: [{ filename: url, abs_path: url, lineno: 1 }] },
        },
      ],
    },
    contexts: {
      trace: { data: { url, "http.url": url, "http.target": path } },
    },
    spans: [{ data: { "url.full": url } }],
  };
}

describe("PR #427 round 3 — every token route, every container", () => {
  it.each(TOKEN_ROUTES)(
    "%s: the token reaches no container",
    (_label, url, token) => {
      const scrubbed = scrubSentryEvent(eventCarrying(url, token));
      expect(JSON.stringify(scrubbed)).not.toContain(token);
    },
  );

  it("keeps what triage needs: path shape, referer, user-agent, non-string args", () => {
    const url = `${API}/calendar/feed/${REAL_TOKENS.feed}.ics`;
    const event = scrubSentryEvent(eventCarrying(url, REAL_TOKENS.feed));
    expect(event.request.headers.referer).toBe(
      `${API}/calendar/feed/<redacted>`,
    );
    expect(event.request.headers["user-agent"]).toBe("ua");
    expect(event.breadcrumbs[0].data["http.query"]).toBeUndefined();
    expect(event.breadcrumbs[0].data["http.fragment"]).toBeUndefined();
    expect(event.breadcrumbs[1].data.arguments[1]).toBe(42);
    expect(event.transaction).toBe("GET /api/v1/calendar/feed/<redacted>");
  });

  it("leaves a filesystem frame path alone, so issue grouping survives", () => {
    const event: any = {
      exception: {
        values: [
          {
            value: "x",
            stacktrace: {
              frames: [
                { filename: "/var/task/dist/mobile/devices/registry.js" },
              ],
            },
          },
        ],
      },
    };
    scrubSentryEvent(event);
    expect(event.exception.values[0].stacktrace.frames[0].filename).toBe(
      "/var/task/dist/mobile/devices/registry.js",
    );
  });
});
