import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ names: [] as string[] }));

type Mod = typeof import("./stepPrefetch");
let m: Mod;

const connection = (value: unknown) =>
  Object.defineProperty(navigator, "connection", { value, configurable: true });

describe("stepPrefetch", () => {
  // A fresh copy of the module per test: its fetched-set and the mocked pages'
  // first load both start over.
  beforeEach(async () => {
    loaded.names.length = 0;
    vi.resetModules();
    for (const [page, name] of [
      ["GetStarted", "get-started"],
      ["HouseContents", "house"],
      ["HouseMenu", "house-menu"],
    ]) {
      vi.doMock(`../pages/${page}`, () => {
        loaded.names.push(name);
        return { default: () => null };
      });
    }
    m = await import("./stepPrefetch");
    connection(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    connection(undefined);
  });

  it("fetches a step once, however many times it is asked for", () => {
    const load = vi.fn(async () => undefined);
    m.stepLoaders["get-started"] = load;
    m.prefetchStep("get-started");
    m.prefetchStep("get-started");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads the page App.tsx lazy-loads, by its own specifier", async () => {
    m.prefetchStep("get-started");
    await vi.waitFor(() => expect(loaded.names).toEqual(["get-started"]));
  });

  it("drops a failed fetch, and a loader that throws at once", () => {
    m.stepLoaders.house = () => Promise.reject(new Error("offline"));
    m.stepLoaders["house-menu"] = () => {
      throw new Error("sync");
    };
    expect(() => {
      m.prefetchStep("house");
      m.prefetchStep("house-menu");
    }).not.toThrow();
  });

  it("fetches nothing when the connection asks to save data", async () => {
    connection({ saveData: true });
    m.prefetchStep("house");
    await vi.dynamicImportSettled();
    expect(loaded.names).toEqual([]);
  });

  it("fetches nothing on a 2g connection, and resumes on a faster one", async () => {
    connection({ effectiveType: "2g" });
    m.prefetchStep("house-menu");
    await vi.dynamicImportSettled();
    expect(loaded.names).toEqual([]);
    connection({ effectiveType: "4g" });
    m.prefetchStep("house-menu");
    await vi.dynamicImportSettled();
    expect(loaded.names).toEqual(["house-menu"]);
  });

  it("waits 1.5 s when the browser has no idle callback, and cancelling asks never", () => {
    vi.useFakeTimers();
    const ran = vi.fn();
    m.onIdle(ran);
    vi.advanceTimersByTime(1499);
    expect(ran).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ran).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn();
    m.onIdle(cancelled)();
    vi.advanceTimersByTime(5000);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("fetches the named steps only when the idle moment comes", async () => {
    let idle: () => void = () => {};
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      idle = cb;
      return 1;
    });
    m.prefetchWhenIdle(["house", "house-menu"]);
    await vi.dynamicImportSettled();
    expect(loaded.names).toEqual([]);
    idle();
    await vi.waitFor(() =>
      expect([...loaded.names].sort()).toEqual(["house", "house-menu"]),
    );
  });

  it("uses requestIdleCallback when the browser has it", () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const stop = m.onIdle(() => {});
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
