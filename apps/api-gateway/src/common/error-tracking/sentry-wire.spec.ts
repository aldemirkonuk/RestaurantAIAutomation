import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "./sentry.service";

/**
 * The scrubber on the WIRE, through the real @sentry/node client.
 *
 * sentry-pii.spec.ts mocks the SDK and hands `scrubSentryEvent` events it built
 * itself. PR #427's round-2 audit showed why that alone is not enough: the leak
 * it found lived in fields the SDK attaches that no hand-built fixture held.
 * Here the SDK does the merging — scope breadcrumbs in the exact shape
 * @sentry/node-core's outgoing fetch/http instrumentation builds
 * (`getBreadcrumbData`: the raw query in `data['http.query']`), the scope's
 * transaction name, the exception's own message — and the assertion is on the
 * serialized envelope the transport would have sent. PR #427 round 3.
 */
const FEED = "9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c0b2d4f6e8a0c2e4f6a8b0d2f4e6a8c0b";
const INVITE = "k7Qm2VxP9rTzL4nW";
const UNSUBSCRIBE = "u5b1e0c8f2a4d6b9e3c7f1a5d8b2e6c0f";
const INBOUND = "whsec_3JfK8mQ2pL9vX5tR";

type NodeClientOptions = ConstructorParameters<typeof Sentry.NodeClient>[0];

function clientCapturingEnvelopes(
  integrations: NonNullable<NodeClientOptions["integrations"]> = [],
) {
  const sent: string[] = [];
  const client = new Sentry.NodeClient({
    dsn: "https://public@example.test/1",
    integrations,
    stackParser: Sentry.defaultStackParser,
    sendDefaultPii: false,
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        sent.push(
          typeof request.body === "string"
            ? request.body
            : Buffer.from(request.body).toString("utf8"),
        );
        return { statusCode: 200 };
      }),
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
  const scope = new Sentry.Scope();
  scope.setClient(client);
  client.init();
  return { client, scope, sent };
}

describe("Sentry wire — the real SDK merges, the scrubber still wins", () => {
  it("no token leaves in the envelope from breadcrumbs, transaction or exception", async () => {
    const { client, scope, sent } = clientCapturingEnvelopes();
    // The calendar-feed lookup and the invite lookup, as the fetch
    // instrumentation records a PostgREST call.
    scope.addBreadcrumb({
      category: "http",
      type: "http",
      level: "info",
      data: {
        status_code: 200,
        url: "https://ref.supabase.co/rest/v1/calendar_feeds",
        "http.method": "GET",
        "http.query": `?select=*&token=eq.${FEED}`,
      },
    });
    scope.addBreadcrumb({
      category: "http",
      type: "http",
      level: "info",
      data: {
        status_code: 200,
        url: "https://ref.supabase.co/rest/v1/organization_invites",
        "http.method": "GET",
        "http.query": `?select=*&code=eq.${INVITE}`,
      },
    });
    scope.addBreadcrumb({
      category: "console",
      level: "warning",
      message: `inbound rejected: /api/v1/inbound-email?secret=${INBOUND}`,
      data: {
        arguments: [
          `inbound rejected: /api/v1/inbound-email?secret=${INBOUND}`,
        ],
        logger: "console",
      },
    });
    scope.setTransactionName(`GET /api/v1/calendar/feed/${FEED}.ics`);

    client.captureException(
      new Error(
        `unsubscribe failed for https://api.mudavym.com/api/v1/analytics/digest/unsubscribe/${UNSUBSCRIBE}`,
      ),
      {},
      scope,
    );
    await client.flush(2000);

    const wire = sent.join("\n");
    expect(sent.length).toBe(1);
    expect(wire).toContain("/calendar/feed/<redacted>");
    for (const token of [FEED, INVITE, UNSUBSCRIBE, INBOUND]) {
      expect(wire).not.toContain(token);
    }
  });

  // The SDK's OWN request body. @sentry/node-core's httpServerIntegration
  // (default on, `maxIncomingRequestBodySize` 'medium') copies every incoming
  // body it sees into the isolation scope as normalizedRequest.data -- a raw
  // utf-8 STRING of up to 10 KB, not a parsed object
  // (integrations/http/httpServerIntegration.js:333-346) -- and
  // requestDataIntegration's DEFAULT_INCLUDE has `data: true` whatever
  // sendDefaultPii says (@sentry/core integrations/requestdata.js:8-13). A key-name
  // scrub is a no-op on a string, so a POST /auth/reset-password body carried its
  // token and new password to Sentry on any 5xx or sampled transaction. ADR 0040
  // assumed "the SDK defaults already withheld bodies"; on Node they do not.
  it("no request body leaves: the SDK attaches it as a raw string", async () => {
    const RESET = "3f1c9a52-7d4e-4b8a-9c21-6e0f5a7d2b84";
    const REFRESH = "rt_Zk3pQ9wL2mX7vB4nH8sD";
    const { client, scope, sent } = clientCapturingEnvelopes([
      Sentry.requestDataIntegration(),
    ]);
    scope.setSDKProcessingMetadata({
      normalizedRequest: {
        method: "POST",
        url: "https://api.mudavym.com/api/v1/auth/reset-password",
        headers: { "content-type": "application/json" },
        data: JSON.stringify({ token: RESET, password: "hunter2hunter2" }),
      },
    });
    client.captureException(new Error("reset failed"), {}, scope);

    const second = clientCapturingEnvelopes([Sentry.requestDataIntegration()]);
    second.scope.setSDKProcessingMetadata({
      normalizedRequest: {
        method: "POST",
        url: "https://api.mudavym.com/api/v1/auth/refresh",
        data: { refreshToken: REFRESH },
      },
    });
    second.client.captureException(
      new Error("refresh failed"),
      {},
      second.scope,
    );
    await client.flush(2000);
    await second.client.flush(2000);

    const wire = [...sent, ...second.sent].join("\n");
    expect(sent.length).toBe(1);
    expect(second.sent.length).toBe(1);
    expect(wire).toContain("/auth/reset-password");
    for (const secret of [RESET, REFRESH, "hunter2hunter2"]) {
      expect(wire).not.toContain(secret);
    }
  });
});
