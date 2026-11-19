import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BUSY_RETRY_DEFAULT_SECONDS,
  busyRetrySeconds,
  forgetSharedMeRead,
  isHouseBusy,
  shareMeRead,
} from "./authMe";

const withStatus = (status: number | undefined, headers = {}) =>
  status === undefined ? new Error("Network Error") : { response: { status, headers } };

beforeEach(() => forgetSharedMeRead());

describe("shareMeRead", () => {
  it("gives callers that arrive while a read is in flight the same read", async () => {
    let finish!: (v: string) => void;
    const read = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const first = shareMeRead(read);
    const second = shareMeRead(read);
    finish("me");
    expect(await first).toBe("me");
    expect(await second).toBe("me");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shares a failure too, and asks again once it has settled", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(withStatus(429))
      .mockResolvedValueOnce("me");
    const a = shareMeRead(read);
    const b = shareMeRead(read);
    await expect(a).rejects.toBeTruthy();
    await expect(b).rejects.toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
    expect(await shareMeRead(read)).toBe("me");
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("the page-load read", () => {
  it("is handed to the other module after it settled, once each", async () => {
    const read = vi.fn(async () => "me");
    expect(await shareMeRead(read, "store")).toBe("me");
    await Promise.resolve();
    expect(await shareMeRead(read, "context")).toBe("me");
    expect(read).toHaveBeenCalledTimes(1);
    // Each module has had its one; the next ask goes to the gateway.
    await shareMeRead(read, "context");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is not kept past ten seconds, nor for a caller with no name", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => "me");
      await shareMeRead(read, "store");
      await shareMeRead(read);
      expect(read).toHaveBeenCalledTimes(2);
      vi.setSystemTime(Date.now() + 11_000);
      await shareMeRead(read, "context");
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("busy answers", () => {
  it("counts a 429 and a missing answer as busy, nothing else", () => {
    expect(isHouseBusy(withStatus(429))).toBe(true);
    expect(isHouseBusy(withStatus(undefined))).toBe(true);
    expect(isHouseBusy(withStatus(401))).toBe(false);
    expect(isHouseBusy(withStatus(500))).toBe(false);
    expect(isHouseBusy(withStatus(503))).toBe(false);
  });

  it("waits the gateway's Retry-After, else three seconds", () => {
    expect(busyRetrySeconds(withStatus(429, { "retry-after": "7" }))).toBe(7);
    expect(busyRetrySeconds(withStatus(429, { "retry-after": "12" }))).toBe(12);
    expect(busyRetrySeconds(withStatus(429, { "retry-after": "999" }))).toBe(20);
    expect(busyRetrySeconds(withStatus(429, { "retry-after": "0.2" }))).toBe(1);
    expect(busyRetrySeconds(withStatus(429, {}))).toBe(BUSY_RETRY_DEFAULT_SECONDS);
    expect(busyRetrySeconds(withStatus(undefined))).toBe(BUSY_RETRY_DEFAULT_SECONDS);
  });
});
