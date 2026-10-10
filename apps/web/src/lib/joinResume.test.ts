import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JOIN_HOLD_KEY,
  JOIN_RESUME_KEY,
  forgetJoin,
  holdJoin,
  pendingJoin,
  rememberJoin,
  takeHeldJoin,
} from "./joinResume";

const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe("joinResume (F-274, F-288)", () => {
  it("keeps a house or studio invite for the account that opened it, and no one else", () => {
    rememberJoin("/invite/AB12CD34", U);
    expect(pendingJoin(U)).toBe("/invite/AB12CD34");
    expect(pendingJoin(OTHER)).toBeNull();
    expect(pendingJoin(undefined)).toBeNull();
    rememberJoin("/studio/invite/tok_123", U);
    expect(pendingJoin(U)).toBe("/studio/invite/tok_123");
  });

  it("keeps nothing but the two invite pages", () => {
    for (const path of ["/inventory", "//evil.example", "/invite/x/../../a", "/invite/"]) {
      rememberJoin(path, U);
      expect(pendingJoin(U)).toBeNull();
    }
    localStorage.setItem(
      JOIN_RESUME_KEY,
      JSON.stringify({ path: "https://evil.example", userId: U, at: Date.now() }),
    );
    expect(pendingJoin(U)).toBeNull();
  });

  it("lets a kept invite lapse after a week, and forgets it on request", () => {
    vi.useFakeTimers();
    rememberJoin("/invite/AB12CD34", U);
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    expect(pendingJoin(U)).toBeNull();
    vi.useRealTimers();
    rememberJoin("/invite/AB12CD34", U);
    forgetJoin();
    expect(pendingJoin(U)).toBeNull();
  });
});

describe("holding an invite before the account exists (F-288)", () => {
  it("holds a join path in this tab only, path only, and taking it clears it", () => {
    holdJoin("/studio/invite/tok_123");
    expect(localStorage.getItem(JOIN_RESUME_KEY)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(JOIN_HOLD_KEY)!)).toEqual({
      path: "/studio/invite/tok_123",
      at: expect.any(Number),
    });
    expect(takeHeldJoin()).toBe("/studio/invite/tok_123");
    expect(takeHeldJoin()).toBeNull();
  });

  it("holds nothing but the two invite pages", () => {
    for (const path of ["/inventory", "//evil.example", "/invite/x/../../a"]) {
      holdJoin(path);
      expect(takeHeldJoin()).toBeNull();
    }
    sessionStorage.setItem(
      JOIN_HOLD_KEY,
      JSON.stringify({ path: "https://evil.example", at: Date.now() }),
    );
    expect(takeHeldJoin()).toBeNull();
  });

  it("lets a hold lapse after half an hour", () => {
    vi.useFakeTimers();
    holdJoin("/invite/AB12CD34");
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(takeHeldJoin()).toBeNull();
  });

  it("sign-out clears a hold too", () => {
    holdJoin("/invite/AB12CD34");
    forgetJoin();
    expect(takeHeldJoin()).toBeNull();
  });
});
