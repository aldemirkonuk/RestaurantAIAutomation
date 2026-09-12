import fs from "fs";
import path from "path";
import {
  EVENT_INVALIDATIONS,
  LIVE_EVENTS,
  PREFIX_KEY,
  invalidationsFor,
  socketUrl,
} from "@/lib/socketEvents";

/**
 * The gateway is the source of truth for event names. This reads its emit
 * sites rather than restating them, so the next time someone renames an event
 * server-side this test fails instead of the phone silently going quiet —
 * which is exactly how `order:updated` and `order_change` survived in the
 * mobile client while never once being emitted.
 */
const GATEWAY = path.resolve(
  __dirname,
  "../../../../api-gateway/src/websocket/websocket.gateway.ts",
);

function gatewayEmittedEvents(): string[] {
  const source = fs.readFileSync(GATEWAY, "utf8");
  const names = new Set<string>();
  const re = /emitToRoom\(\s*[^,]+,\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.add(m[1]);
  return [...names].sort();
}

describe("live event contract", () => {
  it("finds the gateway source (guard is useless if the path drifts)", () => {
    expect(fs.existsSync(GATEWAY)).toBe(true);
    expect(gatewayEmittedEvents().length).toBeGreaterThan(0);
  });

  it("subscribes only to events the gateway actually emits", () => {
    const emitted = new Set(gatewayEmittedEvents());
    const phantom = LIVE_EVENTS.filter((e) => !emitted.has(e));
    expect(phantom).toEqual([]);
  });

  it("subscribes to every gateway event that has a mobile cache", () => {
    // report:ready has no mobile screen yet but is wired to analytics; the
    // only acceptable omission is an event nothing on the phone can show.
    const emitted = gatewayEmittedEvents();
    const unsubscribed = emitted.filter((e) => !EVENT_INVALIDATIONS[e]);
    expect(unsubscribed).toEqual([]);
  });

  it("maps every event to at least one real query prefix", () => {
    for (const [event, prefixes] of Object.entries(EVENT_INVALIDATIONS)) {
      expect(prefixes.length).toBeGreaterThan(0);
      for (const p of prefixes) {
        expect(PREFIX_KEY[p]).toBeDefined();
      }
      expect(invalidationsFor(event).length).toBe(prefixes.length);
    }
  });

  it("returns no invalidations for an unknown event instead of throwing", () => {
    expect(invalidationsFor("something:new")).toEqual([]);
  });

  it("refreshes the decision feed whenever an order or stock level moves", () => {
    for (const event of [
      "order:created",
      "order:status_changed",
      "stock:updated",
      "stock:low",
      "notification:new",
    ]) {
      expect(EVENT_INVALIDATIONS[event]).toContain("mobile-feed");
    }
  });
});

describe("socketUrl", () => {
  it("appends the gateway's /ws namespace", () => {
    expect(socketUrl("http://localhost:8000")).toBe("http://localhost:8000/ws");
  });

  it("does not double the slash on a trailing-slash base", () => {
    expect(socketUrl("https://api.example.com/")).toBe(
      "https://api.example.com/ws",
    );
  });

  it("matches the namespace the gateway declares", () => {
    const source = fs.readFileSync(GATEWAY, "utf8");
    const m = /namespace:\s*"([^"]+)"/.exec(source);
    expect(m).not.toBeNull();
    expect(socketUrl("http://x")).toBe(`http://x${m![1]}`);
  });
});
