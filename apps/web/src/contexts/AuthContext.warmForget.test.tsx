/**
 * Sign-out and a house switch both go through forgetHouseReads; the reports
 * page's warm start (r108 g8) keeps reads in sessionStorage, so that path must
 * clear them too, or the next person, or the next house, would see them.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  instance: {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  },
}));
vi.mock("axios", () => ({
  default: { create: () => h.instance, post: vi.fn() },
  create: () => h.instance,
  post: vi.fn(),
}));

import { forgetHouseReads } from "./AuthContext";
import { flushWarm, WARM_KEY, warmRead, warmWrite } from "../pages/reports/next/rp-warm";

describe("forgetHouseReads clears the reports warm start", () => {
  it("[REVERT-FAILS] leaves no warm read behind, in the store or in memory", () => {
    const owner = { userId: "u1", restaurantId: "r1", role: "owner" };
    const t = Date.now();
    warmWrite(owner, "till", { revenue: 4120 }, t);
    flushWarm(t);
    expect(sessionStorage.getItem(WARM_KEY)).not.toBeNull();
    forgetHouseReads(undefined);
    expect(sessionStorage.getItem(WARM_KEY)).toBeNull();
    expect(warmRead(owner, "till", t)).toBeUndefined();
  });
});
