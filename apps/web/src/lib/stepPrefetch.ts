/**
 * Warm the next onboarding page while the person is on this one.
 *
 * Each loader uses the specifier App.tsx lazy-loads the same page with, so
 * the bundler gives one chunk and the page opens from the cache. A step is
 * fetched once per page life, only when the browser is idle, and never on a
 * connection that asked to save data or is slow. A failed fetch is dropped:
 * the page itself still loads on its own when it is opened.
 */
export type PrefetchStep = "get-started" | "house" | "house-menu";

/** Exported so a test can count calls; nothing else changes it. */
export const stepLoaders: Record<PrefetchStep, () => Promise<unknown>> = {
  "get-started": () => import("../pages/GetStarted"),
  house: () => import("../pages/HouseContents"),
  "house-menu": () => import("../pages/HouseMenu"),
};

const fetched = new Set<PrefetchStep>();

type Connection = { saveData?: boolean; effectiveType?: string };

function connectionIsThin(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as unknown as { connection?: Connection }).connection;
  return (
    c?.saveData === true ||
    c?.effectiveType === "2g" ||
    c?.effectiveType === "slow-2g"
  );
}

export function prefetchStep(name: PrefetchStep): void {
  if (fetched.has(name) || connectionIsThin()) return;
  fetched.add(name);
  try {
    stepLoaders[name]().catch(() => {});
  } catch {
    // A loader that throws before it is a promise is the same as a failed fetch.
  }
}

/** Run `fn` when the browser is idle; the returned function cancels it. */
export function onIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn);
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 1500);
  return () => clearTimeout(id);
}

/** Prefetch these steps once the browser is idle. Returns a canceller. */
export function prefetchWhenIdle(names: PrefetchStep[]): () => void {
  return onIdle(() => names.forEach(prefetchStep));
}

/** Test seam: forget what was fetched. */
export function resetStepPrefetch(): void {
  fetched.clear();
}
