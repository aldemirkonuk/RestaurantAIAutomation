import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AUTH_STORAGE_KEY, leaveDeadSession } from "./deadSession";

/**
 * ADR 0344, "Public pages stay put": the one reaction to a refused refresh
 * token, shared by the API client and the auth store's boot load.
 */

const realLocation = window.location;
const reload = vi.fn();
let href = "";
let pathname = "";

const at = (page: string) => {
  href = page;
  pathname = page;
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  localStorage.setItem("accessToken", "a");
  localStorage.setItem("refreshToken", "r");
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ state: { user: { id: "u" } } }));
  localStorage.setItem("activeRestaurantId", "house");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get pathname() {
        return pathname;
      },
      get href() {
        return href;
      },
      set href(v: string) {
        href = v;
      },
      reload,
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("leaveDeadSession", () => {
  it.each(["/", "/story", "/register", "/register/", "/login", "/privacy", "/terms"])(
    "reloads the public page %s with no session and no persisted person",
    (page) => {
      at(page);
      leaveDeadSession();
      expect(localStorage.getItem("accessToken")).toBeNull();
      expect(localStorage.getItem("refreshToken")).toBeNull();
      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
      expect(href).toBe(page);
    },
  );

  it.each(["/inventory", "/orders/123", "/studio/invite/abc"])(
    "sends the private page %s to /login, clearing the same keys",
    (page) => {
      at(page);
      leaveDeadSession();
      expect(localStorage.getItem("accessToken")).toBeNull();
      expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
      expect(href).toBe("/login");
    },
  );

  it("leaves the remembered house alone", () => {
    at("/");
    leaveDeadSession();
    expect(localStorage.getItem("activeRestaurantId")).toBe("house");
  });
});
