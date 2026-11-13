import { describe, it, expect } from "vitest";
import {
  isTransientSessionReadFailure,
  retryAfterSeconds,
  sessionReadRetryDelayMs,
  SESSION_READ_BACKOFF_CAP_MS,
  SESSION_READ_MAX_DELAY_MS,
  SESSION_READ_SLOW_AFTER_MS,
  sessionReadWaitReason,
  sessionWaitNote,
} from "./sessionReadRetry";

const failed = (
  status?: number,
  extra: { headers?: unknown; data?: unknown } = {},
) => (status === undefined ? new Error("Network Error") : { response: { status, ...extra } });

describe("isTransientSessionReadFailure", () => {
  it.each([429, 408, 500, 502, 503, 504, 599])("%i is temporary", (s) => {
    expect(isTransientSessionReadFailure(failed(s))).toBe(true);
  });

  it("no response at all (network, timeout) is temporary", () => {
    expect(isTransientSessionReadFailure(failed())).toBe(true);
    expect(isTransientSessionReadFailure({ response: {} })).toBe(true);
    expect(isTransientSessionReadFailure(null)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 499, 600])(
    "%i is not temporary",
    (s) => {
      expect(isTransientSessionReadFailure(failed(s))).toBe(false);
    },
  );
});

describe("retryAfterSeconds", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");

  it("reads a seconds header", () => {
    expect(retryAfterSeconds(failed(429, { headers: { "retry-after": "12" } }), now)).toBe(12);
    expect(retryAfterSeconds(failed(429, { headers: { "retry-after": 5 } }), now)).toBe(5);
  });

  it("reads a header through an AxiosHeaders-style getter", () => {
    const headers = { get: (n: string) => (n === "retry-after" ? "9" : undefined) };
    expect(retryAfterSeconds(failed(429, { headers }), now)).toBe(9);
  });

  it("reads an HTTP-date header as seconds from now, never negative", () => {
    const at = new Date(now + 20_000).toUTCString();
    expect(retryAfterSeconds(failed(429, { headers: { "retry-after": at } }), now)).toBe(20);
    const past = new Date(now - 5_000).toUTCString();
    expect(retryAfterSeconds(failed(429, { headers: { "retry-after": past } }), now)).toBe(0);
  });

  it("falls back to the gateway's retryAfter body field when the header is unreadable", () => {
    expect(retryAfterSeconds(failed(429, { data: { retryAfter: 41 } }), now)).toBe(41);
    expect(
      retryAfterSeconds(failed(429, { headers: { "retry-after": "soon" }, data: { retryAfter: 3 } }), now),
    ).toBe(3);
  });

  it("is undefined when nothing parses", () => {
    expect(retryAfterSeconds(failed(429), now)).toBeUndefined();
    expect(retryAfterSeconds(failed(429, { data: { retryAfter: "7" } }), now)).toBeUndefined();
    expect(retryAfterSeconds(failed(429, { data: { retryAfter: -1 } }), now)).toBeUndefined();
    expect(retryAfterSeconds(failed(429, { data: { retryAfter: Infinity } }), now)).toBeUndefined();
  });
});

describe("sessionReadRetryDelayMs", () => {
  it("waits the server's Retry-After plus a 250 ms margin on a 429", () => {
    expect(sessionReadRetryDelayMs(failed(429, { data: { retryAfter: 7 } }), 0)).toBe(7_250);
    expect(sessionReadRetryDelayMs(failed(429, { headers: { "retry-after": "0.5" } }), 3)).toBe(750);
  });

  it("never waits longer than 60 s, whatever the server says", () => {
    expect(sessionReadRetryDelayMs(failed(429, { data: { retryAfter: 3600 } }), 0)).toBe(60_000);
    expect(SESSION_READ_MAX_DELAY_MS).toBe(60_000);
  });

  it("backs off 1, 2, 4, 8, 16 s then holds at 30 s without a Retry-After", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 20].map((a) => sessionReadRetryDelayMs(failed(503), a));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(SESSION_READ_BACKOFF_CAP_MS).toBe(30_000);
  });

  it("a 429 with no Retry-After backs off like any other temporary failure", () => {
    expect(sessionReadRetryDelayMs(failed(429), 2)).toBe(4_000);
  });

  it("a Retry-After on a non-429 is ignored (only the rate limit speaks for its window)", () => {
    expect(sessionReadRetryDelayMs(failed(503, { data: { retryAfter: 20 } }), 0)).toBe(1_000);
  });

  it("a network failure backs off, and a negative or fractional attempt is floored to 0", () => {
    expect(sessionReadRetryDelayMs(failed(), 1)).toBe(2_000);
    expect(sessionReadRetryDelayMs(failed(), -3)).toBe(1_000);
    expect(sessionReadRetryDelayMs(failed(), 1.9)).toBe(2_000);
  });
});

describe("sessionReadWaitReason (r22)", () => {
  it("a 429 is busy", () => {
    expect(sessionReadWaitReason(failed(429))).toBe("busy");
  });
  it.each([408, 500, 503, 599])("%i is the server", (s) => {
    expect(sessionReadWaitReason(failed(s))).toBe("server");
  });
  it("no response, or a response with no status, is offline", () => {
    expect(sessionReadWaitReason(failed())).toBe("offline");
    expect(sessionReadWaitReason({ response: {} })).toBe("offline");
    expect(sessionReadWaitReason(null)).toBe("offline");
  });
});

describe("sessionWaitNote (r22)", () => {
  it("says nothing for an ordinary read in its first seconds", () => {
    expect(sessionWaitNote(null, false)).toBeNull();
  });

  it("a slow read says so, without claiming the person is signed in", () => {
    const note = sessionWaitNote(null, true);
    expect(note).toBe("Still reaching Mudavym. This is taking longer than usual.");
    expect(note).not.toMatch(/signed in/);
  });

  it("the slow threshold is five seconds", () => {
    expect(SESSION_READ_SLOW_AFTER_MS).toBe(5_000);
  });

  it("a rate limit says busy, still signed in, and when", () => {
    expect(sessionWaitNote({ reason: "busy", delayMs: 40_250 }, false)).toBe(
      "Mudavym is busy for a moment. You are still signed in; we will ask again within a minute.",
    );
  });

  it("a short wait says a few seconds; ten seconds is still short, just past it is not", () => {
    expect(sessionWaitNote({ reason: "server", delayMs: 10_000 }, false)).toBe(
      "Mudavym is not answering right now. You are still signed in; we will ask again in a few seconds.",
    );
    expect(sessionWaitNote({ reason: "server", delayMs: 10_001 }, false)).toMatch(
      /within a minute\.$/,
    );
  });

  it("a dropped connection says check the connection, and that it asks again when it is back", () => {
    expect(sessionWaitNote({ reason: "offline", delayMs: 2_000 }, false)).toBe(
      "This device is not reaching Mudavym. Check the connection. You are still signed in; we will ask again in a few seconds, or as soon as the connection is back.",
    );
  });

  it("a known wait outranks the slow line", () => {
    expect(sessionWaitNote({ reason: "busy", delayMs: 1_000 }, true)).toMatch(/^Mudavym is busy/);
  });
});
